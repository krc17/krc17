/**
 * Dashboard bootstrap: fetches state, wires the SSE stream, and keeps every
 * panel in sync. Panels are dumb renderers — this module owns the data flow.
 */
import { AutoCycle } from './autocycle.js';
import { CardDetail } from './carddetail.js';
import { channelChange } from './crt.js';
import { CardDrag } from './carddrag.js';
import { DocumentPanel } from './documents.js';
import { DropBanner } from './dropbanner.js';
import { Pager } from './pager.js';
import { renderCoverage } from './coverage.js';
import { getCard, getColumns, renderBoard } from './projects.js';
import { SessionControl } from './session.js';
import { TimePanel } from './timepanel.js';
import { Ticker } from './ticker.js';
import { TravelPage } from './travel.js';

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

/* ------------------------------------------------------------------ */
/* Drop celebration                                                    */
/* A fresh file gets a short, silent, retro-themed banner. We own the  */
/* "what's new" decision here: a filename absent a moment ago is a drop.*/
/* ------------------------------------------------------------------ */
const dropBanner = new DropBanner(document.getElementById('drop-banner'));
const DOC_LABEL = { takeaways: 'Meeting Takeaway', updates: 'Team Update' };
/** Filenames last seen in each document folder, so we can spot arrivals. */
const knownDocs = { takeaways: new Set(), updates: new Set() };

/** Fetch a document folder, announce anything newly arrived, then render.
 *  Seeding (bootstrap) skips the announce so the wall doesn't celebrate the
 *  files that were already there when it started. */
async function loadDocs(channel, { announce = false } = {}) {
  const documents = (await getJSON(`/api/${channel}`)).documents || [];
  const previous = knownDocs[channel];
  if (announce) {
    for (const doc of documents) {
      if (!previous.has(doc.filename)) dropBanner.announce(DOC_LABEL[channel], doc.filename);
    }
  }
  knownDocs[channel] = new Set(documents.map((doc) => doc.filename));
  panels[channel].render(documents);
}

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

const travelPage = new TravelPage({
  weatherBody: document.getElementById('weather-body'),
  placeEl: document.getElementById('weather-place'),
  routesBody: document.getElementById('travel-routes-body'),
  driveBody: document.getElementById('travel-drive-body'),
  footEl: document.getElementById('travel-foot'),
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

// The "+ New project" tab at the bottom of each column.
document.getElementById('kanban').addEventListener('click', (event) => {
  const add = event.target.closest('[data-add-column]');
  if (add) createProject(add.dataset.addColumn);
});

/** Create a project in a column: prompt for the identity fields, write it, then
 *  open the new card so progress, due and milestones can be set right away. */
async function createProject(status) {
  if (!ensureEditKey()) { toast('Adding a project needs the edit key.'); return; }
  const title = (window.prompt('New project — title:') || '').trim();
  if (!title) return;                                   // cancelled or empty
  const owner = (window.prompt('Owner (optional):') || '').trim();
  try {
    const response = await fetch('/api/projects', {
      method: 'POST',
      headers: editHeaders(),
      body: JSON.stringify({ title, owner, status }),
    });
    const result = await response.json();
    if (!result.ok) {
      if (handleEditRejection(response.status)) return;
      const stale = response.status === 404 || response.status === 405;
      toast(stale ? STALE_BUILD_MSG : (result.detail || 'Could not add that project.'));
      return;
    }
    await refresh('projects');
    if (result.card_id) openCard(result.card_id);       // straight into the details
  } catch (error) {
    console.warn('create project failed', error);
    toast('Could not add that project.');
  }
}

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
pager.setTransition(channelChange);   // CRT flip on auto-cycle and button/key paging

// Auto-cycle the pages hands-off; a tap/swipe/keypress pauses it, and it
// resumes when the wall goes idle. Dwell time comes from config at bootstrap.
const pagerAuto = document.getElementById('pager-auto');
const autoCycle = new AutoCycle({
  pager,
  dwellMs: 0,   // filled in from config once we have it
  onState: (running) => { pagerAuto.hidden = !running; },
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
  takeaways: () => loadDocs('takeaways', { announce: true }),
  updates: () => loadDocs('updates', { announce: true }),
  projects: async () => renderBoard(await getJSON('/api/projects')),
  coverage: async () => renderCoverage(await getJSON('/api/coverage')),
  news: async () => ticker.render(await getJSON('/api/news')),
  agenda: async () => timePanel.setAgenda(await getJSON('/api/agenda')),
  weather: async () => travelPage.setWeather(await getJSON('/api/weather')),
  traffic: async () => travelPage.setTraffic(await getJSON('/api/traffic')),
  routes: async () => travelPage.setRoutes(await getJSON('/api/routes')),
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
    autoCycle.dwellMs = Number(state.config.page_cycle_seconds || 0) * 1000;
    autoCycle.start();
    panels.takeaways.setRotation(state.config.rotation_seconds);
    panels.updates.setRotation(state.config.rotation_seconds);
    panels.takeaways.render(state.takeaways);
    panels.updates.render(state.updates);
    // Seed "what's already here" so the first live drop is the first banner.
    knownDocs.takeaways = new Set((state.takeaways || []).map((doc) => doc.filename));
    knownDocs.updates = new Set((state.updates || []).map((doc) => doc.filename));
    renderBoard(state.projects);
    renderCoverage(state.coverage);
    timePanel.setAgenda(state.agenda);
    ticker.render(state.news);
    travelPage.setWeather(state.weather);
    travelPage.setTraffic(state.traffic);
    travelPage.setRoutes(state.routes);
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
