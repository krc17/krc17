/**
 * The "sky" fill under the weather: a daylight arc with sunrise/sunset and a
 * marker for now, tonight's moon phase, and the next tides. Sun and moon are
 * computed locally from the configured lat/lon (no API, always works); tides
 * come from the NOAA feed. It answers "how much daylight is left for that site
 * trip, and when's the next high tide" at a glance.
 */

const RAD = Math.PI / 180;
const DAY_MS = 86400000;
const J1970 = 2440588;
const J2000 = 2451545;
const OBLIQUITY = RAD * 23.4397;

/* ---- Sun (compact SunCalc core) ---------------------------------------- */
const toDays = (date) => date.valueOf() / DAY_MS - 0.5 + J1970 - J2000;
const solarMeanAnomaly = (d) => RAD * (357.5291 + 0.98560028 * d);
function eclipticLongitude(M) {
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  return M + C + RAD * 102.9372 + Math.PI;
}
const declination = (l) => Math.asin(Math.sin(OBLIQUITY) * Math.sin(l));
const J0 = 0.0009;
const julianCycle = (d, lw) => Math.round(d - J0 - lw / (2 * Math.PI));
const approxTransit = (Ht, lw, n) => J0 + (Ht + lw) / (2 * Math.PI) + n;
const solarTransitJ = (ds, M, L) => J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
const hourAngle = (h, phi, d) =>
  Math.acos((Math.sin(h) - Math.sin(phi) * Math.sin(d)) / (Math.cos(phi) * Math.cos(d)));
const fromJulian = (j) => new Date((j + 0.5 - J1970) * DAY_MS);

export function sunTimes(date, lat, lng) {
  const lw = RAD * -lng;
  const phi = RAD * lat;
  const d = toDays(date);
  const n = julianCycle(d, lw);
  const ds = approxTransit(0, lw, n);
  const M = solarMeanAnomaly(ds);
  const L = eclipticLongitude(M);
  const dec = declination(L);
  const Jnoon = solarTransitJ(ds, M, L);
  const Jset = solarTransitJ(approxTransit(hourAngle(RAD * -0.833, phi, dec), lw, n), M, L);
  return { sunrise: fromJulian(Jnoon - (Jset - Jnoon)), sunset: fromJulian(Jset) };
}

/* ---- Moon --------------------------------------------------------------- */
const SYNODIC = 29.530588853;
const KNOWN_NEW = Date.UTC(2000, 0, 6, 18, 14) / DAY_MS;   // a known new moon
const MOON_NAMES = ['New Moon', 'Waxing Crescent', 'First Quarter', 'Waxing Gibbous',
  'Full Moon', 'Waning Gibbous', 'Last Quarter', 'Waning Crescent'];

export function moonPhase(date) {
  let phase = ((date.valueOf() / DAY_MS - KNOWN_NEW) % SYNODIC) / SYNODIC;
  if (phase < 0) phase += 1;
  return {
    phase,
    name: MOON_NAMES[Math.round(phase * 8) % 8],
    illum: Math.round((1 - Math.cos(2 * Math.PI * phase)) / 2 * 100),
  };
}

function moonMarkup(phase) {
  const r = 16, cx = 20, cy = 20;
  const waxing = phase < 0.5;
  const mag = Math.cos(phase * 2 * Math.PI);      // +1 new … -1 full
  const rx = Math.abs(r * mag);
  const outer = waxing ? 1 : 0;
  const inner = mag > 0 ? outer : 1 - outer;
  const lit = `M ${cx} ${cy - r} A ${r} ${r} 0 0 ${outer} ${cx} ${cy + r} A ${rx} ${r} 0 0 ${inner} ${cx} ${cy - r} Z`;
  return `<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="${cx}" cy="${cy}" r="${r}" fill="#2b3240"/>` +
    `<path d="${lit}" fill="#e4ebf5"/></svg>`;
}

/* ---- Render ------------------------------------------------------------- */
export function renderSky(container, { point, tides, now = new Date() }) {
  if (!container) return;
  const [lat, lng] = (point || '').split(',').map(Number);
  const frag = document.createDocumentFragment();

  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    frag.append(sunBlock(sunTimes(now, lat, lng), now));
    frag.append(moonBlock(moonPhase(now)));
  }
  const tideBlock = tidesBlock(tides);
  if (tideBlock) frag.append(tideBlock);

  container.replaceChildren(frag);
}

function sunBlock({ sunrise, sunset }, now) {
  const block = el('div', 'sky__row');
  const span = sunset - sunrise;
  const frac = span > 0 ? Math.min(1, Math.max(0, (now - sunrise) / span)) : 0;
  const isDay = now >= sunrise && now <= sunset;

  // Arc across a 140×54 box, baseline y=44, peak y=4; sun dot at the fraction.
  const theta = Math.PI * (1 - frac);
  const sx = 70 + 60 * Math.cos(theta);
  const sy = 44 - 40 * Math.sin(theta);
  const dot = isDay
    ? `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="6" fill="#e6b84a"/>`
    : '';
  block.append(svg(
    `<svg viewBox="0 0 140 54" class="sky__arc" aria-hidden="true">` +
    `<path d="M10 44 A 60 40 0 0 1 130 44" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 4"/>` +
    `<line x1="6" y1="44" x2="134" y2="44" stroke="currentColor" stroke-width="1.5" opacity="0.5"/>${dot}</svg>`,
  ));

  const times = el('div', 'sky__times');
  times.append(
    el('span', 'sky__time', `↑ ${clock(sunrise)}`),
    el('span', 'sky__daylight', daylight(span)),
    el('span', 'sky__time', `${clock(sunset)} ↓`),
  );
  block.append(times);
  return block;
}

function moonBlock({ name, illum, phase }) {
  const row = el('div', 'sky__moon');
  row.append(svg(moonMarkup(phase)));
  row.append(el('div', 'sky__moon-label', `${name} · ${illum}% lit`));
  return row;
}

function tidesBlock(tides) {
  if (!tides || !tides.configured) return null;
  const wrap = el('div', 'sky__tides');
  wrap.append(el('div', 'sky__tides-title', 'Tides'));
  if (!tides.tides || !tides.tides.length) {
    wrap.append(el('div', 'sky__tide-empty', tides.error || 'No tide data'));
    return wrap;
  }
  for (const tide of tides.tides.slice(0, 3)) {
    const row = el('div', `sky__tide sky__tide--${tide.type.toLowerCase()}`);
    row.append(
      el('span', 'sky__tide-type', tide.type),
      el('span', 'sky__tide-time', clock(new Date(tide.time))),
      el('span', 'sky__tide-h', tide.height == null ? '' : `${tide.height} ft`),
    );
    wrap.append(row);
  }
  return wrap;
}

/* ---- helpers ------------------------------------------------------------ */
function clock(date) {
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    .replace(' ', '').toLowerCase();
}
function daylight(ms) {
  if (!(ms > 0)) return '';
  const mins = Math.round(ms / 60000);
  return `${Math.floor(mins / 60)}h ${mins % 60}m daylight`;
}
function svg(markup) {
  const t = document.createElement('template');
  t.innerHTML = markup;
  return t.content.firstElementChild.cloneNode(true);
}
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
