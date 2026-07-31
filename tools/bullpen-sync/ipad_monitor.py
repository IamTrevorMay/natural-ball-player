"""iPad USB lifecycle + rvictl automation — callback-based (no Qt).

Ported from Triton-Vision's triton/integrations/ipad_monitor.py. Polls
`xcrun xctrace list devices`; when a trusted iPad appears it runs
`rvictl -s <UDID>` so the mirror interface `rvi0` exists for the sniffer, and
tears it down (`rvictl -x`) on disconnect.

rvictl needs root. Either add a sudoers NOPASSWD rule:

    sudo visudo
    <user> ALL=(root) NOPASSWD: /Library/Apple/usr/bin/rvictl

or run the tool from a shell with cached sudo creds. If neither is set, rvictl
fails and on_status reports it, but the rest of the tool still runs.

Callbacks:
    on_status(status: str)   # 'ipad:<name>' | 'rvi0:ready' | 'rvi0:error:<reason>' | 'ipad:gone'
"""
from __future__ import annotations

import logging
import os
import re
import shutil
import subprocess
import threading
import time
from typing import Callable

log = logging.getLogger(__name__)

RVICTL_PATH = "/Library/Apple/usr/bin/rvictl"
StatusCB = Callable[[str], None]


def _safe_run(cmd: list[str], timeout: float = 10.0) -> str:
    """posix_spawnp-based subprocess (avoids fork(), which macOS aborts after
    Objective-C runtime init). Faithful to Triton's implementation."""
    import errno
    import select as _sel

    exe = shutil.which(cmd[0])
    if exe is None:
        return ""
    rd, wr = os.pipe()
    file_actions = [
        (os.POSIX_SPAWN_DUP2, wr, 1),
        (os.POSIX_SPAWN_CLOSE, rd),
        (os.POSIX_SPAWN_CLOSE, wr),
    ]
    try:
        pid = os.posix_spawnp(exe, [exe, *cmd[1:]], os.environ, file_actions=file_actions)
    except OSError:
        os.close(rd); os.close(wr)
        return ""
    os.close(wr)

    deadline = time.time() + timeout
    chunks: list[bytes] = []
    try:
        while True:
            remaining = deadline - time.time()
            if remaining <= 0:
                break
            r_ready, _, _ = _sel.select([rd], [], [], min(remaining, 0.5))
            if r_ready:
                try:
                    chunk = os.read(rd, 65536)
                except OSError as e:
                    if e.errno in (errno.EAGAIN, errno.EWOULDBLOCK):
                        continue
                    break
                if not chunk:
                    break
                chunks.append(chunk)
                continue
            done_pid, _ = os.waitpid(pid, os.WNOHANG)
            if done_pid != 0:
                while True:
                    try:
                        chunk = os.read(rd, 65536)
                    except OSError:
                        break
                    if not chunk:
                        break
                    chunks.append(chunk)
                break
    finally:
        os.close(rd)
        try:
            os.waitpid(pid, 0)
        except ChildProcessError:
            pass
    return b"".join(chunks).decode("utf-8", errors="replace")


def _list_known_ipads() -> list[tuple[str, str, bool]]:
    try:
        out = _safe_run(["xcrun", "xctrace", "list", "devices"], timeout=10)
        if not out:
            return []
    except Exception:
        return []
    found: list[tuple[str, str, bool]] = []
    section = None
    for raw in out.splitlines():
        line = raw.strip()
        if line == "== Devices ==":
            section = "online"; continue
        if line == "== Devices Offline ==":
            section = "offline"; continue
        if line.startswith("==") and line.endswith("=="):
            section = None; continue
        if section is None or not line:
            continue
        m = re.match(r"^(.+?)\s+\(([^)]+)\)\s+\(([0-9A-Fa-f-]{20,})\)\s*$", line)
        if m:
            name, _ver, udid = m.group(1), m.group(2), m.group(3)
            if "ipad" in name.lower():
                found.append((name, udid, section == "online"))
    return found


def _devicectl_paired_names() -> set[str]:
    try:
        out = _safe_run(["xcrun", "devicectl", "list", "devices"], timeout=8)
        if not out:
            return set()
    except Exception:
        return set()
    paired = set()
    for line in out.splitlines():
        if "available (paired)" in line.lower():
            name = line.split("  ")[0].strip()
            if name:
                paired.add(name)
    return paired


