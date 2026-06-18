'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveSteamId, getOwnedGames, getPlayerSummaries, getGameRating, getAppDetails, getSteamSpyTags } = require('../lib/steam');
const { _reset } = require('../lib/cache');

function makeReviewResponse(total, positive, desc = 'Very Positive') {
  return {
    ok: true,
    json: async () => ({
      query_summary: { total_reviews: total, total_positive: positive, review_score_desc: desc },
    }),
  };
}

test('getGameRating: throws when fetch fails', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 503 }));
  await assert.rejects(() => getGameRating(400), err => err.isUpstream === true);
});

test('getGameRating: returns null when there are no reviews', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => makeReviewResponse(0, 0));
  const result = await getGameRating(400);
  assert.equal(result, null);
});

test('getGameRating: returns correct shape', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => makeReviewResponse(1000, 900, 'Very Positive'));
  const result = await getGameRating(400);
  assert.equal(typeof result.score, 'number');
  assert.equal(result.desc, 'Very Positive');
  assert.equal(result.positive, 900);
  assert.equal(result.total, 1000);
});

test('getGameRating: Wilson score is lower than raw ratio', async (t) => {
  // Wilson score accounts for uncertainty, so it's always below pos/total
  t.mock.method(globalThis, 'fetch', async () => makeReviewResponse(1000, 900, 'Very Positive'));
  const result = await getGameRating(400);
  const rawRatio = Math.round((900 / 1000) * 100); // 90
  assert.ok(result.score < rawRatio, `expected Wilson score ${result.score} < raw ratio ${rawRatio}`);
});

test('getGameRating: score is within valid range', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => makeReviewResponse(1000, 900, 'Very Positive'));
  const result = await getGameRating(400);
  assert.ok(result.score >= 0 && result.score <= 100, `score out of range: ${result.score}`);
});

test('getGameRating: higher positive ratio yields higher score', async (t) => {
  let callCount = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    callCount++;
    return callCount === 1
      ? makeReviewResponse(1000, 600) // 60% positive
      : makeReviewResponse(1000, 900); // 90% positive
  });

  const low = await getGameRating(1);
  const high = await getGameRating(2);
  assert.ok(high.score > low.score, `expected ${high.score} > ${low.score}`);
});

test('getGameRating: more reviews tightens the confidence interval', async (t) => {
  // Same 80% ratio but 10 vs 10000 reviews — larger sample → score closer to raw ratio
  let callCount = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    callCount++;
    return callCount === 1
      ? makeReviewResponse(10, 8)       // 80% with few reviews
      : makeReviewResponse(10000, 8000); // 80% with many reviews
  });

  const fewReviews = await getGameRating(1);
  const manyReviews = await getGameRating(2);
  assert.ok(
    manyReviews.score > fewReviews.score,
    `expected larger sample score ${manyReviews.score} > small sample score ${fewReviews.score}`
  );
});

// ── resolveSteamId ────────────────────────────────────────────────────────────

test('resolveSteamId: returns Steam64 ID directly without fetching', async (t) => {
  _reset();
  let fetchCalled = false;
  t.mock.method(globalThis, 'fetch', async () => { fetchCalled = true; });

  const result = await resolveSteamId('76561198000000001');
  assert.equal(result, '76561198000000001');
  assert.equal(fetchCalled, false);
});

test('resolveSteamId: resolves vanity URL via Steam API', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    json: async () => ({ response: { success: 1, steamid: '76561198000000001' } }),
  }));

  const result = await resolveSteamId('gaben');
  assert.equal(result, '76561198000000001');
});

test('resolveSteamId: caches resolved ID — second call skips fetch', async (t) => {
  _reset();
  let fetchCount = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    fetchCount++;
    return { ok: true, json: async () => ({ response: { success: 1, steamid: '76561198000000001' } }) };
  });

  await resolveSteamId('gaben2');
  await resolveSteamId('gaben2');
  assert.equal(fetchCount, 1, 'second call should be served from cache');
});

