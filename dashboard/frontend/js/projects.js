/**
 * Kanban board in the shape modern trackers use: workflow columns, cards
 * carrying owner / priority / due date / progress, and a KPI row above.
 *
 * Colour rules follow the data-viz method — the status palette is reserved for
 * health and always ships with an icon and a word, so a red-green colourblind
 * reader never depends on hue. Progress meters use the sequential blue ramp
 * (fill) over a darker step of the same ramp (track).
 */

import { relativeTime } from './documents.js';

const kanban = document.getElementById('kanban');
const statsRow = document.getElementById('projects-stats');
const foot = document.getElementById('projects-foot');

const HEALTH = {
  'on-track': { icon: '●', label: 'On track' },
  'at-risk': { icon: '▲', label: 'At risk' },
  'off-track': { icon: '■', label: 'Off track' },
  done: { icon: '✓', label: 'Done' },
};

/** Accent per column — categorical slots in fixed order, never cycled. */
const COLUMN_ACCENT = {
  Backlog: 'var(--muted)',
  'In Progress': 'var(--series-1)',
  Blocked: 'var(--status-critical)',
  'In Review': 'var(--series-7)',
  Done: 'var(--series-3)',
};

/** Owner initials get a stable colour from the categorical order. */
const AVATAR_SLOTS = [
  'var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)',
  'var(--series-5)', 'var(--series-6)', 'var(--series-7)', 'var(--series-8)',
];

let currentBoard = null;

/** The board as last rendered -- the detail sheet reads cards from here. */
export function getCard(cardId) {
  return currentBoard?.cards?.find((card) => card.id === cardId) ?? null;
}

export function getColumns() {
  return currentBoard?.columns?.map((column) => column.name) ?? [];
}

export function renderBoard(board) {
  if (!board) return;
  currentBoard = board;
  renderStats(board.summary ?? {});
  renderColumns(board);
  renderFoot(board);
}

/* ------------------------------------------------------------------ */
/* KPI row                                                             */
/* ------------------------------------------------------------------ */
function renderStats(summary) {
  const tiles = [
    { label: 'Active', value: summary.active ?? 0 },
    { label: 'Blocked', value: summary.blocked ?? 0, tone: summary.blocked ? 'alert' : '' },
    { label: 'At risk', value: summary.at_risk ?? 0, tone: summary.at_risk ? 'warn' : '' },
    { label: 'Overdue', value: summary.overdue ?? 0, tone: summary.overdue ? 'alert' : '' },
    { label: 'Avg progress', value: `${summary.delivery_progress ?? 0}%` },
    { label: 'Complete', value: `${summary.done ?? 0}/${summary.total ?? 0}` },
  ];

  statsRow.replaceChildren(
    ...tiles.map(({ label, value, tone }) => {
      const tile = element('div', `stat${tone ? ` stat--${tone}` : ''}`);
      tile.append(element('span', 'stat__value', String(value)));
      tile.append(element('span', 'stat__label', label));
      return tile;
    }),
  );
}

/* ------------------------------------------------------------------ */
/* Columns & cards                                                     */
/* ------------------------------------------------------------------ */
function renderColumns(board) {
  const columns = board.columns ?? [];
  const cards = board.cards ?? [];

  if (!columns.length || !cards.length) {
    kanban.replaceChildren(emptyBoard());
    return;
  }

  kanban.replaceChildren(
    ...columns.map((column) => {
      const node = element('section', 'column');
      node.dataset.column = column.name;
      const head = element('div', 'column__head');
      head.append(
        element('span', 'column__name', column.name),
        element('span', 'column__count', String(column.count)),
      );

      const list = element('div', 'column__cards');
      const columnCards = cards.filter((card) => card.column === column.name);
      if (columnCards.length) {
        list.append(...columnCards.map((card) => renderCard(card, column.name)));
      } else {
        list.append(element('p', 'column__empty', 'Nothing here'));
      }

      node.append(head, list);
      return node;
    }),
  );
}

