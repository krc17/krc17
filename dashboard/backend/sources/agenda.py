"""Upcoming events pulled from read-only ICS calendar feeds.

Point ``CALENDAR_ICS_URLS`` at the "secret address in iCal format" link that
Google/Outlook/Nextcloud expose. Recurring events are expanded locally with
dateutil so the wall shows the next real occurrence, not the series master.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

import httpx
from dateutil.rrule import rrulestr
from icalendar import Calendar

log = logging.getLogger(__name__)

_FETCH_TIMEOUT = 15.0
_MAX_OCCURRENCES = 60


@dataclass
class AgendaCache:
    events: list[dict[str, Any]] = field(default_factory=list)
    fetched_at: str | None = None
    error: str | None = None
    configured: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "events": self.events,
            "fetched_at": self.fetched_at,
            "error": self.error,
            "configured": self.configured,
        }


class AgendaService:
    def __init__(self, ics_urls: list[str], tz_name: str, horizon_days: int = 30) -> None:
        self._urls = ics_urls
        self._tz = _safe_zone(tz_name)
        self._horizon = timedelta(days=horizon_days)
        self._cache = AgendaCache(configured=bool(ics_urls))

    @property
    def snapshot(self) -> dict[str, Any]:
        return self._cache.to_dict()

    async def refresh(self) -> dict[str, Any]:
        if not self._urls:
            self._cache = AgendaCache(configured=False)
            return self.snapshot

        async with httpx.AsyncClient(
            timeout=_FETCH_TIMEOUT,
            follow_redirects=True,
            headers={"User-Agent": "TeamDashboard/1.0 (+wall display)"},
        ) as client:
            results = await asyncio.gather(
                *(self._fetch(client, url) for url in self._urls),
                return_exceptions=True,
            )

        events: list[dict[str, Any]] = []
        failures = 0
        for url, result in zip(self._urls, results):
            if isinstance(result, BaseException):
                log.warning("calendar failed: %s", result)
                failures += 1
                continue
            events.extend(result)

        if failures == len(self._urls):
            self._cache.error = "Calendar feed unreachable"
            return self.snapshot

        events.sort(key=lambda event: event["start"])
        self._cache = AgendaCache(
            events=events[:40],
            fetched_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
            error=f"{failures} calendar(s) unreachable" if failures else None,
            configured=True,
        )
        return self.snapshot

    async def _fetch(self, client: httpx.AsyncClient, url: str) -> list[dict[str, Any]]:
        response = await client.get(url)
        response.raise_for_status()
        return await asyncio.to_thread(self._parse, response.content)

    def _parse(self, payload: bytes) -> list[dict[str, Any]]:
        calendar = Calendar.from_ical(payload)
        now = datetime.now(self._tz)
        # Start the window at midnight so tapping "today" on the wall shows the
        # whole day, this morning's standup included -- a schedule review, not
        # just what is left. The agenda's "up next" list filters to the future
        # on the client, so it stays forward-looking regardless.
        window_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        window_end = now + self._horizon
        events: list[dict[str, Any]] = []

        for component in calendar.walk("VEVENT"):
            try:
                events.extend(self._expand(component, now, window_start, window_end))
            except Exception as exc:  # one bad VEVENT must not drop the feed
                log.debug("skipping event: %s", exc)
        return events

    def _expand(
        self, component: Any, now: datetime, window_start: datetime, window_end: datetime
    ) -> list[dict[str, Any]]:
        raw_start = component.get("DTSTART")
        if raw_start is None:
            return []

        all_day = not isinstance(raw_start.dt, datetime)
        start = self._as_aware(raw_start.dt)
        duration = self._duration(component, start, all_day)
        summary = str(component.get("SUMMARY", "") or "Untitled event").strip()
        location = str(component.get("LOCATION", "") or "").strip()

        starts = [start]
        rrule = component.get("RRULE")
        if rrule is not None:
            rule = rrulestr(
                rrule.to_ical().decode("utf-8"), dtstart=start, forceset=True
            )
            for exdate in _exdates(component):
                rule.exdate(self._as_aware(exdate))
            starts = list(rule.between(window_start - duration, window_end, inc=True))[
                :_MAX_OCCURRENCES
            ]

        occurrences: list[dict[str, Any]] = []
        for occurrence in starts:
            end = occurrence + duration
            if end < window_start or occurrence > window_end:
                continue
            occurrences.append(
                {
                    "title": summary,
                    "location": location,
                    "all_day": all_day,
                    "start": occurrence.astimezone(self._tz).isoformat(timespec="minutes"),
                    "end": end.astimezone(self._tz).isoformat(timespec="minutes"),
                    "date": occurrence.astimezone(self._tz).date().isoformat(),
                    "in_progress": occurrence <= now <= end,
                }
            )
        return occurrences

    def _duration(self, component: Any, start: datetime, all_day: bool) -> timedelta:
        raw_end = component.get("DTEND")
        if raw_end is not None:
            return max(self._as_aware(raw_end.dt) - start, timedelta(0))
        raw_duration = component.get("DURATION")
        if raw_duration is not None:
            return raw_duration.dt
        return timedelta(days=1) if all_day else timedelta(hours=1)

    def _as_aware(self, value: Any) -> datetime:
        if isinstance(value, datetime):
            return value.astimezone(self._tz) if value.tzinfo else value.replace(tzinfo=self._tz)
        if isinstance(value, date):
            return datetime.combine(value, time.min, tzinfo=self._tz)
        raise TypeError(f"unsupported date value: {value!r}")


def _exdates(component: Any) -> list[Any]:
    raw = component.get("EXDATE")
    if raw is None:
        return []
    groups = raw if isinstance(raw, list) else [raw]
    return [item.dt for group in groups for item in getattr(group, "dts", [])]


def _safe_zone(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except Exception:
        log.warning("unknown timezone %r, falling back to UTC", name)
        return ZoneInfo("UTC")
