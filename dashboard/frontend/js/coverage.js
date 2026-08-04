/**
 * Daily area-coverage board: area columns, one engineer card per person.
 *
 * Deliberately the same shape and drag mechanics as the project board -- an
 * engineer card is dragged from one area column to another -- but a card here
 * carries only a name, because "who is on this area today" is the whole story.
 */

import { relativeTime } from './documents.js';

const board = document.getElementById('coverage-board');
const foot = document.getElementById('coverage-foot');

/** Each area gets a stable categorical colour, by its column order. */
const AREA_SLOTS = [
  'var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)',
  'var(--series-5)', 'var(--series-6)', 'var(--series-7)', 'var(--series-8)',
];

let current = null;

export function getAreas() {
  return current?.areas ?? [];
}

export function renderCoverage(data) {
  if (!board || !data) return;
  current = data;

  const areas = data.areas ?? [];
  const engineers = data.engineers ?? [];

  if (!areas.length) {
    board.replaceChildren(emptyBoard());
    renderFoot(data);
    return;
  }

  board.replaceChildren(
    ...areas.map((area, index) => {
      // "Off / Unassigned" reads as not-covering, so it gets a muted accent
      // rather than a categorical colour that would imply an area like the rest.
      const accent = isOff(area) ? 'var(--muted)' : AREA_SLOTS[index % AREA_SLOTS.length];
      const here = engineers.filter((person) => person.area === area);

      const column = element('section', 'column column--coverage');
      column.dataset.column = area;
      column.style.setProperty('--card-accent', accent);

      const head = element('div', 'column__head');
      head.append(
        element('span', 'column__name', area),
        element('span', 'column__count', String(here.length)),
      );

      const list = element('div', 'column__cards');
      if (here.length) {
        list.append(...here.map((person) => renderCard(person, accent)));
      } else {
        list.append(element('p', 'column__empty', 'No one assigned'));
      }

      column.append(head, list);
      return column;
    }),
  );
  renderFoot(data);
}

function renderCard(person, accent) {
  const node = element('article', 'card card--coverage');
  node.dataset.cardId = person.name;
  node.tabIndex = 0;
  node.setAttribute('role', 'button');
  node.setAttribute('aria-label', `${person.name}, covering ${person.area}. Drag to reassign.`);
  node.style.setProperty('--card-accent', accent);

  const badge = element('span', 'avatar avatar--lg', initials(person.name));
  badge.style.setProperty('--avatar', accent);
  node.append(badge, element('span', 'card--coverage__name', person.name));
  return node;
}

function renderFoot(data) {
  if (!foot) return;
  const parts = [];
  if (data.updated_at) parts.push(`Coverage set ${relativeTime(data.updated_at)}`);
  if (data.errors?.length) parts.push(`⚠ ${data.errors.join('; ')}`);
  foot.textContent = parts.join(' · ');
}

function emptyBoard() {
  const wrapper = element('div', 'empty');
  wrapper.append(element('p', 'empty__headline', 'No coverage loaded'));
  const hint = element(
    'p',
    'empty__hint',
    'Add coverage.yaml in the coverage folder — it lists the areas and who is on each today.',
  );
  hint.append(document.createElement('br'), element('span', 'empty__path', 'data\\coverage\\coverage.yaml'));
  wrapper.append(hint);
  return wrapper;
}

/* ------------------------------------------------------------------ */
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function isOff(area) {
  return /off|unassigned/i.test(area);
}

function initials(name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
