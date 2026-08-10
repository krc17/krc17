/**
 * The Travel page: today's weather outlook, plus one merged "what's affecting
 * your drive" list combining NWS weather alerts and TomTom road incidents.
 *
 * Either feed can update on its own (they poll at different rates), so the drive
 * list is re-rendered whenever weather OR traffic changes; the weather hero
 * follows the weather feed. Both degrade gracefully: no traffic key, a stale
 * pull, or a quiet day all render as calm, readable states rather than blanks.
 */
import { weatherIcon } from './weathericon.js';

export class TravelPage {
  constructor({ weatherBody, placeEl, routesBody, driveBody, footEl }) {
    this.weatherBody = weatherBody;
    this.placeEl = placeEl;
    this.routesBody = routesBody;
    this.driveBody = driveBody;
    this.footEl = footEl;
    this.weather = null;
    this.traffic = null;
    this.routes = null;
  }

  setWeather(data) {
    this.weather = data || null;
    this.#renderWeather();
    this.#renderDrive();
  }

  setTraffic(data) {
    this.traffic = data || null;
    this.#renderDrive();
    this.#renderFoot();
  }

  setRoutes(data) {
    this.routes = data || null;
    this.#renderRoutes();
  }

  #renderWeather() {
    const w = this.weather;
    this.placeEl.textContent = w?.place || '';
    const body = this.weatherBody;

    if (!w || !w.today) {
      body.replaceChildren(el('p', 'weather__empty', w?.error || 'Weather loading…'));
      return;
    }

    const today = w.today;
    const hero = el('div', 'weather__hero');
    hero.append(
      weatherIcon(today.short, today.isDaytime),
      el('div', 'weather__temp', today.temp == null ? '—' : `${today.temp}°`),
      (() => {
        const meta = el('div', 'weather__meta');
        meta.append(
          el('div', 'weather__now', today.short || ''),
          el('div', 'weather__stat', statLine(today)),
        );
        return meta;
      })(),
    );

    const strip = el('div', 'weather__strip');
    for (const period of (w.periods || []).slice(0, 4)) {
      const cell = el('div', 'weather__period');
      const top = el('div', 'weather__period-top');
      top.append(
        weatherIcon(period.short, period.isDaytime, { size: 'sm' }),
        el('div', 'weather__period-temp', period.temp == null ? '—' : `${period.temp}°`),
      );
      cell.append(
        el('div', 'weather__period-name', period.name || ''),
        top,
        el('div', 'weather__period-short', period.short || ''),
      );
      strip.append(cell);
    }

    const fragment = document.createDocumentFragment();
    fragment.append(hero, strip);
    if (today.detailed) fragment.append(el('p', 'weather__detail', today.detailed));
    if (w.error) fragment.append(el('p', 'weather__stale', w.error));
    body.replaceChildren(fragment);
  }

  #renderRoutes() {
    const data = this.routes;
    const body = this.routesBody;
    if (!body) return;

    // No routes configured at all: a quiet hint, not an error.
    if (!data || !data.routes || !data.routes.length) {
      const hint = !data || !data.configured
        ? 'Add TRAVEL_ROUTES to show live drive times to your sites'
        : 'No drive times available';
      body.replaceChildren(el('p', 'routes__hint', hint));
      return;
    }

    const list = el('div', 'routes');
    for (const route of data.routes) {
      const row = el('div', 'route-row');
      row.append(el('div', 'route-row__name', route.name || 'Route'));

      if (route.error) {
        row.append(el('div', 'route-row__time route-row__time--muted', '—'));
        row.classList.add('is-error');
        list.append(row);
        continue;
      }

      const band = delayBand(route.delay_min);
      row.classList.add(`is-${band}`);
      const time = el('div', 'route-row__time');
      time.append(el('span', 'route-row__min', String(route.minutes)), el('span', 'route-row__unit', 'min'));
      row.append(time, el('div', 'route-row__delay', delayText(route)));
      list.append(row);
    }
    body.replaceChildren(list);
  }

  #renderDrive() {
    const items = [];

    // Weather alerts lead — a flood or wind warning outranks any jam.
    for (const alert of this.weather?.alerts || []) {
      items.push({
        kind: 'weather',
        severity: alert.severity,
        tag: alert.event,
        line: alert.headline || alert.event,
        detail: '',
        metric: alert.severity && alert.severity !== 'Unknown' ? alert.severity : '',
      });
    }
    // Then road incidents, already worst-first from the backend.
    for (const inc of this.traffic?.incidents || []) {
      items.push({
        kind: 'traffic',
        category: inc.category,
        tag: inc.type,
        line: inc.road,
        detail: inc.description && inc.description !== inc.type ? inc.description : '',
        metric: driveMetric(inc),
      });
    }

    if (!items.length) {
      this.driveBody.replaceChildren(allClear(this.weather, this.traffic));
      return;
    }

    const list = el('div', 'drive-rows');
    for (const item of items) list.append(driveRow(item));
    this.driveBody.replaceChildren(list);
  }

  #renderFoot() {
    const t = this.traffic;
    let note = '';
    if (!t || !t.configured) note = 'Traffic: add a TomTom key for live road incidents';
    else if (t.error) note = `Traffic: ${t.error.toLowerCase()}`;
    else note = `Traffic via TomTom · ${t.count} incident${t.count === 1 ? '' : 's'}`;
    this.footEl.textContent = note;
  }
}

/* ------------------------------------------------------------------ */
function driveRow({ kind, severity, category, tag, line, detail, metric }) {
  const row = el('div', `drive-row drive-row--${kind}`);
  if (kind === 'weather' && severity) row.classList.add(`is-${severity.toLowerCase()}`);
  if (kind === 'traffic' && category != null) row.classList.add(`cat-${category}`);

  row.append(el('span', 'drive-row__tag', tag || ''));
  const main = el('div', 'drive-row__main');
  main.append(el('div', 'drive-row__line', line || ''));
  if (detail) main.append(el('div', 'drive-row__detail', detail));
  row.append(main);
  if (metric) row.append(el('span', 'drive-row__metric', metric));
  return row;
}

function allClear(weather, traffic) {
  const wrap = el('div', 'drive-clear');
  const noWeather = weather && !weather.error;
  const noTraffic = traffic && traffic.configured && !traffic.error;
  let line = 'No weather alerts or road incidents';
  if (!noWeather && !noTraffic) line = 'Waiting on weather and traffic…';
  else if (!noTraffic) line = 'No weather alerts · live traffic not configured';
  wrap.append(el('div', 'drive-clear__mark', '✓'), el('div', 'drive-clear__line', line));
  return wrap;
}

function statLine(today) {
  const bits = [];
  if (today.precip != null) bits.push(`${today.precip}% precip`);
  if (today.wind) bits.push(`wind ${today.wind}`);
  return bits.join(' · ');
}

function delayBand(delayMin) {
  if (delayMin >= 10) return 'heavy';
  if (delayMin >= 3) return 'slow';
  return 'clear';
}

function delayText(route) {
  if (route.delay_min >= 3) return `+${route.delay_min} min vs normal`;
  if (route.delay_min >= 1) return `+${route.delay_min} min`;
  return 'on time';
}

function driveMetric(inc) {
  if (inc.magnitude >= 4) return 'Closed';
  if (inc.delay >= 60) return `+${Math.round(inc.delay / 60)} min`;
  if (inc.delay > 0) return `+${inc.delay}s`;
  return '';
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
