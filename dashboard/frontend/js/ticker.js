/**
 * Continuous news ticker.
 *
 * Driven by requestAnimationFrame against elapsed time rather than a CSS
 * keyframe loop, so the headline list can be swapped mid-scroll without the
 * marquee jumping back to the start. The track holds two copies of the list;
 * when the first copy has fully passed we reset by exactly its width, which is
 * seamless.
 */

const PIXELS_PER_SECOND = 55;

export class Ticker {
  constructor({ track, viewport, status }) {
    this.track = track;
    this.viewport = viewport;
    this.status = status;

    this.offset = 0;
    this.halfWidth = 0;
    this.lastFrame = 0;
    this.paused = false;
    this.pendingItems = null;
    /** False when there is nothing to cycle — a lone message must sit still. */
    this.animating = false;

    // Pausing on touch lets someone actually read a headline they spotted.
    this.viewport.addEventListener('pointerdown', () => this.#togglePause());
    document.addEventListener('visibilitychange', () => {
      this.lastFrame = 0; // don't fast-forward after the tab was hidden
    });

    requestAnimationFrame((time) => this.#frame(time));
  }

  render(news) {
    const items = news?.items ?? [];
    this.#renderStatus(news);

    if (!items.length) {
      this.track.replaceChildren(
        item({ title: 'No headlines available — check the feed URLs or the network.', source: '' }),
      );
      this.animating = false;
      this.halfWidth = 0;
      this.offset = 0;
      this.track.style.transform = 'translateX(0)';
      return;
    }

    // Swap at the seam so the scroll never visibly jumps.
    this.pendingItems = items;
    if (this.offset >= this.halfWidth || this.halfWidth === 0) this.#applyItems();
  }

  #applyItems() {
    const items = this.pendingItems;
    if (!items) return;
    this.pendingItems = null;

    const build = () => items.flatMap((entry, index) => {
      const nodes = [item(entry)];
      if (index < items.length - 1) nodes.push(separator());
      return nodes;
    });

    // Two copies back to back give us a seamless wrap-around.
    this.track.replaceChildren(...build(), separator(), ...build(), separator());
    this.offset = 0;
    this.halfWidth = this.track.scrollWidth / 2;
    this.animating = true;
  }

  #renderStatus(news) {
    if (!news) return;
    if (news.error) {
      this.status.dataset.state = 'stale';
      this.status.textContent = news.error;
      return;
    }
    this.status.dataset.state = 'ok';
    this.status.textContent = news.fetched_at
      ? new Date(news.fetched_at).toLocaleTimeString(undefined, {
          hour: 'numeric',
          minute: '2-digit',
        })
      : '';
  }

  #togglePause() {
    this.paused = !this.paused;
    this.viewport.style.opacity = this.paused ? '0.72' : '1';
  }

  #frame(time) {
    requestAnimationFrame((next) => this.#frame(next));

    if (!this.lastFrame) {
      this.lastFrame = time;
      return;
    }
    const elapsed = Math.min((time - this.lastFrame) / 1000, 0.25);
    this.lastFrame = time;

    if (!this.animating || this.paused) return;
    if (!this.halfWidth) {
      // Fonts may not have settled when the list was first built.
      this.halfWidth = this.track.scrollWidth / 2;
      if (!this.halfWidth) return;
    }

    this.offset += elapsed * PIXELS_PER_SECOND;
    if (this.offset >= this.halfWidth) {
      this.offset -= this.halfWidth;
      if (this.pendingItems) {
        this.#applyItems();
        return;
      }
    }
    this.track.style.transform = `translateX(${-this.offset}px)`;
  }
}

function item(entry) {
  const node = document.createElement('span');
  node.className = 'ticker__item';
  if (entry.source) {
    const source = document.createElement('span');
    source.className = 'ticker__source';
    source.textContent = entry.source;
    node.append(source);
  }
  node.append(document.createTextNode(entry.title));
  return node;
}

function separator() {
  const node = document.createElement('span');
  node.className = 'ticker__sep';
  node.textContent = '◆';
  return node;
}
