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
  constructor({ sheet, onMilestone, onMove, onCompletion, onDue, getColumns }) {
    this.sheet = sheet;
    this.onMilestone = onMilestone;
    this.onMove = onMove;
    this.onCompletion = onCompletion;
    this.onDue = onDue;
    this.getColumns = getColumns;
    this.card = null;

    this.sheet.addEventListener('click', (event) => {
      if (event.target === this.sheet) this.close();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !this.sheet.hidden) {
        // Immediate, so Escape closing this sheet does not also collapse an
        // expanded panel behind it (both handlers live on document).
        event.stopImmediatePropagation();
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

  /**
   * Completion by the numbers: type or tap in Total and Complete, the meter and
   * the "remaining" line follow, and the backend turns 100% into a move to Done.
   */
  #completionControls(card) {
    const wrap = el('div', 'edit-block');

    const meter = el('div', 'meter meter--large');
    const track = el('div', 'meter__track');
    const fill = el('div', 'meter__fill');
    fill.style.width = `${card.progress}%`;
    if (card.health === 'off-track') fill.style.setProperty('--meter-fill', 'var(--status-critical)');
    else if (card.health === 'at-risk') fill.style.setProperty('--meter-fill', 'var(--status-warning)');
    track.append(fill);
    const value = el('span', 'meter__value', `${card.progress}%`);
    meter.append(track, value);
    wrap.append(meter);

    const row = el('div', 'edit-fields');
    const complete = numberField('Complete', card.complete);
    const total = numberField('Total', card.total);
    row.append(complete.field, el('span', 'edit-fields__of', 'of'), total.field);
    wrap.append(row);

    const remaining = el('p', 'edit-remaining');
    wrap.append(remaining);

    const readInt = (input) => {
      const n = parseInt(input.value, 10);
      return Number.isFinite(n) ? n : null;
    };
    const paint = () => {
      const t = readInt(total.input);
      const c = readInt(complete.input) ?? 0;
      if (t !== null && t > 0) {
        const done = Math.max(0, Math.min(c, t));
        remaining.textContent = `${Math.max(0, t - c)} remaining · ${Math.round((done / t) * 100)}%`;
        value.textContent = `${Math.round((done / t) * 100)}%`;
        fill.style.width = `${Math.round((done / t) * 100)}%`;
      } else {
        remaining.textContent = 'Enter a total to track completion';
      }
    };
    const commit = () => {
      const t = readInt(total.input);
      if (t === null || t <= 0) return; // a total is required to save
      this.onCompletion?.(card.id, { total: t, complete: Math.max(0, readInt(complete.input) ?? 0) });
    };
    [complete.input, total.input].forEach((input) => {
      input.addEventListener('input', paint);
      input.addEventListener('change', commit);
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') { event.preventDefault(); input.blur(); commit(); }
      });
    });
    paint();
    return wrap;
  }

  #dueControls(card) {
    const wrap = el('div', 'edit-block');

    const current = el('p', 'edit-current');
    current.textContent = card.due ? formatDue(card) : 'No due date set';
    if (card.overdue) current.classList.add('is-overdue');
    else if (card.due_in_days !== null && card.due_in_days <= 7) current.classList.add('is-soon');
    wrap.append(current);

    const row = el('div', 'edit-fields');
    const input = document.createElement('input');
    input.type = 'date';
    input.className = 'edit-date';
    if (card.due) input.value = card.due; // already ISO yyyy-mm-dd
    input.addEventListener('change', () => this.onDue?.(card.id, { due: input.value || '' }));
    row.append(input);

    if (card.due) {
      const clear = el('button', 'edit-btn edit-btn--clear', 'Clear');
      clear.type = 'button';
      clear.addEventListener('click', () => this.onDue?.(card.id, { due: '' }));
      row.append(clear);
    }
    wrap.append(row);
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
    panel.append(this.#completionControls(card));

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

/** A labelled numeric input, big enough for a fingertip and a touch keypad. */
function numberField(label, value) {
  const field = el('label', 'edit-field');
  field.append(el('span', 'edit-field__label', label));
  const input = document.createElement('input');
  input.type = 'number';
  input.inputMode = 'numeric';
  input.min = '0';
  input.step = '1';
  input.className = 'edit-field__input';
  if (value !== null && value !== undefined) input.value = String(value);
  field.append(input);
  return { field, input };
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

function capitalise(word) {
  return String(word ?? '').charAt(0).toUpperCase() + String(word ?? '').slice(1);
}
