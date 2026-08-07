"""Engineering team wall dashboard — HTTP API, SSE push, and static frontend."""

from __future__ import annotations

import asyncio
import hmac
import logging
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, AsyncIterator
from zoneinfo import ZoneInfo

from fastapi import Body, FastAPI, File, Form, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import session, uploads
from .config import Settings, load_settings
from .hub import EventHub
from .sources import documents, projects
from .sources.agenda import AgendaService
from .sources.board_writer import BoardWriter
from .sources.coverage import CoverageStore
from .sources.news import NewsService
from .sources.traffic import TrafficService
from .sources.weather import WeatherService
from .watcher import ContentWatcher

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("dashboard")

APP_ROOT = Path(__file__).resolve().parent.parent
FRONTEND_DIR = APP_ROOT / "frontend"


def _build_stamp() -> int:
    """Newest mtime across the code, so a stale server can be spotted.

    Unzipping a new build over an old one leaves the previous server running;
    the launcher health check then finds it alive and skips the restart, and
    the new frontend talks to a backend without its endpoints. The launcher
    compares this against the files on disk and restarts when they are newer.
    """
    newest = 0.0
    for folder in ("backend", "frontend"):
        for item in (APP_ROOT / folder).rglob("*"):
            if item.is_file() and "__pycache__" not in item.parts:
                newest = max(newest, item.stat().st_mtime)
    return int(newest)


BUILD_STAMP = _build_stamp()

settings: Settings = load_settings()
hub = EventHub()
coverage = CoverageStore(settings.coverage_dir)
board_writer = BoardWriter(settings.projects_dir)
news = NewsService(settings.news_feeds, settings.news_max_items)
agenda = AgendaService(settings.calendar_feeds, settings.timezone, settings.calendar_horizon_days)
weather = WeatherService(settings.weather_point, settings.weather_place)
traffic = TrafficService(settings.traffic_api_key, settings.traffic_bbox)


# --------------------------------------------------------------------------- #
# Lifecycle
# --------------------------------------------------------------------------- #
@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    hub.bind_loop(asyncio.get_running_loop())

    def announce(channel: str) -> None:
        # Our own YAML write fires the watcher; repainting mid-drag would snap
        # the card back under the user's finger.
        if channel == "projects" and board_writer.in_quiet_period():
            log.debug("ignoring watcher event from our own write")
            return
        if channel == "coverage" and coverage.in_quiet_period():
            log.debug("ignoring watcher event from our own write")
            return
        hub.publish("content", {"channel": channel})

    watcher = ContentWatcher(announce)
    watcher.watch("takeaways", settings.takeaways_dir)
    watcher.watch("updates", settings.updates_dir)
    watcher.watch("projects", settings.projects_dir)
    watcher.watch("coverage", settings.coverage_dir)
    watcher.start()

    tasks = [
        asyncio.create_task(_poll(news.refresh, settings.news_refresh_seconds, "news")),
        asyncio.create_task(_poll(agenda.refresh, settings.calendar_refresh_seconds, "agenda")),
        asyncio.create_task(_poll(weather.refresh, settings.weather_refresh_seconds, "weather")),
        asyncio.create_task(_poll(traffic.refresh, settings.traffic_refresh_seconds, "traffic")),
    ]
    log.info("dashboard ready - data dir %s", settings.data_dir)

    try:
        yield
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await asyncio.to_thread(watcher.stop)


async def _poll(refresh: Any, interval: int, channel: str) -> None:
    """Refresh a network-backed source forever, announcing each successful pull."""
    while True:
        try:
            await refresh()
            hub.publish("content", {"channel": channel})
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("%s refresh failed", channel)
        await asyncio.sleep(interval)


app = FastAPI(title="Engineering Team Dashboard", lifespan=lifespan, docs_url=None, redoc_url=None)


LOOPBACK_HOSTS = {"127.0.0.1", "::1", "localhost"}


def _is_local(request: Request) -> bool:
    """The screen in front of the TV. Used for display control (shutdown etc.),
    which must never be reachable from the LAN however editing is configured."""
    client = request.client
    return bool(client and client.host in LOOPBACK_HOSTS)


def _can_edit(request: Request) -> bool:
    """Who may change the board and coverage.

    The display itself always can. A LAN browser may too, but only when an
    EDIT_KEY is configured and it presents the matching key in the X-Edit-Key
    header -- so up to a handful of trusted people can edit from their desks
    while the wall stays read-only to everyone else. With no key set, the LAN
    is read-only, which is the secure default. The key is compared in constant
    time; it travels in a header (not a cookie), so a cross-site page cannot
    ride along on it.
    """
    if _is_local(request):
        return True
    key = settings.edit_key
    if not key:
        return False
    supplied = request.headers.get("X-Edit-Key", "")
    return bool(supplied) and hmac.compare_digest(supplied, key)


