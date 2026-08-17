'use strict';

// Force the in-memory DB regardless of how this file is invoked — `npm test`
// already does this via a shell-level `DB_FILE=`, but running this file
// directly (e.g. `node --test test/steam.test.js`, an IDE test runner) would
// otherwise fall through to default.env's DB_FILE=db.sqlite and let _reset()
// wipe the real cache. Must be set before requiring lib/cache.
process.env.DB_FILE = '';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveSteamId, getOwnedGames, getWishlist, getPlayerSummaries, getGameRating, getAppDetails, getSteamSpyTags, searchStoreGames, getProtonDbStatus, getGameSchema, getPlayerAchievements, getGlobalAchievementPercentages, getGameNews } = require('../lib/steam');
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
  _reset();
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 503 }));
  await assert.rejects(() => getGameRating(400), err => err.isUpstream === true);
});

test('getGameRating: returns null when there are no reviews', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async () => makeReviewResponse(0, 0));
  const result = await getGameRating(400);
  assert.equal(result, null);
});

test('getGameRating: returns correct shape', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async () => makeReviewResponse(1000, 900, 'Very Positive'));
  const result = await getGameRating(400);
  assert.equal(typeof result.score, 'number');
  assert.equal(result.desc, 'Very Positive');
  assert.equal(result.positive, 900);
  assert.equal(result.total, 1000);
});

test('getGameRating: Wilson score is lower than raw ratio', async (t) => {
  // Wilson score accounts for uncertainty, so it's always below pos/total
  _reset();
  t.mock.method(globalThis, 'fetch', async () => makeReviewResponse(1000, 900, 'Very Positive'));
  const result = await getGameRating(400);
  const rawRatio = Math.round((900 / 1000) * 100); // 90
  assert.ok(result.score < rawRatio, `expected Wilson score ${result.score} < raw ratio ${rawRatio}`);
});

test('getGameRating: score is within valid range', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async () => makeReviewResponse(1000, 900, 'Very Positive'));
  const result = await getGameRating(400);
  assert.ok(result.score >= 0 && result.score <= 100, `score out of range: ${result.score}`);
});

test('getGameRating: higher positive ratio yields higher score', async (t) => {
  _reset();
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
  _reset();
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

// ── getWishlist ───────────────────────────────────────────────────────────────

test('getWishlist: fetches and returns wishlist items', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    json: async () => ({ response: { items: [{ appid: 400, priority: 1, date_added: 1433965886 }] } }),
  }));

  const items = await getWishlist('76561198000000001');
  assert.equal(items.length, 1);
  assert.equal(items[0].appid, 400);
});

test('getWishlist: caches result — second call skips fetch', async (t) => {
  _reset();
  let fetchCount = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    fetchCount++;
    return { ok: true, json: async () => ({ response: { items: [] } }) };
  });

  await getWishlist('76561198000000002');
  await getWishlist('76561198000000002');
  assert.equal(fetchCount, 1, 'second call should be served from cache');
});

test('getWishlist: throws with isUpstream when Steam API returns non-ok', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 503 }));

  await assert.rejects(
    () => getWishlist('76561198000000003'),
    err => err.isUpstream === true
  );
});

test('getWishlist: returns empty array (does not throw) when response has no items field', async (t) => {
  // Private wishlist, private profile, and a genuinely empty wishlist are all
  // indistinguishable — all return `{"response":{}}`. Unlike getOwnedGames,
  // getWishlist must not throw here, since there's no way to tell them apart.
  _reset();
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    json: async () => ({ response: {} }),
  }));

  const items = await getWishlist('76561198000000004');
  assert.deepEqual(items, []);
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

