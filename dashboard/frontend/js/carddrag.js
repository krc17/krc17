/**
 * Drag a card between Kanban columns with a finger.
 *
 * Three gestures compete on this surface: the page swiper (horizontal), column
 * scrolling (vertical), and this. The resolution:
 *
 * - A drag only begins after a 250ms hold. Below that the touch belongs to
 *   whoever else wants it, so flicking through a column still works.
 * - Before the hold completes, moving more than a few pixels cancels the drag
 *   outright -- that was a scroll, not a lift.
 * - Once lifted we take pointer capture, so the pager never sees the horizontal
 *   movement and cannot page out from under the card.
 *
 * The dragged card is offset above the finger, otherwise the hand covers the
 * drop target on a touchscreen and you are aiming blind.
 */

const HOLD_MS = 250;
const CANCEL_SLOP_PX = 8;      // movement before the hold completes = a scroll
const LIFT_OFFSET_Y = -28;     // raise the card clear of the fingertip

export class CardDrag {
  constructor({ root, onMove, onTap }) {
    this.root = root;
    this.onMove = onMove;
    // Tap detection lives here rather than on a click listener: only this
    // module knows whether the finger moved, and a scroll flick also emits a
    // click. Anything that moved is a scroll and must not open the card.
    this.onTap = onTap;

    this.holdTimer = null;
    this.origin = null;
    this.card = null;
    this.ghost = null;
    this.column = null;
    this.dragging = false;

    this.#bind();
  }

  #bind() {
    this.root.addEventListener('pointerdown', (event) => this.#onDown(event));
    this.root.addEventListener('pointermove', (event) => this.#onMove(event));
    this.root.addEventListener('pointerup', (event) => this.#onUp(event));
    this.root.addEventListener('pointercancel', () => this.#abort());
    // A long-press on a touchscreen otherwise raises the context menu.
    this.root.addEventListener('contextmenu', (event) => {
      if (this.dragging || this.holdTimer) event.preventDefault();
    });
  }

  #onDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    const card = event.target.closest('.card');
    if (!card || !card.dataset.cardId) return;

    this.origin = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    this.card = card;
    this.holdTimer = setTimeout(() => this.#lift(event), HOLD_MS);
  }

  #lift(event) {
    this.holdTimer = null;
    this.dragging = true;
    this.card.classList.add('is-dragging');
    document.body.classList.add('is-card-dragging');

    // Capture on the column list, which is the element that stays put.
    this.root.setPointerCapture?.(this.origin.pointerId);

    this.ghost = this.card.cloneNode(true);
    this.ghost.classList.add('card-ghost');
    const rect = this.card.getBoundingClientRect();
    this.ghost.style.width = `${rect.width}px`;
    this.grab = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    document.body.append(this.ghost);
    this.#position(event.clientX, event.clientY);

    if (navigator.vibrate) navigator.vibrate(12);   // confirms the lift by feel
  }

  #onMove(event) {
    if (this.holdTimer) {
      const moved = Math.hypot(event.clientX - this.origin.x, event.clientY - this.origin.y);
      if (moved > CANCEL_SLOP_PX) this.#abort();    // they were scrolling
      return;
    }
    if (!this.dragging) return;

    event.preventDefault();
    this.#position(event.clientX, event.clientY);
    this.#highlightColumn(event.clientX, event.clientY);
  }

  #position(x, y) {
    this.ghost.style.left = `${x - this.grab.x}px`;
    this.ghost.style.top = `${y - this.grab.y + LIFT_OFFSET_Y}px`;
  }

  #highlightColumn(x, y) {
    // The ghost follows the pointer, so hide it before hit-testing beneath.
    this.ghost.style.visibility = 'hidden';
    const under = document.elementFromPoint(x, y)?.closest('.column');
    this.ghost.style.visibility = '';

    if (under === this.column) return;
    this.column?.classList.remove('is-drop-target');
    this.column = under;
    this.column?.classList.add('is-drop-target');
  }

  #onUp(event) {
    if (this.holdTimer) {
      // Released before the hold completed, and #onMove never cancelled us, so
      // the finger stayed put: that is a tap. A scroll flick would have
      // aborted on the slop check and left this.card null.
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
      const tapped = this.card;
      this.card = null;
      if (tapped) this.onTap?.(tapped.dataset.cardId);
      return;
    }
    if (!this.dragging) return;

    const cardId = this.card.dataset.cardId;
    const from = this.card.closest('.column')?.dataset.column;
    const to = this.column?.dataset.column;
    this.#abort();

    // A drop still emits a click. Swallow that one, or the detail sheet opens
    // on top of the card the user just finished moving.
    window.addEventListener(
      'click',
      (click) => {
        click.stopPropagation();
        click.preventDefault();
      },
      { capture: true, once: true },
    );

    if (to && to !== from) this.onMove?.(cardId, to);
  }

  #abort() {
    clearTimeout(this.holdTimer);
    this.holdTimer = null;
    this.dragging = false;
    this.ghost?.remove();
    this.ghost = null;
    this.card?.classList.remove('is-dragging');
    this.card = null;
    this.column?.classList.remove('is-drop-target');
    this.column = null;
    document.body.classList.remove('is-card-dragging');
  }
}
