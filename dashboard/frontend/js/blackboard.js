/**
 * Touch-pen blackboard.
 *
 * Strokes are kept as vectors (x, y, pressure triples) rather than a bitmap so
 * the board survives a resize, replays on a second screen, and stays a few KB
 * on disk. Pointer Events give us stylus pressure and palm rejection for free
 * on Windows Ink devices — no library needed.
 */

const SAVE_DEBOUNCE_MS = 1200;
const ERASER_RADIUS_FACTOR = 1.6;

export class Blackboard {
  constructor({ canvas, surface, tools, hint, saveState }) {
    this.canvas = canvas;
    this.surface = surface;
    this.tools = tools;
    this.hint = hint;
    this.saveState = saveState;
    this.ctx = canvas.getContext('2d');

    this.clientId = `screen-${Math.random().toString(36).slice(2, 10)}`;
    this.strokes = [];
    this.current = null;
    this.revision = 0;
    this.color = '#f4f4ef';
    this.width = 4;
    this.erasing = false;
    this.saveTimer = null;
    this.pendingSave = false;
    /** Logical drawing space; strokes are stored 0–1 so any screen size fits. */
    this.dpr = 1;

    this.#bindTools();
    this.#bindPointer();
    this.#bindResize();
  }

  /* ---------------------------------------------------------------- */
  /* Data                                                              */
  /* ---------------------------------------------------------------- */
  load(board) {
    if (!board) return;
    this.strokes = Array.isArray(board.strokes) ? board.strokes : [];
    this.revision = board.revision ?? 0;
    this.#resize();
  }

  async pull() {
    try {
      const response = await fetch('/api/blackboard', { cache: 'no-store' });
      if (!response.ok) return;
      const board = await response.json();
      if (board.revision === this.revision) return;
      this.load(board);
    } catch (error) {
      console.warn('blackboard pull failed', error);
    }
  }

  /**
   * Write any debounced changes right now. Called when the wall swipes away
   * from the board page, so a stroke finished a moment earlier is never left
   * sitting in a pending timer.
   */
  flush() {
    if (!this.pendingSave) return;
    clearTimeout(this.saveTimer);
    this.#save();
  }

  #scheduleSave() {
    clearTimeout(this.saveTimer);
    this.pendingSave = true;
    this.#setSaveState('saving', 'Saving…');
    this.saveTimer = setTimeout(() => this.#save(), SAVE_DEBOUNCE_MS);
  }

