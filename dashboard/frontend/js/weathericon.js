/**
 * Inline SVG weather icons, chosen from the NWS short-forecast text and whether
 * it's daytime. Monochrome (they paint with currentColor), self-contained, and
 * legible at wall distance — no external image fetches.
 *
 * The markup is a set of constant, developer-authored strings; weatherIcon()
 * parses one into a fresh <svg> node to append. No user input touches this.
 */

const CLOUD = '<g fill="currentColor"><circle cx="26" cy="24" r="10"/><circle cx="38" cy="20" r="12"/><rect x="20" y="24" width="28" height="10" rx="5"/></g>';

const ICONS = {
  'clear-day':
    '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round">' +
    '<circle cx="32" cy="32" r="12" fill="currentColor" stroke="none"/>' +
    '<line x1="32" y1="6" x2="32" y2="14"/><line x1="32" y1="50" x2="32" y2="58"/>' +
    '<line x1="6" y1="32" x2="14" y2="32"/><line x1="50" y1="32" x2="58" y2="32"/>' +
    '<line x1="13" y1="13" x2="19" y2="19"/><line x1="45" y1="45" x2="51" y2="51"/>' +
    '<line x1="51" y1="13" x2="45" y2="19"/><line x1="19" y1="45" x2="13" y2="51"/></svg>',
  'clear-night':
    '<svg viewBox="0 0 64 64"><path d="M40 12a20 20 0 1 0 12 36 24 24 0 0 1-12-36z" fill="currentColor"/></svg>',
  'partly-day':
    '<svg viewBox="0 0 64 64">' +
    '<g stroke="currentColor" stroke-width="3" stroke-linecap="round">' +
    '<circle cx="24" cy="22" r="8" fill="currentColor" stroke="none"/>' +
    '<line x1="24" y1="6" x2="24" y2="11"/><line x1="8" y1="22" x2="13" y2="22"/>' +
    '<line x1="12" y1="10" x2="15.5" y2="13.5"/><line x1="36" y1="10" x2="32.5" y2="13.5"/></g>' +
    '<g fill="currentColor"><circle cx="30" cy="40" r="10"/><circle cx="42" cy="36" r="12"/>' +
    '<rect x="24" y="42" width="28" height="10" rx="5"/></g></svg>',
  'partly-night':
    '<svg viewBox="0 0 64 64"><path d="M22 12a12 12 0 1 0 8 21 15 15 0 0 1-8-21z" fill="currentColor"/>' +
    '<g fill="currentColor"><circle cx="34" cy="40" r="10"/><circle cx="44" cy="37" r="12"/>' +
    '<rect x="28" y="42" width="28" height="10" rx="5"/></g></svg>',
  cloudy: `<svg viewBox="0 0 64 64">${CLOUD}</svg>`,
  rain:
    `<svg viewBox="0 0 64 64">${CLOUD}` +
    '<g stroke="currentColor" stroke-width="3.5" stroke-linecap="round">' +
    '<line x1="24" y1="42" x2="21" y2="52"/><line x1="34" y1="42" x2="31" y2="52"/>' +
    '<line x1="44" y1="42" x2="41" y2="52"/></g></svg>',
  storm:
    `<svg viewBox="0 0 64 64">${CLOUD}` +
    '<polygon points="34,38 25,52 32,52 27,62 43,44 35,44 39,38" fill="currentColor"/></svg>',
  snow:
    `<svg viewBox="0 0 64 64">${CLOUD}` +
    '<g stroke="currentColor" stroke-width="3" stroke-linecap="round">' +
    '<line x1="26" y1="44" x2="26" y2="54"/><line x1="21" y1="49" x2="31" y2="49"/>' +
    '<line x1="41" y1="42" x2="41" y2="52"/><line x1="36" y1="47" x2="46" y2="47"/></g></svg>',
  fog:
    '<svg viewBox="0 0 64 64" stroke="currentColor" stroke-width="4" stroke-linecap="round">' +
    '<line x1="20" y1="14" x2="44" y2="14"/><line x1="12" y1="26" x2="52" y2="26"/>' +
    '<line x1="16" y1="38" x2="48" y2="38"/><line x1="12" y1="50" x2="52" y2="50"/></svg>',
  wind:
    '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round">' +
    '<path d="M8 24h30a7 7 0 1 0-7-7"/><path d="M8 36h40a7 7 0 1 1-7 7"/>' +
    '<path d="M8 48h22a6 6 0 1 1-6 6"/></svg>',
};

function iconKey(short, isDaytime) {
  const s = (short || '').toLowerCase();
  if (/thunder|storm|t-storm|lightning/.test(s)) return 'storm';
  if (/snow|sleet|flurr|ice|wintry|blizzard/.test(s)) return 'snow';
  if (/rain|shower|drizzle/.test(s)) return 'rain';
  if (/fog|haze|mist|smoke/.test(s)) return 'fog';
  if (/partly|mostly sunny|partly sunny|mostly clear|partly cloudy/.test(s)) {
    return isDaytime ? 'partly-day' : 'partly-night';
  }
  if (/cloud|overcast/.test(s)) return 'cloudy';
  if (/sunny|clear|fair|hot/.test(s)) return isDaytime ? 'clear-day' : 'clear-night';
  if (/wind|breez/.test(s)) return 'wind';
  return 'cloudy';
}

/** The colour group behind an icon key: drops the -day/-night suffix so the CSS
 *  can tint by condition (storm amber, rain blue, clear gold, …). */
function conditionGroup(key) {
  return key.replace(/-(day|night)$/, '');
}

export function weatherIcon(short, isDaytime, { size = 'lg' } = {}) {
  const key = iconKey(short, isDaytime);
  const markup = ICONS[key] || ICONS.cloudy;
  // Parse through an HTML <template> (not DOMParser/importNode) so the SVG is
  // namespaced and laid out like any inline SVG — the imported-XML path renders
  // but collapses to 0×0 as a flex item. Markup is a constant, not user input.
  const template = document.createElement('template');
  template.innerHTML = markup;
  const node = template.content.firstElementChild.cloneNode(true);
  // Base sizing class, a size modifier, and a condition class for the colour.
  node.setAttribute('class', `weather__icon weather__icon--${size} wx-${conditionGroup(key)}`);
  node.setAttribute('aria-hidden', 'true');
  return node;
}
