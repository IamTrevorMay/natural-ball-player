"""Thin NBP/Supabase client for BullpenSync.

Uses plain HTTP against Supabase Auth + PostgREST (no supabase-py) to keep the
tool tiny. All writes carry the admin's own JWT, so the existing staff RLS
policies on trackman_sessions / trackman_pitches enforce permission.

On upload failure the whole payload is dropped into a local retry queue
(config.QUEUE_DIR) as JSON and re-sent by drain_queue() — the on-disk CSV is
always written first by the app, so a failed upload never loses data.
"""
from __future__ import annotations

import json
import logging
import time
import uuid
from pathlib import Path
from typing import Any

import requests

import config

log = logging.getLogger(__name__)

STAFF_ROLES = ("admin", "coach")


class NbpError(Exception):
    pass


class NbpClient:
    def __init__(self) -> None:
        self.url = config.SUPABASE_URL.rstrip("/")
        self.anon = config.SUPABASE_ANON_KEY
        self.access_token: str | None = None
        self.user_id: str | None = None
        self.user_role: str | None = None
        self.user_name: str | None = None

    # ── Auth ──

    def login(self, email: str, password: str) -> dict:
        r = requests.post(
            f"{self.url}/auth/v1/token?grant_type=password",
            headers={"apikey": self.anon, "Content-Type": "application/json"},
            json={"email": email, "password": password},
            timeout=15,
        )
        if r.status_code != 200:
            raise NbpError("Invalid email or password.")
        data = r.json()
        self.access_token = data.get("access_token")
        user = data.get("user") or {}
        self.user_id = user.get("id")
        # Role lives in public.users, not the auth record — fetch it.
        self.user_role, self.user_name = self._fetch_role_name()
        if self.user_role not in STAFF_ROLES:
            self.logout()
            raise NbpError("This tool is for admin/coach accounts only.")
        return {"id": self.user_id, "role": self.user_role, "name": self.user_name}

    def logout(self) -> None:
        self.access_token = self.user_id = self.user_role = self.user_name = None

    @property
    def is_authed(self) -> bool:
        return bool(self.access_token and self.user_role in STAFF_ROLES)

    def _headers(self, extra: dict | None = None) -> dict:
        if not self.access_token:
            raise NbpError("Not logged in.")
        h = {
            "apikey": self.anon,
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json",
        }
        if extra:
            h.update(extra)
        return h

    def _fetch_role_name(self) -> tuple[str | None, str | None]:
        r = requests.get(
            f"{self.url}/rest/v1/users",
            headers=self._headers(),
            params={"select": "role,full_name", "id": f"eq.{self.user_id}"},
            timeout=15,
        )
        if r.status_code == 200 and r.json():
            row = r.json()[0]
            return row.get("role"), row.get("full_name")
        return None, None

    # ── Roster ──

    def search_athletes(self, q: str, limit: int = 25) -> list[dict]:
        """Players matching q by name or email (empty q → first N players)."""
        params = {
            "select": "id,full_name,email",
            "role": "eq.player",
            "order": "full_name.asc",
            "limit": str(limit),
        }
        q = (q or "").strip()
        if q:
            like = f"*{q}*"
            params["or"] = f"(full_name.ilike.{like},email.ilike.{like})"
        r = requests.get(
            f"{self.url}/rest/v1/users", headers=self._headers(), params=params, timeout=15
        )
        if r.status_code != 200:
            raise NbpError(f"Athlete search failed ({r.status_code}).")
        return r.json()

    def athlete_throws(self, user_id: str) -> str | None:
        try:
            r = requests.get(
                f"{self.url}/rest/v1/player_profiles",
                headers=self._headers(),
                params={"select": "throws", "id": f"eq.{user_id}"},
                timeout=10,
            )
            if r.status_code == 200 and r.json():
                return r.json()[0].get("throws")
        except requests.RequestException:
            pass
        return None

    # ── Upload ──

    def upload_session(self, payload: dict) -> dict:
        """Insert one trackman_sessions row + its trackman_pitches. On any
        failure, queue the payload and re-raise so the caller can flag it."""
        try:
            return self._do_upload(payload)
        except (requests.RequestException, NbpError) as e:
            qpath = self._queue(payload)
            log.warning(f"upload failed, queued at {qpath} — {e}")
            raise NbpError(f"Upload failed — saved to retry queue. ({e})")

    def _do_upload(self, payload: dict) -> dict:
        session = payload["session"]
        pitches = payload["pitches"]

        # 1. Insert the session (return representation to get its id).
        r = requests.post(
            f"{self.url}/rest/v1/trackman_sessions",
            headers=self._headers({"Prefer": "return=representation"}),
            json=session,
            timeout=20,
        )
        if r.status_code not in (200, 201):
            raise NbpError(f"session insert {r.status_code}: {r.text[:200]}")
        session_row = r.json()[0]
        session_row_id = session_row["id"]

        # 2. Insert pitches, linked to the session. Upsert on pitch_uid so a
        #    retry of a partially-succeeded upload is idempotent.
        rows = []
        for p in pitches:
            rows.append({**p, "session_row_id": session_row_id,
                         "trackman_session_id": session.get("trackman_session_id")})
        if rows:
            r2 = requests.post(
                f"{self.url}/rest/v1/trackman_pitches?on_conflict=pitch_uid",
                headers=self._headers({"Prefer": "resolution=merge-duplicates,return=minimal"}),
                json=rows,
                timeout=60,
            )
            if r2.status_code not in (200, 201, 204):
                raise NbpError(f"pitches insert {r2.status_code}: {r2.text[:200]}")

        return {"session_row_id": session_row_id, "pitch_count": len(rows)}

    # ── Retry queue ──

    def _queue(self, payload: dict) -> Path:
        config.QUEUE_DIR.mkdir(parents=True, exist_ok=True)
        name = f"{int(time.time())}_{uuid.uuid4().hex[:8]}.json"
        path = config.QUEUE_DIR / name
        path.write_text(json.dumps(payload), encoding="utf-8")
        return path

    def queued_count(self) -> int:
        if not config.QUEUE_DIR.exists():
            return 0
        return len(list(config.QUEUE_DIR.glob("*.json")))

    def drain_queue(self) -> dict:
        """Retry every queued upload. Returns {sent, failed, remaining}."""
        sent = failed = 0
        if not config.QUEUE_DIR.exists():
            return {"sent": 0, "failed": 0, "remaining": 0}
        for f in sorted(config.QUEUE_DIR.glob("*.json")):
            try:
                payload = json.loads(f.read_text(encoding="utf-8"))
                self._do_upload(payload)
                f.unlink(missing_ok=True)
                sent += 1
            except (requests.RequestException, NbpError, json.JSONDecodeError) as e:
                log.warning(f"retry still failing for {f.name} — {e}")
                failed += 1
        return {"sent": sent, "failed": failed, "remaining": self.queued_count()}
