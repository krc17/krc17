/**
 * Date, time, month calendar and the next few calendar events.
 *
 * The clock is anchored to the server's time once at startup and then advanced
 * locally — a TV that has been powered off for a month often boots with a badly
 * drifted RTC, and the wall should not be the thing that is wrong.
 *
 * The month grid does double duty. Compact, each day is a number with a dot
 * when it has events. Expanded (the panel's ⤢ button), the same cells grow and
 * show event chips inline, so the full screen is a real month view. Tapping any
 * day of the current month opens a sheet with that day's schedule — a tap is
 * the only gesture here, so there is nothing to disambiguate.
 */

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MAX_AGENDA_ITEMS = 6;
const MAX_CHIPS_PER_DAY = 3;
// The wall's eight categorical slots. A calendar's colour is its slot, by the
// order it is configured; more than eight wraps rather than inventing hues.
const PALETTE_SLOTS = 8;

/** CSS colour for a calendar index, or null when there is nothing to colour. */
function calColor(index) {
  if (index === undefined || index === null) return null;
  return `var(--series-${(index % PALETTE_SLOTS) + 1})`;
}

export class TimePanel {
  constructor({ time, day, zone, calendar, calendarNav, agenda, legend, status, daySheet }) {
    this.timeEl = time;
    this.dayEl = day;
    this.zoneEl = zone;
    this.calendarEl = calendar;
    this.navEl = calendarNav;
    this.titleEl = calendarNav?.querySelector('[data-cal-label]') ?? null;
    this.todayBtn = calendarNav?.querySelector('[data-cal-today]') ?? null;
    this.agendaEl = agenda;
    this.legendEl = legend;
    this.statusEl = status;
    this.daySheet = daySheet;

    this.timezone = undefined;
    this.offsetMs = 0;
    this.events = [];
    this.calendars = [];
    this.renderedDay = null;
    // Which month the grid is showing. Null until the first render, then it
    // tracks whatever month the user has paged to; the agenda list stays
    // anchored to real "now" regardless.
    this.viewYear = null;
    this.viewMonth = null;

    this.#bindDayInteraction();
    this.#bindMonthNav();
    this.#bindSheet();
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
    this.calendars = agenda?.calendars ?? [];
    this.calStatus = {
      configured: agenda?.configured ?? false,
      error: agenda?.error ?? null,
      fetchedAt: agenda?.fetched_at ?? null,
    };
    this.renderLegend();
    this.renderStatus();
    this.renderAgenda();
    this.renderCalendar(this.now());
    // A day sheet left open should reflect a fresh calendar pull.
    if (this.openDayKey) this.openDay(this.openDayKey);
  }

  /**
   * A quiet feed is worse than a blank one: the wall keeps showing last week's
   * schedule and people trust it. When the server reports a fetch error, say so
   * on the wall -- with how long ago the data was actually good -- so a stale
   * calendar reads as stale, not current.
   */
  renderStatus() {
    if (!this.statusEl) return;
    const status = this.calStatus ?? {};
    if (!status.configured || !status.error) {
      this.statusEl.hidden = true;
      this.statusEl.textContent = '';
      return;
    }
    const since = status.fetchedAt ? ` · last updated ${this.#ago(status.fetchedAt)}` : '';
    this.statusEl.textContent = `⚠ ${status.error}${since}`;
    this.statusEl.hidden = false;
  }