function renderCard(card, columnName) {
  const node = element('article', 'card');
  node.dataset.cardId = card.id;
  node.tabIndex = 0;                       // reachable without a touchscreen
  node.setAttribute('role', 'button');
  node.setAttribute('aria-label', `${card.title}. ${card.status}. Open details.`);
  node.style.setProperty('--card-accent', COLUMN_ACCENT[columnName] ?? 'var(--muted)');

  if (card.id && card.id !== slug(card.title)) {
    const top = element('div', 'card__top');
    top.append(element('span', 'card__id', card.id));
    node.append(top);
  }

  node.append(element('h3', 'card__title', card.title));

  const meta = element('div', 'card__meta');
  meta.append(owner(card.owner));
  meta.append(healthChip(card.health));
  if (card.priority === 'critical' || card.priority === 'high') {
    meta.append(chip(`chip chip--priority-${card.priority}`, '⚑', capitalise(card.priority)));
  }
  if (card.due) meta.append(dueLabel(card));
  node.append(meta);

  if (card.column !== 'Done' || card.progress < 100) {
    node.append(meter(card));
  }

  const nextMilestone = (card.milestones ?? []).find((milestone) => !milestone.done);
  if (nextMilestone) {
    node.append(
      element('p', 'card__milestone', `Next: ${nextMilestone.name}${
        nextMilestone.due ? ` · ${shortDate(nextMilestone.due)}` : ''
      }`),
    );
  }

  if (card.blocked_by) {
    node.append(element('p', 'card__blocker', `Blocked by ${card.blocked_by}`));
  }

  if (card.tags?.length) {
    const tags = element('div', 'tags');
    tags.append(...card.tags.map((tag) => element('span', 'tag', tag)));
    node.append(tags);
  }

  return node;
}

function owner(name) {
  const wrapper = element('span', 'card__owner');
  const badge = element('span', 'avatar', initials(name));
  badge.style.setProperty('--avatar', AVATAR_SLOTS[hash(name) % AVATAR_SLOTS.length]);
  wrapper.append(badge, document.createTextNode(name));
  return wrapper;
}

function healthChip(health) {
  const { icon, label } = HEALTH[health] ?? HEALTH['on-track'];
  return chip(`chip chip--${health}`, icon, label);
}

function chip(className, icon, label) {
  const node = element('span', className);
  node.append(element('span', 'chip__icon', icon), document.createTextNode(label));
  return node;
}

function dueLabel(card) {
  const days = card.due_in_days;
  let tone = '';
  let text = shortDate(card.due);

  if (card.overdue) {
    tone = ' card__due--overdue';
    text = `${Math.abs(days)}d overdue`;
  } else if (days !== null && days >= 0 && days <= 7) {
    // Only count down toward a future date — a finished card keeps its date.
    tone = ' card__due--soon';
    text = days === 0 ? 'Due today' : `${days}d left`;
  }
  return element('span', `card__due${tone}`, text);
}

function meter(card) {
  const wrapper = element('div', 'meter');
  const track = element('div', 'meter__track');
  const fill = element('div', 'meter__fill');
  fill.style.width = `${Math.max(0, Math.min(100, card.progress))}%`;

  // Severity rides the fill so the meter reads without hunting for the chip.
  if (card.health === 'off-track') fill.style.setProperty('--meter-fill', 'var(--status-critical)');
  else if (card.health === 'at-risk') fill.style.setProperty('--meter-fill', 'var(--status-warning)');

  track.append(fill);
  wrapper.append(track, element('span', 'meter__value', `${card.progress}%`));
  wrapper.setAttribute('role', 'img');
  wrapper.setAttribute('aria-label', `${card.progress} percent complete`);
  return wrapper;
}

function renderFoot(board) {
  const parts = [];
  if (board.updated_at) parts.push(`Board updated ${relativeTime(board.updated_at)}`);
  if (board.errors?.length) parts.push(`⚠ ${board.errors.join('; ')}`);
  foot.textContent = parts.join(' · ');
}

function emptyBoard() {
  const wrapper = element('div', 'empty');
  wrapper.append(element('p', 'empty__headline', 'No projects loaded'));
  const hint = element(
    'p',
    'empty__hint',
    'Add or edit projects.yaml in the projects folder — columns, owners, due dates and progress all come from that file.',
  );
  hint.append(document.createElement('br'), element('span', 'empty__path', 'data\\projects\\projects.yaml'));
  wrapper.append(hint);
  return wrapper;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function initials(name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

function hash(value) {
  let total = 0;
  for (const char of String(value ?? '')) total = (total * 31 + char.charCodeAt(0)) % 100000;
  return total;
}

function shortDate(iso) {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function capitalise(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function slug(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
}