test('resolveSteamId: throws with isUpstream when Steam API returns non-ok', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 503 }));

  await assert.rejects(
    () => resolveSteamId('gaben3'),
    err => err.isUpstream === true && /503/.test(err.message)
  );
});

test('resolveSteamId: throws user error when account is not found', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    json: async () => ({ response: { success: 42 } }),
  }));

  await assert.rejects(
    () => resolveSteamId('nobody'),
    err => !err.isUpstream && /Cannot find Steam account/.test(err.message)
  );
});

// ── getOwnedGames ─────────────────────────────────────────────────────────────

test('getOwnedGames: fetches and returns game list', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    json: async () => ({ response: { games: [{ appid: 400, name: 'Portal' }] } }),
  }));

  const games = await getOwnedGames('76561198000000001');
  assert.equal(games.length, 1);
  assert.equal(games[0].appid, 400);
});

test('getOwnedGames: caches result — second call skips fetch', async (t) => {
  _reset();
  let fetchCount = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    fetchCount++;
    return { ok: true, json: async () => ({ response: { games: [] } }) };
  });

  await getOwnedGames('76561198000000002');
  await getOwnedGames('76561198000000002');
  assert.equal(fetchCount, 1, 'second call should be served from cache');
});

test('getOwnedGames: throws with isUpstream when Steam API returns non-ok', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 503 }));

  await assert.rejects(
    () => getOwnedGames('76561198000000003'),
    err => err.isUpstream === true
  );
});

test('getOwnedGames: throws user error when library is private', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    json: async () => ({ response: {} }),  // no `games` field
  }));

  await assert.rejects(
    () => getOwnedGames('76561198000000004'),
    err => !err.isUpstream && /private/.test(err.message)
  );
});

// ── getPlayerSummaries ────────────────────────────────────────────────────────

test('getPlayerSummaries: fetches and returns player list', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    json: async () => ({ response: { players: [{ steamid: '76561198000000001', personaname: 'Alice' }] } }),
  }));

  const players = await getPlayerSummaries(['76561198000000001']);
  assert.equal(players.length, 1);
  assert.equal(players[0].personaname, 'Alice');
});

test('getPlayerSummaries: caches result — second call skips fetch', async (t) => {
  _reset();
  let fetchCount = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    fetchCount++;
    return { ok: true, json: async () => ({ response: { players: [{ steamid: '76561198000000005', personaname: 'User5', profileurl: '' }] } }) };
  });

  await getPlayerSummaries(['76561198000000005']);
  await getPlayerSummaries(['76561198000000005']);
  assert.equal(fetchCount, 1, 'second call should be served from cache');
});

test('getPlayerSummaries: returns placeholder players when API fails, does not cache', async (t) => {
  _reset();
  let fetchCount = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    fetchCount++;
    return { ok: false, status: 503 };
  });

  const ids = ['76561198000000006'];
  const result = await getPlayerSummaries(ids);
  assert.equal(result.length, 1);
  assert.equal(result[0].steamid, ids[0]);
  assert.equal(result[0].personaname, ids[0]);

  // Since failure result wasn't cached, next call hits the API again
  await getPlayerSummaries(ids);
  assert.equal(fetchCount, 2, 'fallback result must not be cached');
});

test('getPlayerSummaries: cache key is order-independent', async (t) => {
  _reset();
  let fetchCount = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    fetchCount++;
    return { ok: true, json: async () => ({ response: { players: [
      { steamid: '76561198000000007', personaname: 'User7', profileurl: '' },
      { steamid: '76561198000000008', personaname: 'User8', profileurl: '' },
    ] } }) };
  });

  await getPlayerSummaries(['76561198000000008', '76561198000000007']);
  await getPlayerSummaries(['76561198000000007', '76561198000000008']); // reversed order
  assert.equal(fetchCount, 1, 'reversed order should hit same cache entries');
});

// ── getAppDetails ─────────────────────────────────────────────────────────────

function makeAppDetailsResponse(appid, data = null) {
  const entry = data
    ? { success: true, data }
    : { success: false };
  return { ok: true, json: async () => ({ [String(appid)]: entry }) };
}