test('getPlayerSummaries: forceIds bypasses the cache for only the listed accounts', async (t) => {
  _reset();
  const ID_A = '76561198000000009';
  const ID_B = '76561198000000010';
  let fetchCount = 0;
  // Each call returns a fresh personaname for whichever IDs were actually requested,
  // so we can tell from the result which accounts were re-fetched vs. served from cache.
  t.mock.method(globalThis, 'fetch', async (url) => {
    fetchCount++;
    const requested = new URL(url).searchParams.get('steamids').split(',');
    return { ok: true, json: async () => ({ response: { players:
      requested.map(id => ({ steamid: id, personaname: `fetch${fetchCount}-${id}`, profileurl: '' })),
    } }) };
  });

  await getPlayerSummaries([ID_A, ID_B]); // primes the cache for both
  assert.equal(fetchCount, 1);

  const result = await getPlayerSummaries([ID_A, ID_B], { forceIds: new Set([ID_A]) });
  assert.equal(fetchCount, 2, 'only the forced account should trigger a re-fetch');
  assert.equal(result.find(p => p.steamid === ID_A).personaname, `fetch2-${ID_A}`, 'forced account gets fresh data');
  assert.equal(result.find(p => p.steamid === ID_B).personaname, `fetch1-${ID_B}`, 'non-forced account is still served from cache');
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
  _reset();
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 503 }));
  await assert.rejects(() => getAppDetails(400), err => err.isUpstream === true);
});

test('getGameRating: retries on 429 and succeeds on third attempt', async (t) => {
  _reset();
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
  _reset();
  t.mock.method(globalThis, 'fetch', async () => make429Response());
  await assert.rejects(
    () => getGameRating(400),
    err => err.isUpstream === true && /rate limited/.test(err.message)
  );
});

test('getAppDetails: retries on 429 and succeeds on third attempt', async (t) => {
  _reset();
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
  _reset();
  t.mock.method(globalThis, 'fetch', async () => makeAppDetailsResponse(400, null));
  assert.equal(await getAppDetails(400), null);
});

test('getAppDetails: returns genres, categories, developers and publishers', async (t) => {
  _reset();
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

test('getAppDetails: dedupes genres/categories that share the same label but different ids', async (t) => {
  // Real-world case (app 3357650): Steam lists distinct ids 55/56 both labeled "DualShock
  // Controller Support" and 57/58 both "DualSense Controller Support" — since only the label
  // is ever displayed, the duplicate id is never meaningful and shouldn't render as a
  // repeated pill/table entry.
  _reset();
  t.mock.method(globalThis, 'fetch', async () => makeAppDetailsResponse(400, {
    genres:     [{ id: '1', description: 'Action' }, { id: '2', description: 'Action' }],
    categories: [
      { id: 55, description: 'DualShock Controller Support' },
      { id: 56, description: 'DualShock Controller Support' },
      { id: 57, description: 'DualSense Controller Support' },
    ],
    developers: ['Valve'],
    publishers: ['Valve'],
  }));
  const result = await getAppDetails(400);
  assert.deepEqual(result.genres,     ['Action']);
  assert.deepEqual(result.categories, ['DualShock Controller Support', 'DualSense Controller Support']);
});

test('getAppDetails: handles missing optional fields with empty arrays', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async () => makeAppDetailsResponse(400, {}));
  assert.deepEqual(await getAppDetails(400), { name: null, genres: [], categories: [], developers: [], publishers: [], description: null, releaseDate: null, comingSoon: false, metacritic: null, capsule: 'https://cdn.akamai.steamstatic.com/steam/apps/400/capsule_sm_120.jpg', banner: 'https://cdn.akamai.steamstatic.com/steam/apps/400/header.jpg', movies: [], screenshots: [] });
});

test('getAppDetails: extracts name field', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async () => makeAppDetailsResponse(400, { name: 'Portal' }));
  const result = await getAppDetails(400);
  assert.equal(result.name, 'Portal');
});

