"""Filesystem watcher: a file dropped in a folder repaints the wall within a second."""

from __future__ import annotations

import logging
import threading
from pathlib import Path
from typing import Callable

from watchdog.events import FileSystemEvent, FileSystemEventHandler
from watchdog.observers import Observer

log = logging.getLogger(__name__)

# Word/PowerPoint write several times while saving; coalesce the burst.
_DEBOUNCE_SECONDS = 1.0
_IGNORED_PREFIXES = (".", "~$")
_IGNORED_SUFFIXES = (".tmp", ".crdownload", ".part", ".swp")


class _DebouncedHandler(FileSystemEventHandler):
    def __init__(self, channel: str, callback: Callable[[str], None]) -> None:
        self._channel = channel
        self._callback = callback
        self._timer: threading.Timer | None = None
        self._lock = threading.Lock()

    def on_any_event(self, event: FileSystemEvent) -> None:
        if event.is_directory:
            return
        name = Path(str(event.src_path)).name
        if name.startswith(_IGNORED_PREFIXES) or name.lower().endswith(_IGNORED_SUFFIXES):
            return
        self._schedule()

    def _schedule(self) -> None:
        with self._lock:
            if self._timer is not None:
                self._timer.cancel()
            self._timer = threading.Timer(_DEBOUNCE_SECONDS, self._fire)
            self._timer.daemon = True
            self._timer.start()

    def _fire(self) -> None:
        log.info("content changed: %s", self._channel)
        try:
            self._callback(self._channel)
        except Exception:
            log.exception("watcher callback failed for %s", self._channel)


class ContentWatcher:
    """Watches each content folder and reports which channel changed."""

    def __init__(self, callback: Callable[[str], None]) -> None:
        self._observer = Observer()
        self._callback = callback
        self._handlers: list[_DebouncedHandler] = []

    def watch(self, channel: str, folder: Path) -> None:
        folder.mkdir(parents=True, exist_ok=True)
        handler = _DebouncedHandler(channel, self._callback)
        self._handlers.append(handler)
        self._observer.schedule(handler, str(folder), recursive=True)
        log.info("watching %s -> %s", channel, folder)

    def start(self) -> None:
        self._observer.start()

    def stop(self) -> None:
        for handler in self._handlers:
            if handler._timer is not None:
                handler._timer.cancel()
        self._observer.stop()
        self._observer.join(timeout=5)
