'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { levenshtein, stringSimilarity, getHLTB, buildSearchTerms, _resetAuth } = require('../lib/hltb');

// ── levenshtein ───────────────────────────────────────────────────────────

test('levenshtein: identical strings', () => {
  assert.equal(levenshtein('portal', 'portal'), 0);
});

test('levenshtein: both empty', () => {
  assert.equal(levenshtein('', ''), 0);
});

test('levenshtein: one empty', () => {
  assert.equal(levenshtein('abc', ''), 3);
  assert.equal(levenshtein('', 'abc'), 3);
});

test('levenshtein: one substitution', () => {
  assert.equal(levenshtein('cat', 'bat'), 1);
});

test('levenshtein: one insertion', () => {
  assert.equal(levenshtein('cat', 'cart'), 1);
});

test('levenshtein: one deletion', () => {
  assert.equal(levenshtein('cart', 'cat'), 1);
});

test('levenshtein: classic example', () => {
  assert.equal(levenshtein('kitten', 'sitting'), 3);
});

// ── stringSimilarity ──────────────────────────────────────────────────────

test('stringSimilarity: identical strings', () => {
  assert.equal(stringSimilarity('Portal 2', 'Portal 2'), 1);
});

test('stringSimilarity: both empty', () => {
  assert.equal(stringSimilarity('', ''), 1);
});

test('stringSimilarity: case-insensitive', () => {
  assert.equal(stringSimilarity('Portal', 'portal'), 1);
});

test('stringSimilarity: trims whitespace', () => {
  assert.equal(stringSimilarity('  Portal  ', 'Portal'), 1);
});

test('stringSimilarity: completely different strings score low', () => {
  const sim = stringSimilarity('aaa', 'zzz');
  assert.ok(sim < 0.4, `expected < 0.4 but got ${sim}`);
});

test('stringSimilarity: similar game names score above 0.4 threshold', () => {
  // "Portal 2" vs "Portal" — close enough to match
  const sim = stringSimilarity('Portal 2', 'Portal');
  assert.ok(sim >= 0.4, `expected >= 0.4 but got ${sim}`);
});

test('stringSimilarity: uses longer string as denominator', () => {
  // sim('ab', 'abcde') should equal sim('abcde', 'ab') — symmetric via max
  const s1 = stringSimilarity('ab', 'abcde');
  const s2 = stringSimilarity('abcde', 'ab');
  assert.equal(s1, s2);
});

// ── buildSearchTerms ──────────────────────────────────────────────────────

test('buildSearchTerms: strips edition words from terms', () => {
  assert.deepEqual(buildSearchTerms('Portal 2: Definitive Edition'), ['Portal', '2']);
});

test('buildSearchTerms: strips punctuation from individual tokens', () => {
  assert.deepEqual(buildSearchTerms('Batman: Arkham Asylum'), ['Batman', 'Arkham', 'Asylum']);
});

test('buildSearchTerms: falls back to all tokens when every word is an edition word', () => {
  assert.deepEqual(buildSearchTerms('Definitive Edition'), ['Definitive', 'Edition']);
});

// ── getHLTB ───────────────────────────────────────────────────────────────

function makeInitResponse(token = 'tok', hpKey = 'k', hpVal = 'v') {
  return { ok: true, status: 200, json: async () => ({ token, hpKey, hpVal }) };
}

function makeSearchResponse(results) {
  return { ok: true, status: 200, json: async () => ({ data: results }) };
}

test('getHLTB: returns null for empty name', async () => {
  _resetAuth();
  const result = await getHLTB('');
  assert.equal(result, null);
});

test('getHLTB: returns null without fetching when name is only stripped symbols', async (t) => {
  _resetAuth();
  let fetchCalled = false;
  t.mock.method(globalThis, 'fetch', async () => { fetchCalled = true; });

  const result = await getHLTB('™®©');
  assert.equal(result, null);
  assert.equal(fetchCalled, false);
});