// Simulate a 429 response with a near-zero Retry-After so retries complete instantly in tests.
function make429Response() {
  return { ok: false, status: 429, headers: { get: h => h === 'retry-after' ? '0.001' : null } };
}

test('getAppDetails: throws when fetch fails', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 503 }));
  await assert.rejects(() => getAppDetails(400), err => err.isUpstream === true);
});

test('getGameRating: retries on 429 and succeeds on third attempt', async (t) => {
  let callCount = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    callCount++;
    return callCount < 3 ? make429Response() : makeReviewResponse(1000, 900, 'Very Positive');
  });
  const result = await getGameRating(400);
  assert.equal(callCount, 3);
  assert.equal(result.total, 1000);
});

test('getGameRating: throws isUpstream after exhausting 429 retries', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => make429Response());
  await assert.rejects(
    () => getGameRating(400),
    err => err.isUpstream === true && /rate limited/.test(err.message)
  );
});

test('getAppDetails: retries on 429 and succeeds on third attempt', async (t) => {
  let callCount = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    callCount++;
    return callCount < 3
      ? make429Response()
      : makeAppDetailsResponse(400, { genres: [{ id: '1', description: 'Action' }], categories: [], developers: [], publishers: [] });
  });
  const result = await getAppDetails(400);
  assert.equal(callCount, 3);
  assert.deepEqual(result.genres, ['Action']);
});

test('getAppDetails: returns null when success is false', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => makeAppDetailsResponse(400, null));
  assert.equal(await getAppDetails(400), null);
});

test('getAppDetails: returns genres, categories, developers and publishers', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => makeAppDetailsResponse(400, {
    genres:     [{ id: '1', description: 'Action' }, { id: '25', description: 'Adventure' }],
    categories: [{ id: '9', description: 'Co-op' }],
    developers: ['Valve'],
    publishers: ['Valve'],
  }));
  const result = await getAppDetails(400);
  assert.deepEqual(result.genres,     ['Action', 'Adventure']);
  assert.deepEqual(result.categories, ['Co-op']);
  assert.deepEqual(result.developers, ['Valve']);
  assert.deepEqual(result.publishers, ['Valve']);
});

test('getAppDetails: handles missing optional fields with empty arrays', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => makeAppDetailsResponse(400, {}));
  assert.deepEqual(await getAppDetails(400), { genres: [], categories: [], developers: [], publishers: [], description: null, releaseDate: null });
});

// ── getSteamSpyTags ───────────────────────────────────────────────────────────

test('getSteamSpyTags: returns top 10 tags sorted by vote count descending', async (t) => {
  const rawTags = Object.fromEntries(
    Array.from({ length: 15 }, (_, i) => [`Tag${i}`, (15 - i) * 100])
  );
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    json: async () => ({ tags: rawTags }),
  }));

  const result = await getSteamSpyTags(400);
  assert.equal(result.length, 10);
  assert.equal(result[0], 'Tag0');   // highest votes first
  assert.equal(result[9], 'Tag9');
});

test('getSteamSpyTags: returns correct tag names in vote-count order', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    json: async () => ({ tags: { 'RPG': 500, 'Action': 9000, 'Indie': 3000 } }),
  }));

  const result = await getSteamSpyTags(400);
  assert.deepEqual(result, ['Action', 'Indie', 'RPG']);
});

test('getSteamSpyTags: returns empty array when tags field is missing', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    json: async () => ({ appid: 400, name: 'Portal' }),
  }));

  const result = await getSteamSpyTags(400);
  assert.deepEqual(result, []);
});

test('getSteamSpyTags: returns empty array when tags is empty object', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    json: async () => ({ tags: {} }),
  }));

  const result = await getSteamSpyTags(400);
  assert.deepEqual(result, []);
});

test('getSteamSpyTags: throws isUpstream when fetch fails', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 503 }));
  await assert.rejects(() => getSteamSpyTags(400), err => err.isUpstream === true);
});

