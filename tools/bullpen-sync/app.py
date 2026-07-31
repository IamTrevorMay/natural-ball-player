"""NBP BullpenSync — local FastAPI server.

Runs on the admin's Mac. Serves a single-page UI at http://127.0.0.1:8787 and
owns the sniffer + iPad monitor + live session. The browser talks to it over
REST + a websocket for the live pitch feed.

Data never leaves the laptop except the final upload to NBP (Supabase), which
carries the admin's own JWT and is gated by NBP's staff RLS.
"""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

import config
from ipad_monitor import IpadMonitor
from nbp_client import NbpClient, NbpError
from session import LiveSession
from sniffer import TrackmanSniffer

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("bullpen")

HERE = Path(__file__).parent


class Hub:
    """Shared app state + thread-safe websocket broadcast."""

    def __init__(self) -> None:
        self.nbp = NbpClient()
        self.session: LiveSession | None = None
        self.sniffer: TrackmanSniffer | None = None
        self.ipad: IpadMonitor | None = None
        self.loop: asyncio.AbstractEventLoop | None = None
        self.clients: set[WebSocket] = set()
        self.sniffer_status = "idle"
        self.ipad_status = "idle"

    # ── websocket fan-out (safe to call from any thread) ──
    def emit(self, msg: dict[str, Any]) -> None:
        if self.loop is None:
            return
        try:
            asyncio.run_coroutine_threadsafe(self._broadcast(msg), self.loop)
        except RuntimeError:
            pass

    async def _broadcast(self, msg: dict[str, Any]) -> None:
        dead = []
        for ws in list(self.clients):
            try:
                await ws.send_json(msg)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.clients.discard(ws)

    # ── sniffer/ipad callbacks (worker threads) ──
    def on_frame(self, frame: dict, direction: str) -> None:
        sess = self.session
        if sess is None:
            return
        row = sess.on_frame(frame, direction)
        if row is not None:
            self.emit({"type": "pitch", "row": row, "count": sess.pitch_count()})

    def on_sniffer_status(self, status: str) -> None:
        self.sniffer_status = status
        self.emit({"type": "sniffer_status", "status": status})

    def on_ipad_status(self, status: str) -> None:
        self.ipad_status = status
        self.emit({"type": "ipad_status", "status": status})
        # Restart the sniffer whenever the mirror interface (re)appears.
        if status == "rvi0:ready" and self.sniffer is not None:
            self.sniffer.stop()
            self.sniffer.start()


hub = Hub()


@asynccontextmanager
async def lifespan(app: FastAPI):
    hub.loop = asyncio.get_running_loop()
    hub.sniffer = TrackmanSniffer(
        on_frame=hub.on_frame,
        on_status=hub.on_sniffer_status,
        iface=config.SNIFF_IFACE,
        replay_jsonl=config.REPLAY_JSONL,
    )
    if config.REPLAY_JSONL:
        log.info("Replay mode: %s", config.REPLAY_JSONL)
        hub.sniffer.start()
    else:
        hub.ipad = IpadMonitor(on_status=hub.on_ipad_status)
        hub.ipad.start()
        hub.sniffer.start()  # waits harmlessly until rvi0 has traffic
    yield
    if hub.sniffer:
        hub.sniffer.stop()
    if hub.ipad:
        hub.ipad.stop()


app = FastAPI(title="NBP BullpenSync", lifespan=lifespan)


def _require_auth() -> None:
    if not hub.nbp.is_authed:
        raise HTTPException(status_code=401, detail="Not logged in.")


# ── UI ──
app.mount("/static", StaticFiles(directory=HERE / "static"), name="static")


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(HERE / "static" / "index.html")


# ── Auth ──
@app.post("/api/login")
async def login(body: dict) -> JSONResponse:
    email = (body or {}).get("email", "")
    password = (body or {}).get("password", "")
    try:
        user = await asyncio.to_thread(hub.nbp.login, email, password)
    except NbpError as e:
        raise HTTPException(status_code=401, detail=str(e))
    return JSONResponse({"user": user, "queued": hub.nbp.queued_count()})


@app.post("/api/logout")
async def logout() -> dict:
    hub.nbp.logout()
    return {"ok": True}


