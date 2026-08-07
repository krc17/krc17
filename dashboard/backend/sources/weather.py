"""Today's weather outlook from the US National Weather Service (api.weather.gov).

Free and keyless. Two calls resolve a point to its forecast, plus one for any
active alerts (flood / wind / fog / heat) -- the parts that actually change a
commute or a drive to a remote site. Like the news ticker, a failed pull keeps
the last good outlook on screen and just marks itself stale rather than blanking.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import httpx

log = logging.getLogger(__name__)

_TIMEOUT = 12.0
_HEADERS = {
    # NWS asks for a UA identifying the app; contact is a courtesy for abuse.
    "User-Agent": "TeamDashboard/1.0 (engineering wall display)",
    "Accept": "application/geo+json",
}
_API = "https://api.weather.gov"


@dataclass
class WeatherCache:
    place: str = ""
    today: dict[str, Any] | None = None
    periods: list[dict[str, Any]] = field(default_factory=list)
    alerts: list[dict[str, Any]] = field(default_factory=list)
    fetched_at: str | None = None
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "place": self.place,
            "today": self.today,
            "periods": self.periods,
            "alerts": self.alerts,
            "fetched_at": self.fetched_at,
            "error": self.error,
        }


class WeatherService:
    def __init__(self, point: str, place: str) -> None:
        self._point = point.strip()
        self._place = place.strip()
        self._forecast_url: str | None = None      # resolved once from /points
        self._cache = WeatherCache(place=self._place)

    @property
    def snapshot(self) -> dict[str, Any]:
        return self._cache.to_dict()

    async def refresh(self) -> dict[str, Any]:
        if not self._point:
            self._cache = WeatherCache(place=self._place, error="No weather point configured")
            return self.snapshot
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT, follow_redirects=True,
                                         headers=_HEADERS) as client:
                periods = await self._forecast(client)
                alerts = await self._alerts(client)
        except Exception as exc:                    # network/JSON/shape — all non-fatal
            log.warning("weather refresh failed: %s", exc)
            self._cache.error = "Weather unavailable"   # keep last good on screen
            return self.snapshot

        today = next((p for p in periods if p.get("isDaytime")), periods[0] if periods else None)
        self._cache = WeatherCache(
            place=self._place,
            today=today,
            periods=periods[:4],
            alerts=alerts,
            fetched_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
            error=None,
        )
        return self.snapshot

    async def _forecast(self, client: httpx.AsyncClient) -> list[dict[str, Any]]:
        if self._forecast_url is None:
            meta = (await self._json(client, f"{_API}/points/{self._point}")).get("properties", {})
            self._forecast_url = meta.get("forecast")
            # If NWS gave a nicer place label than our config, keep ours; the
            # config wins for a clean, familiar name on the wall.
            if not self._forecast_url:
                raise ValueError("no forecast url for point")
        data = await self._json(client, self._forecast_url)
        return [_period(p) for p in data.get("properties", {}).get("periods", [])]

    async def _alerts(self, client: httpx.AsyncClient) -> list[dict[str, Any]]:
        data = await self._json(client, f"{_API}/alerts/active", params={"point": self._point})
        alerts = [_alert(f.get("properties", {})) for f in data.get("features", [])]
        # Most urgent first; NWS severity ranks Extreme > Severe > Moderate > Minor.
        order = {"Extreme": 0, "Severe": 1, "Moderate": 2, "Minor": 3, "Unknown": 4}
        return sorted(alerts, key=lambda a: order.get(a["severity"], 5))

    async def _json(self, client: httpx.AsyncClient, url: str,
                    params: dict[str, Any] | None = None) -> dict[str, Any]:
        response = await client.get(url, params=params)
        response.raise_for_status()
        return response.json()


def _period(p: dict[str, Any]) -> dict[str, Any]:
    precip = (p.get("probabilityOfPrecipitation") or {}).get("value")
    return {
        "name": p.get("name", ""),
        "temp": p.get("temperature"),
        "unit": p.get("temperatureUnit", "F"),
        "short": p.get("shortForecast", ""),
        "detailed": p.get("detailedForecast", ""),
        "precip": precip,                          # percent or None
        "wind": " ".join(x for x in (p.get("windSpeed", ""), p.get("windDirection", "")) if x),
        "isDaytime": bool(p.get("isDaytime")),
    }


def _alert(p: dict[str, Any]) -> dict[str, Any]:
    return {
        "event": p.get("event", "Weather alert"),
        "severity": p.get("severity", "Unknown"),
        "headline": p.get("headline", ""),
        "ends": p.get("ends") or p.get("expires"),
    }
