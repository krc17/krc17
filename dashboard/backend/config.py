"""Environment-driven configuration for the engineering team dashboard."""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path

# A trailing #hex colour on a calendar label, e.g. "Team #2e8b57".
_HEX_COLOUR = re.compile(r"^(.*?)\s+(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})$")

DEFAULT_FEEDS = (
    "https://feeds.bbci.co.uk/news/world/rss.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/World.xml",
    "https://www.theguardian.com/world/rss",
    "https://moxie.foxnews.com/google-publisher/world.xml",
)


def _env_path(name: str, default: Path) -> Path:
    raw = os.getenv(name)
    return Path(raw).expanduser() if raw else default


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, "").strip() or default)
    except ValueError:
        return default


def _env_list(name: str, default: tuple[str, ...] = ()) -> list[str]:
    raw = os.getenv(name, "")
    items = [item.strip() for item in raw.split(",")]
    items = [item for item in items if item]
    return items or list(default)


_LATLON = re.compile(r"^-?\d{1,3}(?:\.\d+)?,\s*-?\d{1,3}(?:\.\d+)?$")


def _parse_routes(name: str) -> list[dict[str, str]]:
    """Parse TRAVEL_ROUTES: semicolon-separated `Label = lat,lon > lat,lon`.

    e.g.  HQ -> Awendaw = 32.78,-79.93 > 33.03,-79.62; HQ -> Downtown = ...
    Malformed entries are skipped rather than failing the whole config.
    """
    routes: list[dict[str, str]] = []
    for chunk in os.getenv(name, "").split(";"):
        chunk = chunk.strip()
        if not chunk or "=" not in chunk:
            continue
        label, path = chunk.split("=", 1)
        if ">" not in path:
            continue
        origin, destination = (part.strip().replace(" ", "") for part in path.split(">", 1))
        if _LATLON.match(origin) and _LATLON.match(destination):
            routes.append({"name": label.strip() or "Route", "from": origin, "to": destination})
    return routes


def _parse_calendar_feeds(name: str) -> list[dict[str, str | None]]:
    """Parse ``CALENDAR_ICS_URLS`` into named, optionally-coloured feeds.

    Each comma-separated entry is either a bare ICS URL or ``Label = URL``,
    where the label may end with a colour: ``Team #2e8b57 = URL``. The label
    lets the wall tell one calendar from another (a coloured dot and a legend);
    the colour, when given, overrides the automatic palette colour. We only read
    a label when the text after the first ``=`` looks like a URL, so query
    strings such as ``...?src=abc`` are never mistaken for a name and split apart.
    """
    feeds: list[dict[str, str | None]] = []
    for entry in _env_list(name):
        label: str | None = None
        colour: str | None = None
        url = entry
        if "=" in entry:
            head, tail = entry.split("=", 1)
            tail = tail.strip()
            if tail.lower().startswith(("http://", "https://")):
                head = head.strip()
                match = _HEX_COLOUR.match(head)
                if match:
                    head, colour = match.group(1).strip(), match.group(2).lower()
                label = head or None
                url = tail
        feeds.append({"name": label, "url": url, "color": colour})
    return feeds


@dataclass(frozen=True)
class Settings:
    """All tunables live here so the container is configured purely by env vars."""

    data_dir: Path
    takeaways_dir: Path
    updates_dir: Path
    projects_dir: Path
    coverage_dir: Path

    host: str = "127.0.0.1"
    port: int = 8770
    team_name: str = "Engineering"
    timezone: str = "America/New_York"

    news_feeds: list[str] = field(default_factory=lambda: list(DEFAULT_FEEDS))
    news_refresh_seconds: int = 600
    news_max_items: int = 40

    calendar_feeds: list[dict[str, str | None]] = field(default_factory=list)
    calendar_refresh_seconds: int = 900
    calendar_horizon_days: int = 30

    # Seconds each document card is shown before the panel rotates to the next one.
    rotation_seconds: int = 25

    # Seconds the wall dwells on each page (Overview / Projects / Coverage /
    # Travel) before auto-advancing to the next. Touching the wall pauses it; it
    # resumes when the wall goes idle again. 0 turns auto-cycling off.
    page_cycle_seconds: int = 20

    # --- Travel page (weather + traffic) ------------------------------------
    # Weather is the free, keyless US National Weather Service. Point is
    # "lat,lon"; place is the label shown on the wall.
    weather_point: str = "32.7765,-79.9311"      # Charleston, SC
    weather_place: str = "Charleston County"
    weather_refresh_seconds: int = 900
    # Traffic incidents come from TomTom (free tier, needs a key). Empty key =
    # the Travel page shows weather only. bbox is "minLon,minLat,maxLon,maxLat".
    traffic_api_key: str = ""
    traffic_bbox: str = "-80.20,32.65,-79.75,33.03"   # greater Charleston
    traffic_refresh_seconds: int = 180
    # Named routes for live drive times, each {name, from "lat,lon", to "lat,lon"}.
    # Uses the same TomTom key (Routing API). Empty = no drive-times panel.
    # Drive times have their own refresh (one TomTom call per route), separate
    # from traffic incidents, so the two can be tuned to stay under the key's
    # daily quota. With N routes that is N calls every routes_refresh_seconds.
    travel_routes: list[dict[str, str]] = field(default_factory=list)
    routes_refresh_seconds: int = 300
    # NOAA tide station for the tide clock (free, no key). Charleston Harbor by
    # default. Blank = no tide panel.
    tide_station: str = "8665530"
    tide_refresh_seconds: int = 1800

    # Shared passphrase that lets a LAN browser edit the board/coverage (the
    # display itself always can). Empty = LAN stays read-only, the secure default.
    edit_key: str = ""


