"""Next high/low tides from NOAA CO-OPS (Tides & Currents) — free, no key.

Charleston's street flooding is tidal, so the next high tide is a real travel
signal (and it pairs with the NWS coastal-flood alerts). Returns the upcoming
hi/lo predictions for a station; a failed pull keeps the last good set on screen.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import httpx

log = logging.getLogger(__name__)

_TIMEOUT = 12.0
_URL = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter"


@dataclass
class TidesCache:
    station: str = ""
    tides: list[dict[str, Any]] = field(default_factory=list)
    configured: bool = False
    fetched_at: str | None = None
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "station": self.station,
            "tides": self.tides,
            "configured": self.configured,
            "fetched_at": self.fetched_at,
            "error": self.error,
        }


class TidesService:
    def __init__(self, station: str) -> None:
        self._station = station.strip()
        self._cache = TidesCache(station=self._station, configured=bool(self._station))

    @property
    def snapshot(self) -> dict[str, Any]:
        return self._cache.to_dict()

    async def refresh(self) -> dict[str, Any]:
        if not self._station:
            self._cache = TidesCache(configured=False)
            return self.snapshot
        params = {
            "product": "predictions",
            "application": "team-dashboard",
            "station": self._station,
            "date": "today",
            "range": "36",                 # hours ahead — a day and a half of tides
            "datum": "MLLW",
            "interval": "hilo",
            "units": "english",
            "time_zone": "lst_ldt",        # station local time, matches the wall
            "format": "json",
        }
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT, follow_redirects=True) as client:
                response = await client.get(_URL, params=params)
                response.raise_for_status()
                data = response.json()
        except Exception as exc:
            log.warning("tides refresh failed: %s", exc)
            self._cache.configured = True
            self._cache.error = "Tides unavailable"       # keep last good on screen
            return self.snapshot

        now = datetime.now()
        upcoming = []
        for entry in data.get("predictions", []):
            parsed = _tide(entry)
            if parsed and parsed["_when"] >= now:
                upcoming.append(parsed)
        for tide in upcoming:
            tide.pop("_when", None)        # internal sort key, not for the client

        self._cache = TidesCache(
            station=self._station,
            tides=upcoming[:4],
            configured=True,
            fetched_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
            error=None,
        )
        return self.snapshot


def _tide(entry: dict[str, Any]) -> dict[str, Any] | None:
    raw_time = entry.get("t", "")
    try:
        when = datetime.strptime(raw_time, "%Y-%m-%d %H:%M")
    except ValueError:
        return None
    try:
        height = round(float(entry.get("v", "")), 1)
    except (TypeError, ValueError):
        height = None
    return {
        "type": "High" if entry.get("type") == "H" else "Low",
        "time": when.isoformat(timespec="minutes"),
        "height": height,
        "_when": when,
    }