  /** Compact, wall-legible relative age: "just now", "12 min ago", "3 h ago". */
  #ago(iso) {
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return 'a while ago';
    const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours} h ago`;
    const days = Math.round(hours / 24);
    return days === 1 ? 'yesterday' : `${days} days ago`;
  }

  /** A small keyed legend, shown only when more than one calendar is joined. */
  renderLegend() {
    if (!this.legendEl) return;
    if (this.calendars.length < 2) {
      this.legendEl.hidden = true;
      this.legendEl.replaceChildren();
      return;
    }
    this.legendEl.hidden = false;
    this.legendEl.replaceChildren(
      ...this.calendars.map((cal) => {
        const item = element('li', 'calendar-legend__item');
        const dot = element('span', 'calendar-legend__dot');
        dot.style.background = calColor(cal.index) ?? 'var(--series-1)';
        item.append(dot, element('span', 'calendar-legend__name', cal.name || 'Calendar'));
        return item;
      }),
    );
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

    // Repaint the agenda and grid exactly once, when the date rolls over. The
    // grid only follows the rollover while it is showing the current month --
    // if the user has paged to another month, leave it where they put it.
    const key = this.dateKey(now);
    if (key !== this.renderedDay) {
      this.renderedDay = key;
      if (this.#isCurrentView(now)) this.renderCalendar(now);
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
    // First render adopts the current month; after that the grid shows whatever
    // month the user has paged to.
    if (this.viewYear == null) {
      const [ty, tm] = todayKey.split('-').map(Number);
      this.viewYear = ty;
      this.viewMonth = tm;
    }
    const year = this.viewYear;
    const month = this.viewMonth;

    const first = new Date(Date.UTC(year, month - 1, 1));
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const leading = (first.getUTCDay() + 6) % 7; // Monday-first grid
    const byDay = this.#eventsByDay();

    const cells = DOW.map((label) => element('div', 'calendar__dow', label));

    const previousMonthDays = new Date(Date.UTC(year, month - 1, 0)).getUTCDate();
    for (let i = leading; i > 0; i -= 1) {
      cells.push(this.#mutedCell(previousMonthDays - i + 1));
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
      const key = `${year}-${pad(month)}-${pad(day)}`;
      cells.push(this.#dayCell(day, key, key === todayKey, byDay.get(key) ?? []));
    }

    // Fill the final week so the grid keeps a rectangular shape.
    const trailing = (7 - ((leading + daysInMonth) % 7)) % 7;
    for (let day = 1; day <= trailing; day += 1) {
      cells.push(this.#mutedCell(day));
    }

    this.calendarEl.replaceChildren(...cells);
    this.#renderMonthLabel(now);
  }

  /* ---------------------------------------------------------------- */
  /* Month navigation                                                  */
  /* ---------------------------------------------------------------- */
  #bindMonthNav() {
    if (!this.navEl) return;
    this.navEl.addEventListener('click', (event) => {
      if (event.target.closest('[data-cal-prev]')) this.shiftMonth(-1);
      else if (event.target.closest('[data-cal-next]')) this.shiftMonth(1);
      else if (event.target.closest('[data-cal-today]')) this.goToday();
    });
  }

  shiftMonth(delta) {
    if (this.viewYear == null) this.renderCalendar(this.now());
    let month = this.viewMonth + delta;
    let year = this.viewYear;
    while (month < 1) { month += 12; year -= 1; }
    while (month > 12) { month -= 12; year += 1; }
    this.viewMonth = month;
    this.viewYear = year;
    this.renderCalendar(this.now());
  }

  goToday() {
    const [ty, tm] = this.dateKey(this.now()).split('-').map(Number);
    this.viewYear = ty;
    this.viewMonth = tm;
    this.renderCalendar(this.now());
  }

  #isCurrentView(now) {
    if (this.viewYear == null) return true;
    const [ty, tm] = this.dateKey(now).split('-').map(Number);
    return this.viewYear === ty && this.viewMonth === tm;
  }

  #renderMonthLabel(now) {
    if (this.titleEl) {
      const label = new Date(Date.UTC(this.viewYear, this.viewMonth - 1, 1))
        .toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
      this.titleEl.textContent = label;
    }
    // "Today" only makes sense as a way back when you have paged away.
    if (this.todayBtn) this.todayBtn.hidden = this.#isCurrentView(now);
  }

  #mutedCell(number) {
    const cell = element('div', 'calendar__day calendar__day--muted');
    cell.append(element('span', 'calendar__num', String(number)));
    return cell;
  }

  /** A current-month cell: interactive, with a dot (compact) and chips (expanded). */
  #dayCell(day, key, isToday, events) {
    const classes = ['calendar__day'];
    if (isToday) classes.push('calendar__day--today');
    if (events.length) classes.push('calendar__day--has-events');

    const cell = element('div', classes.join(' '));
    cell.dataset.date = key;
    cell.tabIndex = 0;
    cell.setAttribute('role', 'button');
    cell.setAttribute(
      'aria-label',
      `${this.#longDate(key)}${events.length ? `, ${events.length} event${events.length === 1 ? '' : 's'}` : ', no events'}`,
    );
    if (isToday) cell.setAttribute('aria-current', 'date');

    cell.append(element('span', 'calendar__num', String(day)));

    if (events.length) {
      const list = element('div', 'calendar__events');
      events.slice(0, MAX_CHIPS_PER_DAY).forEach((event) => {
        const chip = element('span', `calendar__event${event.in_progress ? ' is-now' : ''}`);
        this.#tintByCalendar(chip, event);
        if (!event.all_day) chip.append(element('span', 'calendar__event-time', this.#time(event.start)));
        chip.append(document.createTextNode(event.title));
        list.append(chip);
      });
      if (events.length > MAX_CHIPS_PER_DAY) {
        list.append(element('span', 'calendar__more', `+${events.length - MAX_CHIPS_PER_DAY} more`));
      }
      cell.append(list);
    }
    return cell;
  }

  /* ---------------------------------------------------------------- */
  /* Day schedule sheet                                                */
  /* ---------------------------------------------------------------- */
  #bindDayInteraction() {
    this.calendarEl.addEventListener('click', (event) => {
      const cell = event.target.closest('.calendar__day[data-date]');
      if (cell) this.openDay(cell.dataset.date);
    });
    this.calendarEl.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const cell = event.target.closest('.calendar__day[data-date]');
      if (!cell) return;
      event.preventDefault();
      this.openDay(cell.dataset.date);
    });
  }

  #bindSheet() {
    if (!this.daySheet) return;
    this.daySheet.addEventListener('click', (event) => {
      if (event.target === this.daySheet || event.target.closest('[data-day-close]')) {
        this.closeDay();
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !this.daySheet.hidden) {
        // stopImmediatePropagation, not stopPropagation: the panel-collapse
        // Escape handler is another listener on document, and only the
        // "immediate" form stops siblings on the same element. Without it,
        // one Escape would both close this sheet and collapse the panel.
        event.stopImmediatePropagation();
        this.closeDay();
      }
    });
  }

  openDay(key) {
    if (!this.daySheet) return;
    this.openDayKey = key;
    const now = this.now();
    const dayEvents = this.#eventsByDay().get(key) ?? [];

    const panel = element('div', 'sheet sheet--day');

    const head = element('div', 'day-sheet__head');
    head.append(element('h2', 'sheet__title', this.#longDate(key)));
    if (key === this.dateKey(now)) head.append(element('span', 'day-sheet__today', 'Today'));
    panel.append(head);

    if (!dayEvents.length) {
      panel.append(element('p', 'day-sheet__empty',
        this.events.length ? 'Nothing scheduled.' : 'No calendar connected.'));
    } else {
      const list = element('ol', 'day-schedule');
      dayEvents.forEach((event) => {
        const live = event.in_progress;
        const item = element('li', `day-event${live ? ' is-now' : ''}`);
        this.#tintByCalendar(item, event);

        const when = element('div', 'day-event__when');
        if (event.all_day) {
          when.textContent = 'All day';
        } else {
          when.textContent = this.#time(event.start);
          when.append(element('span', 'day-event__end', `– ${this.#time(event.end)}`));
        }

        const body = element('div', 'day-event__body');
        body.append(element('span', 'day-event__title', event.title));
        if (event.location) body.append(element('span', 'day-event__where', event.location));
        if (live) body.append(element('span', 'day-event__badge', 'In progress'));

        item.append(when, body);
        list.append(item);
      });
      panel.append(list);
    }

    const close = element('button', 'sheet__cancel', 'Close');
    close.type = 'button';
    close.dataset.dayClose = '';
    panel.append(close);

    this.daySheet.replaceChildren(panel);
    this.daySheet.hidden = false;
  }

  closeDay() {
    if (!this.daySheet) return;
    this.daySheet.hidden = true;
    this.openDayKey = null;
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
        this.#tintByCalendar(item, event);

        const when = element('div', 'agenda__when');
        when.textContent = live ? 'Now' : event.all_day ? 'All day' : this.#time(event.start);
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

  /* ---------------------------------------------------------------- */
  /* Helpers                                                           */
  /* ---------------------------------------------------------------- */
  #eventsByDay() {
    // Group by calendar date, all-day first then chronological, so both the
    // grid chips and the day sheet read in the order the day happens.
    const map = new Map();
    for (const event of this.events) {
      if (!map.has(event.date)) map.set(event.date, []);
      map.get(event.date).push(event);
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        if (a.all_day !== b.all_day) return a.all_day ? -1 : 1;
        return new Date(a.start) - new Date(b.start);
      });
    }
    return map;
  }

  /**
   * Mark an event element with its calendar's colour. Only when more than one
   * calendar is joined -- a single calendar needs no key, so the wall stays
   * calm and the colour means "which calendar", nothing else.
   */
  #tintByCalendar(node, event) {
    if (this.calendars.length < 2) return;
    const color = calColor(event.cal_index);
    if (color) {
      node.style.setProperty('--cal', color);
      node.classList.add('has-cal');
    }
  }

  #time(iso) {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: this.timezone,
    });
  }

  #longDate(key) {
    // Build from the key at noon UTC so the weekday never slips a day.
    const date = new Date(`${key}T12:00:00Z`);
    return date.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',
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
