"""Turn dropped Word/PDF/Markdown files into structured blocks the wall can render.

Anyone on the team drops a file in the watched folder; the panel picks it up on
the next filesystem event. Parsing results are memoised on (path, mtime, size)
so re-reading a 40-page PDF only happens when it actually changes.
"""

from __future__ import annotations

import html
import logging
import re
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

log = logging.getLogger(__name__)

SUPPORTED_SUFFIXES = {".docx", ".pdf", ".md", ".markdown", ".txt"}
MAX_BLOCKS = 240

_BULLET_PREFIX = re.compile(r"^\s*([-*•‣◦⁃∙]|\d{1,2}[.)])\s+")
_MD_HEADING = re.compile(r"^(#{1,6})\s+(.*)$")
_SENTENCE_END = re.compile(r"[.!?:;,]$")
_WHITESPACE = re.compile(r"\s+")


@dataclass
class Block:
    """One renderable line of a document."""

    type: str  # heading | bullet | paragraph | table
    text: str = ""
    level: int = 0
    rows: list[list[str]] = field(default_factory=list)


@dataclass
class Document:
    id: str
    title: str
    filename: str
    kind: str
    modified: str
    modified_epoch: float
    size_bytes: int
    blocks: list[Block]
    truncated: bool = False
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["blocks"] = [
            {k: v for k, v in block.items() if v not in ("", 0, [])} | {"type": block["type"]}
            for block in payload["blocks"]
        ]
        return payload


_cache: dict[str, tuple[tuple[float, int], Document]] = {}


# --------------------------------------------------------------------------- #
# Public API
# --------------------------------------------------------------------------- #
def load_folder(folder: Path) -> list[dict[str, Any]]:
    """Parse every supported file in ``folder``, newest first."""
    if not folder.exists():
        return []

    documents: list[Document] = []
    for path in sorted(folder.iterdir()):
        if not path.is_file() or path.name.startswith((".", "~$")):
            continue
        if path.suffix.lower() not in SUPPORTED_SUFFIXES:
            continue
        documents.append(_load_cached(path))

    documents.sort(key=lambda doc: doc.modified_epoch, reverse=True)
    _prune_cache(folder, {str(path) for path in folder.iterdir()})
    return [doc.to_dict() for doc in documents]


def _load_cached(path: Path) -> Document:
    stat = path.stat()
    signature = (stat.st_mtime, stat.st_size)
    key = str(path)
    cached = _cache.get(key)
    if cached and cached[0] == signature:
        return cached[1]

    document = _parse(path, stat.st_mtime, stat.st_size)
    _cache[key] = (signature, document)
    return document


def _prune_cache(folder: Path, live_paths: set[str]) -> None:
    """Drop entries for deleted files, but only within the folder we just scanned."""
    prefix = f"{folder}/"
    stale = [key for key in _cache if key.startswith(prefix) and key not in live_paths]
    for key in stale:
        _cache.pop(key, None)


def _parse(path: Path, mtime: float, size: int) -> Document:
    suffix = path.suffix.lower()
    blocks: list[Block] = []
    error: str | None = None

    try:
        if suffix == ".docx":
            blocks = _parse_docx(path)
        elif suffix == ".pdf":
            blocks = _parse_pdf(path)
        elif suffix in (".md", ".markdown"):
            blocks = _parse_markdown(path)
        else:
            blocks = _parse_plaintext(path)
    except Exception as exc:  # a malformed drop must not take the wall down
        log.exception("failed to parse %s", path.name)
        error = f"Could not read this file: {exc.__class__.__name__}"

    truncated = len(blocks) > MAX_BLOCKS
    if truncated:
        blocks = blocks[:MAX_BLOCKS]

    title, blocks = _split_title(blocks, fallback=_pretty_name(path))
    modified = datetime.fromtimestamp(mtime, tz=timezone.utc)

    return Document(
        id=_slug(path.name),
        title=title,
        filename=path.name,
        kind=suffix.lstrip("."),
        modified=modified.isoformat(timespec="seconds"),
        modified_epoch=mtime,
        size_bytes=size,
        blocks=blocks,
        truncated=truncated,
        error=error,
    )


# --------------------------------------------------------------------------- #
# Format-specific readers
# --------------------------------------------------------------------------- #
def _parse_docx(path: Path) -> list[Block]:
    from docx import Document as DocxDocument  # imported lazily; keeps startup fast
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    document = DocxDocument(str(path))
    blocks: list[Block] = []

    for element in document.element.body.iterchildren():
        tag = element.tag.split("}")[-1]
        if tag == "p":
            block = _docx_paragraph(Paragraph(element, document))
            if block:
                blocks.append(block)
        elif tag == "tbl":
            rows = _docx_table(Table(element, document))
            if rows:
                blocks.append(Block(type="table", rows=rows))

    return blocks


