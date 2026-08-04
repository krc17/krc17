/**
 * Renders one document at a time and rotates through the folder automatically,
 * so an unattended wall cycles the whole set. Touching the panel pauses the
 * rotation long enough to read, then it resumes on its own.
 */

const PAUSE_AFTER_TOUCH_MS = 90000;

export class DocumentPanel {
  constructor({ key, body, foot, pager, onArchive, emptyHeadline, emptyHint, emptyPath }) {
    this.key = key;
    this.body = body;
    this.foot = foot;
    this.pager = pager;
    this.onArchive = onArchive;
    this.empty = { headline: emptyHeadline, hint: emptyHint, path: emptyPath };

    this.documents = [];
    this.index = 0;
    this.rotationMs = 25000;
    this.timer = null;
    this.pausedUntil = 0;
    this.archiveArmed = null; // filename awaiting a confirming second tap

    this.#bindControls();
  }

  setRotation(seconds) {
    if (Number.isFinite(seconds) && seconds > 0) this.rotationMs = seconds * 1000;
  }

  render(documents) {
    const previousId = this.documents[this.index]?.id;
    this.documents = Array.isArray(documents) ? documents : [];
    // Keep the reader on the same document across an unrelated folder change.
    const sameDoc = this.documents.findIndex((doc) => doc.id === previousId);
    this.index = sameDoc >= 0 ? sameDoc : 0;
    this.#paint();
    this.#scheduleRotation();
  }

  #bindControls() {
    document.querySelectorAll(`[data-doc-prev="${this.key}"]`).forEach((button) =>
      button.addEventListener('click', () => this.#step(-1)),
    );
    document.querySelectorAll(`[data-doc-next="${this.key}"]`).forEach((button) =>
      button.addEventListener('click', () => this.#step(1)),
    );
    document.querySelectorAll(`[data-doc-archive="${this.key}"]`).forEach((button) =>
      button.addEventListener('click', () => this.#archiveClick(button)),
    );
    // Any interaction — scrolling to read, a tap — holds the rotation.
    ['pointerdown', 'scroll'].forEach((type) =>
      this.body.addEventListener(type, () => this.#pause(), { passive: true }),
    );
  }

  /**
   * Archiving removes a document from the wall, so a stray tap shouldn't do it
   * on its own. The first tap arms the button (and holds the rotation so the
   * document can't change under it); a second tap within a few seconds moves
   * the document that was showing when it was armed.
   */
  #archiveClick(button) {
    if (!this.documents.length) return;

    if (this.archiveArmed === null) {
      this.archiveArmed = this.documents[this.index]?.filename ?? null;
      if (!this.archiveArmed) return;
      button.classList.add('is-arming');
      button.setAttribute('title', 'Tap again to archive');
      this.#pause();
      clearTimeout(this.archiveTimer);
      this.archiveTimer = setTimeout(() => this.#disarmArchive(button), 4000);
      return;
    }

    const filename = this.archiveArmed;
    this.#disarmArchive(button);
    this.onArchive?.(this.key, filename);
  }

  #disarmArchive(button) {
    this.archiveArmed = null;
    clearTimeout(this.archiveTimer);
    button.classList.remove('is-arming');
    button.setAttribute('title', 'Archive');
  }

  #step(delta) {
    if (this.documents.length < 2) return;
    const count = this.documents.length;
    this.index = (this.index + delta + count) % count;
    this.#pause();
    this.#paint();
  }

  #pause() {
    this.pausedUntil = Date.now() + PAUSE_AFTER_TOUCH_MS;
    this.#scheduleRotation();
  }

  #scheduleRotation() {
    clearTimeout(this.timer);
    if (this.documents.length < 2) return;
    const wait = Math.max(this.rotationMs, this.pausedUntil - Date.now());
    this.timer = setTimeout(() => {
      this.index = (this.index + 1) % this.documents.length;
      this.#paint();
      this.#scheduleRotation();
    }, wait);
  }

  #paint() {
    this.body.scrollTop = 0;

    if (!this.documents.length) {
      this.body.replaceChildren(emptyState(this.empty));
      this.pager.textContent = '';
      this.foot.textContent = '';
      return;
    }

    const doc = this.documents[this.index];
    const fragment = document.createDocumentFragment();

    fragment.append(
      element('h3', 'doc__title', doc.title),
      element('p', 'doc__meta', `${doc.filename} · updated ${relativeTime(doc.modified)}`),
    );

    if (doc.error) {
      fragment.append(element('p', 'doc__para', doc.error));
    }

    let list = null;
    for (const block of doc.blocks ?? []) {
      if (block.type === 'bullet') {
        if (!list) {
          list = element('ul', 'doc__list');
          fragment.append(list);
        }
        list.append(element('li', 'doc__bullet', block.text));
        continue;
      }
      list = null;

      if (block.type === 'heading') {
        fragment.append(element('h4', 'doc__heading', block.text));
      } else if (block.type === 'table') {
        fragment.append(table(block.rows ?? []));
      } else if (block.text) {
        fragment.append(element('p', 'doc__para', block.text));
      }
    }

    if (doc.truncated) {
      fragment.append(element('p', 'doc__meta', 'Long document — showing the first part.'));
    }

    this.body.replaceChildren(fragment);
    this.pager.textContent =
      this.documents.length > 1 ? `${this.index + 1} / ${this.documents.length}` : '';
    this.foot.textContent =
      this.documents.length > 1
        ? `${this.documents.length} documents in this folder`
        : '1 document in this folder';
  }
}

/* ------------------------------------------------------------------ */
/* DOM helpers — textContent everywhere, never innerHTML               */
/* ------------------------------------------------------------------ */
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function table(rows) {
  const node = element('table', 'doc__table');
  const body = document.createElement('tbody');
  for (const row of rows) {
    const tr = document.createElement('tr');
    for (const cell of row) tr.append(element('td', '', cell));
    body.append(tr);
  }
  node.append(body);
  return node;
}

function emptyState({ headline, hint, path }) {
  const wrapper = element('div', 'empty');
  wrapper.append(element('p', 'empty__headline', headline));
  const hintNode = element('p', 'empty__hint', hint);
  hintNode.append(document.createElement('br'), element('span', 'empty__path', path));
  wrapper.append(hintNode);
  return wrapper;
}

export function relativeTime(iso) {
  if (!iso) return 'unknown';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'unknown';

  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
