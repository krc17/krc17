/**
 * CRT channel-change transition between pages.
 *
 * A full-screen overlay flashes static, scanlines and a rolling bar for a
 * fraction of a second — the old-TV "flip the channel" snap. The actual page
 * swap is done in the dark middle of that flash, so the horizontal slide is
 * never seen; the wall just cuts from one page to the next.
 *
 * Registered on the pager (pager.setTransition), so both the auto-cycle and a
 * manual tap/swipe share it. Reduced-motion callers skip it (the pager only
 * calls this when motion is allowed).
 */
const DURATION_MS = 430;   // must match the crt-* animations in the CSS
const SWAP_AT_MS = 150;    // swap while the overlay is at its darkest

let overlay = null;

export function channelChange(swap) {
  overlay = overlay || document.getElementById('crt');
  if (!overlay) { swap(); return; }        // no overlay in the DOM — just cut

  // Restart the animation even if a previous flip is still playing.
  overlay.classList.remove('is-playing');
  void overlay.offsetWidth;                // force reflow so the animation replays
  overlay.classList.add('is-playing');

  setTimeout(swap, SWAP_AT_MS);
  setTimeout(() => overlay.classList.remove('is-playing'), DURATION_MS);
}