def load_settings() -> Settings:
    data_dir = _env_path("DASHBOARD_DATA_DIR", Path(__file__).resolve().parent.parent / "data")
    settings = Settings(
        data_dir=data_dir,
        takeaways_dir=_env_path("TAKEAWAYS_DIR", data_dir / "meeting-takeaways"),
        updates_dir=_env_path("UPDATES_DIR", data_dir / "team-updates"),
        projects_dir=_env_path("PROJECTS_DIR", data_dir / "projects"),
        coverage_dir=_env_path("COVERAGE_DIR", data_dir / "coverage"),
        host=os.getenv("DASHBOARD_HOST", "127.0.0.1"),
        port=_env_int("DASHBOARD_PORT", 8770),
        team_name=os.getenv("TEAM_NAME", "Engineering"),
        timezone=os.getenv("DASHBOARD_TZ", "America/New_York"),
        news_feeds=_env_list("NEWS_FEEDS", DEFAULT_FEEDS),
        news_refresh_seconds=_env_int("NEWS_REFRESH_SECONDS", 600),
        news_max_items=_env_int("NEWS_MAX_ITEMS", 40),
        edit_key=os.getenv("EDIT_KEY", "").strip(),
        calendar_feeds=_parse_calendar_feeds("CALENDAR_ICS_URLS"),
        calendar_refresh_seconds=_env_int("CALENDAR_REFRESH_SECONDS", 900),
        calendar_horizon_days=_env_int("CALENDAR_HORIZON_DAYS", 30),
        rotation_seconds=_env_int("ROTATION_SECONDS", 25),
        page_cycle_seconds=_env_int("PAGE_CYCLE_SECONDS", 20),
        weather_point=os.getenv("WEATHER_POINT", "32.7765,-79.9311").strip(),
        weather_place=os.getenv("WEATHER_PLACE", "Charleston County").strip(),
        weather_refresh_seconds=_env_int("WEATHER_REFRESH_SECONDS", 900),
        traffic_api_key=os.getenv("TRAFFIC_API_KEY", "").strip(),
        traffic_bbox=os.getenv("TRAFFIC_BBOX", "-80.20,32.65,-79.75,33.03").strip(),
        traffic_refresh_seconds=_env_int("TRAFFIC_REFRESH_SECONDS", 180),
        travel_routes=_parse_routes("TRAVEL_ROUTES"),
        routes_refresh_seconds=_env_int("ROUTES_REFRESH_SECONDS", 300),
        tide_station=os.getenv("TIDE_STATION", "8665530").strip(),
        tide_refresh_seconds=_env_int("TIDE_REFRESH_SECONDS", 1800),
    )
    for directory in (
        settings.takeaways_dir,
        settings.updates_dir,
        settings.projects_dir,
        settings.coverage_dir,
    ):
        directory.mkdir(parents=True, exist_ok=True)

    # First-run seed for the coverage board. Unlike the document panels, an
    # empty coverage folder shows areas but no engineer cards and nothing to
    # drag, which reads as broken. So if the folder holds no coverage file yet,
    # copy the sample once. Never overwrites -- an existing file is left alone,
    # so a team's edits are safe on every future build.
    _seed_if_empty(settings.coverage_dir, Path(__file__).resolve().parent.parent / "samples" / "coverage")
    return settings


def _seed_if_empty(target: Path, sample_dir: Path) -> None:
    if not sample_dir.is_dir():
        return
    has_content = any(
        item.is_file() and item.name != ".gitkeep" for item in target.iterdir()
    )
    if has_content:
        return
    import shutil

    for item in sample_dir.iterdir():
        if item.is_file() and not (target / item.name).exists():
            shutil.copy2(item, target / item.name)
