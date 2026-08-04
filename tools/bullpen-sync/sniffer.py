"""Live Trackman B1 WebSocket sniffer — callback-based (no Qt).

Ported from Triton-Vision's triton/integrations/trackman_sniff.py. The WS-frame
parser and TCP reassembly (`_WSStream`) are unchanged — that logic is proven.
The only rework is the delivery layer: instead of PyQt signals this emits via
two plain callbacks so it drops cleanly into a FastAPI app:

    on_frame(frame: dict, direction: str)   # direction "S->C" (B1->iPad) / "C->S"
    on_status(status: str)                  # 'starting'|'connected'|'stopped'|'error:...'

Assumes rvi0 is up (rvictl -s <iPad UDID>, driven by ipad_monitor). Spawns
tcpdump on the interface, reassembles TCP per flow, parses WS text frames, and
hands each decoded JSON object to on_frame.

Replay mode: construct with replay_jsonl=<path> to emit frames from a recorded
trackman_ws.jsonl (schema: {"ts","dir","frame"}) with no tcpdump/root needed.
"""
from __future__ import annotations

import json
import logging
import re
import struct
import subprocess
import threading
import time
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Callable

log = logging.getLogger(__name__)

FrameCB = Callable[[dict, str], None]
StatusCB = Callable[[str], None]


# ── WS frame parser (verbatim from Triton) ──

class _WSStream:
    """Per-direction byte buffer + WS frame parser with in-order TCP reassembly."""

    def __init__(self) -> None:
        self.buf = bytearray()
        self.next_seq: int | None = None
        self.pending: dict[int, bytes] = {}

    PENDING_CAP = 256
    MAX_FRAME = 16 * 1024 * 1024
    _VALID_OPCODES = frozenset((0x0, 0x1, 0x2, 0x8, 0x9, 0xA))

    def feed(self, seq: int, data: bytes) -> None:
        if self.next_seq is None:
            self.next_seq = seq
        end = seq + len(data)
        if seq == self.next_seq:
            self.buf.extend(data)
            self.next_seq += len(data)
            while self.next_seq in self.pending:
                d = self.pending.pop(self.next_seq)
                self.buf.extend(d)
                self.next_seq += len(d)
        elif seq > self.next_seq:
            self.pending[seq] = data
            if len(self.pending) > self.PENDING_CAP:
                self.pending.pop(max(self.pending), None)
        elif end > self.next_seq:
            tail = data[self.next_seq - seq:]
            self.buf.extend(tail)
            self.next_seq += len(tail)
            while self.next_seq in self.pending:
                d = self.pending.pop(self.next_seq)
                self.buf.extend(d)
                self.next_seq += len(d)

    def frames(self):
        i = 0
        while True:
            if i + 2 > len(self.buf):
                break
            b0 = self.buf[i]; b1 = self.buf[i + 1]
            opcode = b0 & 0x0F
            masked = b1 & 0x80
            plen = b1 & 0x7F
            if opcode not in self._VALID_OPCODES:
                self.buf.clear()
                return
            j = i + 2
            if plen == 126:
                if j + 2 > len(self.buf): break
                plen = struct.unpack(">H", bytes(self.buf[j:j+2]))[0]; j += 2
            elif plen == 127:
                if j + 8 > len(self.buf): break
                plen = struct.unpack(">Q", bytes(self.buf[j:j+8]))[0]; j += 8
            if plen > self.MAX_FRAME:
                self.buf.clear()
                return
            if masked:
                if j + 4 > len(self.buf): break
                mask = bytes(self.buf[j:j+4]); j += 4
            else:
                mask = b"\x00\x00\x00\x00"
            if j + plen > len(self.buf): break
            payload = bytes(self.buf[j:j+plen])
            if masked:
                payload = bytes(p ^ mask[k % 4] for k, p in enumerate(payload))
            yield (opcode, bool(masked), payload)
            i = j + plen
        if i > 0:
            del self.buf[:i]


# ── B1 IP autodetect ──

_API_PROBE_RE = re.compile(rb"GET\s+/api[/?\s]")


def _find_b1_ip_from_scapy_pkt(pkt) -> str | None:
    from scapy.layers.inet import IP, TCP
    if IP not in pkt or TCP not in pkt:
        return None
    payload = bytes(pkt[TCP].payload)
    if not payload:
        return None
    if _API_PROBE_RE.search(payload):
        return pkt[IP].dst
    return None


