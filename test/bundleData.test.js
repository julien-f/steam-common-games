'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  flattenBundleGames, fetchBundleById, resolveBundleAppids, resolveBundleGames, fetchBundleAppids,
} = require('../public/bundleData.ts');

function withFetch(t, handler) {
  const restore = globalThis.fetch;
  globalThis.fetch = handler;
  t.after(() => { globalThis.fetch = restore; });
}

function game(id, title = id) {
  return { id, slug: id, title, type: 'game', assets: null };
}

// ── flattenBundleGames ───────────────────────────────────────────────────────────────────────

test('flattenBundleGames: flattens every tier\'s games into one list', () => {
  const bundle = {
    tiers: [
      { price: { amount: 500, currency: 'USD' }, games: [game('a')], addon: false },
      { price: { amount: 1000, currency: 'USD' }, games: [game('b')], addon: false },
    ],
  };
  const flat = flattenBundleGames(bundle);
  assert.deepEqual(flat.map(g => g.gid), ['a', 'b']);
});

test('flattenBundleGames: a game repeated across tiers is deduped, keeping the cheapest (first-seen) tier\'s price', () => {
  const bundle = {
    tiers: [
      { price: { amount: 500, currency: 'USD' }, games: [game('a')], addon: false },
      { price: { amount: 1500, currency: 'USD' }, games: [game('a'), game('b')], addon: false },
    ],
  };
  const flat = flattenBundleGames(bundle);
  assert.equal(flat.length, 2);
  const a = flat.find(g => g.gid === 'a');
  assert.equal(a.tierPrice, 500);
});

test('flattenBundleGames: a null tier price (e.g. a "Build Your Own" pick-and-mix tier) maps to null, not 0', () => {
  const bundle = { tiers: [{ price: null, games: [game('a')], addon: false }] };
  const flat = flattenBundleGames(bundle);
  assert.equal(flat[0].tierPrice, null);
  assert.equal(flat[0].tierCurrency, null);
});

test('flattenBundleGames: marks addon games from an addon tier', () => {
  const bundle = { tiers: [{ price: { amount: 100, currency: 'USD' }, games: [game('a')], addon: true }] };
  assert.equal(flattenBundleGames(bundle)[0].addon, true);
});

test('flattenBundleGames: no tiers at all yields an empty list', () => {
  assert.deepEqual(flattenBundleGames({ tiers: [] }), []);
});

// ── fetchBundleById ──────────────────────────────────────────────────────────────────────────

test('fetchBundleById: fetches GET /api/bundles/:id, with an optional country param, and unwraps the { bundle } response', async (t) => {
  let seenUrl;
  withFetch(t, async url => { seenUrl = url; return { ok: true, json: async () => ({ bundle: { id: 42, title: 'Bundle' } }) }; });

  const bundle = await fetchBundleById(42, { country: 'US' });
  assert.equal(seenUrl, '/api/bundles/42?country=US');
  assert.equal(bundle.id, 42);
});

test('fetchBundleById: no country param when omitted', async (t) => {
  let seenUrl;
  withFetch(t, async url => { seenUrl = url; return { ok: true, json: async () => ({ bundle: { id: 1 } }) }; });
  await fetchBundleById(1);
  assert.equal(seenUrl, '/api/bundles/1');
});

test('fetchBundleById: throws with the server error message on a non-2xx response', async (t) => {
  withFetch(t, async () => ({ ok: false, json: async () => ({ error: 'not found' }) }));
  await assert.rejects(() => fetchBundleById(999), /not found/);
});

// ── resolveBundleAppids ──────────────────────────────────────────────────────────────────────

test('resolveBundleAppids: posts gids, returns the gid->appid map as-is', async (t) => {
  let seenBody;
  withFetch(t, async (url, opts) => {
    seenBody = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ appids: { a: 440, b: null } }) };
  });

  const map = await resolveBundleAppids(['a', 'b']);
  assert.deepEqual(seenBody, { gids: ['a', 'b'] });
  assert.deepEqual(map, { a: 440, b: null });
});

test('resolveBundleAppids: throws with the server error message on a non-2xx response', async (t) => {
  withFetch(t, async () => ({ ok: false, json: async () => ({ error: 'resolution failed' }) }));
  await assert.rejects(() => resolveBundleAppids(['a']), /resolution failed/);
});

// ── resolveBundleGames ───────────────────────────────────────────────────────────────────────

test('resolveBundleGames: splits into resolved (with appid)/unresolved, preserving cheapest-tier order', async (t) => {
  const bundle = { tiers: [{ price: { amount: 500, currency: 'USD' }, games: [game('a'), game('b')], addon: false }] };
  withFetch(t, async () => ({ ok: true, json: async () => ({ appids: { a: 440, b: null } }) }));

  const { resolved, unresolved } = await resolveBundleGames(bundle);
  assert.deepEqual(resolved.map(g => g.appid), [440]);
  assert.deepEqual(unresolved.map(g => g.gid), ['b']);
});

test('resolveBundleGames: two distinct gids resolving to the same appid keep only the first occurrence', async (t) => {
  const bundle = { tiers: [{ price: { amount: 500, currency: 'USD' }, games: [game('a'), game('b')], addon: false }] };
  withFetch(t, async () => ({ ok: true, json: async () => ({ appids: { a: 440, b: 440 } }) }));

  const { resolved } = await resolveBundleGames(bundle);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].gid, 'a');
});

// ── fetchBundleAppids ────────────────────────────────────────────────────────────────────────

test('fetchBundleAppids: fetches the bundle, resolves it, returns just the flat appid Set', async (t) => {
  const calls = [];
  withFetch(t, async (url, opts) => {
    calls.push(url);
    if (url.startsWith('/api/bundles/42')) {
      return { ok: true, json: async () => ({ bundle: { id: 42, tiers: [{ price: null, games: [game('a')], addon: false }] } }) };
    }
    return { ok: true, json: async () => ({ appids: { a: 440 } }) };
  });

  const appids = await fetchBundleAppids('42');
  assert.deepEqual(appids, new Set([440]));
  assert.equal(calls[0], '/api/bundles/42');
});
