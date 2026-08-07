"""Road incidents from TomTom's Traffic Incidents API (v5).

Focused on what changes a drive -- accidents, jams, lane/road closures, flooding
-- inside a bounding box around the county. Free tier, but it needs an API key;
with no key the service returns an empty, clearly-labelled snapshot so the Travel
page simply shows weather only. A failed pull keeps the last good list on screen.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import httpx

log = logging.getLogger(__name__)

_TIMEOUT = 12.0
_URL = "https://api.tomtom.com/traffic/services/5/incidentDetails"
# The nested selection TomTom v5 wants; keeps the payload to what we render.
_FIELDS = (
    "{incidents{type,properties{iconCategory,magnitudeOfDelay,"
    "events{description,code,iconCategory},startTime,endTime,from,to,"
    "length,delay,roadNumbers}}}"
)
# iconCategory -> readable label. Drop the purely-weather ones (fog/rain/ice/
# wind) since the weather panel already covers those; keep road-affecting ones.
_CATEGORY = {
    1: "Accident",
    6: "Traffic jam",
    7: "Lane closed",
    8: "Road closed",
    9: "Roadworks",
    11: "Flooding",
    14: "Broken-down vehicle",
}
_CATEGORY_FILTER = ",".join(str(c) for c in _CATEGORY)


@dataclass
class TrafficCache:
    incidents: list[dict[str, Any]] = field(default_factory=list)
    fetched_at: str | None = None
    configured: bool = False
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "incidents": self.incidents,
            "count": len(self.incidents),
            "fetched_at": self.fetched_at,
            "configured": self.configured,
            "error": self.error,
        }


class TrafficService:
    def __init__(self, api_key: str, bbox: str) -> None:
        self._key = api_key.strip()
        self._bbox = bbox.strip()
        self._cache = TrafficCache(configured=bool(self._key))

    @property
    def snapshot(self) -> dict[str, Any]:
        return self._cache.to_dict()

    async def refresh(self) -> dict[str, Any]:
        if not self._key:
            self._cache = TrafficCache(configured=False, error="No traffic key configured")
            return self.snapshot
        params = {
            "key": self._key,
            "bbox": self._bbox,
            "fields": _FIELDS,
            "language": "en-US",
            "categoryFilter": _CATEGORY_FILTER,
            "timeValidityFilter": "present",
        }
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT, follow_redirects=True) as client:
                response = await client.get(_URL, params=params)
                response.raise_for_status()
                data = response.json()
        except Exception as exc:
            log.warning("traffic refresh failed: %s", exc)
            self._cache.configured = True
            self._cache.error = "Traffic unavailable"     # keep last good on screen
            return self.snapshot

        incidents = [_incident(i) for i in data.get("incidents", [])]
        incidents = [i for i in incidents if i]
        incidents.sort(key=lambda i: (-i["magnitude"], -i["delay"]))   # worst first
        self._cache = TrafficCache(
            incidents=incidents,
            fetched_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
            configured=True,
            error=None,
        )
        return self.snapshot


def _incident(feature: dict[str, Any]) -> dict[str, Any] | None:
    props = feature.get("properties") or {}
    category = props.get("iconCategory")
    label = _CATEGORY.get(category)
    if label is None:
        return None                                   # a category we don't surface
    events = props.get("events") or []
    description = (events[0].get("description") if events else "") or label
    roads = props.get("roadNumbers") or []
    road = ", ".join(r for r in roads if r) or props.get("from", "") or "Local road"
    return {
        "type": label,
        "category": category,
        "road": road,
        "description": description,
        "from": props.get("from", ""),
        "to": props.get("to", ""),
        "delay": int(props.get("delay") or 0),        # seconds of extra travel
        "length": int(props.get("length") or 0),      # metres affected
        "magnitude": int(props.get("magnitudeOfDelay") or 0),   # 0..4, 4 = closure
    }
