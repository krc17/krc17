/**
 * Hands-off page cycling for the wall.
 *
 * The wall dwells on each page for `dwellMs`, then advances to the next one,
 * wrapping Overview -> Projects -> Coverage -> Travel -> Overview. Any genuine
 * interaction -- a tap, swipe, wheel, or keypress -- pauses it, and it resumes
 * once the wall has been left alone for `idleMs`. The pager's own auto-scroll is
 * not one of those events, so the cycle never pauses itself.
 *
 * Two deliberate holds override that idle-resume:
 *   - a *manual* pause, toggled from the AUTO button, stays paused until toggled
 *     back on -- so someone can hold a page as long as they like;
 *   - the `canResume` predicate lets the caller veto resuming while an editing
 *     surface is open (a card sheet), so the page never flips mid-edit.
 */
const INTERACTION_EVENTS = ['pointerdown', 'wheel', 'touchstart', 'keydown'];

export class AutoCycle {
  constructor({ pager, dwellMs, idleMs = 45000, onState = () => {}, canResume = () => true }) {
    this.pager = pager;
    this.dwellMs = dwellMs;
    this.idleMs = idleMs;
    this.onState = onState;
    this.canResume = canResume;
    this.dwellTimer = null;
    this.idleTimer = null;
    this.running = false;
    this.started = false;
    this.manualPaused = false;
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
    this.#report();
    this.#resume();
  }

  /** Manual play/pause from the AUTO button. A manual pause holds indefinitely. */
  toggle() {
    if (!this.started) return;
    if (this.manualPaused) {
      this.manualPaused = false;
      this.#resume();
    } else {
      this.manualPaused = true;
      this.running = false;
      clearTimeout(this.dwellTimer);
      clearTimeout(this.idleTimer);
      this.#report();
    }
  }

  #report() {
    this.onState({ enabled: this.started, manualPaused: this.manualPaused });
  }

  #resume() {
    this.running = true;
    this.#report();
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
    if (this.manualPaused) return;         // a manual pause is sticky
    this.running = false;
    // Hold while the wall is being used; resume once it's been idle a while.
    clearTimeout(this.dwellTimer);
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.#tryResume(), this.idleMs);
  }

  #tryResume() {
    if (this.manualPaused) return;
    if (!this.canResume()) {               // e.g. a card sheet is open — wait
      this.idleTimer = setTimeout(() => this.#tryResume(), 4000);
      return;
    }
    this.#resume();
  }
}
