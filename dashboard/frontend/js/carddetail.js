/**
 * Card detail sheet.
 *
 * Opened by a tap, which is the one gesture with no competition on this
 * surface -- drag needs a 250ms hold, scroll needs movement, a tap is neither.
 *
 * Milestones are tickable. Ticking one writes to the YAML and lets the normal
 * SSE repaint bring the new progress back, rather than computing it here: the
 * derivation rules live in the backend and should stay in one place.
 */

const COLUMN_ACCENT = {
  Backlog: 'var(--muted)',
  'In Progress': 'var(--series-1)',
  Blocked: 'var(--status-critical)',
  'In Review': 'var(--series-7)',
  Done: 'var(--series-3)',
};

const HEALTH_LABEL = {
  'on-track': '● On track',
  'at-risk': '▲ At risk',
  'off-track': '■ Off track',
  done: '✓ Done',
};

export class CardDetail {
  constructor({ sheet, onMilestone, onMove, onProgress, onDue, getColumns }) {
    this.sheet = sheet;
    this.onMilestone = onMilestone;
    this.onMove = onMove;
    this.onProgress = onProgress;
    this.onDue = onDue;
    this.getColumns = getColumns;
    this.card = null;

    this.sheet.addEventListener('click', (event) => {
      if (event.target === this.sheet) this.close();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !this.sheet.hidden) {
        event.stopPropagation();
        this.close();
      }
    });
  }

  get isOpen() {
    return !this.sheet.hidden;
  }

  open(card) {
    this.card = card;
    this.sheet.replaceChildren(this.#build(card));
    this.sheet.hidden = false;
    this.sheet.querySelector('.sheet__cancel')?.focus();
  }

  close() {
    this.sheet.hidden = true;
    this.card = null;
  }

  /** Re-render in place after a write, so ticks and progress stay in sync. */
  refresh(card) {
    if (this.isOpen && card && card.id === this.card?.id) this.open(card);
  }

  /** Big meter plus coarse steps -- nobody nudges 1% at a time on a wall. */
  #progressControls(card) {
    const wrap = el('div', 'edit-block');

    const meter = el('div', 'meter meter--large');
    const track = el('div', 'meter__track');
    const fill = el('div', 'meter__fill');
    fill.style.width = `${card.progress}%`;
    if (card.health === 'off-track') fill.style.setProperty('--meter-fill', 'var(--status-critical)');
    else if (card.health === 'at-risk') fill.style.setProperty('--meter-fill', 'var(--status-warning)');
    track.append(fill);
    meter.append(track, el('span', 'meter__value', `${card.progress}%`));
    wrap.append(meter);

    const nudge = el('div', 'edit-row');
    [-25, -10, +10, +25].forEach((delta) => {
      const button = el('button', 'edit-btn', delta > 0 ? `+${delta}` : String(delta));
      button.type = 'button';
      button.disabled = (delta < 0 && card.progress <= 0) || (delta > 0 && card.progress >= 100);
      button.addEventListener('click', () => this.onProgress?.(card.id, { delta }));
      nudge.append(button);
    });
    wrap.append(nudge);

    const presets = el('div', 'edit-row');
    [0, 25, 50, 75, 100].forEach((value) => {
      const button = el('button', 'edit-btn edit-btn--preset', `${value}%`);
      button.type = 'button';
      if (card.progress === value) button.classList.add('is-current');
      button.addEventListener('click', () => this.onProgress?.(card.id, { progress: value }));
      presets.append(button);
    });
    wrap.append(presets);

    if (card.milestones?.length && card.progress_derived) {
      wrap.append(el('p', 'edit-note',
        'Currently derived from milestones. Setting a value here pins it.'));
    }
    return wrap;
  }

  #dueControls(card) {
    const wrap = el('div', 'edit-block');

    const current = el('p', 'edit-current');
    current.textContent = card.due ? formatDue(card) : 'No due date set';
    if (card.overdue) current.classList.add('is-overdue');
    else if (card.due_in_days !== null && card.due_in_days <= 7) current.classList.add('is-soon');
    wrap.append(current);

    const shift = el('div', 'edit-row');
    [-7, -1, +1, +7].forEach((days) => {
      const label = Math.abs(days) === 7 ? `${days > 0 ? '+' : '-'}1 wk` : `${days > 0 ? '+' : '-'}1 d`;
      const button = el('button', 'edit-btn', label);
      button.type = 'button';
      button.addEventListener('click', () => this.onDue?.(card.id, { days }));
      shift.append(button);
    });
    wrap.append(shift);

    const quick = el('div', 'edit-row');
    [['Today', 0], ['+2 wks', 14], ['+1 mo', 30]].forEach(([label, days]) => {
      const button = el('button', 'edit-btn edit-btn--preset', label);
      button.type = 'button';
      // These set from today rather than nudging, so they mean what they say
      // regardless of what the date currently is.
      button.addEventListener('click', () => this.onDue?.(card.id, { due: isoFromToday(days) }));
      quick.append(button);
    });
    if (card.due) {
      const clear = el('button', 'edit-btn edit-btn--clear', 'Clear');
      clear.type = 'button';
      clear.addEventListener('click', () => this.onDue?.(card.id, { due: '' }));
      quick.append(clear);
    }
    wrap.append(quick);
    return wrap;
  }

  #build(card) {
    const panel = el('div', 'sheet sheet--card');
    panel.style.setProperty('--card-accent', COLUMN_ACCENT[card.column] ?? 'var(--muted)');

    // --- header -----------------------------------------------------
    const head = el('div', 'card-detail__head');
    if (card.id) head.append(el('span', 'card__id', card.id));
    head.append(el('h2', 'sheet__title', card.title));
    panel.append(head);

    const meta = el('div', 'card-detail__meta');
    meta.append(
      metaPair('Owner', card.owner),
      metaPair('Status', card.status),
      metaPair('Health', HEALTH_LABEL[card.health] ?? card.health),
      metaPair('Priority', capitalise(card.priority)),
      metaPair('Due', card.due ? formatDue(card) : 'Not set'),
      metaPair('Progress', `${card.progress}%`),
    );
    panel.append(meta);

    if (card.summary) panel.append(el('p', 'card-detail__summary', card.summary));

    if (card.blocked_by) {
      panel.append(el('p', 'card__blocker', `Blocked by ${card.blocked_by}`));
    }

    // --- progress ---------------------------------------------------
    panel.append(el('h3', 'card-detail__section', 'Progress'));
    panel.append(this.#progressControls(card));

    // --- due date ---------------------------------------------------
    panel.append(el('h3', 'card-detail__section', 'Due date'));
    panel.append(this.#dueControls(card));

    // --- milestones -------------------------------------------------
    const milestones = card.milestones ?? [];
    if (milestones.length) {
      panel.append(el('h3', 'card-detail__section', 'Milestones'));
      const list = el('ul', 'milestones');
      milestones.forEach((milestone, index) => {
        const item = el('li', `milestone${milestone.done ? ' is-done' : ''}`);
        const toggle = el('button', 'milestone__toggle');
        toggle.type = 'button';
        toggle.setAttribute('aria-pressed', String(Boolean(milestone.done)));
        toggle.append(
          el('span', 'milestone__box', milestone.done ? '✓' : ''),
          el('span', 'milestone__name', milestone.name),
        );
        if (milestone.due) toggle.append(el('span', 'milestone__due', shortDate(milestone.due)));
        toggle.addEventListener('click', () =>
          this.onMilestone?.(card.id, index, !milestone.done),
        );
        item.append(toggle);
        list.append(item);
      });
      panel.append(list);
    }

    if (card.tags?.length) {
      const tags = el('div', 'tags card-detail__tags');
      tags.append(...card.tags.map((tag) => el('span', 'tag', tag)));
      panel.append(tags);
    }

    // --- move to column ---------------------------------------------
    const columns = (this.getColumns?.() ?? []).filter((name) => name !== card.column);
    if (columns.length) {
      panel.append(el('h3', 'card-detail__section', 'Move to'));
      const row = el('div', 'move-row');
      columns.forEach((name) => {
        const button = el('button', 'move-btn', name);
        button.type = 'button';
        button.style.setProperty('--move-accent', COLUMN_ACCENT[name] ?? 'var(--muted)');
        button.addEventListener('click', () => this.onMove?.(card.id, name));
        row.append(button);
      });
      panel.append(row);
    }

    if (card.source) {
      panel.append(el('p', 'card-detail__source', `From ${card.source}`));
    }

    const close = el('button', 'sheet__cancel', 'Close');
    close.type = 'button';
    close.addEventListener('click', () => this.close());
    panel.append(close);

    return panel;
  }
}

/* ------------------------------------------------------------------ */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function metaPair(label, value) {
  const pair = el('div', 'card-detail__pair');
  pair.append(el('span', 'card-detail__label', label), el('span', 'card-detail__value', value));
  return pair;
}

function formatDue(card) {
  const date = shortDate(card.due);
  if (card.overdue) return `${date} · ${Math.abs(card.due_in_days)}d overdue`;
  if (card.due_in_days === 0) return `${date} · today`;
  if (card.due_in_days > 0) return `${date} · ${card.due_in_days}d left`;
  return date;
}

function shortDate(iso) {
  const date = new Date(`${iso}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function isoFromToday(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function capitalise(word) {
  return String(word ?? '').charAt(0).toUpperCase() + String(word ?? '').slice(1);
}
