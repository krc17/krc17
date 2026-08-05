/**
 * Dashboard bootstrap: fetches state, wires the SSE stream, and keeps every
 * panel in sync. Panels are dumb renderers — this module owns the data flow.
 */
import { CardDetail } from './carddetail.js';
import { CardDrag } from './carddrag.js';
import { DocumentPanel } from './documents.js';
import { Pager } from './pager.js';
import { renderCoverage } from './coverage.js';
import { getCard, getColumns, renderBoard } from './projects.js';
import { SessionControl } from './session.js';
import { TimePanel } from './timepanel.js';
import { Ticker } from './ticker.js';

const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 30000;
/** If SSE dies silently (sleeping TV, flaky wifi) this is the safety net. */
const FALLBACK_POLL_MS = 120000;

const linkState = document.getElementById('link-state');

const panels = {
  takeaways: new DocumentPanel({
    key: 'takeaways',
    body: document.getElementById('takeaways-body'),
    foot: document.getElementById('takeaways-foot'),
    pager: document.getElementById('takeaways-pager'),
    onArchive: archiveDoc,
    emptyHeadline: 'No meeting takeaways yet',
    emptyHint: 'Drop a Word, PDF, or Markdown file into the takeaways folder and it appears here within a second.',
    emptyPath: 'data\\meeting-takeaways',
  }),
  updates: new DocumentPanel({
    key: 'updates',
    body: document.getElementById('updates-body'),
    foot: document.getElementById('updates-foot'),
    pager: document.getElementById('updates-pager'),
    onArchive: archiveDoc,
    emptyHeadline: 'No team updates yet',
    emptyHint: 'Each file in the updates folder becomes a card. One file per project or per person works well.',
    emptyPath: 'data\\team-updates',
  }),
};

/** Move the shown document into its folder's archive/ subfolder. */
async function archiveDoc(channel, filename) {
  if (!ensureEditKey()) { toast('Archiving needs the edit key.'); return; }
  try {
    const response = await fetch(`/api/${encodeURIComponent(channel)}/archive`, {
      method: 'POST',
      headers: editHeaders(),
      body: JSON.stringify({ filename }),
    });
    const result = await response.json();
    if (!result.ok && handleEditRejection(response.status)) {
      // message already shown
    } else {
      toast(result.ok ? `Archived ${filename}` : (result.detail || 'Could not archive that file.'));
    }
  } catch (error) {
    console.warn('archive failed', error);
    toast('Could not archive that file.');
  }
  await refresh(channel);
}

const timePanel = new TimePanel({
  time: document.getElementById('clock-time'),
  day: document.getElementById('clock-day'),
  zone: document.getElementById('clock-zone'),
  calendar: document.getElementById('calendar'),
  calendarNav: document.getElementById('calendar-nav'),
  agenda: document.getElementById('agenda-list'),
  legend: document.getElementById('calendar-legend'),
  status: document.getElementById('calendar-status'),
  daySheet: document.getElementById('day-sheet'),
});

const ticker = new Ticker({
  track: document.getElementById('ticker-track'),
  viewport: document.querySelector('.ticker__viewport'),
  status: document.getElementById('ticker-status'),
});

new SessionControl({
  button: document.getElementById('session-open'),
  sheet: document.getElementById('session-sheet'),
  note: document.getElementById('sheet-note'),
});

/* ------------------------------------------------------------------ */
/* Kanban interaction                                                  */
/* ------------------------------------------------------------------ */
const cardDetail = new CardDetail({
  sheet: document.getElementById('card-sheet'),
  getColumns,
  onMilestone: (cardId, index, done) =>
    mutate(`/api/projects/${encodeURIComponent(cardId)}/milestone`, { index, done }),
  onMove: (cardId, status) => {
    cardDetail.close();
    moveCard(cardId, status);
  },
  onCompletion: (cardId, body) =>
    mutate(`/api/projects/${encodeURIComponent(cardId)}/completion`, { ...body, cardId }),
  onDue: (cardId, body) =>
    mutate(`/api/projects/${encodeURIComponent(cardId)}/due`, { ...body, cardId }),
});

function openCard(cardId) {
  const detail = getCard(cardId);
  if (detail) cardDetail.open(detail);
}

new CardDrag({
  root: document.getElementById('kanban'),
  onMove: (cardId, status) => moveCard(cardId, status),
  onTap: openCard,
});

