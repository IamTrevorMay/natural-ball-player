"""Physics-heuristic pitch classifier — the FALLBACK when the coach hasn't
selected a current pitch type.

The live B1 stream has no pitch type, so this makes a rough guess from velo,
spin, and movement. It is an APPROXIMATION, not Trackman classification. The
coach's current-pitch selection always overrides it, and every row is editable
(live in the tool, and afterwards on the athlete's Trackman tab in the portal).

Handedness (#435): horizontal break is read SIGN-AWARE so arm-side run
(sinker / 4-seam / changeup) and glove-side sweep (slider / cutter / curve)
are told apart. The throwing hand comes from the athlete's player profile
(`throws`), falling back to the sign of the release-side metric on the pitch
itself (B1 reports release side from the pitcher's view: + = first-base side
= a right-hander's arm side).

Movement convention (matches the mapper's inches output):
  induced_vert_break (IVB): + = "rides"/carries, - = drops
  horz_break (HB): Trackman sign, + = toward first base / catcher's right.
    For a RHP that is arm side; for a LHP it is glove side. We fold it into
    `arm_side` (+ = arm-side run, - = glove-side sweep) once the hand is known.

Returned codes align with the tool's short tags: FB, SI, CT, SL, CB, CH, SP.
"""
from __future__ import annotations

from typing import Any


def _num(v: Any) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def normalize_hand(throws: Any) -> str | None:
    """'Right'/'R'/'RHP' → 'R', 'Left'/'L'/'LHP' → 'L', anything else → None."""
    if not throws:
        return None
    t = str(throws).strip().upper()
    if t.startswith("R"):
        return "R"
    if t.startswith("L"):
        return "L"
    return None


def infer_hand(row: dict[str, Any], throws: Any = None) -> str | None:
    """Profile hand first; else the release-side sign; else unknown."""
    hand = normalize_hand(throws)
    if hand:
        return hand
    rel_side = _num(row.get("rel_side"))
    # Within ~0.3 ft of centre the sign is noise (rare: true over-the-top).
    if rel_side is not None and abs(rel_side) >= 0.3:
        return "R" if rel_side > 0 else "L"
    return None


def classify(row: dict[str, Any], throws: Any = None) -> str | None:
    """Best-effort pitch type from a mapped metric row. None if too little data.

    `throws` is the athlete's profile throwing hand when known.
    """
    velo = _num(row.get("rel_speed"))
    spin = _num(row.get("spin_rate"))
    ivb = _num(row.get("induced_vert_break"))
    hb = _num(row.get("horz_break"))
    if velo is None:
        return None

    ivb = ivb if ivb is not None else 0.0
    hb = hb if hb is not None else 0.0
    hb_mag = abs(hb)

    hand = infer_hand(row, throws)
    # arm_side: + = arm-side run, - = glove-side sweep. None when the hand is
    # unknown, in which case we fall back to magnitude-only rules.
    if hand == "R":
        arm_side: float | None = hb
    elif hand == "L":
        arm_side = -hb
    else:
        arm_side = None

    runs_arm_side = arm_side is not None and arm_side > 3
    sweeps_glove_side = arm_side is not None and arm_side < -3

    # Slow band: curveball if it drops, otherwise a changeup/splitter.
    if velo < 75:
        if ivb < 2 and not runs_arm_side:
            return "CB"
        return "CH"

    # Mid band (75–85): breaking balls live here, but so do changeups and a
    # pro's warm-up fastballs. Arm-side run is NEVER a slider.
    if 75 <= velo < 85:
        if sweeps_glove_side or arm_side is None:
            if ivb < -2 and spin and spin > 2200:
                return "CB"
            if hb_mag > 6 and ivb < 8:
                return "SL"
            if ivb < 6:
                return "CH"
            return "SL"
        if runs_arm_side:
            if spin is not None and spin < 1900:
                return "CH"        # low-spin arm-side fade = changeup
            if ivb >= 12:
                return "FB"        # easy four-seam: ride + run
            if ivb < 10 and hb_mag >= 8:
                return "SI"        # easy sinker: run, little ride
            return "CH"            # arm-side fade, no ride
        # Little horizontal movement either way.
        if ivb < -2 and spin and spin > 2200:
            return "CB"
        if ivb < 6:
            return "CH"
        return "CT"

    # Hard band (85+): fastball family vs hard slider/cutter.
    if sweeps_glove_side:
        if ivb >= 6 and hb_mag < 8:
            return "CT"            # cutter: firm, short glove-side cut
        return "SL"                # hard slider / sweeper
    if runs_arm_side:
        if ivb >= 12:
            return "FB"            # 4-seam: ride + arm-side run
        if hb_mag >= 8:
            return "SI"            # sinker/2-seam: less ride, more run
        return "FB"
    if arm_side is None:
        # Hand unknown — magnitude-only legacy rules.
        if hb_mag < 4 and 0 <= ivb < 10:
            return "CT"
        if ivb >= 12:
            return "FB"
        if ivb < 8 and hb_mag >= 8:
            return "SI"
        if velo >= 88:
            return "FB"
        return "SL"
    # Hand known, movement nearly straight.
    if ivb < 10:
        return "CT"
    return "FB"
