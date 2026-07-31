"""Environment-driven configuration for the engineering team dashboard."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

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


def _parse_calendar_feeds(name: str) -> list[dict[str, str | None]]:
    """Parse ``CALENDAR_ICS_URLS`` into named feeds.

    Each comma-separated entry is either a bare ICS URL or ``Label = URL``.
    The label lets the wall tell one calendar from another (a coloured dot and
    a legend). We only read a label when the text after the first ``=`` looks
    like a URL, so query strings such as ``...?src=abc`` are never mistaken for
    a name and split apart.
    """
    feeds: list[dict[str, str | None]] = []
    for entry in _env_list(name):
        label: str | None = None
        url = entry
        if "=" in entry:
            head, tail = entry.split("=", 1)
            tail = tail.strip()
            if tail.lower().startswith(("http://", "https://")):
                label = head.strip() or None
                url = tail
        feeds.append({"name": label, "url": url})
    return feeds


@dataclass(frozen=True)
class Settings:
    """All tunables live here so the container is configured purely by env vars."""

    data_dir: Path
    takeaways_dir: Path
    updates_dir: Path
    projects_dir: Path
    blackboard_dir: Path

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

    @property
    def blackboard_file(self) -> Path:
        return self.blackboard_dir / "board.json"


def load_settings() -> Settings:
    data_dir = _env_path("DASHBOARD_DATA_DIR", Path(__file__).resolve().parent.parent / "data")
    settings = Settings(
        data_dir=data_dir,
        takeaways_dir=_env_path("TAKEAWAYS_DIR", data_dir / "meeting-takeaways"),
        updates_dir=_env_path("UPDATES_DIR", data_dir / "team-updates"),
        projects_dir=_env_path("PROJECTS_DIR", data_dir / "projects"),
        blackboard_dir=_env_path("BLACKBOARD_DIR", data_dir / "blackboard"),
        host=os.getenv("DASHBOARD_HOST", "127.0.0.1"),
        port=_env_int("DASHBOARD_PORT", 8770),
        team_name=os.getenv("TEAM_NAME", "Engineering"),
        timezone=os.getenv("DASHBOARD_TZ", "America/New_York"),
        news_feeds=_env_list("NEWS_FEEDS", DEFAULT_FEEDS),
        news_refresh_seconds=_env_int("NEWS_REFRESH_SECONDS", 600),
        news_max_items=_env_int("NEWS_MAX_ITEMS", 40),
        calendar_feeds=_parse_calendar_feeds("CALENDAR_ICS_URLS"),
        calendar_refresh_seconds=_env_int("CALENDAR_REFRESH_SECONDS", 900),
        calendar_horizon_days=_env_int("CALENDAR_HORIZON_DAYS", 30),
        rotation_seconds=_env_int("ROTATION_SECONDS", 25),
    )
    for directory in (
        settings.takeaways_dir,
        settings.updates_dir,
        settings.projects_dir,
        settings.blackboard_dir,
    ):
        directory.mkdir(parents=True, exist_ok=True)
    return settings
