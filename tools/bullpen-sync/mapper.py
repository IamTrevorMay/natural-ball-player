"""B1 WebSocket Measurement frame -> NBP trackman_pitches column dict.

The B1 emits SI units (m, m/s). NBP's trackman_pitches (migration 20260704)
follows the Trackman CSV convention: mph for speed, ft for distance, inches for
movement. This maps field names AND converts units, mirroring Triton's
trackman_mapper but targeting NBP's exact column set.

Only the physics/metric columns are produced here. The session layer adds
pitch_no, pitcher identity, tagged_pitch_type, session linkage, and source.

NOTE: the live B1 stream carries NO pitch classification (verified against real
captures — only Trackman's cloud adds AutoPitchType later). Pitch type is set by
the coach's current-pitch selection or the physics heuristic in classifier.py.
"""
from __future__ import annotations

from typing import Any

MPS_TO_MPH = 2.23693629
M_TO_FT = 3.28084
M_TO_IN = 39.3700787

# CSV/DB column order for the metric fields this mapper produces.
METRIC_COLUMNS = [
    "rel_speed", "spin_rate", "spin_axis", "tilt",
    "rel_height", "rel_side", "extension",
    "vert_break", "induced_vert_break", "horz_break",
    "plate_loc_height", "plate_loc_side", "zone_speed",
    "vert_appr_angle", "horz_appr_angle", "eff_velocity",
]


def _f(v: Any) -> float | None:
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def _mph(v: Any) -> float | None:
    x = _f(v)
    return round(x * MPS_TO_MPH, 4) if x is not None else None


def _ft(v: Any) -> float | None:
    x = _f(v)
    return round(x * M_TO_FT, 4) if x is not None else None


def _in(v: Any) -> float | None:
    x = _f(v)
    return round(x * M_TO_IN, 4) if x is not None else None


def _safe(d: Any) -> dict:
    return d if isinstance(d, dict) else {}


def is_measurement(frame: dict) -> bool:
    return isinstance(frame, dict) and frame.get("Type") == "Measurement"


def pitch_uid(frame: dict) -> str | None:
    """Stable id across the 3 progressive Kind frames (LaunchData/FlightData/
    Measurement) that make up one shot."""
    payload = _safe(frame.get("Payload"))
    pitch = _safe(payload.get("Pitch"))
    return frame.get("Id") or payload.get("Id") or pitch.get("TrackId")


def map_measurement(frame: dict) -> dict[str, Any] | None:
    """Map one Measurement frame to the NBP metric-column dict (+ raw + times).

    Returns None if the frame isn't a usable Measurement with pitch data.
    """
    if not is_measurement(frame):
        return None
    payload = _safe(frame.get("Payload"))
    pitch = _safe(payload.get("Pitch"))
    if not pitch:
        return None

    release = _safe(pitch.get("Release"))
    location = _safe(pitch.get("Location"))
    trajectory = _safe(pitch.get("Trajectory"))

    iso_time = payload.get("Time") or pitch.get("TrackTime") or ""
    thrown_date = thrown_time = None
    if isinstance(iso_time, str) and "T" in iso_time:
        date_part, time_part = iso_time.split("T", 1)
        thrown_date = date_part
        thrown_time = time_part.rstrip("Z").split(".")[0]

    return {
        "pitch_uid": pitch_uid(frame),
        "play_id": pitch.get("TrackId"),
        "thrown_date": thrown_date,
        "thrown_time": thrown_time,

        "rel_speed": _mph(release.get("Speed")),
        "spin_rate": _f(release.get("SpinRate")),
        "spin_axis": _f(release.get("SpinAxis")),
        "tilt": release.get("Tilt"),
        "rel_height": _ft(release.get("Height")),
        "rel_side": _ft(release.get("Side")),
        "extension": _ft(release.get("Extension")),

        "vert_break": _in(trajectory.get("VerticalBreak")),
        "induced_vert_break": _in(trajectory.get("InducedVerticalBreak")),
        "horz_break": _in(trajectory.get("HorizontalBreak")),

        "plate_loc_height": _ft(location.get("Height")),
        "plate_loc_side": _ft(location.get("Side")),
        "zone_speed": _mph(location.get("Speed")),
        "vert_appr_angle": _f(location.get("Angle")),
        "horz_appr_angle": _f(location.get("Direction")),
        "eff_velocity": _mph(pitch.get("EffectiveVelocity")),

        # Forward-compat: keep the entire WS Payload so nothing is ever lost.
        "raw": payload,
    }


def merge(base: dict[str, Any] | None, new: dict[str, Any]) -> dict[str, Any]:
    """Merge a newer (more complete) frame's row over an earlier one for the same
    pitch_uid. Non-null/non-empty values from `new` win; earlier values fill gaps.
    """
    if base is None:
        return dict(new)
    merged = dict(base)
    for k, v in new.items():
        if v is not None and v != "":
            merged[k] = v
    return merged
