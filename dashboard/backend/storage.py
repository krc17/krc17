"""Persistence for the blackboard so a browser refresh never wipes the wall."""

from __future__ import annotations

import json
import logging
import os
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

EMPTY_BOARD: dict[str, Any] = {"strokes": [], "updated_at": None, "revision": 0}


class BlackboardStore:
    """Single-file JSON store holding the vector strokes drawn on the board.

    Strokes are kept as points rather than a flattened image so the board stays
    resolution-independent and can be replayed on a second screen.
    """

    def __init__(self, path: Path) -> None:
        self._path = path
        self._lock = threading.Lock()
        self._cache: dict[str, Any] | None = None

    def read(self) -> dict[str, Any]:
        with self._lock:
            if self._cache is not None:
                return self._cache
            if not self._path.exists():
                self._cache = dict(EMPTY_BOARD)
                return self._cache
            try:
                data = json.loads(self._path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError) as exc:
                log.warning("blackboard unreadable (%s), starting a clean board", exc)
                data = dict(EMPTY_BOARD)
            data.setdefault("strokes", [])
            data.setdefault("revision", 0)
            data.setdefault("updated_at", None)
            self._cache = data
            return data

    def write(self, strokes: list[dict[str, Any]]) -> dict[str, Any]:
        with self._lock:
            revision = int((self._cache or self.__read_unlocked()).get("revision", 0)) + 1
            payload = {
                "strokes": strokes,
                "revision": revision,
                "updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            }
            self._atomic_write(payload)
            self._cache = payload
            return payload

    def __read_unlocked(self) -> dict[str, Any]:
        if not self._path.exists():
            return dict(EMPTY_BOARD)
        try:
            return json.loads(self._path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return dict(EMPTY_BOARD)

    def _atomic_write(self, payload: dict[str, Any]) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_name = tempfile.mkstemp(dir=str(self._path.parent), suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(payload, handle)
            os.replace(tmp_name, self._path)
        except OSError as exc:
            log.error("could not persist blackboard: %s", exc)
            Path(tmp_name).unlink(missing_ok=True)
