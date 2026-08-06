/**
 * A silent celebration when a fresh file lands on the wall.
 *
 * One banner shell, a rotating set of retro badges. Each drop advances to the
 * next badge, so over time the wall cycles the whole set. No audio (public TV).
 *
 * One banner shows at a time; the rest wait off-screen. A banner never leaves
 * on its own — it stays until someone taps it, so every drop is acknowledged by
 * a person. Tapping plays that badge's exit, then the next queued drop animates
 * in; you clear the backlog one tap at a time, oldest first, until you are
 * caught up on the latest.
 *
 * app.js decides what counts as a "drop" (a filename that was not in the
 * folder a moment ago) and calls announce(folderLabel, filename).
 */

const EXIT_FALLBACK_MS = 900;   // backstop if animationend is missed; > longest exit

/**
 * The badges. Each fills the same three slots; the CSS class does the styling.
 * The phrasing is part of the badge, so each writes its own — but all of them
 * carry the folder and the filename, nothing else (no author is tracked).
 */
const BADGES = [
  {
    id: 'pokemon',
    eyebrow: () => '⚔ WILD ENCOUNTER',
    title: (folder) => `A wild ${folder} appeared!`,
    sub: (_folder, file) => file,
  },
  {
    id: 'streetfighter',
    eyebrow: () => 'ROUND 1 — FIGHT!',
    title: () => 'NEW CHALLENGER',
    sub: (folder, file) => `${file} enters the ${folder} arena`,
  },
  {
    id: 'mario',
    eyebrow: () => '★ 1-UP',
    title: (folder) => `${folder}  +100`,
    sub: (_folder, file) => file,
  },
  {
    id: 'xbox',
    eyebrow: () => 'ACHIEVEMENT UNLOCKED',
    title: (_folder, file) => file,
    sub: (folder) => `${folder} posted`,
  },
  {
    id: 'marquee',
    eyebrow: () => '◆ NOW SHOWING ◆',
    title: (_folder, file) => file,
    sub: (folder) => `Fresh ${folder} on the big screen`,
  },
  {
    id: 'zelda',
    eyebrow: () => '✦ ITEM GET!',
    title: (folder) => `You got the ${folder}!`,
    sub: (_folder, file) => file,
  },
  {
    id: 'pacman',
    eyebrow: () => 'WAKA-WAKA',
    title: (_folder, file) => file,
    sub: (folder) => `A fresh ${folder} pellet`,
  },
  {
    id: 'spaceinvaders',
    eyebrow: () => '▚ INVADER DETECTED',
    title: (folder) => `${folder} incoming`,
    sub: (_folder, file) => file,
  },
  {
    id: 'gameboy',
    eyebrow: () => 'SAVING…',
    title: (_folder, file) => file,
    sub: (folder) => `${folder} written to cartridge`,
  },
  {
    id: 'matrix',
    eyebrow: () => '> WAKE UP…',
    title: (_folder, file) => file,
    sub: (folder) => `A ${folder} enters the Matrix`,
  },
  {
    id: 'tron',
    eyebrow: () => 'ENTERING THE GRID',
    title: (_folder, file) => file,
    sub: (folder) => `${folder} — end of line`,
  },
  {
    id: 'skyrim',
    eyebrow: () => '◆ QUEST UPDATED',
    title: (_folder, file) => file,
    sub: (folder) => `${folder} added to your journal`,
  },
  {
    id: 'lotr',
    eyebrow: () => '❂ THE RING SPEAKS',
    title: (_folder, file) => file,
    sub: (folder) => `One does not simply ignore a ${folder}`,
  },
];

export class DropBanner {
  constructor(root) {
    this.root = root;                 // the fixed overlay container
    this.badgeIndex = 0;
    this.queue = [];                  // drops waiting off-screen, oldest first
    this.current = null;              // the card on screen, or null
  }

  /** Queue a celebration for a freshly-dropped file. folderLabel is a short,
   *  human label (e.g. "Team Update"); filename is the file that just landed.
   *  If nothing is showing it appears at once; otherwise it waits its turn. */
  announce(folderLabel, filename) {
    if (!filename) return;
    this.queue.push({ folder: folderLabel, file: filename });
    if (this.current) this.#renderCount();   // a drop arrived while one is up
    else this.#showNext();
  }

  #showNext() {
    const item = this.queue.shift();
    if (!item) {                       // caught up — nothing left to show
      this.current = null;
      this.root.replaceChildren();
      this.root.hidden = true;
      return;
    }

    const badge = BADGES[this.badgeIndex];
    this.badgeIndex = (this.badgeIndex + 1) % BADGES.length;

    const card = el('div', `dropbanner__card dropbanner--${badge.id}`);
    card.append(
      el('div', 'dropbanner__eyebrow', badge.eyebrow(item.folder, item.file)),
      el('div', 'dropbanner__title', badge.title(item.folder, item.file)),
      el('div', 'dropbanner__sub', badge.sub(item.folder, item.file)),
    );

    this.current = card;
    this.root.hidden = false;
    this.root.replaceChildren(card);
    this.#renderCount();

    // Two frames so the browser paints the entrance start state before we flip
    // to "in" and the transition actually runs.
    requestAnimationFrame(() => requestAnimationFrame(() => card.classList.add('is-in')));
    // Stays put until a person taps it — every drop is acknowledged by hand.
    card.addEventListener('pointerdown', () => this.#dismiss(card), { once: true });
  }

  /** Refresh the "+N more" counter to match how many drops are still queued
   *  behind the badge currently showing. */
  #renderCount() {
    this.root.querySelector('.dropbanner__more')?.remove();
    if (this.current && this.queue.length) {
      this.root.append(el('div', 'dropbanner__more', `+${this.queue.length} more`));
    }
  }

  #dismiss(card) {
    if (card !== this.current) return;   // ignore a stray tap after it left
    card.classList.remove('is-in');
    card.classList.add('is-out');        // each badge has its own exit
    let finished = false;
    const advance = () => {
      if (finished) return;              // animationend + timeout must fire once
      finished = true;
      this.#showNext();                  // the next queued drop animates in
    };
    // Exit durations differ per badge, so end on the animation; a timeout backs
    // it up in case animationend is missed (e.g. tab hidden mid-fizzle).
    card.addEventListener('animationend', advance, { once: true });
    setTimeout(advance, EXIT_FALLBACK_MS);
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
