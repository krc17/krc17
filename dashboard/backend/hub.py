"""Tiny pub/sub fan-out used to push refresh events to every connected screen."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

log = logging.getLogger(__name__)


class EventHub:
    """Broadcasts server-sent events to all subscribed dashboards.

    ``publish`` is safe to call from any thread (the file watcher runs in one),
    which is why it hops back onto the event loop before touching the queues.
    """

    def __init__(self, max_queue: int = 32) -> None:
        self._subscribers: set[asyncio.Queue[str]] = set()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._max_queue = max_queue

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def subscribe(self) -> asyncio.Queue[str]:
        queue: asyncio.Queue[str] = asyncio.Queue(maxsize=self._max_queue)
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue[str]) -> None:
        self._subscribers.discard(queue)

    @property
    def subscriber_count(self) -> int:
        return len(self._subscribers)

    def publish(self, event: str, payload: dict[str, Any] | None = None) -> None:
        message = f"event: {event}\ndata: {json.dumps(payload or {})}\n\n"
        if self._loop is None or not self._loop.is_running():
            return
        try:
            self._loop.call_soon_threadsafe(self._dispatch, message)
        except RuntimeError:  # loop shutting down
            log.debug("event loop closed, dropping %s event", event)

    def _dispatch(self, message: str) -> None:
        for queue in list(self._subscribers):
            try:
                queue.put_nowait(message)
            except asyncio.QueueFull:
                # A wedged client should never back-pressure the rest of the wall.
                self._subscribers.discard(queue)
