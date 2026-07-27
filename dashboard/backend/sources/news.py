"""World news ticker fed by RSS/Atom feeds.

Network failures are expected on a wall display, so the fetcher keeps serving the
last good pull and reports staleness rather than blanking the ticker.
"""

from __future__ import annotations

import asyncio
import html
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

import feedparser
import httpx

log = logging.getLogger(__name__)

_TAG = re.compile(r"<[^>]+>")
_WHITESPACE = re.compile(r"\s+")
_FETCH_TIMEOUT = 12.0


@dataclass
class NewsCache:
    items: list[dict[str, Any]] = field(default_factory=list)
    fetched_at: str | None = None
    sources_ok: int = 0
    sources_total: int = 0
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "items": self.items,
            "fetched_at": self.fetched_at,
            "sources_ok": self.sources_ok,
            "sources_total": self.sources_total,
            "error": self.error,
        }


class NewsService:
    def __init__(self, feeds: list[str], max_items: int = 40) -> None:
        self._feeds = feeds
        self._max_items = max_items
        self._cache = NewsCache(sources_total=len(feeds))

    @property
    def snapshot(self) -> dict[str, Any]:
        return self._cache.to_dict()

    async def refresh(self) -> dict[str, Any]:
        if not self._feeds:
            self._cache = NewsCache(error="No feeds configured")
            return self.snapshot

        async with httpx.AsyncClient(
            timeout=_FETCH_TIMEOUT,
            follow_redirects=True,
            headers={"User-Agent": "TeamDashboard/1.0 (+wall display)"},
        ) as client:
            results = await asyncio.gather(
                *(self._fetch(client, url) for url in self._feeds),
                return_exceptions=True,
            )

        items: list[dict[str, Any]] = []
        ok = 0
        for feed_url, result in zip(self._feeds, results):
            if isinstance(result, BaseException):
                log.warning("feed failed %s: %s", _host(feed_url), result)
                continue
            ok += 1
            items.extend(result)

        if not items:
            # Keep whatever we had on screen; just mark the pull as failed.
            self._cache.error = "All feeds unreachable"
            self._cache.sources_ok = 0
            return self.snapshot

        self._cache = NewsCache(
            items=_dedupe(items)[: self._max_items],
            fetched_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
            sources_ok=ok,
            sources_total=len(self._feeds),
            error=None if ok == len(self._feeds) else f"{len(self._feeds) - ok} feed(s) unreachable",
        )
        return self.snapshot

    async def _fetch(self, client: httpx.AsyncClient, url: str) -> list[dict[str, Any]]:
        response = await client.get(url)
        response.raise_for_status()
        # feedparser is synchronous CPU work; keep it off the event loop.
        parsed = await asyncio.to_thread(feedparser.parse, response.content)
        source = _clean(parsed.feed.get("title", "")) or _host(url)
        return [_entry_to_item(entry, source) for entry in parsed.entries[:15]]


def _entry_to_item(entry: Any, source: str) -> dict[str, Any]:
    published = _published_at(entry)
    return {
        "title": _clean(entry.get("title", "")),
        "source": source,
        "link": entry.get("link", ""),
        "published": published.isoformat(timespec="seconds") if published else None,
        "published_epoch": published.timestamp() if published else 0.0,
    }


def _published_at(entry: Any) -> datetime | None:
    for key in ("published_parsed", "updated_parsed"):
        parsed = entry.get(key)
        if parsed:
            try:
                return datetime(*parsed[:6], tzinfo=timezone.utc)
            except (TypeError, ValueError):
                continue
    return None


def _dedupe(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Wire stories repeat across outlets — collapse them to one ticker entry."""
    seen: set[str] = set()
    unique: list[dict[str, Any]] = []
    for item in sorted(items, key=lambda i: i["published_epoch"], reverse=True):
        if not item["title"]:
            continue
        key = re.sub(r"[^a-z0-9]+", "", item["title"].lower())[:70]
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)
    return unique


def _clean(text: str) -> str:
    return _WHITESPACE.sub(" ", html.unescape(_TAG.sub("", text or ""))).strip()


def _host(url: str) -> str:
    return (urlparse(url).hostname or url).removeprefix("www.")
