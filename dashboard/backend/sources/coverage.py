"""Daily area-coverage board: which engineer is on which area today.

Shaped like the project board -- columns are areas, cards are engineers -- but
one card sits in exactly one column, so a "move" is simply reassigning an
engineer to an area. The file is hand-editable and carries a comment header, so
the same round-trip write path the project board uses applies here: preserve
comments, re-check the mtime before writing, and quiet the watcher briefly so
our own save does not repaint a drag mid-flight.
"""

from __future__ import annotations

import io
import logging
import os
import tempfile
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ruamel.yaml import YAML

log = logging.getLogger(__name__)

SELF_WRITE_QUIET_SECONDS = 2.0
_SOURCE_SUFFIXES = (".yaml", ".yml")

# The wall shows these areas as columns, in this order, even before anyone is
# assigned. Editing the file's own areas list overrides them.
DEFAULT_AREAS = ["Perimeter", "HD JOE", "Downtown", "On-Call", "Special project"]


@dataclass(frozen=True)
class WriteResult:
    ok: bool
    detail: str
    engineer: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {"ok": self.ok, "detail": self.detail, "engineer": self.engineer}


class CoverageStore:
    """Read and update the single coverage file in ``folder``."""

    def __init__(self, folder: Path) -> None:
        self._folder = folder
        self._lock = threading.Lock()
        self._quiet_until = 0.0
        self._yaml = YAML()
        self._yaml.preserve_quotes = True
        self._yaml.width = 4096

    # ----------------------------------------------------------------- #
    # Watcher coordination
    # ----------------------------------------------------------------- #
    def in_quiet_period(self) -> bool:
        return time.monotonic() < self._quiet_until

    def _begin_quiet_period(self) -> None:
        self._quiet_until = time.monotonic() + SELF_WRITE_QUIET_SECONDS

    # ----------------------------------------------------------------- #
    # Read
    # ----------------------------------------------------------------- #
    def load(self) -> dict[str, Any]:
        """Return {areas, engineers:[{name,area}], updated_at, errors}."""
        located = self._locate()
        if located is None:
            return {
                "areas": list(DEFAULT_AREAS),
                "engineers": [],
                "updated_at": None,
                "errors": [],
            }

        path, _mtime, document = located
        errors: list[str] = []

        block = document.get("coverage") if isinstance(document, dict) else None
        if not isinstance(block, dict):
            block = {}

        areas = [str(area).strip() for area in (block.get("areas") or []) if str(area).strip()]
        if not areas:
            areas = list(DEFAULT_AREAS)

        engineers: list[dict[str, str]] = []
        for entry in block.get("engineers") or []:
            if isinstance(entry, dict):
                name = str(entry.get("name", "")).strip()
                area = str(entry.get("area", "")).strip()
            else:
                name, area = str(entry).strip(), ""
            if not name:
                continue
            # An unknown or blank area lands in the first column rather than
            # vanishing off the board -- the coverage is still visible, and a
            # drag fixes it. Note it so a typo in the file is not silent.
            if area not in areas:
                if area:
                    errors.append(f"{name}: area {area!r} is not one of the columns")
                area = areas[0]
            engineers.append({"name": name, "area": area})

        return {
            "areas": areas,
            "engineers": engineers,
            "updated_at": datetime.fromtimestamp(
                path.stat().st_mtime, tz=timezone.utc
            ).isoformat(timespec="seconds"),
            "errors": errors,
        }

    # ----------------------------------------------------------------- #
    # Write
    # ----------------------------------------------------------------- #
    def assign(self, engineer: str, area: str) -> WriteResult:
        """Move an engineer to an area, writing the change back to the file."""
        engineer = engineer.strip()
        area = area.strip()

        with self._lock:
            located = self._locate()
            if located is None:
                return WriteResult(False, "no coverage file to write to", engineer)
            path, mtime, document = located

            block = document.get("coverage") if isinstance(document, dict) else None
            if not isinstance(block, dict):
                return WriteResult(False, "coverage file has no 'coverage:' block", engineer)

            areas = [str(a).strip() for a in (block.get("areas") or []) if str(a).strip()] or list(
                DEFAULT_AREAS
            )
            if area not in areas:
                return WriteResult(False, f"{area!r} is not one of the areas", engineer)

            entries = block.get("engineers")
            if not isinstance(entries, list):
                return WriteResult(False, "coverage file has no engineers", engineer)

            target = next(
                (
                    entry
                    for entry in entries
                    if isinstance(entry, dict)
                    and str(entry.get("name", "")).strip().lower() == engineer.lower()
                ),
                None,
            )
            if target is None:
                return WriteResult(False, f"no engineer named {engineer!r}", engineer)

            if str(target.get("area", "")).strip() == area:
                return WriteResult(True, "already there", engineer)

            if path.stat().st_mtime != mtime:
                return WriteResult(
                    False, f"{path.name} changed on disk, refusing to overwrite", engineer
                )

            previous = str(target.get("area", "")) or "unset"
            target["area"] = area
            self._begin_quiet_period()
            try:
                self._atomic_dump(path, document)
            except OSError as exc:
                log.exception("coverage write failed")
                return WriteResult(False, f"could not write {path.name}: {exc.strerror}", engineer)

            log.info("coverage %s: %s -> %s", engineer, previous, area)
            return WriteResult(True, f"{previous} -> {area}", engineer)

    # ----------------------------------------------------------------- #
    # Core
    # ----------------------------------------------------------------- #
    def _locate(self) -> tuple[Path, float, Any] | None:
        """The first YAML file in the folder that carries a coverage block."""
        for path in sorted(self._folder.glob("*")):
            if path.suffix.lower() not in _SOURCE_SUFFIXES or path.name.startswith("."):
                continue
            try:
                document = self._yaml.load(path.read_text(encoding="utf-8"))
            except Exception as exc:
                log.warning("could not read %s: %s", path.name, exc)
                continue
            if isinstance(document, dict) and "coverage" in document:
                return path, path.stat().st_mtime, document
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
