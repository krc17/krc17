/**
 * A short, silent celebration when a fresh file lands on the wall.
 *
 * One banner shell, five retro skins. Each drop advances to the next skin, so
 * over a week the wall cycles the whole set. No audio (it is a public TV) and
 * no interaction — it slides in, holds a few seconds, and leaves on its own.
 *
 * app.js decides what counts as a "drop" (a filename that was not in the
 * folder a moment ago) and calls announce(folderLabel, filename).
 */

const HOLD_MS = 6000;   // time on screen once fully in
const OUT_MS = 600;     // must cover the longest exit transition in the CSS
const MAX_QUEUED = 3;   // a night's worth of drops shouldn't parade forever

/**
 * Five skins. Each fills the same three slots; the CSS class does the styling.
 * The phrasing is part of the theme, so each writes its own — but all of them
 * carry the folder and the filename, nothing else (no author is tracked).
 */
const THEMES = [
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
];

export class DropBanner {
  constructor(root) {
    this.root = root;                 // the fixed overlay container
    this.queue = [];
    this.pumping = false;
    this.themeIndex = 0;
  }

  /** Queue a celebration. folderLabel is a short, human label (e.g. "Team
   *  Update"); filename is the file that just landed. */
  announce(folderLabel, filename) {
    if (!filename) return;
    if (this.queue.length >= MAX_QUEUED) this.queue.shift();
    this.queue.push({ folder: folderLabel, file: filename });
    if (!this.pumping) this.#pump();
  }

  async #pump() {
    this.pumping = true;
    while (this.queue.length) {
      // eslint-disable-next-line no-await-in-loop -- banners must not overlap
      await this.#present(this.queue.shift());
    }
    this.pumping = false;
  }

  #present({ folder, file }) {
    const theme = THEMES[this.themeIndex];
    this.themeIndex = (this.themeIndex + 1) % THEMES.length;

    const card = el('div', `dropbanner__card dropbanner--${theme.id}`);
    card.append(
      el('div', 'dropbanner__eyebrow', theme.eyebrow(folder, file)),
      el('div', 'dropbanner__title', theme.title(folder, file)),
      el('div', 'dropbanner__sub', theme.sub(folder, file)),
    );

    this.root.hidden = false;
    this.root.replaceChildren(card);

    return new Promise((resolve) => {
      // Two frames so the browser paints the "out" start state before we flip
      // to "in" and the transition actually runs.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        card.classList.add('is-in');
        setTimeout(() => {
          card.classList.remove('is-in');           // play the exit
          setTimeout(() => {
            if (this.root.firstChild === card) {
              this.root.replaceChildren();
              this.root.hidden = true;
            }
            resolve();
          }, OUT_MS);
        }, HOLD_MS);
      }));
    });
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
