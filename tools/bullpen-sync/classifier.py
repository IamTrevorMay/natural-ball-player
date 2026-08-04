"""Physics-heuristic pitch classifier — the FALLBACK when the coach hasn't
selected a current pitch type.

The live B1 stream has no pitch type, so this makes a rough guess from velo,
spin, and movement. It is an APPROXIMATION, not Trackman classification — it
will mislabel some pitches (especially without knowing pitcher handedness). The
coach's current-pitch selection always overrides it, and every row is editable.

Movement convention (matches the mapper's inches output):
  induced_vert_break (IVB): + = "rides"/carries, - = drops
  horz_break (HB): sign is arm-side vs glove-side; we use magnitude only here
    since the stream doesn't give us handedness reliably.

Returned codes align with common short tags: FB, SI, CT, SL, CB, CH, SP.
"""
from __future__ import annotations

from typing import Any


def _num(v: Any) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def classify(row: dict[str, Any]) -> str | None:
    """Best-effort pitch type from a mapped metric row. None if too little data."""
    velo = _num(row.get("rel_speed"))
    spin = _num(row.get("spin_rate"))
    ivb = _num(row.get("induced_vert_break"))
    hb = _num(row.get("horz_break"))
    if velo is None:
        return None

    ivb = ivb if ivb is not None else 0.0
    hb = hb if hb is not None else 0.0
    hb_mag = abs(hb)

    # Offspeed by velocity first.
    if velo < 75:
        # Slow with big downward break → curveball; slow-ish soft = splitter/change.
        if ivb < 2:
            return "CB"
        return "CH"

    # Breaking-ball band.
    if 75 <= velo < 85:
        if ivb < -2 and spin and spin > 2200:
            return "CB"
        if hb_mag > 6 and ivb < 8:
            return "SL"
        if ivb < 6:
            return "CH"
        return "SL"

    # Hard band: fastball family vs hard slider/cutter.
    if velo >= 85:
        if hb_mag < 4 and 0 <= ivb < 10:
            return "CT"       # cutter: firm, little movement
        if ivb >= 12 and hb_mag >= 6:
            return "FB"       # 4-seam: ride + arm-side run
        if ivb >= 12:
            return "FB"
        if ivb < 8 and hb_mag >= 8:
            return "SI"       # sinker/2-seam: less ride, more run
        if velo >= 88:
            return "FB"
        return "SL"

    return None