# --------------------------------------------------------------------------- #
# Content API
# --------------------------------------------------------------------------- #
@app.get("/api/config")
async def get_config(request: Request) -> dict[str, Any]:
    local = _is_local(request)
    return {
        "team_name": settings.team_name,
        "timezone": settings.timezone,
        "rotation_seconds": settings.rotation_seconds,
        "page_cycle_seconds": settings.page_cycle_seconds,
        "calendar_configured": bool(settings.calendar_feeds),
        # Editing: the display always edits; a LAN browser needs the edit key
        # when one is set, and is read-only when none is.
        "can_edit": local or bool(settings.edit_key),
        "edit_key_required": (not local) and bool(settings.edit_key),
    }


@app.get("/api/takeaways")
async def get_takeaways() -> dict[str, Any]:
    return {"documents": await asyncio.to_thread(documents.load_folder, settings.takeaways_dir)}


@app.get("/api/updates")
async def get_updates() -> dict[str, Any]:
    return {"documents": await asyncio.to_thread(documents.load_folder, settings.updates_dir)}


@app.get("/api/projects")
async def get_projects() -> dict[str, Any]:
    return await asyncio.to_thread(projects.load_board, settings.projects_dir)


@app.post("/api/projects")
async def create_project(request: Request, payload: dict[str, Any] = Body(...)) -> JSONResponse:
    """Add a new project to the board. Captures the identity fields (title,
    owner, the column it lands in); everything else is set by tapping the card."""
    if not _can_edit(request):
        return JSONResponse({"ok": False, "detail": "read-only from here"}, status_code=403)

    title = str(payload.get("title", "")).strip()
    if not title:
        return JSONResponse({"ok": False, "detail": "title is required"}, status_code=400)
    status = str(payload.get("status", "")).strip()
    owner = str(payload.get("owner", "")).strip()

    result = await asyncio.to_thread(board_writer.create, title, status, owner)
    if result.ok:
        hub.publish("content", {"channel": "projects"})
    return JSONResponse(result.as_dict(), status_code=200 if result.ok else 409)


@app.post("/api/projects/{card_id}/status")
async def move_card(card_id: str, request: Request, payload: dict[str, Any] = Body(...)) -> JSONResponse:
    """Move a card to another column, writing the change back to the YAML."""
    if not _can_edit(request):
        return JSONResponse({"ok": False, "detail": "read-only from here"}, status_code=403)

    status = str(payload.get("status", "")).strip()
    if not status:
        return JSONResponse({"ok": False, "detail": "status is required"}, status_code=400)

    result = await asyncio.to_thread(board_writer.set_status, card_id, status)
    if result.ok:
        hub.publish("content", {"channel": "projects"})
    return JSONResponse(result.as_dict(), status_code=200 if result.ok else 409)


@app.post("/api/projects/{card_id}/progress")
async def set_progress(
    card_id: str, request: Request, payload: dict[str, Any] = Body(...)
) -> JSONResponse:
    """Set progress outright, or nudge it by a delta."""
    if not _can_edit(request):
        return JSONResponse({"ok": False, "detail": "read-only from here"}, status_code=403)

    board = await asyncio.to_thread(projects.load_board, settings.projects_dir)
    card = next((entry for entry in board["cards"] if entry["id"] == card_id), None)
    if card is None:
        return JSONResponse({"ok": False, "detail": f"no card {card_id}"}, status_code=404)

    if "delta" in payload:
        try:
            target = int(card["progress"]) + int(payload["delta"])
        except (TypeError, ValueError):
            return JSONResponse({"ok": False, "detail": "delta must be a number"}, status_code=400)
    else:
        try:
            target = int(payload.get("progress"))
        except (TypeError, ValueError):
            return JSONResponse({"ok": False, "detail": "progress must be a number"}, status_code=400)

    result = await asyncio.to_thread(board_writer.set_progress, card_id, target)
    if result.ok:
        hub.publish("content", {"channel": "projects"})
    return JSONResponse(result.as_dict(), status_code=200 if result.ok else 409)


@app.post("/api/projects/{card_id}/completion")
async def set_completion(
    card_id: str, request: Request, payload: dict[str, Any] = Body(...)
) -> JSONResponse:
    """Set total + complete counts; the board derives the percentage and, at
    100%, moves the card to Done."""
    if not _can_edit(request):
        return JSONResponse({"ok": False, "detail": "read-only from here"}, status_code=403)

    try:
        total = int(payload.get("total"))
        complete = int(payload.get("complete"))
    except (TypeError, ValueError):
        return JSONResponse(
            {"ok": False, "detail": "total and complete must be numbers"}, status_code=400
        )

    result = await asyncio.to_thread(board_writer.set_completion, card_id, total, complete)
    if result.ok:
        hub.publish("content", {"channel": "projects"})
    return JSONResponse(result.as_dict(), status_code=200 if result.ok else 409)


