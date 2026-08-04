"""Static config + on-disk user settings for BullpenSync.

The Supabase URL + anon key are the SAME public values the NBP web app ships
(src/supabaseClient.js) — the anon key is safe to embed; every real permission
is enforced server-side by RLS against the admin's logged-in JWT.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

# ── NBP Supabase (public anon config, mirrors src/supabaseClient.js) ──
SUPABASE_URL = "https://cjilkqzifyhssbsiqgfu.supabase.co"
SUPABASE_ANON_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNqaWxrcXppZnloc3Nic2lxZ2Z1Iiwicm9sZSI6ImFub24i"
    "LCJpYXQiOjE3NzA1NzM0NjMsImV4cCI6MjA4NjE0OTQ2M30."
    "sZH3suieH6Y4PHHb_rSbVS8zPMs-Uy20_rdt51Tfw3c"
)

# ── Local server ──
HOST = os.environ.get("BULLPEN_HOST", "127.0.0.1")
PORT = int(os.environ.get("BULLPEN_PORT", "8787"))

# ── Sniffer ──
# rvi0 is the rvictl mirror interface of the tethered iPad (see ipad_monitor).
SNIFF_IFACE = os.environ.get("BULLPEN_IFACE", "rvi0")
# Replay a recorded trackman_ws.jsonl instead of live capture (dev/testing).
REPLAY_JSONL = os.environ.get("BULLPEN_REPLAY_JSONL") or None

# ── App data dir (settings + upload retry queue) ──
DATA_DIR = Path(os.environ.get("BULLPEN_DATA_DIR", Path.home() / ".nbp-bullpen-sync"))
SETTINGS_PATH = DATA_DIR / "settings.json"
QUEUE_DIR = DATA_DIR / "upload_queue"

_DEFAULT_SETTINGS = {
    # Folder where finished CSVs are auto-saved (chosen once by the admin).
    "save_folder": str(Path.home() / "Documents" / "BullpenSync"),
}


def load_settings() -> dict:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    QUEUE_DIR.mkdir(parents=True, exist_ok=True)
    data = dict(_DEFAULT_SETTINGS)
    if SETTINGS_PATH.exists():
        try:
            data.update(json.loads(SETTINGS_PATH.read_text(encoding="utf-8")))
        except (OSError, json.JSONDecodeError):
            pass
    return data


def save_settings(data: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    merged = load_settings()
    merged.update(data)
    SETTINGS_PATH.write_text(json.dumps(merged, indent=2), encoding="utf-8")
