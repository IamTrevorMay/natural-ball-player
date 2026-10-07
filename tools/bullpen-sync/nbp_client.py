"""Thin NBP/Supabase client for BullpenSync.

Uses plain HTTP against Supabase Auth + PostgREST (no supabase-py) to keep the
tool tiny. All writes carry the admin's own JWT, so the existing staff RLS
policies on trackman_sessions / trackman_pitches enforce permission.

On upload failure the whole payload is dropped into a local retry queue
(config.QUEUE_DIR) as JSON and re-sent by drain_queue() — the on-disk CSV is
always written first by the app, so a failed upload never loses data.

Token lifetime (#442). Supabase access tokens expire after an hour. 1.0.0
kept only the access token from login, so any bullpen that ended more than an
hour after sign-in failed with `PGRST303 JWT expired` and "Retry upload" could
never succeed either. Every authed request now goes through _request(), which
refreshes the token (grant_type=refresh_token) shortly before expiry and, as a
belt-and-braces, on a 401 — retrying the call once. If the refresh itself is
refused the client signs out and reports "sign in again", and the payload is
already in the retry queue for after that.
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
        self.refresh_token: str | None = None
        self.expires_at: float = 0.0  # unix seconds; 0 = unknown
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
        self._take_tokens(data)
        user = data.get("user") or {}
        self.user_id = user.get("id")
        # Role lives in public.users, not the auth record — fetch it.
        self.user_role, self.user_name = self._fetch_role_name()
        if self.user_role not in STAFF_ROLES:
            self.logout()
            raise NbpError("This tool is for admin/coach accounts only.")
        return {"id": self.user_id, "role": self.user_role, "name": self.user_name}

    def logout(self) -> None:
        self.access_token = self.refresh_token = None
        self.expires_at = 0.0
        self.user_id = self.user_role = self.user_name = None

    @property
    def is_authed(self) -> bool:
        return bool(self.access_token and self.user_role in STAFF_ROLES)

    # ── Token refresh (#442) ──

    # Refresh this many seconds BEFORE the access token expires, so a long
    # pitches insert started near the edge doesn't cross it mid-flight.
    REFRESH_MARGIN_S = 120

    def _take_tokens(self, data: dict) -> None:
        self.access_token = data.get("access_token")
        # Supabase rotates the refresh token on every refresh; always keep the
        # newest one or the next refresh is refused.
        self.refresh_token = data.get("refresh_token") or self.refresh_token
        exp = data.get("expires_at")
        if not exp and data.get("expires_in"):
            exp = time.time() + float(data["expires_in"])
        self.expires_at = float(exp) if exp else 0.0

    def _token_stale(self) -> bool:
        return bool(self.expires_at) and time.time() >= self.expires_at - self.REFRESH_MARGIN_S

    def refresh(self) -> None:
        """Swap the refresh token for a new access token. Signs out and raises
        when the refresh is refused (token revoked, user deleted, long idle)."""
        if not self.refresh_token:
            self.logout()
            raise NbpError("Session expired — please sign in again.")
        try:
            r = requests.post(
                f"{self.url}/auth/v1/token?grant_type=refresh_token",
                headers={"apikey": self.anon, "Content-Type": "application/json"},
                json={"refresh_token": self.refresh_token},
                timeout=15,
            )
        except requests.RequestException as e:
            # Network blip: keep the session, let the caller's request fail on
            # its own terms rather than forcing a sign-out over wifi.
            raise NbpError(f"Could not refresh sign-in ({e}).")
        if r.status_code != 200:
            log.warning(f"token refresh refused ({r.status_code}): {r.text[:200]}")
            self.logout()
            raise NbpError("Session expired — please sign in again.")
        self._take_tokens(r.json())
        log.info("access token refreshed")

    def _request(self, method: str, path: str, *, extra_headers: dict | None = None, **kw) -> requests.Response:
        """An authed PostgREST call that keeps the token fresh: refresh ahead
        of expiry, and on a 401 refresh once and retry."""
        if not self.access_token:
            raise NbpError("Not logged in.")
        if self._token_stale() and self.refresh_token:
            self.refresh()
        r = requests.request(method, f"{self.url}{path}", headers=self._headers(extra_headers), **kw)
        if r.status_code == 401:
            if not self.refresh_token:
                # Nothing to refresh with: the sign-in is dead. Say so rather
                # than letting every later call (and the whole retry queue)
                # fail the same way.
                self.logout()
                raise NbpError("Session expired — please sign in again.")
            log.info("401 from PostgREST — refreshing token and retrying once")
            self.refresh()
            r = requests.request(method, f"{self.url}{path}", headers=self._headers(extra_headers), **kw)
        return r

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
        r = self._request(
            "GET", "/rest/v1/users",
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
        r = self._request("GET", "/rest/v1/users", params=params, timeout=15)
        if r.status_code != 200:
            raise NbpError(f"Athlete search failed ({r.status_code}).")
        return r.json()

    def athlete_throws(self, user_id: str) -> str | None:
        """Throwing hand ('Right' / 'Left') from the athlete's player profile.

        player_profiles has its own primary key; the athlete is linked through
        `user_id` (#435 — this used to filter on `id`, so it never matched and
        handedness was always None).
        """
        try:
            r = self._request(
                "GET", "/rest/v1/player_profiles",
                params={"select": "throws", "user_id": f"eq.{user_id}", "limit": "1"},
                timeout=10,
            )
            if r.status_code == 200 and r.json():
                return r.json()[0].get("throws") or None
        except (requests.RequestException, NbpError):
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
            if not self.is_authed:
                raise NbpError("Upload failed — saved to retry queue. Your sign-in expired: sign in again, then click Retry upload.")
            raise NbpError(f"Upload failed — saved to retry queue. ({e})")

    def _do_upload(self, payload: dict) -> dict:
        session = payload["session"]
        pitches = payload["pitches"]

        # 1. Insert the session (return representation to get its id).
        r = self._request(
            "POST", "/rest/v1/trackman_sessions",
            extra_headers={"Prefer": "return=representation"},
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
            r2 = self._request(
                "POST", "/rest/v1/trackman_pitches?on_conflict=pitch_uid",
                extra_headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
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
                # #442: once the sign-in is gone every remaining file fails the
                # same way — stop here so the caller can ask for a sign-in.
                if not self.is_authed:
                    break
        return {"sent": sent, "failed": failed, "remaining": self.queued_count()}