test('getAppDetails: uses capsule_imagev5 when present', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async () => makeAppDetailsResponse(400, {
    capsule_imagev5: 'https://cdn.akamai.steamstatic.com/steam/apps/400/capsule_231x87.jpg',
    capsule_image:   'https://cdn.akamai.steamstatic.com/steam/apps/400/capsule_sm_120.jpg',
  }));
  const result = await getAppDetails(400);
  assert.equal(result.capsule, 'https://cdn.akamai.steamstatic.com/steam/apps/400/capsule_231x87.jpg');
});

test('getAppDetails: comingSoon reflects release_date.coming_soon', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async () => makeAppDetailsResponse(400, {
    release_date: { coming_soon: true, date: 'Oct 14, 2026' },
  }));
  const result = await getAppDetails(400);
  assert.equal(result.comingSoon, true);
  assert.equal(result.releaseDate, 'Oct 14, 2026');
});

test('getAppDetails: falls back to capsule_image when capsule_imagev5 is absent', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async () => makeAppDetailsResponse(400, {
    capsule_image: 'https://cdn.akamai.steamstatic.com/steam/apps/400/capsule_sm_120.jpg',
  }));
  const result = await getAppDetails(400);
  assert.equal(result.capsule, 'https://cdn.akamai.steamstatic.com/steam/apps/400/capsule_sm_120.jpg');
});

test('getAppDetails: falls back to constructed sm_120 URL when no capsule fields present', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async () => makeAppDetailsResponse(400, {}));
  const result = await getAppDetails(400);
  assert.equal(result.capsule, 'https://cdn.akamai.steamstatic.com/steam/apps/400/capsule_sm_120.jpg');
});

test('getAppDetails: uses header_image for the panel hero banner when present', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async () => makeAppDetailsResponse(400, {
    header_image: 'https://cdn.akamai.steamstatic.com/steam/apps/400/header_real.jpg',
  }));
  const result = await getAppDetails(400);
  assert.equal(result.banner, 'https://cdn.akamai.steamstatic.com/steam/apps/400/header_real.jpg');
});

test('getAppDetails: falls back to constructed header.jpg URL when header_image is absent', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async () => makeAppDetailsResponse(400, {}));
  const result = await getAppDetails(400);
  assert.equal(result.banner, 'https://cdn.akamai.steamstatic.com/steam/apps/400/header.jpg');
});

test('getAppDetails: extracts movies with hls field', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async () => makeAppDetailsResponse(400, {
    movies: [
      { id: 1, name: 'Trailer', thumbnail: 'https://example.com/thumb.jpg', hls_h264: 'https://example.com/vid.m3u8', highlight: true },
      { id: 2, name: 'Gameplay', thumbnail: 'https://example.com/thumb2.jpg', highlight: false },
    ],
  }));
  const result = await getAppDetails(400);
  assert.equal(result.movies.length, 2);
  assert.equal(result.movies[0].thumbnail, 'https://example.com/thumb.jpg');
  assert.equal(result.movies[0].hls, 'https://example.com/vid.m3u8');
  assert.equal(result.movies[1].hls, null);
});

test('getAppDetails: caps movies at 5', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async () => makeAppDetailsResponse(400, {
    movies: Array.from({ length: 8 }, (_, i) => ({ id: i, name: `T${i}`, thumbnail: '', hls_h264: `https://example.com/${i}.m3u8` })),
  }));
  const result = await getAppDetails(400);
  assert.equal(result.movies.length, 5);
});

// ── getSteamSpyTags ───────────────────────────────────────────────────────────

test('getSteamSpyTags: returns top 10 tags sorted by vote count descending', async (t) => {
  _reset();
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
  _reset();
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    json: async () => ({ tags: { 'RPG': 500, 'Action': 9000, 'Indie': 3000 } }),
  }));

  const result = await getSteamSpyTags(400);
  assert.deepEqual(result, ['Action', 'Indie', 'RPG']);
});

