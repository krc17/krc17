/**
 * Date, time, month calendar and the next few calendar events.
 *
 * The clock is anchored to the server's time once at startup and then advanced
 * locally — a TV that has been powered off for a month often boots with a badly
 * drifted RTC, and the wall should not be the thing that is wrong.
 */

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MAX_AGENDA_ITEMS = 6;

export class TimePanel {
  constructor({ time, day, zone, calendar, agenda }) {
    this.timeEl = time;
    this.dayEl = day;
    this.zoneEl = zone;
    this.calendarEl = calendar;
    this.agendaEl = agenda;

    this.timezone = undefined;
    this.offsetMs = 0;
    this.events = [];
    this.renderedDay = null;
  }

  configure(config, now) {
    this.timezone = config?.timezone || undefined;
    if (now?.iso) {
      const serverNow = new Date(now.iso).getTime();
      if (!Number.isNaN(serverNow)) this.offsetMs = serverNow - Date.now();
    }
    this.zoneEl.textContent = shortZone(this.timezone);
  }

  setAgenda(agenda) {
    this.events = agenda?.events ?? [];
    this.renderAgenda();
    this.renderCalendar(this.now());
  }

  start() {
    this.tick();
    setInterval(() => this.tick(), 1000);
  }

  now() {
    return new Date(Date.now() + this.offsetMs);
  }

  tick() {
    const now = this.now();
    this.timeEl.textContent = now.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: this.timezone,
    });
    this.dayEl.textContent = now.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      timeZone: this.timezone,
    });

    // Repaint the month grid and agenda exactly once, when the date rolls over.
    const key = this.dateKey(now);
    if (key !== this.renderedDay) {
      this.renderedDay = key;
      this.renderCalendar(now);
      this.renderAgenda();
    }
  }

  dateKey(date) {
    return date.toLocaleDateString('en-CA', { timeZone: this.timezone });
  }

  /* ---------------------------------------------------------------- */
  /* Month grid                                                        */
  /* ---------------------------------------------------------------- */
  renderCalendar(now) {
    const todayKey = this.dateKey(now);
    const [year, month] = todayKey.split('-').map(Number);
    const first = new Date(Date.UTC(year, month - 1, 1));
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const leading = (first.getUTCDay() + 6) % 7; // Monday-first grid
    const eventDays = new Set(this.events.map((event) => event.date));

    const cells = DOW.map((label) => element('div', 'calendar__dow', label));

    const previousMonthDays = new Date(Date.UTC(year, month - 1, 0)).getUTCDate();
    for (let i = leading; i > 0; i -= 1) {
      cells.push(element('div', 'calendar__day calendar__day--muted', String(previousMonthDays - i + 1)));
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
      const key = `${year}-${pad(month)}-${pad(day)}`;
      const classes = ['calendar__day'];
      if (key === todayKey) classes.push('calendar__day--today');
      if (eventDays.has(key)) classes.push('calendar__day--has-events');
      const cell = element('div', classes.join(' '), String(day));
      if (key === todayKey) cell.setAttribute('aria-current', 'date');
      cells.push(cell);
    }

    // Fill the final week so the grid keeps a rectangular shape.
    const trailing = (7 - ((leading + daysInMonth) % 7)) % 7;
    for (let day = 1; day <= trailing; day += 1) {
      cells.push(element('div', 'calendar__day calendar__day--muted', String(day)));
    }

    this.calendarEl.replaceChildren(...cells);
  }

  /* ---------------------------------------------------------------- */
  /* Agenda list                                                       */
  /* ---------------------------------------------------------------- */
  renderAgenda() {
    const now = this.now();
    const upcoming = this.events
      .filter((event) => new Date(event.end) >= now)
      .slice(0, MAX_AGENDA_ITEMS);

    if (!upcoming.length) {
      const message = this.events.length
        ? 'Nothing else scheduled'
        : 'No calendar connected';
      this.agendaEl.replaceChildren(element('li', 'agenda__title', message));
      return;
    }

    this.agendaEl.replaceChildren(
      ...upcoming.map((event) => {
        const start = new Date(event.start);
        const live = start <= now && new Date(event.end) >= now;
        const item = element('li', `agenda__item${live ? ' agenda__item--now' : ''}`);

        const when = element('div', 'agenda__when');
        when.textContent = live
          ? 'Now'
          : event.all_day
            ? 'All day'
            : start.toLocaleTimeString(undefined, {
                hour: 'numeric',
                minute: '2-digit',
                timeZone: this.timezone,
              });
        when.append(element('span', 'agenda__day', this.dayLabel(start, now)));

        const body = element('div', 'agenda__title', event.title);
        if (event.location) body.append(element('span', 'agenda__where', event.location));

        item.append(when, body);
        return item;
      }),
    );
  }

  dayLabel(start, now) {
    const startKey = this.dateKey(start);
    const todayKey = this.dateKey(now);
    if (startKey === todayKey) return 'Today';

    const tomorrow = new Date(now.getTime() + 86400000);
    if (startKey === this.dateKey(tomorrow)) return 'Tomorrow';
    return start.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone: this.timezone,
    });
  }
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function shortZone(timezone) {
  try {
    const parts = new Intl.DateTimeFormat(undefined, {
      timeZone: timezone,
      timeZoneName: 'short',
    }).formatToParts(new Date());
    return parts.find((part) => part.type === 'timeZoneName')?.value ?? '';
  } catch {
    return '';
  }
}