// Keyboard equivalent: cards are role="button" and focusable.
document.getElementById('kanban').addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const card = event.target.closest('.card');
  if (!card) return;
  event.preventDefault();
  openCard(card.dataset.cardId);
});

/* ------------------------------------------------------------------ */
/* Coverage board — same drag engine, no detail sheet (drag only)      */
/* ------------------------------------------------------------------ */
new CardDrag({
  root: document.getElementById('coverage-board'),
  onMove: (engineer, area) => assignCoverage(engineer, area),
  // No tap action: a coverage card carries only a name, nothing to open.
});

/* ------------------------------------------------------------------ */
/* Edit authorization                                                  */
/* The display itself always edits. A LAN browser needs the shared edit */
/* key, entered once and kept in this browser, sent as a header.        */
/* ------------------------------------------------------------------ */
const EDIT_KEY_STORE = 'dashboard-edit-key';
let editKeyRequired = false;

function editHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const key = localStorage.getItem(EDIT_KEY_STORE);
  if (key) headers['X-Edit-Key'] = key;
  return headers;
}

/** Ensure a key is on hand when one is required; false if the user dismisses
 *  the prompt, so the caller can abort the write. */
function ensureEditKey() {
  if (!editKeyRequired || localStorage.getItem(EDIT_KEY_STORE)) return true;
  const key = window.prompt('Enter the edit key to change the board:');
  if (key && key.trim()) { localStorage.setItem(EDIT_KEY_STORE, key.trim()); return true; }
  return false;
}

/** A 403 on a keyed write means the key was wrong — forget it so the next
 *  attempt prompts again. Returns true when it handled the message. */
function handleEditRejection(status) {
  if (status === 403 && editKeyRequired) {
    localStorage.removeItem(EDIT_KEY_STORE);
    toast('Edit key rejected — try again.');
    return true;
  }
  return false;
}

const STALE_BUILD_MSG =
  'The server is running an older build. Restart it: windows\\Stop-Dashboard.ps1, then Start Dashboard.bat';

async function assignCoverage(engineer, area) {
  if (!ensureEditKey()) { toast('Editing needs the edit key.'); await refresh('coverage'); return; }
  try {
    const response = await fetch(`/api/coverage/${encodeURIComponent(engineer)}/area`, {
      method: 'POST',
      headers: editHeaders(),
      body: JSON.stringify({ area }),
    });
    const result = await response.json();
    if (!result.ok && !handleEditRejection(response.status)) {
      const stale = response.status === 404 || response.status === 405;
      toast(stale ? STALE_BUILD_MSG : (result.detail || 'Could not save that change.'));
    }
  } catch (error) {
    console.warn('coverage write failed', error);
    toast('Could not save that change.');
  }
  // Repaint either way: on success to confirm, on failure to undo the drag.
  await refresh('coverage');
}

async function mutate(path, body) {
  const done = async (ok) => {
    // Repaint either way: on success to pick up derived progress and health,
    // on failure to undo whatever the optimistic move showed.
    await refresh('projects');
    cardDetail.refresh(getCard(body.cardId ?? cardDetail.card?.id));
    return ok;
  };
  if (!ensureEditKey()) { toast('Editing needs the edit key.'); return done(false); }
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: editHeaders(),
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!result.ok && !handleEditRejection(response.status)) {
      // 404/405 means this endpoint does not exist on the running server, which
      // in practice means a new frontend is talking to an older backend left
      // running from a previous build. Say that, not "Method Not Allowed".
      const stale = response.status === 404 || response.status === 405;
      console.warn('board write refused:', response.status, result.detail);
      toast(stale ? STALE_BUILD_MSG : result.detail);
    }
    return done(result.ok);
  } catch (error) {
    console.warn('board write failed', error);
    toast('Could not save that change.');
    return done(false);
  }
}

function moveCard(cardId, status) {
  return mutate(`/api/projects/${encodeURIComponent(cardId)}/status`, { status, cardId });
}

let toastTimer = null;
function toast(message) {
  const node = document.getElementById('toast');
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, 4000);
}

const pager = new Pager({
  scroller: document.getElementById('pages'),
  dots: document.querySelectorAll('.pager__dot'),
});

