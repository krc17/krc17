"""Project tracking board built from YAML/JSON files in the projects folder.

The shape is deliberately close to what modern trackers (Jira, Linear, Asana)
expose: a set of workflow columns, cards carrying owner/status/health/progress,
and optional milestones. Everything is file-driven so the team edits a YAML file
in the shared folder instead of clicking through an app on a touchscreen.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any, Iterable

import yaml

log = logging.getLogger(__name__)

DEFAULT_COLUMNS = ["Backlog", "In Progress", "Blocked", "In Review", "Done"]
HEALTH_VALUES = ("on-track", "at-risk", "off-track", "done")
PRIORITY_VALUES = ("critical", "high", "medium", "low")

# Free-text status values people actually type, mapped onto workflow columns.
_COLUMN_ALIASES = {
    "todo": "Backlog",
    "to do": "Backlog",
    "planned": "Backlog",
    "not started": "Backlog",
    "backlog": "Backlog",
    "wip": "In Progress",
    "in progress": "In Progress",
    "doing": "In Progress",
    "active": "In Progress",
    "blocked": "Blocked",
    "on hold": "Blocked",
    "waiting": "Blocked",
    "review": "In Review",
    "in review": "In Review",
    "qa": "In Review",
    "testing": "In Review",
    "done": "Done",
    "complete": "Done",
    "completed": "Done",
    "shipped": "Done",
    "closed": "Done",
}


@dataclass
class Board:
    name: str
    columns: list[str]
    cards: list[dict[str, Any]]
    updated_at: str | None
    errors: list[str]

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "columns": [
                {
                    "name": column,
                    "count": sum(1 for card in self.cards if card["column"] == column),
                }
                for column in self.columns
            ],
            "cards": self.cards,
            "summary": self._summary(),
            "updated_at": self.updated_at,
            "errors": self.errors,
        }

    def _summary(self) -> dict[str, Any]:
        total = len(self.cards)
        done = sum(1 for card in self.cards if card["column"] == "Done")
        active = sum(1 for card in self.cards if card["column"] in ("In Progress", "In Review"))
        blocked = sum(1 for card in self.cards if card["column"] == "Blocked")
        at_risk = sum(1 for card in self.cards if card["health"] in ("at-risk", "off-track"))
        overdue = sum(1 for card in self.cards if card.get("overdue"))
        open_cards = [card for card in self.cards if card["column"] != "Done"]
        progress = (
            round(sum(card["progress"] for card in open_cards) / len(open_cards))
            if open_cards
            else 100
        )
        return {
            "total": total,
            "done": done,
            "active": active,
            "blocked": blocked,
            "at_risk": at_risk,
            "overdue": overdue,
            "delivery_progress": progress,
            "completion": round(done / total * 100) if total else 0,
        }


def load_board(folder: Path) -> dict[str, Any]:
    """Merge every YAML/JSON file in ``folder`` into a single board."""
    name = "Project Tracking"
    columns: list[str] = []
    raw_projects: list[dict[str, Any]] = []
    errors: list[str] = []
    newest: float = 0.0

    for path in sorted(_source_files(folder)):
        try:
            data = _read_structured(path)
        except Exception as exc:
            log.warning("could not read %s: %s", path.name, exc)
            errors.append(f"{path.name}: {exc.__class__.__name__}")
            continue

        newest = max(newest, path.stat().st_mtime)
        board_meta = data.get("board") or {}
        if isinstance(board_meta, dict):
            name = board_meta.get("name") or name
            for column in board_meta.get("columns") or []:
                if str(column) not in columns:
                    columns.append(str(column))

        raw_projects.extend(_extract_projects(data, path.name))

    cards = [_normalise(project, columns or DEFAULT_COLUMNS) for project in raw_projects]
    cards = [card for card in cards if card]
    columns = columns or _derive_columns(cards)
    _order_cards(cards, columns)

    board = Board(
        name=name,
        columns=columns,
        cards=cards,
        updated_at=datetime.fromtimestamp(newest).isoformat(timespec="seconds") if newest else None,
        errors=errors,
    )
    return board.to_dict()


def _source_files(folder: Path) -> Iterable[Path]:
    if not folder.exists():
        return []
    return [
        path
        for path in folder.iterdir()
        if path.is_file()
        and not path.name.startswith(".")
        and path.suffix.lower() in (".yaml", ".yml", ".json")
    ]


def _read_structured(path: Path) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8")
    data = json.loads(text) if path.suffix.lower() == ".json" else yaml.safe_load(text)
    if isinstance(data, list):
        return {"projects": data}
    if not isinstance(data, dict):
        raise ValueError("expected a mapping or a list of projects")
    return data


def _extract_projects(data: dict[str, Any], filename: str) -> list[dict[str, Any]]:
    for key in ("projects", "items", "cards", "tasks"):
        entries = data.get(key)
        if isinstance(entries, list):
            return [
                {**entry, "_source": filename} for entry in entries if isinstance(entry, dict)
            ]
    return []


def _normalise(project: dict[str, Any], columns: list[str]) -> dict[str, Any] | None:
    title = _text(project.get("title") or project.get("name"))
    if not title:
        return None

    status = _text(project.get("status") or project.get("column")) or "Backlog"
    column = _resolve_column(status, columns)
    due = _parse_date(project.get("due") or project.get("due_date") or project.get("target"))
    milestones = _milestones(project.get("milestones"))
    progress = _progress(project, column, milestones)
    health = _health(project, column, due, progress)

    return {
        "id": _text(project.get("id")) or _slug(title),
        "title": title,
        "summary": _text(project.get("summary") or project.get("description")),
        "owner": _text(project.get("owner") or project.get("assignee")) or "Unassigned",
        "status": status,
        "column": column,
        "health": health,
        "priority": _priority(project.get("priority")),
        "progress": progress,
        "due": due.isoformat() if due else None,
        "due_in_days": (due - date.today()).days if due else None,
        "overdue": bool(due and due < date.today() and column != "Done"),
        "tags": [_text(tag) for tag in _as_list(project.get("tags")) if _text(tag)][:4],
        "milestones": milestones,
        "blocked_by": _text(project.get("blocked_by") or project.get("blocker")),
        "source": project.get("_source", ""),
    }


def _resolve_column(status: str, columns: list[str]) -> str:
    normalised = status.strip().lower()
    for column in columns:
        if column.lower() == normalised:
            return column
    alias = _COLUMN_ALIASES.get(normalised)
    if alias and alias in columns:
        return alias
    if alias:
        return alias
    return columns[0] if columns else "Backlog"


def _derive_columns(cards: list[dict[str, Any]]) -> list[str]:
    """Keep the canonical order, but only show columns that are actually in play."""
    present = {card["column"] for card in cards}
    ordered = [column for column in DEFAULT_COLUMNS if column in present]
    ordered.extend(sorted(present - set(DEFAULT_COLUMNS)))
    return ordered or DEFAULT_COLUMNS


def _order_cards(cards: list[dict[str, Any]], columns: list[str]) -> None:
    """Most urgent first inside each column: overdue, then priority, then due date."""
    priority_rank = {value: index for index, value in enumerate(PRIORITY_VALUES)}
    column_rank = {column: index for index, column in enumerate(columns)}
    cards.sort(
        key=lambda card: (
            column_rank.get(card["column"], len(columns)),
            not card["overdue"],
            priority_rank.get(card["priority"], len(PRIORITY_VALUES)),
            card["due_in_days"] if card["due_in_days"] is not None else 9_999,
            card["title"].lower(),
        )
    )


def _milestones(raw: Any) -> list[dict[str, Any]]:
    milestones: list[dict[str, Any]] = []
    for entry in _as_list(raw):
        if isinstance(entry, str):
            milestones.append({"name": entry, "done": False, "due": None})
            continue
        if not isinstance(entry, dict):
            continue
        due = _parse_date(entry.get("due"))
        milestones.append(
            {
                "name": _text(entry.get("name") or entry.get("title")),
                "done": bool(entry.get("done") or entry.get("complete")),
                "due": due.isoformat() if due else None,
            }
        )
    return [milestone for milestone in milestones if milestone["name"]][:6]


def _progress(project: dict[str, Any], column: str, milestones: list[dict[str, Any]]) -> int:
    raw = project.get("progress", project.get("percent_complete"))
    if raw is not None:
        try:
            value = float(str(raw).rstrip("% "))
            return max(0, min(100, round(value)))
        except ValueError:
            pass
    if milestones:
        return round(sum(1 for m in milestones if m["done"]) / len(milestones) * 100)
    return {"Done": 100, "In Review": 85, "In Progress": 50, "Blocked": 35}.get(column, 0)


def _health(project: dict[str, Any], column: str, due: date | None, progress: int) -> str:
    declared = _text(project.get("health")).lower().replace(" ", "-").replace("_", "-")
    if declared in HEALTH_VALUES:
        return declared
    if column == "Done":
        return "done"
    if column == "Blocked":
        return "off-track"
    if due:
        remaining = (due - date.today()).days
        if remaining < 0:
            return "off-track"
        if remaining <= 7 and progress < 75:
            return "at-risk"
    return "on-track"


def _priority(raw: Any) -> str:
    value = _text(raw).lower()
    aliases = {"p0": "critical", "p1": "high", "p2": "medium", "p3": "low", "urgent": "critical"}
    value = aliases.get(value, value)
    return value if value in PRIORITY_VALUES else "medium"


def _parse_date(raw: Any) -> date | None:
    if isinstance(raw, datetime):
        return raw.date()
    if isinstance(raw, date):
        return raw
    text = _text(raw)
    if not text:
        return None
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y", "%b %d %Y", "%B %d %Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(text.replace(",", ""), fmt).date()
        except ValueError:
            continue
    log.debug("unrecognised date %r", text)
    return None


def _as_list(raw: Any) -> list[Any]:
    if raw is None:
        return []
    if isinstance(raw, (list, tuple)):
        return list(raw)
    if isinstance(raw, str):
        return [part.strip() for part in raw.split(",") if part.strip()]
    return [raw]


def _text(raw: Any) -> str:
    return "" if raw is None else str(raw).strip()


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:48]
