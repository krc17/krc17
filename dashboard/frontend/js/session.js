/**
 * Quit / minimise control.
 *
 * A kiosk page cannot close its own window -- `window.close()` is refused for
 * anything the script did not open -- so the choice is handed to the local
 * server, which drives the window through the OS.
 *
 * The button hides itself entirely when the backend reports it cannot act
 * (a non-Windows host, or a screen watching from another machine). A visible
 * control that does nothing is worse than no control.
 */

const HIDE_DELAY_MS = 400;

export class SessionControl {
  constructor({ button, sheet, note }) {
    this.button = button;
    this.sheet = sheet;
    this.note = note;
    this.defaultNote = note.textContent;

    this.#bind();
    this.#detectCapabilities();
  }

  async #detectCapabilities() {
    try {
      const response = await fetch('/api/session', { cache: 'no-store' });
      if (!response.ok) return;
      const caps = await response.json();
      // Only offer it where it will actually work: on the display itself.
      this.button.hidden = !(caps.supported && caps.local);
    } catch {
      this.button.hidden = true;
    }
  }

  #bind() {
    this.button.addEventListener('click', () => this.open());
    this.sheet.addEventListener('click', (event) => {
      if (event.target === this.sheet) this.close();       // tap outside to dismiss
    });
    this.sheet.querySelector('[data-session-cancel]').addEventListener('click', () => this.close());

    this.sheet.querySelectorAll('[data-session-action]').forEach((action) =>
      action.addEventListener('click', () => this.#run(action.dataset.sessionAction)),
    );

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !this.sheet.hidden) {
        event.stopPropagation();   // don't also collapse an expanded panel
        this.close();
      }
    });
  }

  open() {
    this.note.textContent = this.defaultNote;
    this.sheet.hidden = false;
    this.sheet.querySelector('.sheet__action')?.focus();
  }

  close() {
    this.sheet.hidden = true;
    this.button.focus();
  }

  async #run(action) {
    this.note.textContent = 'Working…';
    try {
      const response = await fetch(`/api/session/${action}`, { method: 'POST' });
      const result = await response.json();
      if (!result.ok) {
        this.note.textContent = `Could not do that: ${result.detail}`;
        return;
      }
      // The window is on its way out; getting the sheet off screen first
      // avoids it being the last thing captured in a lingering frame.
      setTimeout(() => this.close(), HIDE_DELAY_MS);
    } catch {
      // A shutdown kills the connection mid-request, which is success.
      if (action === 'shutdown') setTimeout(() => this.close(), HIDE_DELAY_MS);
      else this.note.textContent = 'The dashboard did not respond.';
    }
  }
}
