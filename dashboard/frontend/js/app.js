/**
 * Dashboard bootstrap: fetches state, wires the SSE stream, and keeps every
 * panel in sync. Panels are dumb renderers — this module owns the data flow.
 */
import { Blackboard } from './blackboard.js';
import { DocumentPanel } from './documents.js';
import { Pager } from './pager.js';
import { renderBoard } from './projects.js';
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
    emptyHeadline: 'No meeting takeaways yet',
    emptyHint: 'Drop a Word, PDF, or Markdown file into the takeaways folder and it appears here within a second.',
    emptyPath: 'data\\meeting-takeaways',
  }),
  updates: new DocumentPanel({
    key: 'updates',
    body: document.getElementById('updates-body'),
    foot: document.getElementById('updates-foot'),
    pager: document.getElementById('updates-pager'),
    emptyHeadline: 'No team updates yet',
    emptyHint: 'Each file in the updates folder becomes a card. One file per project or per person works well.',
    emptyPath: 'data\\team-updates',
  }),
};

const timePanel = new TimePanel({
  time: document.getElementById('clock-time'),
  day: document.getElementById('clock-day'),
  zone: document.getElementById('clock-zone'),
  calendar: document.getElementById('calendar'),
  agenda: document.getElementById('agenda-list'),
});

const ticker = new Ticker({
  track: document.getElementById('ticker-track'),
  viewport: document.querySelector('.ticker__viewport'),
  status: document.getElementById('ticker-status'),
});

const blackboard = new Blackboard({
  canvas: document.getElementById('board-canvas'),
  surface: document.getElementById('board-surface'),
  tools: document.getElementById('board-tools'),
  hint: document.getElementById('board-hint'),
  saveState: document.getElementById('board-save-state'),
});

new SessionControl({
  button: document.getElementById('session-open'),
  sheet: document.getElementById('session-sheet'),
  note: document.getElementById('sheet-note'),
});

const pager = new Pager({
  scroller: document.getElementById('pages'),
  dots: document.querySelectorAll('.pager__dot'),
});

pager.onChange((page) => {
  if (page === 'board') {
    // Another screen may have drawn while this one sat on the overview page.
    blackboard.pull();
  } else {
    // Leaving the board mid-stroke would otherwise leave the save pending.
    blackboard.flush();
  }
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
    panels.takeaways.setRotation(state.config.rotation_seconds);
    panels.updates.setRotation(state.config.rotation_seconds);
    panels.takeaways.render(state.takeaways);
    panels.updates.render(state.updates);
    renderBoard(state.projects);
    timePanel.setAgenda(state.agenda);
    ticker.render(state.news);
    blackboard.load(state.blackboard);
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

  stream.addEventListener('blackboard', (event) => {
    const payload = safeParse(event.data);
    // Ignore the echo of our own save; only pull when another screen drew.
    if (payload.client_id !== blackboard.clientId) blackboard.pull();
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
    blackboard.pull();
  }
});
