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


@dataclass(frozen=True)
class Settings:
    """All tunables live here so the container is configured purely by env vars."""

    data_dir: Path
    takeaways_dir: Path
    updates_dir: Path
    projects_dir: Path
    blackboard_dir: Path

    team_name: str = "Engineering"
    timezone: str = "America/New_York"

    news_feeds: list[str] = field(default_factory=lambda: list(DEFAULT_FEEDS))
    news_refresh_seconds: int = 600
    news_max_items: int = 40

    calendar_ics_urls: list[str] = field(default_factory=list)
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
        team_name=os.getenv("TEAM_NAME", "Engineering"),
        timezone=os.getenv("DASHBOARD_TZ", "America/New_York"),
        news_feeds=_env_list("NEWS_FEEDS", DEFAULT_FEEDS),
        news_refresh_seconds=_env_int("NEWS_REFRESH_SECONDS", 600),
        news_max_items=_env_int("NEWS_MAX_ITEMS", 40),
        calendar_ics_urls=_env_list("CALENDAR_ICS_URLS"),
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