def _docx_paragraph(paragraph: Any) -> Block | None:
    text = _clean(paragraph.text)
    if not text:
        return None

    style = (getattr(paragraph.style, "name", "") or "").lower()
    if style.startswith("heading") or style in ("title", "subtitle"):
        digits = re.findall(r"\d", style)
        level = int(digits[0]) if digits else 1
        return Block(type="heading", text=text, level=min(level, 3))
    if "list" in style or _BULLET_PREFIX.match(text):
        return Block(type="bullet", text=_BULLET_PREFIX.sub("", text))
    return Block(type="paragraph", text=text)


def _docx_table(table: Any) -> list[list[str]]:
    rows: list[list[str]] = []
    for row in table.rows[:12]:
        cells = [_clean(cell.text) for cell in row.cells[:6]]
        if any(cells):
            rows.append(cells)
    return rows


def _parse_pdf(path: Path) -> list[Block]:
    from pypdf import PdfReader

    reader = PdfReader(str(path))
    lines: list[str] = []
    for page in reader.pages[:25]:
        text = page.extract_text() or ""
        lines.extend(text.splitlines())
    return _blocks_from_lines(lines)


def _parse_markdown(path: Path) -> list[Block]:
    blocks: list[Block] = []
    # Markdown soft-wraps: consecutive non-blank lines are one paragraph.
    pending: list[str] = []

    def flush() -> None:
        if pending:
            blocks.append(Block(type="paragraph", text=_clean(" ".join(pending))))
            pending.clear()

    in_code = False
    for raw in _read_text(path).splitlines():
        line = raw.rstrip()

        if line.strip().startswith("```"):
            flush()
            in_code = not in_code
            continue
        if in_code:
            continue

        if not line.strip():
            flush()
            continue

        heading = _MD_HEADING.match(line)
        if heading:
            flush()
            blocks.append(
                Block(type="heading", text=_clean(heading.group(2)), level=min(len(heading.group(1)), 3))
            )
            continue

        if _BULLET_PREFIX.match(line):
            flush()
            blocks.append(Block(type="bullet", text=_clean(_strip_inline_markdown(_BULLET_PREFIX.sub("", line)))))
            continue

        stripped = line.strip()
        if len(stripped) >= 3 and set(stripped) <= {"-", "=", "*", "_"}:
            flush()
            continue  # horizontal rule / setext underline

        pending.append(_strip_inline_markdown(line))

    flush()
    return blocks


def _parse_plaintext(path: Path) -> list[Block]:
    return _blocks_from_lines(_read_text(path).splitlines())


def _blocks_from_lines(lines: Iterable[str]) -> list[Block]:
    """Shared heuristics for formats that only give us flat lines (PDF, TXT)."""
    blocks: list[Block] = []
    for raw in lines:
        line = _clean(raw)
        if not line:
            continue
        if _BULLET_PREFIX.match(line):
            blocks.append(Block(type="bullet", text=_BULLET_PREFIX.sub("", line)))
            continue
        if _looks_like_heading(line):
            blocks.append(Block(type="heading", text=line, level=2))
            continue
        blocks.append(Block(type="paragraph", text=line))
    return _merge_wrapped_paragraphs(blocks)


def _looks_like_heading(line: str) -> bool:
    if len(line) > 70 or _SENTENCE_END.search(line):
        return False
    letters = [ch for ch in line if ch.isalpha()]
    if letters and all(ch.isupper() for ch in letters):
        return True

    words = line.split()
    if not words or not words[0][:1].isupper():
        return False
    # A short capitalised word on its own line is a section label, not prose.
    if len(words) == 1:
        return len(words[0]) <= 25 and words[0].isalpha()
    # Title Case with few words reads as a section header in most meeting notes.
    return len(words) <= 8 and sum(w[:1].isupper() for w in words) >= max(2, len(words) - 1)


def _merge_wrapped_paragraphs(blocks: list[Block]) -> list[Block]:
    """PDF extraction breaks sentences at the page's line width — glue them back."""
    merged: list[Block] = []
    for block in blocks:
        previous = merged[-1] if merged else None
        if (
            previous is not None
            and previous.type == "paragraph"
            and block.type == "paragraph"
            and not _SENTENCE_END.search(previous.text)
            and block.text[:1].islower()
        ):
            previous.text = f"{previous.text} {block.text}"
            continue
        merged.append(block)
    return merged


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def _clean(text: str) -> str:
    return _WHITESPACE.sub(" ", html.unescape(text or "")).strip()


def _strip_inline_markdown(text: str) -> str:
    text = re.sub(r"!?\[([^\]]*)\]\([^)]*\)", r"\1", text)  # links & images
    text = re.sub(r"(\*\*|__|\*|_|`)", "", text)
    return text


def _split_title(blocks: list[Block], fallback: str) -> tuple[str, list[Block]]:
    """Promote a leading heading to the card title so it isn't printed twice."""
    if blocks and blocks[0].type == "heading" and len(blocks[0].text) <= 90:
        return blocks[0].text, blocks[1:]
    return fallback, blocks


def _pretty_name(path: Path) -> str:
    stem = re.sub(r"[_\-]+", " ", path.stem)
    stem = re.sub(r"^\d{4}[-_ ]?\d{2}[-_ ]?\d{2}\s*", "", stem).strip()
    return stem.title() if stem.islower() else stem or path.stem


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
