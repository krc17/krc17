"""Live drive times for named routes, via TomTom's Routing API.

This is the Travel page's real payload: for each route the team cares about
(office to a remote site, a common commute), one call returns the current drive
time *with live traffic*, the normal free-flow time, and the delay -- so the
wall answers "how long right now, and is it worse than usual?" rather than just
listing incidents. Same TomTom key as traffic (Routing must be entitled on it).
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import httpx

log = logging.getLogger(__name__)

_TIMEOUT = 12.0
_BASE = "https://api.tomtom.com/routing/1/calculateRoute"


@dataclass
class RoutingCache:
    routes: list[dict[str, Any]] = field(default_factory=list)
    fetched_at: str | None = None
    configured: bool = False
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "routes": self.routes,
            "configured": self.configured,
            "fetched_at": self.fetched_at,
            "error": self.error,
        }


class RoutingService:
    def __init__(self, api_key: str, routes: list[dict[str, str]]) -> None:
        self._key = api_key.strip()
        self._routes = routes
        self._last: dict[str, dict[str, Any]] = {}   # last good result per route name
        self._cache = RoutingCache(configured=bool(self._key and self._routes))

    @property
    def snapshot(self) -> dict[str, Any]:
        return self._cache.to_dict()

    async def refresh(self) -> dict[str, Any]:
        if not self._key or not self._routes:
            self._cache = RoutingCache(
                configured=False,
                error=None if not self._routes else "No traffic key configured",
            )
            return self.snapshot
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT, follow_redirects=True) as client:
                results = await asyncio.gather(
                    *(self._one(client, route) for route in self._routes),
                    return_exceptions=True,
                )
        except Exception as exc:                       # couldn't even start — all fail
            log.warning("routing refresh failed: %s", exc)
            results = [exc] * len(self._routes)

        routes: list[dict[str, Any]] = []
        failures = 0
        for route, result in zip(self._routes, results):
            name = route["name"]
            if isinstance(result, BaseException):
                log.warning("route %s failed: %s", name, result)
                failures += 1
                if name in self._last:
                    # Keep the last good numbers on the wall, flagged stale so the
                    # UI can dim them and show when they were last updated.
                    routes.append({**self._last[name], "stale": True})
                else:
                    routes.append({"name": name, "error": True})   # never had data
            else:
                self._last[name] = result                          # remember last good
                routes.append(result)

        # Keep configured order (a reordering list on a wall is confusing); the
        # UI colours each by its own delay.
        self._cache = RoutingCache(
            routes=routes,
            configured=True,
            fetched_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
            error=f"{failures} route(s) unavailable" if failures else None,
        )
        return self.snapshot

    async def _one(self, client: httpx.AsyncClient, route: dict[str, str]) -> dict[str, Any]:
        url = f"{_BASE}/{route['from']}:{route['to']}/json"
        response = await client.get(url, params={
            "key": self._key,
            "traffic": "true",
            "routeType": "fastest",
            "computeTravelTimeFor": "all",
        })
        response.raise_for_status()
        summary = (response.json().get("routes") or [{}])[0].get("summary", {})
        live = int(summary.get("travelTimeInSeconds") or 0)
        delay = int(summary.get("trafficDelayInSeconds") or 0)
        free = int(summary.get("noTrafficTravelTimeInSeconds") or max(live - delay, 0))
        return {
            "name": route["name"],
            "minutes": round(live / 60),
            "delay_min": round(delay / 60),
            "free_min": round(free / 60),
            "km": round(int(summary.get("lengthInMeters") or 0) / 1000, 1),
            "as_of": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "error": False,
            "stale": False,
        }