class TrackmanSniffer:
    """Live WS sniffer for an iPad-tethered B1, delivered via callbacks."""

    def __init__(
        self,
        on_frame: FrameCB,
        on_status: StatusCB | None = None,
        iface: str = "rvi0",
        b1_ip: str | None = None,
        autodetect_b1: bool = True,
        replay_jsonl: Path | str | None = None,
        replay_rate: str | float = "realtime",
    ) -> None:
        self._on_frame = on_frame
        self._on_status = on_status or (lambda s: None)
        self._iface = iface
        self._b1_ip = b1_ip
        self._autodetect = autodetect_b1
        self._proc: subprocess.Popen | None = None
        self._thread: threading.Thread | None = None
        self._stop_flag = threading.Event()
        self._connected = False
        self._replay_jsonl = Path(replay_jsonl) if replay_jsonl else None
        self._replay_rate = replay_rate

    @property
    def is_replay(self) -> bool:
        return self._replay_jsonl is not None

    @property
    def b1_ip(self) -> str | None:
        return self._b1_ip

    @property
    def is_connected(self) -> bool:
        return self._connected

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop_flag.clear()
        target = self._replay_run if self._replay_jsonl is not None else self._run
        self._thread = threading.Thread(target=target, name="TrackmanSniffer", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop_flag.set()
        if self._proc is not None:
            try: self._proc.terminate()
            except Exception: pass
        if self._thread is not None:
            self._thread.join(timeout=3)
        self._thread = None
        self._proc = None
        self._connected = False
        self._status("stopped")

    def _status(self, s: str) -> None:
        try:
            self._on_status(s)
        except Exception as e:
            log.warning(f"status cb failed — {e}")

    # ── Worker: live capture ──

    def _run(self) -> None:
        self._status("starting")
        try:
            from scapy.all import PcapReader
            from scapy.layers.inet import IP, TCP
        except Exception as e:
            log.error(f"scapy import failed — {e}")
            self._status(f"error:scapy:{e}")
            return

        filter_expr = f"host {self._b1_ip} and tcp" if self._b1_ip else "tcp port 80"
        cmd = ["tcpdump", "-i", self._iface, "-y", "RAW", "-U", "-w", "-", "-n", filter_expr]
        try:
            self._proc = subprocess.Popen(
                cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, bufsize=0,
            )
        except FileNotFoundError:
            log.error("tcpdump not found")
            self._status("error:tcpdump_missing")
            return
        if self._proc.stdout is None:
            self._status("error:no_stdout")
            return

        parsers: dict[tuple, _WSStream] = defaultdict(_WSStream)
        try:
            reader = PcapReader(self._proc.stdout)
            for pkt in reader:
                if self._stop_flag.is_set():
                    break
                if IP not in pkt or TCP not in pkt:
                    continue

                if self._b1_ip is None and self._autodetect:
                    ip = _find_b1_ip_from_scapy_pkt(pkt)
                    if ip is not None:
                        self._b1_ip = ip
                        self._connected = True
                        self._status("connected")
                        log.info(f"B1 locked to {ip}")

                if self._b1_ip is not None:
                    if pkt[IP].src != self._b1_ip and pkt[IP].dst != self._b1_ip:
                        continue
                    if not self._connected:
                        self._connected = True
                        self._status("connected")

                key = (pkt[IP].src, pkt[TCP].sport, pkt[IP].dst, pkt[TCP].dport)

                flags = int(pkt[TCP].flags)
                if flags & 0x05:  # FIN | RST — evict both directions of this flow
                    parsers.pop(key, None)
                    parsers.pop((pkt[IP].dst, pkt[TCP].dport, pkt[IP].src, pkt[TCP].sport), None)
                    continue

                payload = bytes(pkt[TCP].payload)
                if not payload:
                    continue
                parsers[key].feed(pkt[TCP].seq, payload)

                first_bytes = bytes(parsers[key].buf[:8]) if parsers[key].buf else b""
                if first_bytes.startswith((b"GET ", b"POST", b"PUT ", b"HEAD", b"HTTP")):
                    parsers[key].buf.clear()
                    continue

                direction = "S->C" if self._b1_ip and pkt[IP].src == self._b1_ip else "C->S"
                for op, masked, pl in parsers[key].frames():
                    if op != 0x1:
                        continue
                    try:
                        obj = json.loads(pl.decode("utf-8"))
                    except Exception:
                        continue
                    if not isinstance(obj, dict):
                        continue
                    if obj.get("Type") in ("Ping", "Pong"):
                        continue
                    try:
                        self._on_frame(obj, direction)
                    except Exception as e:
                        log.warning(f"frame cb failed — {e}")
        except Exception as e:
            log.error(f"read loop error — {e!r}")
            self._status(f"error:{e!r}")
        finally:
            if self._proc is not None and self._proc.poll() is None:
                try: self._proc.terminate(); self._proc.wait(timeout=2)
                except Exception:
                    try: self._proc.kill()
                    except Exception: pass
            self._connected = False
            self._status("stopped")

    # ── Worker: replay ──

    def _replay_run(self) -> None:
        self._status("starting")
        path = self._replay_jsonl
        if path is None or not path.exists():
            log.error(f"replay path missing — {path}")
            self._status(f"error:replay_missing:{path}")
            return
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except OSError as e:
            self._status(f"error:replay_read:{e}")
            return

        self._connected = True
        self._status("connected")

        realtime = self._replay_rate == "realtime"
        try:
            fixed_delay = None if realtime else 1.0 / float(self._replay_rate)
        except (TypeError, ValueError):
            fixed_delay = None
            realtime = True

        prev_ts: datetime | None = None
        for line in lines:
            if self._stop_flag.is_set():
                break
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            frame = entry.get("frame") if isinstance(entry, dict) else None
            direction = entry.get("dir") or entry.get("direction") or "S->C"
            if not isinstance(frame, dict):
                continue
            if realtime:
                ts_str = entry.get("ts")
                try:
                    ts_now = datetime.fromisoformat(ts_str.rstrip("Z")) if ts_str else None
                except (ValueError, AttributeError):
                    ts_now = None
                if prev_ts is not None and ts_now is not None:
                    delta = (ts_now - prev_ts).total_seconds()
                    if 0 < delta < 5.0:
                        time.sleep(delta)
                prev_ts = ts_now
            elif fixed_delay:
                time.sleep(fixed_delay)
            if frame.get("Type") in ("Ping", "Pong"):
                continue
            try:
                self._on_frame(frame, direction)
            except Exception as e:
                log.warning(f"replay frame cb failed — {e}")

        self._connected = False
        self._status("stopped")