test('getHLTB: returns main and extra hours on match', async (t) => {
  _resetAuth();
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (url.includes('bleed/init')) return makeInitResponse();
    return makeSearchResponse([
      { game_id: 42, game_name: 'Portal 2', comp_main: 25200, comp_plus: 36000 }, // 7h, 10h
    ]);
  });

  const result = await getHLTB('Portal 2');
  assert.deepEqual(result, { id: 42, main: 7, extra: 10, completionist: null });
});

test('getHLTB: strips trademark symbols from query', async (t) => {
  _resetAuth();
  let capturedBody;
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    if (url.includes('bleed/init')) return makeInitResponse();
    capturedBody = JSON.parse(opts.body);
    return makeSearchResponse([
      { game_name: 'Hades', comp_main: 36000, comp_plus: 72000 },
    ]);
  });

  await getHLTB('Hades™');
  assert.deepEqual(capturedBody.searchTerms, ['Hades']);
});

test('getHLTB: returns null when best match is below 0.35 similarity', async (t) => {
  _resetAuth();
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (url.includes('bleed/init')) return makeInitResponse();
    return makeSearchResponse([
      { game_name: 'Zzzzz Totally Unrelated Game', comp_main: 3600, comp_plus: 7200 },
    ]);
  });

  const result = await getHLTB('Portal');
  assert.equal(result, null);
});

test('getHLTB: returns null when no results', async (t) => {
  _resetAuth();
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (url.includes('bleed/init')) return makeInitResponse();
    return makeSearchResponse([]);
  });

  const result = await getHLTB('Portal');
  assert.equal(result, null);
});

test('getHLTB: 401 does not set retry cooldown — init is retried immediately', async (t) => {
  _resetAuth();
  let initCalls = 0;
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (url.includes('bleed/init')) { initCalls++; return makeInitResponse(); }
    return { ok: false, status: 401 };
  });

  await assert.rejects(() => getHLTB('Portal'));
  assert.equal(initCalls, 1);

  // 401 clears the token but must not set the failure cooldown — init must be called again
  await assert.rejects(() => getHLTB('Portal'));
  assert.equal(initCalls, 2, 'init should be retried immediately after a 401, no cooldown');
});

test('getHLTB: throws and clears auth on 401', async (t) => {
  _resetAuth();
  let initCalls = 0;
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (url.includes('bleed/init')) { initCalls++; return makeInitResponse(); }
    return { ok: false, status: 401 };
  });

  await assert.rejects(() => getHLTB('Portal'));

  // On the next call, auth should have been cleared so init is called again
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (url.includes('bleed/init')) { initCalls++; return makeInitResponse(); }
    return makeSearchResponse([{ game_name: 'Portal', comp_main: 7200, comp_plus: 18000 }]);
  });
  await getHLTB('Portal');
  assert.equal(initCalls, 2, 'expected init to be called again after 401');
});

test('getHLTB: throws when init fails', async (t) => {
  _resetAuth();
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 503 }));

  await assert.rejects(() => getHLTB('Portal'), err => /auth unavailable/i.test(err.message));
});

test('getHLTB: skips init retry within 30s cooldown after failed init', async (t) => {
  _resetAuth();
  let initCalls = 0;
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (url.includes('bleed/init')) { initCalls++; return { ok: false, status: 503 }; }
    return makeSearchResponse([]);
  });

  await assert.rejects(() => getHLTB('Portal'));
  assert.equal(initCalls, 1);

  // Second call is within the 30s window — init must not be retried
  await assert.rejects(() => getHLTB('Portal'));
  assert.equal(initCalls, 1, 'init should not be retried within cooldown window');
  _resetAuth();
});

test('getHLTB: picks the best match by similarity, not first result', async (t) => {
  _resetAuth();
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (url.includes('bleed/init')) return makeInitResponse();
    return makeSearchResponse([
      { game_id: 1, game_name: 'Portal Stories: Mel', comp_main: 18000, comp_plus: 21600 }, // weaker match
      { game_id: 2, game_name: 'Portal',              comp_main:  7200, comp_plus: 14400 }, // exact match
    ]);
  });

  const result = await getHLTB('Portal');
  assert.deepEqual(result, { id: 2, main: 2, extra: 4, completionist: null }); // Portal's times, not Portal Stories
});
