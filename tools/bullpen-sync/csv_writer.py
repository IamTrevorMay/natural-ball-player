"""Crash-safe CSV writer for a live bullpen session.

Sessions are small (tens of pitches) and rows mutate as progressive frames
arrive, so we simply rewrite the whole file on each update via a temp-file swap.
The file is created at Start Session in the admin's chosen folder with a
generated name, so data is on disk the moment the first pitch lands.
"""
from __future__ import annotations

import csv
import os
import re
from pathlib import Path
from typing import Any

# Column order in the exported CSV. Metric names match NBP trackman_pitches.
CSV_COLUMNS = [
    "pitch_no", "tagged_pitch_type",
    "rel_speed", "spin_rate", "spin_axis", "tilt",
    "induced_vert_break", "horz_break", "vert_break",
    "plate_loc_height", "plate_loc_side",
    "rel_height", "rel_side", "extension",
    "zone_speed", "vert_appr_angle", "horz_appr_angle", "eff_velocity",
    "thrown_date", "thrown_time", "pitch_uid", "play_id",
]


def _slug(s: str) -> str:
    s = re.sub(r"[^A-Za-z0-9]+", "_", (s or "").strip())
    return s.strip("_") or "athlete"


def make_filename(athlete_name: str, started_at) -> str:
    """e.g. 'Smith_John_2026-07-31_1432.csv' from a datetime."""
    stamp = started_at.strftime("%Y-%m-%d_%H%M")
    return f"{_slug(athlete_name)}_{stamp}.csv"


class SessionCsv:
    def __init__(self, folder: str | Path, filename: str) -> None:
        self.folder = Path(folder)
        self.path = self.folder / filename

    def write(self, rows: list[dict[str, Any]], header_meta: dict[str, Any] | None = None) -> Path:
        """Rewrite the CSV from the full ordered row list (atomic swap)."""
        self.folder.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".csv.tmp")
        with open(tmp, "w", newline="", encoding="utf-8") as fp:
            if header_meta:
                # Human-readable preamble (athlete/session), then a blank line.
                w = csv.writer(fp)
                for k, v in header_meta.items():
                    w.writerow([f"# {k}", v])
                w.writerow([])
            w = csv.DictWriter(fp, fieldnames=CSV_COLUMNS, extrasaction="ignore")
            w.writeheader()
            for r in rows:
                w.writerow({k: r.get(k) for k in CSV_COLUMNS})
        os.replace(tmp, self.path)
        return self.path
