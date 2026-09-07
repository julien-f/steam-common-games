'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  cheapestTierPrice, fmtBundleDateTime, fmtBundleDatePart, fmtBundleTimePart, toBundleRow,
  bundleCovers, shopHue, bundleUrgency, bundleTierSummary, fmtBundleDateFriendly,
} = require('../public/bundleRows.ts');

const HOUR = 3600000;
const DAY = 24 * HOUR;

function withBanner(id) {
  return { assets: { boxart: `https://assets.example/${id}/boxart.jpg`, banner145: `https://assets.example/${id}/banner145.jpg` } };
}

function bundle(overrides = {}) {
  return {
    id: 1,
    title: 'A Bundle',
    page: { name: 'Fanatical' },
    counts: { games: 12 },
    publish: '2026-08-01T10:00:00+02:00',
    expiry: '2026-09-01T10:00:00+02:00',
    tiers: [{ price: { amount: 5, currency: 'USD' } }],
    ...overrides,
  };
}

// ── cheapestTierPrice ────────────────────────────────────────────────────────────────────────

test('cheapestTierPrice: picks the lowest-priced tier regardless of tier order', () => {
  const b = bundle({ tiers: [
    { price: { amount: 25, currency: 'EUR' } },
    { price: { amount: 5, currency: 'EUR' } },
    { price: { amount: 15, currency: 'EUR' } },
  ] });
  assert.deepEqual(cheapestTierPrice(b), { amount: 5, currency: 'EUR' });
});

test('cheapestTierPrice: null when no tier carries a price (a "Build Your Own" bundle)', () => {
  assert.equal(cheapestTierPrice(bundle({ tiers: [{ price: null }, { price: null }] })), null);
});

test('cheapestTierPrice: a real zero-amount tier is a price, not a missing one', () => {
  assert.deepEqual(cheapestTierPrice(bundle({ tiers: [{ price: { amount: 0, currency: 'USD' } }] })), { amount: 0, currency: 'USD' });
});

test('cheapestTierPrice: ignores priceless tiers alongside priced ones', () => {
  const b = bundle({ tiers: [{ price: null }, { price: { amount: 9, currency: 'USD' } }] });
  assert.deepEqual(cheapestTierPrice(b), { amount: 9, currency: 'USD' });
});

test('cheapestTierPrice: no tiers at all', () => {
  assert.equal(cheapestTierPrice(bundle({ tiers: [] })), null);
  assert.equal(cheapestTierPrice(bundle({ tiers: undefined })), null);
});

// ── fmtBundleDateTime ────────────────────────────────────────────────────────────────────────────

test('fmtBundleDateTime: formats an ITAD timestamp as its own local date and time', () => {
  // Deliberately an offset timestamp whose UTC date differs from its local one in a negative-
  // offset timezone: this is what `toISOString().slice(0, 10)` gets wrong.
  const iso = '2026-09-25T01:30:00+02:00';
  const expected = new Date(iso);
  const pad = n => String(n).padStart(2, '0');
  assert.equal(
    fmtBundleDateTime(iso),
    `${expected.getFullYear()}-${pad(expected.getMonth() + 1)}-${pad(expected.getDate())}`
      + ` ${pad(expected.getHours())}:${pad(expected.getMinutes())}`,
  );
});

