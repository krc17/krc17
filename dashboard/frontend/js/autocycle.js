/**
 * Hands-off page cycling for the wall.
 *
 * The wall dwells on each page for `dwellMs`, then advances to the next one,
 * wrapping Overview -> Projects -> Coverage -> Overview. Any genuine interaction
 * -- a tap, swipe, wheel, or keypress -- pauses it, and it resumes once the wall
 * has been left alone for `idleMs`. The pager's own auto-scroll is not one of
 * those events, so the cycle never pauses itself.
 */
const INTERACTION_EVENTS = ['pointerdown', 'wheel', 'touchstart', 'keydown'];

export class AutoCycle {
  constructor({ pager, dwellMs, idleMs = 45000, onState = () => {} }) {
    this.pager = pager;
    this.dwellMs = dwellMs;
    this.idleMs = idleMs;
    this.onState = onState;
    this.dwellTimer = null;
    this.idleTimer = null;
    this.running = false;
    this.started = false;
  }

  /** Begin cycling. Idempotent (bootstrap can re-run on reconnect). A
   *  non-positive dwell (PAGE_CYCLE_SECONDS=0) or a single-page wall leaves it
   *  switched off entirely. */
  start() {
    if (this.started || !(this.dwellMs > 0) || this.pager.pageCount < 2) return;
    this.started = true;
    INTERACTION_EVENTS.forEach((type) =>
      document.addEventListener(type, () => this.#interacted(), { passive: true, capture: true }),
    );
    this.#resume();
  }

  #resume() {
    this.running = true;
    this.onState(true);
    this.#schedule();
  }

  #schedule() {
    clearTimeout(this.dwellTimer);
    this.dwellTimer = setTimeout(() => {
      this.pager.advance();
      this.#schedule();
    }, this.dwellMs);
  }

  #interacted() {
    if (this.running) {
      this.running = false;
      this.onState(false);
    }
    // Hold while the wall is being used; resume once it's been idle a while.
    clearTimeout(this.dwellTimer);
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.#resume(), this.idleMs);
  }
}
