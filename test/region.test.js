'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  COUNTRY_OPTIONS, TIMEZONE_COUNTRY, detectCountry, AUTO_COUNTRY,
  REGION_CHANGED_EVENT, getStoredRegion, setStoredRegion, resolveRegion,
} = require('../public/region.ts');

// region.js reads a handful of global-scoped APIs live on every call (no module-level state of
// its own to reset between tests — see setPref/getPref's own equivalent note in prefs.js) —
// localStorage (via prefs.js), Intl.DateTimeFormat/Intl.Locale (detectCountry), and window
// (setStoredRegion's event broadcast). Each test stubs only what it needs and afterEach restores
// the real Intl.DateTimeFormat/Intl.Locale so no test leaks a stub into another.
function makeMemoryLocalStorage() {
  const store = new Map();
  return {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  };
}

const realDateTimeFormat = Intl.DateTimeFormat;
const realLocale = Intl.Locale;

// `timeZone: undefined` simulates Intl.DateTimeFormat itself throwing (unsupported), matching
// detectCountry's own try/catch around it.
function stubTimeZone(timeZone) {
  Intl.DateTimeFormat = timeZone === undefined
    ? function () { throw new Error('unsupported'); }
    : function () { return { resolvedOptions: () => ({ timeZone }) } };
}

// `region: undefined` simulates Intl.Locale itself throwing (unsupported/unparseable tag).
function stubLocaleRegion(region) {
  Intl.Locale = region === undefined
    ? function () { throw new Error('unparseable'); }
    : function () { return { maximize: () => ({ region }) } };
}

beforeEach(() => {
  global.localStorage = makeMemoryLocalStorage();
});

afterEach(() => {
  Intl.DateTimeFormat = realDateTimeFormat;
  Intl.Locale = realLocale;
  delete global.navigator;
  delete global.window;
});

// ── COUNTRY_OPTIONS / TIMEZONE_COUNTRY ──────────────────────────────────────────

test('COUNTRY_OPTIONS: includes the expected curated codes', () => {
  const codes = COUNTRY_OPTIONS.map(c => c.code);
  assert.deepEqual(codes, ['US', 'GB', 'DE', 'CA', 'AU', 'JP', 'BR', 'RU', 'TR', 'UA', 'AR', 'IN', 'CN', 'KR', 'MX']);
});

test('TIMEZONE_COUNTRY: maps a representative zone per country to a COUNTRY_OPTIONS code', () => {
  const validCodes = new Set(COUNTRY_OPTIONS.map(c => c.code));
  for (const code of Object.values(TIMEZONE_COUNTRY)) assert.ok(validCodes.has(code), code);
  assert.equal(TIMEZONE_COUNTRY['Europe/Paris'], 'DE');
  assert.equal(TIMEZONE_COUNTRY['Asia/Tokyo'], 'JP');
});

// ── detectCountry ────────────────────────────────────────────────────────────

test('detectCountry: resolves a known timezone directly, without consulting navigator.language', () => {
  stubTimeZone('Europe/Paris');
  stubLocaleRegion('US'); // would mislead if this were consulted — confirms timezone wins
  assert.equal(detectCountry(), 'DE');
});

test('detectCountry: falls back to navigator.language region when the timezone is unmapped', () => {
  stubTimeZone('Africa/Cairo'); // not in TIMEZONE_COUNTRY
  stubLocaleRegion('JP');
  global.navigator = { language: 'ja-JP' };
  assert.equal(detectCountry(), 'JP');
});

test('detectCountry: falls back to US when neither timezone nor language resolve to anything', () => {
  stubTimeZone('Africa/Cairo');
  stubLocaleRegion('ZZ'); // not one of COUNTRY_OPTIONS' codes
  global.navigator = { language: 'xx-ZZ' };
  assert.equal(detectCountry(), 'US');
});

test('detectCountry: falls back to US when Intl.DateTimeFormat and Intl.Locale both throw', () => {
  stubTimeZone(undefined);
  stubLocaleRegion(undefined);
  global.navigator = { language: 'en-US' };
  assert.equal(detectCountry(), 'US');
});

test('detectCountry: falls back to language when Intl.DateTimeFormat itself throws', () => {
  stubTimeZone(undefined);
  stubLocaleRegion('DE');
  global.navigator = { language: 'de-DE' };
  assert.equal(detectCountry(), 'DE');
});

// ── getStoredRegion / setStoredRegion ────────────────────────────────────────

test('getStoredRegion: returns AUTO_COUNTRY when nothing was ever stored', () => {
  assert.equal(getStoredRegion(), AUTO_COUNTRY);
});

test('setStoredRegion/getStoredRegion: round-trips a real country code', () => {
  setStoredRegion('DE');
  assert.equal(getStoredRegion(), 'DE');
});

test('setStoredRegion/getStoredRegion: round-trips AUTO_COUNTRY itself', () => {
  setStoredRegion('DE');
  setStoredRegion(AUTO_COUNTRY);
  assert.equal(getStoredRegion(), AUTO_COUNTRY);
});

test('getStoredRegion: falls back to AUTO_COUNTRY for an unrecognized stored value', () => {
  global.localStorage.setItem('steam-common-games:prefs', JSON.stringify({ region: 'ZZ' }));
  assert.equal(getStoredRegion(), AUTO_COUNTRY);
});

test('setStoredRegion: dispatches REGION_CHANGED_EVENT on window with the new value', () => {
  const dispatched = [];
  global.window = { dispatchEvent: e => dispatched.push(e) };
  setStoredRegion('GB');
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].type, REGION_CHANGED_EVENT);
  assert.equal(dispatched[0].detail.region, 'GB');
});

test('setStoredRegion: never throws when window is undefined (Node/test environment)', () => {
  assert.doesNotThrow(() => setStoredRegion('GB'));
});

// ── resolveRegion ────────────────────────────────────────────────────────────

test('resolveRegion: passes a real country code straight through', () => {
  assert.equal(resolveRegion('DE'), 'DE');
});

test('resolveRegion: resolves AUTO_COUNTRY to a live detectCountry() result', () => {
  stubTimeZone('Asia/Tokyo');
  assert.equal(resolveRegion(AUTO_COUNTRY), 'JP');
});
