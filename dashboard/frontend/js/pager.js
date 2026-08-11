/**
 * Two-page swipe pager.
 *
 * Uses CSS scroll-snap rather than a transform-driven carousel, so touch
 * swiping gets the platform's own momentum and rubber-banding for free.
 *
 * One deliberate wrinkle: a card being dragged takes pointer capture, so a
 * finger dragging an engineer between areas moves the card instead of paging.
 * That is the behaviour we want -- nobody should flip the page mid-drag -- so
 * the second page always carries explicit ways out: the "Overview" button in
 * its header, the dots below, and the arrow keys.
 */

const PAGE_NAMES = ['overview', 'projects', 'coverage', 'travel'];

export class Pager {
  constructor({ scroller, dots }) {
    this.scroller = scroller;
    this.dots = Array.from(dots);
    this.index = 0;
    this.settleTimer = null;

    document.documentElement.dataset.page = this.pageName;   // reflect the start page

    this.#bindControls();
    this.#bindScroll();
    this.#bindKeyboard();
    this.#bindResize();
  }

  get pageName() {
    return PAGE_NAMES[this.index] ?? 'overview';
  }

  /** Register a page-change transition, called as transition(swap) where swap()
   *  performs the instant jump. Lets a transition effect mask the swap. Used by
   *  every programmatic change; a live finger-swipe still
   *  scrolls natively. */
  setTransition(fn) { this.transition = fn; }

  /** Move to a page. `smooth` is off during resize so we don't animate a reflow. */
  goTo(index, { smooth = true } = {}) {
    const target = Math.max(0, Math.min(this.dots.length - 1, index));
    const jump = (behavior) => {
      this.scroller.scrollTo({ left: target * this.scroller.clientWidth, behavior });
      this.#setIndex(target);
    };
    const animate = smooth && !prefersReducedMotion();
    if (animate && this.transition && target !== this.index) {
      this.transition(() => jump('auto'));   // effect cuts to the new page mid-way
    } else {
      jump(animate ? 'smooth' : 'auto');
    }
  }

  next() { this.goTo(this.index + 1); }
  previous() { this.goTo(this.index - 1); }

  /** Like next(), but wraps past the last page back to the first. Used by the
   *  auto-cycle so the wall loops Overview -> Projects -> Coverage -> Overview. */
  advance() { this.goTo((this.index + 1) % this.dots.length); }

  get pageCount() { return this.dots.length; }

  /** Fires with the page name whenever the visible page changes. */
  onChange(handler) {
    this.handler = handler;
  }

  #bindControls() {
    document.addEventListener('click', (event) => {
      const trigger = event.target.closest('[data-goto-page]');
      if (!trigger) return;
      this.goTo(Number(trigger.dataset.gotoPage));
    });
  }

  #bindScroll() {
    this.scroller.addEventListener(
      'scroll',
      () => {
        // Wait for the snap to settle rather than firing on every scroll frame.
        clearTimeout(this.settleTimer);
        this.settleTimer = setTimeout(() => {
          const width = this.scroller.clientWidth || 1;
          this.#setIndex(Math.round(this.scroller.scrollLeft / width));
        }, 80);
      },
      { passive: true },
    );
  }

  #bindKeyboard() {
    document.addEventListener('keydown', (event) => {
      if (event.target.matches('input, textarea')) return;
      if (event.key === 'ArrowRight' || event.key === 'PageDown') this.next();
      else if (event.key === 'ArrowLeft' || event.key === 'PageUp') this.previous();
      else if (event.key === '1') this.goTo(0);
      else if (event.key === '2') this.goTo(1);
      else if (event.key === '3') this.goTo(2);
      else return;
      event.preventDefault();
    });
  }

  #bindResize() {
    // A rotated screen or a resized kiosk window must not leave us mid-page.
    let timer = null;
    window.addEventListener('resize', () => {
      clearTimeout(timer);
      timer = setTimeout(() => this.goTo(this.index, { smooth: false }), 150);
    });
  }

  #setIndex(index) {
    if (index === this.index) return;
    this.index = index;
    this.dots.forEach((dot, i) => {
      const active = i === index;
      dot.classList.toggle('is-active', active);
      if (active) dot.setAttribute('aria-current', 'page');
      else dot.removeAttribute('aria-current');
    });
    document.documentElement.dataset.page = this.pageName;
    this.handler?.(this.pageName);
  }
}

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
