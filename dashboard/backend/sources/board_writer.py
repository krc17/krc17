"""Write card changes back into the project YAML files.

Three things make this harder than "load, edit, dump":

1. ``projects.yaml`` carries a 20-line comment block documenting the schema,
   and people edit that file by hand. PyYAML's dumper throws comments away, so
   this uses ruamel's round-trip mode, which preserves them exactly.
2. The file watcher is pointed at the same folder, so our own write would fire
   a repaint and could stomp a drag that is still in progress. Writes are
   therefore announced, and the watcher ignores events for a moment afterwards.
3. Someone may have the file open in Notepad. Every write re-checks the mtime it
   read from, and refuses rather than silently discarding their edit.
"""

from __future__ import annotations

import io
import logging
import os
import tempfile
import threading
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Callable

from ruamel.yaml import YAML

log = logging.getLogger(__name__)

# How long after our own write the watcher should ignore events for the folder.
SELF_WRITE_QUIET_SECONDS = 2.0

_SOURCE_SUFFIXES = (".yaml", ".yml")


@dataclass(frozen=True)
class WriteResult:
    ok: bool
    detail: str
    card_id: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {"ok": self.ok, "detail": self.detail, "card_id": self.card_id}


class BoardWriter:
    def __init__(self, folder: Path) -> None:
        self._folder = folder
        self._lock = threading.Lock()
        self._quiet_until = 0.0
        self._yaml = YAML()
        self._yaml.preserve_quotes = True
        self._yaml.width = 4096          # never re-wrap a line the team wrote

    # ----------------------------------------------------------------- #
    # Watcher coordination
    # ----------------------------------------------------------------- #
    def in_quiet_period(self) -> bool:
        """True when a filesystem event is almost certainly our own write."""
        return time.monotonic() < self._quiet_until

    def _begin_quiet_period(self) -> None:
        self._quiet_until = time.monotonic() + SELF_WRITE_QUIET_SECONDS

    # ----------------------------------------------------------------- #
    # Mutations
    # ----------------------------------------------------------------- #
    def set_status(self, card_id: str, status: str) -> WriteResult:
        def mutate(card: Any) -> str | None:
            previous = str(card.get("status", ""))
            if previous == status:
                return None
            card["status"] = status
            return f"{previous or 'unset'} -> {status}"

        return self._edit(card_id, mutate, "status")

    def set_progress(self, card_id: str, progress: int) -> WriteResult:
        clamped = max(0, min(100, int(progress)))

        def mutate(card: Any) -> str | None:
            previous = card.get("progress")
            if previous is not None and int(previous) == clamped:
                return None
            card["progress"] = clamped
            return f"{previous if previous is not None else 'derived'}% -> {clamped}%"

        return self._edit(card_id, mutate, "progress")

    def shift_due(self, card_id: str, days: int) -> WriteResult:
        """Nudge the due date by whole days, or set it from today if unset."""

        def mutate(card: Any) -> str | None:
            current = _as_date(card.get("due"))
            base = current or date.today()
            # An unset date starts from today, so +7 means "a week from now"
            # rather than a week after some arbitrary epoch.
            target = base + timedelta(days=days) if current else date.today() + timedelta(days=days)
            if current == target:
                return None
            card["due"] = target          # a date, so ruamel emits it unquoted
            return f"{current.isoformat() if current else 'unset'} -> {target.isoformat()}"

        return self._edit(card_id, mutate, "due")

    def set_due(self, card_id: str, value: str | None) -> WriteResult:
        """Set an explicit ISO date, or clear it when value is empty."""
        if value:
            parsed = _as_date(value)
            if parsed is None:
                return WriteResult(False, f"{value!r} is not a YYYY-MM-DD date", card_id)
        else:
            parsed = None

        def mutate(card: Any) -> str | None:
            current = _as_date(card.get("due"))
            if current == parsed:
                return None
            if parsed is None:
                card.pop("due", None)
                return f"{current.isoformat() if current else 'unset'} -> cleared"
            card["due"] = parsed          # keep the file's native date style
            return f"{current.isoformat() if current else 'unset'} -> {parsed.isoformat()}"

        return self._edit(card_id, mutate, "due")

    def toggle_milestone(self, card_id: str, index: int, done: bool) -> WriteResult:
        def mutate(card: Any) -> str | None:
            milestones = card.get("milestones")
            if not isinstance(milestones, list) or not 0 <= index < len(milestones):
                raise IndexError(f"milestone {index} does not exist")
            entry = milestones[index]
            if not isinstance(entry, dict):
                # A bare string milestone has nowhere to record state; promote it.
                milestones[index] = {"name": str(entry), "done": done}
                return f"milestone {index} -> {done}"
            if bool(entry.get("done")) == done:
                return None
            entry["done"] = done
            return f"milestone {index} -> {done}"

        return self._edit(card_id, mutate, "milestone")

    # ----------------------------------------------------------------- #
    # Core
    # ----------------------------------------------------------------- #
    def _edit(
        self, card_id: str, mutate: Callable[[Any], str | None], what: str
    ) -> WriteResult:
        with self._lock:
            try:
                located = self._locate(card_id)
            except Exception as exc:
                log.exception("could not read the board")
                return WriteResult(False, f"could not read the board: {exc.__class__.__name__}")

            if located is None:
                return WriteResult(False, f"no card with id {card_id!r}", card_id)

            path, mtime, document, card = located
            try:
                change = mutate(card)
            except IndexError as exc:
                return WriteResult(False, str(exc), card_id)

            if change is None:
                return WriteResult(True, "already in that state", card_id)

            # Re-check just before writing: someone may have saved while we worked.
            if path.stat().st_mtime != mtime:
                return WriteResult(
                    False, f"{path.name} changed on disk, refusing to overwrite", card_id
                )

            self._begin_quiet_period()
            try:
                self._atomic_dump(path, document)
            except OSError as exc:
                log.exception("write failed")
                return WriteResult(False, f"could not write {path.name}: {exc.strerror}", card_id)

            log.info("%s %s: %s", card_id, what, change)
            return WriteResult(True, change, card_id)

    def _locate(self, card_id: str) -> tuple[Path, float, Any, Any] | None:
        """Find the file and node holding this card, across every board file."""
        for path in sorted(self._folder.glob("*")):
            if path.suffix.lower() not in _SOURCE_SUFFIXES or path.name.startswith("."):
                continue
            mtime = path.stat().st_mtime
            document = self._yaml.load(path.read_text(encoding="utf-8"))
            if not isinstance(document, dict):
                continue
            for key in ("projects", "items", "cards", "tasks"):
                entries = document.get(key)
                if not isinstance(entries, list):
                    continue
                for entry in entries:
                    if isinstance(entry, dict) and _identity(entry) == card_id:
                        return path, mtime, document, entry
        return None

    def _atomic_dump(self, path: Path, document: Any) -> None:
        buffer = io.StringIO()
        self._yaml.dump(document, buffer)
        payload = buffer.getvalue()

        fd, tmp_name = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="") as handle:
                handle.write(payload)
            os.replace(tmp_name, path)
        except OSError:
            Path(tmp_name).unlink(missing_ok=True)
            raise


def _as_date(raw: Any) -> date | None:
    """Accept what ruamel hands back: a real date, a datetime, or a string."""
    if isinstance(raw, datetime):
        return raw.date()
    if isinstance(raw, date):
        return raw
    text = str(raw or "").strip()
    if not text:
        return None
    try:
        return date.fromisoformat(text)
    except ValueError:
        return None


def _identity(entry: dict[str, Any]) -> str:
    """Mirror the id the reader hands to the frontend, so lookups agree."""
    import re

    raw = entry.get("id")
    if raw is not None and str(raw).strip():
        return str(raw).strip()
    title = str(entry.get("title") or entry.get("name") or "")
    return re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:48]