test('getSteamSpyTags: returns empty array when tags field is missing', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    json: async () => ({ appid: 400, name: 'Portal' }),
  }));

  const result = await getSteamSpyTags(400);
  assert.deepEqual(result, []);
});

test('getSteamSpyTags: returns empty array when tags is empty object', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    json: async () => ({ tags: {} }),
  }));

  const result = await getSteamSpyTags(400);
  assert.deepEqual(result, []);
});

test('getSteamSpyTags: throws isUpstream when fetch fails', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 503 }));
  await assert.rejects(() => getSteamSpyTags(400), err => err.isUpstream === true);
});

// ── getProtonDbStatus ──────────────────────────────────────────────────────────

test('getProtonDbStatus: returns tier, confidence and total', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    json: async () => ({ tier: 'gold', bestReportedTier: 'platinum', confidence: 'strong', score: 0.71, total: 2009, trendingTier: 'platinum' }),
  }));

  const result = await getProtonDbStatus(400);
  assert.deepEqual(result, { tier: 'gold', confidence: 'strong', total: 2009 });
});

// A 404 means "ProtonDB has no reports for this appid" — not an upstream failure —
// same treatment as getGameRating's "no reviews yet" case.
test('getProtonDbStatus: returns null on 404 (no reports for this appid)', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 404 }));
  const result = await getProtonDbStatus(999999999);
  assert.equal(result, null);
});

// "pending" means too few reports for ProtonDB to confidently assign a tier — not a
// compatibility outcome, so it carries the same actionable information as no rating at all.
// Collapsed to null here rather than passed through, so the side panel/Library Explorer never
// have to special-case a tier that isn't a real point on the quality scale the others represent.
test('getProtonDbStatus: treats a "pending" tier as no rating (returns null)', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    json: async () => ({ tier: 'pending', confidence: 'low', total: 2 }),
  }));
  const result = await getProtonDbStatus(400);
  assert.equal(result, null);
});

test('getProtonDbStatus: throws isUpstream for a non-404 error', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 503 }));
  await assert.rejects(() => getProtonDbStatus(400), err => err.isUpstream === true);
});

test('getProtonDbStatus: caches result — second call skips fetch', async (t) => {
  _reset();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return { ok: true, json: async () => ({ tier: 'platinum', confidence: 'strong', total: 10 }) };
  });

  await getProtonDbStatus(400);
  await getProtonDbStatus(400);
  assert.equal(calls, 1);
});

test('getProtonDbStatus: caches the null result of a 404 too', async (t) => {
  _reset();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return { ok: false, status: 404 }; });

  await getProtonDbStatus(400);
  await getProtonDbStatus(400);
  assert.equal(calls, 1);
});

// ── searchStoreGames ──────────────────────────────────────────────────────────

test('searchStoreGames: extracts appid, name and tinyImage, capped at 8', async (t) => {
  _reset();
  const items = Array.from({ length: 12 }, (_, i) => ({
    id: 400 + i, name: `Game ${i}`, tiny_image: `https://example.com/${i}.jpg`,
  }));
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ items }) }));

  const result = await searchStoreGames('portal');
  assert.equal(result.length, 8);
  assert.deepEqual(result[0], { appid: 400, name: 'Game 0', tinyImage: 'https://example.com/0.jpg' });
});

test('searchStoreGames: returns empty array when items field is missing', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({}) }));
  assert.deepEqual(await searchStoreGames('xyz'), []);
});

test('searchStoreGames: tinyImage is null when absent', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true, json: async () => ({ items: [{ id: 400, name: 'Portal' }] }),
  }));
  assert.deepEqual(await searchStoreGames('portal'), [{ appid: 400, name: 'Portal', tinyImage: null }]);
});

test('searchStoreGames: caches result — second call skips fetch', async (t) => {
  _reset();
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => ({
    ok: true, json: async () => ({ items: [{ id: 400, name: 'Portal' }] }),
  }));
  await searchStoreGames('portal');
  await searchStoreGames('portal');
  assert.equal(fetchMock.mock.callCount(), 1);
});

