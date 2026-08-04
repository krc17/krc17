"""Accept files dropped from a browser on the LAN.

The alternative -- teaching everyone to reach a UNC share -- fails for the
people who most need to post: someone on a laptop, on wifi, who does not have
the share mapped. A URL works for all of them.

Uploads are deliberately more permissive than the board-control endpoints. A
posted document is additive and reversible; stopping the wall or rewriting the
project board is not. So uploads are allowed from the LAN while control stays
loopback-only.

Everything about the incoming name is treated as hostile: the extension is
whitelisted against what the parsers actually read, the stem is rebuilt from
safe characters, and the result is confined to the target folder.
"""

from __future__ import annotations

import logging
import re
import unicodedata
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

log = logging.getLogger(__name__)

# Exactly what the document parsers can read. Anything else is refused with a
# message naming these, rather than being accepted and silently ignored.
ALLOWED_SUFFIXES = {".docx", ".pdf", ".md", ".markdown", ".txt"}
MAX_BYTES = 25 * 1024 * 1024
MAX_STEM = 80

_UNSAFE = re.compile(r"[^A-Za-z0-9 ._-]+")
_RUNS = re.compile(r"[ _]{2,}")

DESTINATIONS = {
    "takeaways": "Team Meeting Takeaways",
    "updates": "Team Updates",
}


@dataclass(frozen=True)
class UploadResult:
    ok: bool
    detail: str
    filename: str = ""
    destination: str = ""


def safe_filename(raw: str) -> str | None:
    """Rebuild a filename from safe parts, or None if nothing usable remains."""
    # Browsers on Windows sometimes send a full path; keep only the last part.
    name = str(raw or "").replace("\\", "/").split("/")[-1].strip()
    if not name:
        return None

    suffix = Path(name).suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        return None

    stem = Path(name).stem
    # Strip accents to ASCII so the name survives any filesystem it lands on.
    stem = unicodedata.normalize("NFKD", stem).encode("ascii", "ignore").decode()
    stem = _UNSAFE.sub(" ", stem)
    stem = _RUNS.sub(" ", stem).strip(" ._-")[:MAX_STEM]
    if not stem:
        return None

    return f"{stem}{suffix}"


def unique_path(folder: Path, filename: str) -> Path:
    """Never overwrite. A same-named file gets a dated sibling instead."""
    candidate = folder / filename
    if not candidate.exists():
        return candidate

    stem, suffix = Path(filename).stem, Path(filename).suffix
    stamp = datetime.now().strftime("%Y-%m-%d-%H%M")
    candidate = folder / f"{stem} ({stamp}){suffix}"
    counter = 2
    while candidate.exists():
        candidate = folder / f"{stem} ({stamp}-{counter}){suffix}"
        counter += 1
    return candidate


def store(folder: Path, raw_name: str, payload: bytes, destination: str) -> UploadResult:
    if len(payload) == 0:
        return UploadResult(False, "That file is empty.")
    if len(payload) > MAX_BYTES:
        return UploadResult(
            False, f"That file is {len(payload) / 1048576:.0f} MB. The limit is 25 MB."
        )

    filename = safe_filename(raw_name)
    if filename is None:
        allowed = ", ".join(sorted(s.lstrip(".") for s in ALLOWED_SUFFIXES))
        return UploadResult(False, f"Only these file types work: {allowed}.")

    try:
        folder.mkdir(parents=True, exist_ok=True)
        target = unique_path(folder, filename)
        # Confirm the resolved path is still inside the folder we intended.
        if folder.resolve() not in target.resolve().parents:
            return UploadResult(False, "Rejected: that filename escapes the folder.")
        target.write_bytes(payload)
    except OSError as exc:
        log.exception("upload failed")
        return UploadResult(False, f"Could not save it: {exc.strerror}")

    log.info("uploaded %s -> %s", target.name, destination)
    return UploadResult(True, "Saved", target.name, DESTINATIONS.get(destination, destination))