test('fmtBundleDatePart / fmtBundleTimePart: the two halves the stacked cell renders', () => {
  const iso = '2026-09-25T01:30:00+02:00';
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, '0');
  assert.equal(fmtBundleDatePart(iso), `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  assert.equal(fmtBundleTimePart(iso), `${pad(d.getHours())}:${pad(d.getMinutes())}`);
  // Together they're exactly the flat form the column's own `format` (and so the table's search)
  // still returns.
  assert.equal(fmtBundleDateTime(iso), `${fmtBundleDatePart(iso)} ${fmtBundleTimePart(iso)}`);
});

test('fmtBundleTimePart: empty for a missing date, so the cell renders no second line at all', () => {
  for (const v of [null, undefined, '', 'not a date']) {
    assert.equal(fmtBundleTimePart(v), '');
    assert.equal(fmtBundleDatePart(v), '—');
    // No trailing space from an empty time half.
    assert.equal(fmtBundleDateTime(v), '—');
  }
});

test('fmtBundleDateTime: keeps the time that distinguishes two same-day bundles', () => {
  // The reason the time is shown at all: the table sorts on the full timestamp, so a pair of rows
  // both reading "2026-09-04" would otherwise look arbitrarily ordered.
  const early = fmtBundleDateTime('2026-09-04T16:55:38+02:00');
  const late = fmtBundleDateTime('2026-09-04T20:35:03+02:00');
  assert.notEqual(early, late);
  assert.ok(early < late, `${early} should render before ${late}`);
});

test('fmtBundleDateTime: missing/unparseable dates render as an em dash', () => {
  assert.equal(fmtBundleDateTime(null), '—');
  assert.equal(fmtBundleDateTime(undefined), '—');
  assert.equal(fmtBundleDateTime(''), '—');
  assert.equal(fmtBundleDateTime('not a date'), '—');
});

// ── bundleCovers ─────────────────────────────────────────────────────────────────────────────

test('bundleCovers: takes the first four banners in tier order', () => {
  const b = bundle({ tiers: [
    { price: { amount: 5, currency: 'USD' }, games: [withBanner('a'), withBanner('b')] },
    { price: { amount: 15, currency: 'USD' }, games: [withBanner('c'), withBanner('d'), withBanner('e')] },
  ] });
  assert.deepEqual(bundleCovers(b), [
    'https://assets.example/a/banner145.jpg',
    'https://assets.example/b/banner145.jpg',
    'https://assets.example/c/banner145.jpg',
    'https://assets.example/d/banner145.jpg',
  ]);
});

test('bundleCovers: dedupes a game listed in several tiers', () => {
  const b = bundle({ tiers: [
    { price: { amount: 5, currency: 'USD' }, games: [withBanner('a')] },
    { price: { amount: 15, currency: 'USD' }, games: [withBanner('a'), withBanner('b')] },
  ] });
  assert.deepEqual(bundleCovers(b), ['https://assets.example/a/banner145.jpg', 'https://assets.example/b/banner145.jpg']);
});

test('bundleCovers: skips games with no artwork rather than leaving a hole', () => {
  const b = bundle({ tiers: [{ price: null, games: [{ assets: {} }, { assets: null }, {}, withBanner('a')] }] });
  assert.deepEqual(bundleCovers(b), ['https://assets.example/a/banner145.jpg']);
});

test('bundleCovers: empty for a bundle with no games/tiers at all', () => {
  assert.deepEqual(bundleCovers(bundle({ tiers: [] })), []);
  assert.deepEqual(bundleCovers(bundle({ tiers: [{ price: null, games: null }] })), []);
});

test('bundleCovers: honors an explicit max', () => {
  const b = bundle({ tiers: [{ price: null, games: [withBanner('a'), withBanner('b'), withBanner('c')] }] });
  assert.equal(bundleCovers(b, 2).length, 2);
});

// ── fmtBundleDateFriendly ────────────────────────────────────────────────────────────────────

// Pinned to one locale here so the assertions are stable wherever the suite runs; the app itself
// passes no locale, so a viewer gets their own conventions (field order, month name, 12h vs 24h).
test('fmtBundleDateFriendly: locale-formatted, with the time only when asked', () => {
  const iso = '2026-09-25T20:00:00Z';
  const now = Date.parse('2026-09-07T12:00:00Z');
  const d = new Date(iso);
  assert.equal(
    fmtBundleDateFriendly(iso, { now, locale: 'en-US' }),
    d.toLocaleString('en-US', { month: 'short', day: 'numeric' }),
  );
  assert.equal(
    fmtBundleDateFriendly(iso, { time: true, now, locale: 'en-US' }),
    d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
  );
});

test('fmtBundleDateFriendly: shows the year only when it is not the current one', () => {
  const now = Date.parse('2026-09-07T12:00:00Z');
  assert.ok(!fmtBundleDateFriendly('2026-09-25T20:00:00Z', { now, locale: 'en-US' }).includes('2026'));
  assert.ok(fmtBundleDateFriendly('2024-12-31T20:00:00Z', { now, locale: 'en-US' }).includes('2024'));
});

test('fmtBundleDateFriendly: follows the given locale rather than a hardcoded format', () => {
  const iso = '2026-09-25T20:00:00Z';
  const now = Date.parse('2026-09-07T12:00:00Z');
  const us = fmtBundleDateFriendly(iso, { time: true, now, locale: 'en-US' });
  const fr = fmtBundleDateFriendly(iso, { time: true, now, locale: 'fr-FR' });
  assert.notEqual(us, fr, 'two locales with different month names/clocks should not format alike');
});

test('fmtBundleDateFriendly: missing/unparseable dates render as an em dash', () => {
  for (const v of [null, undefined, '', 'not a date']) {
    assert.equal(fmtBundleDateFriendly(v, { locale: 'en-US' }), '—');
  }
});

// ── bundleTierSummary ────────────────────────────────────────────────────────────────────────

test('bundleTierSummary: one entry per tier, in order, with that tier\'s own game count', () => {
  const b = bundle({ tiers: [
    { price: { amount: 5, currency: 'USD' }, games: [withBanner('a')] },
    { price: { amount: 15, currency: 'USD' }, games: [withBanner('a'), withBanner('b'), withBanner('c')] },
  ] });
  assert.deepEqual(bundleTierSummary(b), [
    { price: 5, currency: 'USD', gameCount: 1 },
    // Deliberately not deduped against the cheaper tier: a pricier tier includes everything below
    // it, and the card presents these as tiers, not as a partition that should sum to the total.
    { price: 15, currency: 'USD', gameCount: 3 },
  ]);
});

test('bundleTierSummary: a pick-and-mix tier keeps a null price (rendered "Varies", never Free)', () => {
  const b = bundle({ tiers: [{ price: null, games: [withBanner('a')] }] });
  assert.deepEqual(bundleTierSummary(b), [{ price: null, currency: null, gameCount: 1 }]);
});

test('bundleTierSummary: a real zero-amount tier is a price, not a missing one', () => {
  const b = bundle({ tiers: [{ price: { amount: 0, currency: 'EUR' }, games: [] }] });
  assert.deepEqual(bundleTierSummary(b), [{ price: 0, currency: 'EUR', gameCount: 0 }]);
});

test('bundleTierSummary: empty for a bundle with no tiers', () => {
  assert.deepEqual(bundleTierSummary(bundle({ tiers: [] })), []);
  assert.deepEqual(bundleTierSummary(bundle({ tiers: undefined })), []);
});

// ── shopHue ──────────────────────────────────────────────────────────────────────────────────

test('shopHue: deterministic, and in range for every shop name seen live', () => {
  for (const name of ['Humble Bundle', 'Fanatical', 'GreenManGaming', 'GreenMan Gaming', 'IndieGala', 'Itch.io', 'Digiphile', '']) {
    const hue = shopHue(name);
    assert.equal(hue, shopHue(name), `${name} must hash consistently`);
    assert.ok(Number.isInteger(hue) && hue >= 0 && hue < 360, `${name} hue out of range: ${hue}`);
  }
});

test('shopHue: different shops get different hues (no collision among the live shop names)', () => {
  const names = ['Humble Bundle', 'Fanatical', 'GreenManGaming', 'IndieGala', 'Itch.io', 'Digiphile'];
  assert.equal(new Set(names.map(shopHue)).size, names.length);
});

// ── bundleUrgency ────────────────────────────────────────────────────────────────────────────

test('bundleUrgency: tiers by how much time is left', () => {
  const now = Date.parse('2026-09-07T12:00:00Z');
  const at = ms => new Date(now + ms).toISOString();
  assert.deepEqual(bundleUrgency(at(-HOUR), now), { tier: 'ended', label: 'ended' });
  // Inside the last day the label counts hours — that's the window where 20h vs 2h changes what
  // you do about it.
  assert.deepEqual(bundleUrgency(at(20 * 60000), now), { tier: 'urgent', label: '<1h' });
  assert.deepEqual(bundleUrgency(at(6 * HOUR), now), { tier: 'urgent', label: 'in 6h' });
  // Floored, never rounded up: 90 minutes left is "in 1h", not "in 2h".
  assert.deepEqual(bundleUrgency(at(90 * 60000), now), { tier: 'urgent', label: 'in 1h' });
  assert.deepEqual(bundleUrgency(at(23 * HOUR), now), { tier: 'urgent', label: 'in 23h' });
  // Past 24h it's whole days again — "in 30h" is no more actionable and harder to read.
  assert.deepEqual(bundleUrgency(at(30 * HOUR), now), { tier: 'urgent', label: 'in 1d' });
  assert.deepEqual(bundleUrgency(at(4 * DAY), now), { tier: 'soon', label: 'in 4d' });
  // Past a week out the date alone carries it — no label, so it renders as nothing.
  assert.deepEqual(bundleUrgency(at(20 * DAY), now), { tier: 'later', label: '' });
});

test('bundleUrgency: no expiry (open-ended bundle) and unparseable dates are not urgency at all', () => {
  assert.equal(bundleUrgency(null), null);
  assert.equal(bundleUrgency(undefined), null);
  assert.equal(bundleUrgency(''), null);
  assert.equal(bundleUrgency('not a date'), null);
});

// ── toBundleRow ──────────────────────────────────────────────────────────────────────────────

test('toBundleRow: flattens every field the table sorts/filters/groups on', () => {
  const b = bundle({ tiers: [{ price: { amount: 5, currency: 'USD' }, games: [withBanner('a')] }] });
  const row = toBundleRow(b, Date.parse('2026-08-15T00:00:00Z'));
  assert.deepEqual(row, {
    id: 1,
    title: 'A Bundle',
    shop: 'Fanatical',
    games: 12,
    tierCount: 1,
    price: 5,
    currency: 'USD',
    publish: '2026-08-01T10:00:00+02:00',
    expiry: '2026-09-01T10:00:00+02:00',
    status: 'Active',
    covers: ['https://assets.example/a/banner145.jpg'],
  });
});

test('toBundleRow: status is Expired once the expiry is in the past', () => {
  const b = bundle({ expiry: '2026-09-01T10:00:00+02:00' });
  assert.equal(toBundleRow(b, Date.parse('2026-09-02T00:00:00Z')).status, 'Expired');
  assert.equal(toBundleRow(b, Date.parse('2026-08-31T00:00:00Z')).status, 'Active');
});

test('toBundleRow: a bundle with no expiry at all counts as Active', () => {
  assert.equal(toBundleRow(bundle({ expiry: null }), Date.now()).status, 'Active');
});

test('toBundleRow: a priceless bundle keeps null price/currency (rendered "Varies", never Free)', () => {
  const row = toBundleRow(bundle({ tiers: [{ price: null }, { price: null }] }), Date.now());
  assert.equal(row.price, null);
  assert.equal(row.currency, null);
  assert.equal(row.tierCount, 2);
});

test('toBundleRow: missing shop/game count become null rather than empty strings or 0', () => {
  const row = toBundleRow(bundle({ page: null, counts: null }), Date.now());
  assert.equal(row.shop, null);
  assert.equal(row.games, null);
});