test('searchStoreGames: cache key is case-insensitive', async (t) => {
  _reset();
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => ({
    ok: true, json: async () => ({ items: [{ id: 400, name: 'Portal' }] }),
  }));
  await searchStoreGames('Portal');
  await searchStoreGames('PORTAL');
  assert.equal(fetchMock.mock.callCount(), 1);
});

test('searchStoreGames: throws isUpstream when fetch fails', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 503 }));
  await assert.rejects(() => searchStoreGames('portal'), err => err.isUpstream === true);
});

// ── getGameSchema ─────────────────────────────────────────────────────────────

test('getGameSchema: extracts achievement fields', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    json: async () => ({
      game: { availableGameStats: { achievements: [
        { name: 'ACH_WIN', displayName: 'Winner', description: 'Win a match', icon: 'a.jpg', icongray: 'a_gray.jpg', hidden: 0 },
      ] } },
    }),
  }));
  const result = await getGameSchema(400);
  assert.deepEqual(result, [{ apiname: 'ACH_WIN', name: 'Winner', description: 'Win a match', icon: 'a.jpg', icongray: 'a_gray.jpg', hidden: false }]);
});

test('getGameSchema: returns empty array when game has no achievements', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ game: {} }) }));
  assert.deepEqual(await getGameSchema(400), []);
});

test('getGameSchema: caches result — second call skips fetch', async (t) => {
  _reset();
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ game: {} }) }));
  await getGameSchema(400);
  await getGameSchema(400);
  assert.equal(fetchMock.mock.callCount(), 1);
});

test('getGameSchema: throws isUpstream when fetch fails', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 503 }));
  await assert.rejects(() => getGameSchema(400), err => err.isUpstream === true);
});

// ── getPlayerAchievements ─────────────────────────────────────────────────────

test('getPlayerAchievements: extracts achieved state and unlocktime', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    json: async () => ({ playerstats: { success: true, achievements: [
      { apiname: 'ACH_WIN', achieved: 1, unlocktime: 1700000000 },
      { apiname: 'ACH_LOSE', achieved: 0, unlocktime: 0 },
    ] } }),
  }));
  const result = await getPlayerAchievements('7656119123456789', 400);
  assert.deepEqual(result, [
    { apiname: 'ACH_WIN', achieved: true, unlocktime: 1700000000 },
    { apiname: 'ACH_LOSE', achieved: false, unlocktime: 0 },
  ]);
});

test('getPlayerAchievements: returns null (not throw) on 400 — game has no stats', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 400 }));
  assert.equal(await getPlayerAchievements('7656119123456789', 400), null);
});

test('getPlayerAchievements: returns null (not throw) on 403 — private profile', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 403 }));
  assert.equal(await getPlayerAchievements('7656119123456789', 400), null);
});

test('getPlayerAchievements: returns null when success is false', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ playerstats: { success: false } }) }));
  assert.equal(await getPlayerAchievements('7656119123456789', 400), null);
});

test('getPlayerAchievements: throws isUpstream for a non-400/403 error', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 503 }));
  await assert.rejects(() => getPlayerAchievements('7656119123456789', 400), err => err.isUpstream === true);
});

test('getPlayerAchievements: caches result — second call skips fetch', async (t) => {
  _reset();
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => ({
    ok: true, json: async () => ({ playerstats: { success: true, achievements: [] } }),
  }));
  await getPlayerAchievements('7656119123456789', 400);
  await getPlayerAchievements('7656119123456789', 400);
  assert.equal(fetchMock.mock.callCount(), 1);
});

// ── getGlobalAchievementPercentages ──────────────────────────────────────────