@app.get("/api/status")
async def status() -> dict:
    sess = hub.session
    return {
        "authed": hub.nbp.is_authed,
        "user": {"name": hub.nbp.user_name, "role": hub.nbp.user_role} if hub.nbp.is_authed else None,
        "sniffer": hub.sniffer_status,
        "ipad": hub.ipad_status,
        "queued": hub.nbp.queued_count(),
        "settings": config.load_settings(),
        "session": None if sess is None else {
            "athlete": sess.athlete.get("full_name"),
            "pitch_count": sess.pitch_count(),
            "current_pitch_type": sess.current_pitch_type,
            "rows": sess.rows_display(),
        },
    }


# ── Roster ──
@app.get("/api/athletes")
async def athletes(q: str = "") -> dict:
    _require_auth()
    try:
        rows = await asyncio.to_thread(hub.nbp.search_athletes, q)
    except NbpError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {"athletes": rows}


# ── Settings ──
@app.get("/api/settings")
async def get_settings() -> dict:
    return config.load_settings()


@app.post("/api/settings")
async def set_settings(body: dict) -> dict:
    folder = (body or {}).get("save_folder")
    if folder:
        config.save_settings({"save_folder": folder})
    return config.load_settings()


# ── Session lifecycle ──
@app.post("/api/session/start")
async def session_start(body: dict) -> dict:
    _require_auth()
    if hub.session is not None:
        raise HTTPException(status_code=409, detail="A session is already active.")
    athlete = (body or {}).get("athlete") or {}
    if not athlete.get("id"):
        raise HTTPException(status_code=400, detail="Pick an athlete first.")
    # Fill throwing hand for the classifier / CSV if available.
    athlete["throws"] = await asyncio.to_thread(hub.nbp.athlete_throws, athlete["id"])
    folder = config.load_settings()["save_folder"]
    hub.session = LiveSession(athlete, folder, captured_by=hub.nbp.user_id)
    hub.emit({"type": "session_started", "athlete": athlete.get("full_name")})
    return {"ok": True, "csv_path": str(hub.session.csv.path)}


@app.post("/api/session/current-type")
async def session_current_type(body: dict) -> dict:
    _require_auth()
    if hub.session is None:
        raise HTTPException(status_code=409, detail="No active session.")
    ptype = (body or {}).get("type")
    hub.session.set_current_pitch_type(ptype)
    return {"ok": True, "current_pitch_type": hub.session.current_pitch_type}


@app.post("/api/session/row-type")
async def session_row_type(body: dict) -> dict:
    _require_auth()
    if hub.session is None:
        raise HTTPException(status_code=409, detail="No active session.")
    uid = (body or {}).get("pitch_uid")
    ptype = (body or {}).get("type")
    row = hub.session.edit_row_type(uid, ptype)
    if row is None:
        raise HTTPException(status_code=404, detail="Unknown pitch.")
    hub.emit({"type": "pitch", "row": row, "count": hub.session.pitch_count()})
    return {"ok": True, "row": row}


@app.post("/api/session/end")
async def session_end() -> dict:
    _require_auth()
    if hub.session is None:
        raise HTTPException(status_code=409, detail="No active session.")
    sess = hub.session
    hub.session = None  # stop ingesting new frames into it

    csv_path = str(sess.finalize_csv())
    payload = sess.build_upload_payload()
    uploaded = True
    message = "Uploaded to NBP."
    try:
        await asyncio.to_thread(hub.nbp.upload_session, payload)
    except NbpError as e:
        uploaded = False
        message = str(e)

    result = {
        "ok": True,
        "csv_path": csv_path,
        "pitch_count": len(payload["pitches"]),
        "uploaded": uploaded,
        "message": message,
        "queued": hub.nbp.queued_count(),
    }
    hub.emit({"type": "session_ended", **result})
    return result


@app.post("/api/queue/drain")
async def queue_drain() -> dict:
    _require_auth()
    return await asyncio.to_thread(hub.nbp.drain_queue)


# ── Websocket ──
@app.websocket("/ws")
async def ws(ws: WebSocket) -> None:
    await ws.accept()
    hub.clients.add(ws)
    try:
        while True:
            await ws.receive_text()  # keepalive; client sends pings
    except WebSocketDisconnect:
        pass
    finally:
        hub.clients.discard(ws)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=config.HOST, port=config.PORT, log_level="info")