/* ------------------------------------------------------------------ */
/* Fetch helpers                                                       */
/* ------------------------------------------------------------------ */
async function getJSON(path) {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${path} → ${response.status}`);
  return response.json();
}

const channels = {
  takeaways: async () => panels.takeaways.render((await getJSON('/api/takeaways')).documents),
  updates: async () => panels.updates.render((await getJSON('/api/updates')).documents),
  projects: async () => renderBoard(await getJSON('/api/projects')),
  coverage: async () => renderCoverage(await getJSON('/api/coverage')),
  news: async () => ticker.render(await getJSON('/api/news')),
  agenda: async () => timePanel.setAgenda(await getJSON('/api/agenda')),
};

async function refresh(channel) {
  const loader = channels[channel];
  if (!loader) return;
  try {
    await loader();
  } catch (error) {
    console.warn(`refresh failed: ${channel}`, error);
  }
}

async function refreshAll() {
  await Promise.allSettled(Object.keys(channels).map(refresh));
}

async function bootstrap() {
  try {
    const state = await getJSON('/api/state');
    timePanel.configure(state.config, state.now);
    editKeyRequired = Boolean(state.config.edit_key_required);
    panels.takeaways.setRotation(state.config.rotation_seconds);
    panels.updates.setRotation(state.config.rotation_seconds);
    panels.takeaways.render(state.takeaways);
    panels.updates.render(state.updates);
    renderBoard(state.projects);
    renderCoverage(state.coverage);
    timePanel.setAgenda(state.agenda);
    ticker.render(state.news);
    setLink(true);
  } catch (error) {
    console.error('bootstrap failed', error);
    setLink(false);
    setTimeout(bootstrap, RECONNECT_BASE_MS);
  }
}

/* ------------------------------------------------------------------ */
/* Live updates                                                        */
/* ------------------------------------------------------------------ */
let stream = null;
let retries = 0;

function connect() {
  stream?.close();
  stream = new EventSource('/api/stream');

  stream.addEventListener('open', () => {
    retries = 0;
    setLink(true);
  });

  stream.addEventListener('content', (event) => {
    const { channel } = safeParse(event.data);
    if (channel) refresh(channel);
  });

  stream.addEventListener('error', () => {
    setLink(false);
    stream?.close();
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** retries++, RECONNECT_MAX_MS);
    setTimeout(connect, delay);
  });
}

function safeParse(data) {
  try {
    return JSON.parse(data) ?? {};
  } catch {
    return {};
  }
}

function setLink(online) {
  linkState.hidden = online;
}

/* ------------------------------------------------------------------ */
/* Overflow fades                                                      */
/* ------------------------------------------------------------------ */
/**
 * Scrollable regions get a bottom fade only while there is genuinely more
 * content below — a fade on a half-empty panel just looks like a rendering bug.
 */
const OVERFLOW_SELECTOR = '.doc-viewport, .agenda, .column__cards';

function syncOverflowFades() {
  document.querySelectorAll(OVERFLOW_SELECTOR).forEach((region) => {
    const remaining = region.scrollHeight - region.clientHeight - region.scrollTop;
    region.classList.toggle('scroll-fade', remaining > 4);
  });
}

const overflowObserver = new ResizeObserver(syncOverflowFades);
document.querySelectorAll('.panel').forEach((panel) => overflowObserver.observe(panel));
document.addEventListener('scroll', syncOverflowFades, { capture: true, passive: true });
// Renders are synchronous but layout is not — settle first, then measure.
const mutationObserver = new MutationObserver(() => requestAnimationFrame(syncOverflowFades));
mutationObserver.observe(document.getElementById('wall'), { childList: true, subtree: true });

/* ------------------------------------------------------------------ */
/* Panel expand / collapse                                             */
/* ------------------------------------------------------------------ */
document.addEventListener('click', (event) => {
  const trigger = event.target.closest('[data-expand]');
  if (!trigger) return;
  const panel = document.getElementById(trigger.dataset.expand);
  const expanded = panel.classList.toggle('is-expanded');
  trigger.setAttribute('aria-label', expanded ? 'Collapse panel' : 'Expand panel');
  trigger.textContent = expanded ? '⤡' : '⤢';
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  document.querySelectorAll('.panel.is-expanded').forEach((panel) => {
    panel.classList.remove('is-expanded');
    const trigger = panel.querySelector('[data-expand]');
    if (trigger) {
      trigger.textContent = '⤢';
      trigger.setAttribute('aria-label', 'Expand panel');
    }
  });
});

/* ------------------------------------------------------------------ */
/* Start                                                               */
/* ------------------------------------------------------------------ */
bootstrap().then(connect);
timePanel.start();
setInterval(refreshAll, FALLBACK_POLL_MS);

// A TV that slept through the night wakes up with stale everything.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    refreshAll();
  }
});