test('getGlobalAchievementPercentages: maps apiname to percent as a number', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    json: async () => ({ achievementpercentages: { achievements: [
      { name: 'PORTAL_GET_PORTALGUNS', percent: '80.9' },
      { name: 'PORTAL_LONGJUMP', percent: '14.1' },
    ] } }),
  }));
  const result = await getGlobalAchievementPercentages(400);
  assert.deepEqual(result, { PORTAL_GET_PORTALGUNS: 80.9, PORTAL_LONGJUMP: 14.1 });
});

test('getGlobalAchievementPercentages: returns null (not throw) on 403 — no stats or unknown appid', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 403 }));
  assert.equal(await getGlobalAchievementPercentages(400), null);
});

test('getGlobalAchievementPercentages: throws isUpstream for a non-403 error', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 503 }));
  await assert.rejects(() => getGlobalAchievementPercentages(400), err => err.isUpstream === true);
});

test('getGlobalAchievementPercentages: caches result — second call skips fetch', async (t) => {
  _reset();
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => ({
    ok: true, json: async () => ({ achievementpercentages: { achievements: [] } }),
  }));
  await getGlobalAchievementPercentages(400);
  await getGlobalAchievementPercentages(400);
  assert.equal(fetchMock.mock.callCount(), 1);
});

// ── getGameNews ────────────────────────────────────────────────────────────────

test('getGameNews: extracts title, url, date and feedLabel, capped at 20', async (t) => {
  _reset();
  const newsitems = Array.from({ length: 25 }, (_, i) => ({
    gid: String(i), title: `Update ${i}`, url: `https://store.steampowered.com/news/app/400/view/${i}`,
    date: 1700000000 + i, feedlabel: 'Community Announcements', feedname: 'steam_community_announcements', contents: 'ignored',
  }));
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true, json: async () => ({ appnews: { appid: 400, newsitems, count: 25 } }),
  }));

  const result = await getGameNews(400);
  assert.equal(result.length, 20);
  assert.deepEqual(result[0], {
    title: 'Update 0', url: 'https://store.steampowered.com/news/app/400/view/0',
    date: 1700000000, feedLabel: 'Community Announcements',
  });
});

test('getGameNews: filters out syndicated third-party press, keeping only steam_community_announcements', async (t) => {
  _reset();
  const newsitems = [
    { title: 'Пресса на русском', url: 'https://x/1', date: 1700000002, feedlabel: 'Gamemag.ru', feedname: 'Gamemag.ru' },
    { title: 'RPS coverage', url: 'https://x/2', date: 1700000001, feedlabel: 'Rock, Paper, Shotgun', feedname: 'Rock, Paper, Shotgun' },
    { title: 'Official patch notes', url: 'https://x/3', date: 1700000000, feedlabel: 'Community Announcements', feedname: 'steam_community_announcements' },
  ];
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true, json: async () => ({ appnews: { newsitems } }),
  }));

  const result = await getGameNews(400);
  assert.equal(result.length, 1);
  assert.equal(result[0].title, 'Official patch notes');
});

test('getGameNews: returns empty array when newsitems is missing', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true, json: async () => ({ appnews: { appid: 400, count: 0 } }),
  }));
  assert.deepEqual(await getGameNews(400), []);
});

test('getGameNews: feedLabel is null when absent', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    json: async () => ({ appnews: { newsitems: [{ title: 'Update', url: 'https://x/1', date: 1700000000, feedname: 'steam_community_announcements' }] } }),
  }));
  const result = await getGameNews(400);
  assert.equal(result[0].feedLabel, null);
});

test('getGameNews: throws isUpstream when fetch fails', async (t) => {
  _reset();
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 503 }));
  await assert.rejects(() => getGameNews(400), err => err.isUpstream === true);
});

test('getGameNews: caches result — second call skips fetch', async (t) => {
  _reset();
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => ({
    ok: true, json: async () => ({ appnews: { newsitems: [] } }),
  }));
  await getGameNews(400);
  await getGameNews(400);
  assert.equal(fetchMock.mock.callCount(), 1);
});