  async #save() {
    this.pendingSave = false;
    try {
      const response = await fetch('/api/blackboard', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strokes: this.strokes, client_id: this.clientId }),
      });
      if (!response.ok) throw new Error(`status ${response.status}`);
      const saved = await response.json();
      this.revision = saved.revision;
      this.#setSaveState('saved', 'Saved');
    } catch (error) {
      console.warn('blackboard save failed', error);
      this.#setSaveState('error', 'Not saved — retrying');
      setTimeout(() => this.#save(), 5000);
    }
  }

  #setSaveState(state, label) {
    this.saveState.dataset.state = state;
    this.saveState.textContent = label;
  }

  /* ---------------------------------------------------------------- */
  /* Toolbar                                                           */
  /* ---------------------------------------------------------------- */
  #bindTools() {
    this.tools.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (!button) return;

      if (button.dataset.color) {
        this.color = button.dataset.color;
        this.erasing = false;
        this.#syncGroup(button, '.swatch');
        this.#setEraser(false);
        return;
      }

      if (button.dataset.width) {
        this.width = Number(button.dataset.width);
        this.#syncGroup(button, '.tool--size');
        return;
      }

      switch (button.dataset.action) {
        case 'eraser':
          this.#setEraser(!this.erasing);
          break;
        case 'undo':
          if (this.strokes.length) {
            this.strokes.pop();
            this.#redraw();
            this.#scheduleSave();
          }
          break;
        case 'clear':
          if (this.strokes.length && confirm('Wipe the whole blackboard?')) {
            this.strokes = [];
            this.#redraw();
            this.#scheduleSave();
          }
          break;
      }
    });
  }

  #syncGroup(active, selector) {
    this.tools.querySelectorAll(selector).forEach((element) => {
      const on = element === active;
      element.classList.toggle('is-active', on);
      if (element.hasAttribute('role')) element.setAttribute('aria-checked', String(on));
    });
  }

  #setEraser(on) {
    this.erasing = on;
    const button = this.tools.querySelector('[data-action="eraser"]');
    button.setAttribute('aria-pressed', String(on));
    button.classList.toggle('is-active', on);
    this.canvas.style.cursor = on ? 'cell' : 'crosshair';
  }

  /* ---------------------------------------------------------------- */
  /* Drawing                                                           */
  /* ---------------------------------------------------------------- */
  #bindPointer() {
    const canvas = this.canvas;

    canvas.addEventListener('pointerdown', (event) => {
      // Ignore the palm resting on the glass while writing with the pen.
      if (event.pointerType === 'touch' && event.width > 45) return;
      canvas.setPointerCapture(event.pointerId);
      this.hint.hidden = true;

      if (this.erasing) {
        this.#eraseAt(event);
        this.current = { erasing: true };
        return;
      }

      this.current = {
        points: [],
        color: this.color,
        width: this.width,
        tool: 'chalk',
      };
      this.#addPoint(event);
    });

    canvas.addEventListener('pointermove', (event) => {
      if (!this.current) return;
      if (this.current.erasing) {
        this.#eraseAt(event);
        return;
      }
      // Coalesced events keep fast pen strokes smooth instead of polygonal.
      const moves = event.getCoalescedEvents?.() ?? [event];
      moves.forEach((move) => this.#addPoint(move));
      this.#drawStroke(this.current);
    });

    const finish = () => {
      if (!this.current) return;
      const stroke = this.current;
      this.current = null;
      if (!stroke.erasing) {
        if (stroke.points.length < 6) {
          // A tap should still leave a dot on the board.
          stroke.points.push(...stroke.points.slice(0, 3));
        }
        this.strokes.push(stroke);
        this.#redraw();
      }
      this.#scheduleSave();
    };

    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', finish);
    canvas.addEventListener('pointerleave', finish);
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  #addPoint(event) {
    const rect = this.canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    // Mice and fingers report 0 or a flat 0.5 — normalise to a usable weight.
    const pressure = event.pressure > 0 && event.pressure !== 0.5 ? event.pressure : 0.5;
    this.current.points.push(round(x), round(y), round(pressure, 2));
  }

  #eraseAt(event) {
    const rect = this.canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    const radius = (this.width * ERASER_RADIUS_FACTOR) / rect.width;

    const remaining = this.strokes.filter((stroke) => !hitsStroke(stroke, x, y, radius));
    if (remaining.length !== this.strokes.length) {
      this.strokes = remaining;
      this.#redraw();
    }
  }

  /* ---------------------------------------------------------------- */
  /* Rendering                                                         */
  /* ---------------------------------------------------------------- */
  #bindResize() {
    const observer = new ResizeObserver(() => this.#resize());
    observer.observe(this.surface);
    this.#resize();
  }

  #resize() {
    const rect = this.surface.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
    this.#redraw();
  }

  #redraw() {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    this.strokes.forEach((stroke) => this.#drawStroke(stroke, true));
    this.hint.hidden = this.strokes.length > 0 || Boolean(this.current);
  }

  #drawStroke(stroke, full = false) {
    const { ctx, canvas } = this;
    const points = stroke.points;
    if (!points || points.length < 6) {
      if (points?.length === 3) this.#drawDot(stroke);
      return;
    }

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = stroke.color;
    // Chalk reads as slightly soft rather than a hard vector line.
    ctx.shadowColor = stroke.color;
    ctx.shadowBlur = 1.5 * this.dpr;

    const start = full ? 0 : Math.max(0, points.length - 9);
    for (let i = start; i + 5 < points.length; i += 3) {
      const x1 = points[i] * canvas.width;
      const y1 = points[i + 1] * canvas.height;
      const x2 = points[i + 3] * canvas.width;
      const y2 = points[i + 4] * canvas.height;
      const pressure = (points[i + 2] + points[i + 5]) / 2;

      ctx.globalAlpha = 0.72 + pressure * 0.28;
      ctx.lineWidth = stroke.width * this.dpr * (0.55 + pressure * 0.9);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    ctx.restore();
  }

  #drawDot(stroke) {
    const { ctx, canvas } = this;
    ctx.save();
    ctx.fillStyle = stroke.color;
    ctx.beginPath();
    ctx.arc(
      stroke.points[0] * canvas.width,
      stroke.points[1] * canvas.height,
      (stroke.width * this.dpr) / 2,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.restore();
  }
}

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */
function hitsStroke(stroke, x, y, radius) {
  const points = stroke.points ?? [];
  const reach = radius + stroke.width / 1000;
  for (let i = 0; i < points.length; i += 3) {
    if (Math.hypot(points[i] - x, points[i + 1] - y) <= reach) return true;
  }
  return false;
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