@app.post("/api/projects/{card_id}/due")
async def set_due(card_id: str, request: Request, payload: dict[str, Any] = Body(...)) -> JSONResponse:
    """Shift the due date by whole days, or set/clear it explicitly."""
    if not _can_edit(request):
        return JSONResponse({"ok": False, "detail": "read-only from here"}, status_code=403)

    if "days" in payload:
        try:
            days = int(payload["days"])
        except (TypeError, ValueError):
            return JSONResponse({"ok": False, "detail": "days must be a number"}, status_code=400)
        result = await asyncio.to_thread(board_writer.shift_due, card_id, days)
    else:
        raw = payload.get("due")
        result = await asyncio.to_thread(
            board_writer.set_due, card_id, str(raw).strip() if raw else None
        )

    if result.ok:
        hub.publish("content", {"channel": "projects"})
    return JSONResponse(result.as_dict(), status_code=200 if result.ok else 409)


@app.post("/api/projects/{card_id}/milestone")
async def toggle_milestone(
    card_id: str, request: Request, payload: dict[str, Any] = Body(...)
) -> JSONResponse:
    if not _can_edit(request):
        return JSONResponse({"ok": False, "detail": "read-only from here"}, status_code=403)

    try:
        index = int(payload.get("index"))
    except (TypeError, ValueError):
        return JSONResponse({"ok": False, "detail": "index must be a number"}, status_code=400)

    result = await asyncio.to_thread(
        board_writer.toggle_milestone, card_id, index, bool(payload.get("done"))
    )
    if result.ok:
        hub.publish("content", {"channel": "projects"})
    return JSONResponse(result.as_dict(), status_code=200 if result.ok else 409)


# --------------------------------------------------------------------------- #
# Coverage board -- which engineer is covering which area today
# --------------------------------------------------------------------------- #
@app.get("/api/coverage")
async def get_coverage() -> dict[str, Any]:
    return await asyncio.to_thread(coverage.load)


@app.post("/api/coverage/{engineer}/area")
async def assign_coverage(
    engineer: str, request: Request, payload: dict[str, Any] = Body(...)
) -> JSONResponse:
    """Move an engineer to an area, writing the change back to the YAML."""
    if not _can_edit(request):
        return JSONResponse({"ok": False, "detail": "read-only from here"}, status_code=403)

    area = str(payload.get("area", "")).strip()
    if not area:
        return JSONResponse({"ok": False, "detail": "area is required"}, status_code=400)

    result = await asyncio.to_thread(coverage.assign, engineer, area)
    if result.ok:
        hub.publish("content", {"channel": "coverage"})
    return JSONResponse(result.as_dict(), status_code=200 if result.ok else 409)


# --------------------------------------------------------------------------- #
# Uploads -- reachable from the LAN so the team can post without a file share
# --------------------------------------------------------------------------- #
@app.post("/api/upload")
async def upload(
    destination: str = Form(...), file: UploadFile = File(...)
) -> JSONResponse:
    """Take a file from the drop page and put it in a watched folder.

    Intentionally not loopback-only: posting a document is the whole point of
    the page, and it is additive and reversible. Control endpoints that stop
    the wall or rewrite the board stay restricted to the display itself.
    """
    folders = {
        "takeaways": settings.takeaways_dir,
        "updates": settings.updates_dir,
    }
    folder = folders.get(destination)
    if folder is None:
        return JSONResponse(
            {"ok": False, "detail": "Pick where the file should go."}, status_code=400
        )

    payload = await file.read()
    result = await asyncio.to_thread(
        uploads.store, folder, file.filename or "", payload, destination
    )
    if result.ok:
        hub.publish("content", {"channel": destination})
    return JSONResponse(
        {
            "ok": result.ok,
            "detail": result.detail,
            "filename": result.filename,
            "destination": result.destination,
        },
        status_code=200 if result.ok else 400,
    )