def _list_online_ipads() -> list[tuple[str, str]]:
    known = _list_known_ipads()
    paired = _devicectl_paired_names()
    return [(n, u) for (n, u, online) in known if online or n in paired]


def _rvi_interface_exists() -> bool:
    try:
        return bool(_safe_run(["ifconfig", "rvi0"], timeout=3))
    except Exception:
        return False


class IpadMonitor:
    """Watches trusted-iPad presence + drives rvictl. Callback-based."""

    def __init__(
        self,
        on_status: StatusCB | None = None,
        preferred_udid: str | None = None,
        poll_interval_s: float = 3.0,
        manage_rvictl: bool = True,
        use_sudo: bool = True,
    ) -> None:
        self._on_status = on_status or (lambda s: None)
        self._preferred_udid = preferred_udid
        self._poll = poll_interval_s
        self._manage_rvictl = manage_rvictl
        self._use_sudo = use_sudo
        self._stop_flag = threading.Event()
        self._thread: threading.Thread | None = None
        self._active_udid: str | None = None

    @property
    def active_udid(self) -> str | None:
        return self._active_udid

    def _status(self, s: str) -> None:
        try:
            self._on_status(s)
        except Exception as e:
            log.warning(f"status cb failed — {e}")

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop_flag.clear()
        self._thread = threading.Thread(target=self._run, name="IpadMonitor", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop_flag.set()
        t = self._thread
        if t is not None and t is not threading.current_thread():
            t.join(timeout=20)
        udid = self._active_udid
        if udid and self._manage_rvictl:
            try:
                self._run_rvictl_teardown(udid)
            except Exception as e:
                log.warning(f"teardown failed — {e}")
        self._thread = None
        self._active_udid = None

    def _run(self) -> None:
        log.info("IpadMonitor: polling")
        while not self._stop_flag.is_set():
            try:
                online = _list_online_ipads()
            except Exception:
                online = []

            chosen: tuple[str, str] | None = None
            if self._preferred_udid:
                for n, u in online:
                    if u == self._preferred_udid:
                        chosen = (n, u); break
            if chosen is None and online:
                chosen = online[0]
            current_udid = chosen[1] if chosen else None

            if current_udid is None and self._active_udid is not None:
                if self._manage_rvictl:
                    self._run_rvictl_teardown(self._active_udid)
                self._status("ipad:gone")
                self._active_udid = None

            elif current_udid is not None and current_udid != self._active_udid:
                if self._active_udid is not None and self._manage_rvictl:
                    self._run_rvictl_teardown(self._active_udid)
                name, udid = chosen
                self._status(f"ipad:{name}")
                if self._manage_rvictl:
                    if _rvi_interface_exists():
                        self._active_udid = udid
                        self._status("rvi0:ready")
                    else:
                        ok, err = self._run_rvictl_setup(udid)
                        if ok:
                            self._active_udid = udid
                            self._status("rvi0:ready")
                        else:
                            self._status(f"rvi0:error:{err}")
                else:
                    self._active_udid = udid
                    if _rvi_interface_exists():
                        self._status("rvi0:ready")

            self._stop_flag.wait(self._poll)
        log.info("IpadMonitor: stopped")

    def _rvictl_cmd(self, args: list[str]) -> list[str]:
        if not shutil.which(RVICTL_PATH) and not shutil.which("rvictl"):
            return []
        path = RVICTL_PATH if shutil.which(RVICTL_PATH) else "rvictl"
        if self._use_sudo:
            return ["sudo", "-n", path, *args]
        return [path, *args]

    def _run_rvictl_setup(self, udid: str) -> tuple[bool, str]:
        cmd = self._rvictl_cmd(["-s", udid])
        if not cmd:
            return False, "rvictl binary not found"
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        except Exception as e:
            return False, f"rvictl run failed: {e!r}"
        ok = r.returncode == 0 and "SUCCEEDED" in (r.stdout or "")
        if ok:
            for _ in range(10):
                if _rvi_interface_exists():
                    return True, ""
                time.sleep(0.3)
            return True, ""
        err = (r.stderr or r.stdout or "rvictl unknown failure").strip()
        return False, err[:200]

    def _run_rvictl_teardown(self, udid: str) -> None:
        cmd = self._rvictl_cmd(["-x", udid])
        if not cmd:
            return
        try:
            subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        except Exception as e:
            log.debug(f"teardown error — {e}")
