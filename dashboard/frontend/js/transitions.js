/**
 * Rotating page transitions.
 *
 * Each page change plays the next effect in a set — a full-screen overlay that
 * masks the swap at its peak, the same shape as the old single CRT effect. The
 * pager calls nextTransition(swap) via setTransition(); swap() performs the
 * instant jump, which we fire mid-effect so the horizontal slide is never seen.
 *
 * All effects are pure CSS (an `fx--<id>` class + keyframes in the stylesheet);
 * this module just picks the next one, restarts the animation, and times the
 * swap and cleanup per that effect's tempo. Reduced-motion callers never reach
 * here (the pager cuts straight to the page instead).
 */
const EFFECTS = [
  { id: 'pixel', swapAt: 200, duration: 520 },        // 8-bit block dissolve
  { id: 'grid', swapAt: 180, duration: 520 },         // Tron neon grid
  { id: 'starwars', swapAt: 260, duration: 560 },     // iris wipe
  { id: 'matrix', swapAt: 220, duration: 600 },       // digital rain
  { id: 'stargate', swapAt: 220, duration: 600 },     // 2001 warp tunnel
  { id: 'bladerunner', swapAt: 240, duration: 560 },  // neon searchlight sweep
  { id: 'godfather', swapAt: 380, duration: 900 },    // slow cinematic dissolve
];

let index = 0;
let overlay = null;

export function nextTransition(swap) {
  overlay = overlay || document.getElementById('page-fx');
  if (!overlay) { swap(); return; }        // no overlay in the DOM — just cut

  const fx = EFFECTS[index];
  index = (index + 1) % EFFECTS.length;

  overlay.className = 'page-fx';            // clear any prior effect
  void overlay.offsetWidth;                 // force reflow so the animation replays
  overlay.classList.add(`fx--${fx.id}`, 'is-playing');

  setTimeout(swap, fx.swapAt);              // cut to the new page at this effect's peak
  setTimeout(() => overlay.classList.remove('is-playing'), fx.duration);
}