@app.post("/api/{channel}/archive")
async def archive_document(
    channel: str, request: Request, payload: dict[str, Any] = Body(...)
) -> JSONResponse:
    """Move a document out of the wall into its folder's archive/ subfolder.

    Loopback-only, like the other writes: a browser watching from a desk can
    read the wall but not rearrange it. The move is reversible -- the file is
    still on disk under archive/."""
    if not _can_edit(request):
        return JSONResponse({"ok": False, "detail": "read-only from here"}, status_code=403)

    folders = {"takeaways": settings.takeaways_dir, "updates": settings.updates_dir}
    folder = folders.get(channel)
    if folder is None:
        return JSONResponse({"ok": False, "detail": "unknown channel"}, status_code=404)

    filename = str(payload.get("filename", "")).strip()
    if not filename:
        return JSONResponse({"ok": False, "detail": "filename is required"}, status_code=400)

    result = await asyncio.to_thread(documents.archive_file, folder, filename)
    if result["ok"]:
        hub.publish("content", {"channel": channel})
    return JSONResponse(result, status_code=200 if result["ok"] else 400)


@app.get("/drop")
async def drop_page() -> FileResponse:
    """The page the team opens to post files. Linked from the wall's QR."""
    return FileResponse(FRONTEND_DIR / "drop.html", headers={"Cache-Control": "no-store"})


@app.get("/api/news")
async def get_news() -> dict[str, Any]:
    return news.snapshot


@app.get("/api/agenda")
async def get_agenda() -> dict[str, Any]:
    return agenda.snapshot


@app.get("/api/weather")
async def get_weather() -> dict[str, Any]:
    return weather.snapshot


@app.get("/api/traffic")
async def get_traffic() -> dict[str, Any]:
    return traffic.snapshot


@app.get("/api/now")
async def get_now() -> dict[str, Any]:
    """Authoritative clock, so a TV with a drifting RTC still shows the right time."""
    zone = ZoneInfo(settings.timezone) if _valid_zone(settings.timezone) else ZoneInfo("UTC")
    now = datetime.now(zone)
    return {"iso": now.isoformat(timespec="seconds"), "timezone": str(zone)}


@app.get("/api/state")
async def get_state(request: Request) -> dict[str, Any]:
    """One-shot bootstrap so a freshly opened screen paints in a single round trip."""
    takeaways, updates, board, coverage_board = await asyncio.gather(
        asyncio.to_thread(documents.load_folder, settings.takeaways_dir),
        asyncio.to_thread(documents.load_folder, settings.updates_dir),
        asyncio.to_thread(projects.load_board, settings.projects_dir),
        asyncio.to_thread(coverage.load),
    )
    return {
        "config": await get_config(request),
        "takeaways": takeaways,
        "updates": updates,
        "projects": board,
        "coverage": coverage_board,
        "news": news.snapshot,
        "agenda": agenda.snapshot,
        "weather": weather.snapshot,
        "traffic": traffic.snapshot,
        "now": await get_now(),
    }


# --------------------------------------------------------------------------- #
# Server-sent events
# --------------------------------------------------------------------------- #
@app.get("/api/stream")
async def stream(request: Request) -> StreamingResponse:
    queue = hub.subscribe()

    async def event_source() -> AsyncIterator[str]:
        yield "retry: 3000\n\n"
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    yield await asyncio.wait_for(queue.get(), timeout=20.0)
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"  # keeps proxies and the browser from timing out
        finally:
            hub.unsubscribe(queue)

    return StreamingResponse(
        event_source(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


@app.get("/api/health")
async def health() -> dict[str, Any]:
    return {"status": "ok", "screens": hub.subscriber_count, "build": BUILD_STAMP}


# --------------------------------------------------------------------------- #
# Display control (minimise / close / shut down)
# --------------------------------------------------------------------------- #
@app.get("/api/session")
async def session_capabilities(request: Request) -> dict[str, Any]:
    """Lets the page hide controls it would not be allowed to use."""
    return {
        "supported": session.is_supported(),
        "local": _is_local(request),
        "platform": session.platform_name(),
    }


@app.post("/api/session/{action}")
async def session_action(action: str, request: Request) -> JSONResponse:
    if not _is_local(request):
        return JSONResponse(
            {"ok": False, "detail": "only available on the display itself"}, status_code=403
        )

    if action == "minimize":
        result = session.minimize_display()
    elif action == "close":
        result = session.close_display()
    elif action == "shutdown":
        closed = session.close_display()
        stopped = session.stop_server()
        result = session.ActionResult(stopped.ok, f"{closed.detail}; {stopped.detail}")
    else:
        return JSONResponse({"ok": False, "detail": "unknown action"}, status_code=404)

    return JSONResponse({"ok": result.ok, "detail": result.detail})


# --------------------------------------------------------------------------- #
# Frontend
# --------------------------------------------------------------------------- #
def _valid_zone(name: str) -> bool:
    try:
        ZoneInfo(name)
        return True
    except Exception:
        return False


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "index.html", headers={"Cache-Control": "no-store"})


app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
