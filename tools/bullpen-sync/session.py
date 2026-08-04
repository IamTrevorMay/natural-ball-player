"""In-memory live bullpen session: frames in, typed rows + CSV out.

One active session at a time (one admin, one laptop). Frames arrive on the
sniffer thread; UI actions (set current pitch, edit a row, end) arrive on the
server thread — a lock guards the shared state.

Pitch typing (per the agreed hybrid):
  - If the coach has a current pitch type selected, new pitches tag with it.
  - Otherwise the physics heuristic (classifier.py) guesses.
  - Any row is editable afterward; a manual edit sticks.
An 'auto'-typed row re-classifies as later frames complete its metrics; 'coach'
and 'manual' rows are never overwritten.
"""
from __future__ import annotations

import threading
from datetime import datetime, timezone
from typing import Any

import classifier
import mapper
from csv_writer import CSV_COLUMNS, SessionCsv, make_filename

# Metric fields shown live on screen (the curated "key metrics" set).
DISPLAY_FIELDS = [
    "pitch_no", "tagged_pitch_type", "rel_speed", "spin_rate",
    "induced_vert_break", "horz_break", "plate_loc_height", "plate_loc_side",
]


def _now() -> datetime:
    return datetime.now(timezone.utc)


class LiveSession:
    def __init__(
        self,
        athlete: dict,          # {id, full_name, throws?}
        save_folder: str,
        captured_by: str | None,
    ) -> None:
        self.athlete = athlete
        self.captured_by = captured_by
        self.started_at = _now()
        self.current_pitch_type: str | None = None
        self._lock = threading.RLock()
        self._order: list[str] = []                 # pitch_uid in arrival order
        self._rows: dict[str, dict[str, Any]] = {}  # pitch_uid -> merged row (+meta)
        self._type_source: dict[str, str] = {}      # pitch_uid -> coach|auto|manual

        fname = make_filename(athlete.get("full_name", "athlete"), self.started_at)
        self.csv = SessionCsv(save_folder, fname)
        self._flush_csv()

    # ── Coach controls ──

    def set_current_pitch_type(self, ptype: str | None) -> None:
        with self._lock:
            self.current_pitch_type = (ptype or None)

    def edit_row_type(self, pitch_uid: str, ptype: str) -> dict | None:
        with self._lock:
            row = self._rows.get(pitch_uid)
            if row is None:
                return None
            row["tagged_pitch_type"] = ptype
            self._type_source[pitch_uid] = "manual"
            self._flush_csv()
            return self._display(row)

    # ── Frame ingest (sniffer thread) ──

    def on_frame(self, frame: dict, direction: str) -> dict | None:
        """Ingest one WS frame. Returns a display dict for the changed row, or
        None if the frame isn't a usable pitch measurement."""
        if not mapper.is_measurement(frame):
            return None
        mapped = mapper.map_measurement(frame)
        if mapped is None:
            return None
        uid = mapped.get("pitch_uid")
        if not uid:
            return None

        with self._lock:
            existing = self._rows.get(uid)
            if existing is None:
                merged = mapper.merge(None, mapped)
                merged["pitch_no"] = len(self._order) + 1
                self._order.append(uid)
                # Assign type at first sighting.
                if self.current_pitch_type:
                    merged["tagged_pitch_type"] = self.current_pitch_type
                    self._type_source[uid] = "coach"
                else:
                    merged["tagged_pitch_type"] = classifier.classify(merged)
                    self._type_source[uid] = "auto"
            else:
                pno = existing.get("pitch_no")
                tag = existing.get("tagged_pitch_type")
                merged = mapper.merge(existing, mapped)
                merged["pitch_no"] = pno
                merged["tagged_pitch_type"] = tag
                # Refine an auto guess as metrics complete.
                if self._type_source.get(uid) == "auto":
                    merged["tagged_pitch_type"] = classifier.classify(merged)

            self._rows[uid] = merged
            self._flush_csv()
            return self._display(merged)

    # ── Snapshot / end ──

    def rows_display(self) -> list[dict]:
        with self._lock:
            return [self._display(self._rows[u]) for u in self._order]

    def pitch_count(self) -> int:
        with self._lock:
            return len(self._order)

    def build_upload_payload(self) -> dict:
        """Assemble the trackman_sessions + trackman_pitches insert payload."""
        with self._lock:
            aid = self.athlete.get("id")
            aname = self.athlete.get("full_name")
            throws = self.athlete.get("throws")
            sid = f"live-{self.started_at.strftime('%Y%m%dT%H%M%S')}-{(aid or '')[:8]}"
            session = {
                "trackman_session_id": sid,
                "session_date": self.started_at.date().isoformat(),
                "session_type": "Pitching",
                "file_path": f"live/{sid}",   # synthetic; satisfies NOT NULL UNIQUE
                "pitch_count": len(self._order),
                "source": "live",
                "captured_by": self.captured_by,
            }
            pitches = []
            for uid in self._order:
                row = self._rows[uid]
                p = {k: row.get(k) for k in (
                    ["pitch_uid", "play_id", "thrown_date", "thrown_time",
                     "tagged_pitch_type"] + mapper.METRIC_COLUMNS + ["raw"]
                )}
                p["pitch_no"] = row.get("pitch_no")
                p["pitcher_user_id"] = aid
                p["pitcher_name"] = aname
                p["pitcher_throws"] = throws
                p["source"] = "live"
                pitches.append(p)
            return {"session": session, "pitches": pitches}

    def finalize_csv(self):
        with self._lock:
            return self._flush_csv()

    # ── internals ──

    def _display(self, row: dict) -> dict:
        d = {k: row.get(k) for k in DISPLAY_FIELDS}
        d["pitch_uid"] = row.get("pitch_uid")
        return d

    def _flush_csv(self):
        ordered = [self._rows[u] for u in self._order]
        meta = {
            "athlete": self.athlete.get("full_name"),
            "athlete_id": self.athlete.get("id"),
            "session_start": self.started_at.isoformat(),
            "source": "live (B1 WebSocket capture)",
        }
        return self.csv.write(ordered, header_meta=meta)
