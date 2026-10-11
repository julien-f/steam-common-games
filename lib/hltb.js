'use strict';

const { getCached, setCache } = require('./cache');
const { trackedFetch } = require('./metrics');
const { UPSTREAM_MIN_INTERVAL_MS } = require('./config');
const { createCircuitBreaker } = require('./circuitBreaker');
const { SEMAPHORE_MAX_QUEUE, createSemaphore } = require('./upstream');

const HLTB_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const HLTB_BASE = 'https://howlongtobeat.com/';
const TIMEOUT_MS = 10000;

// Words stripped from search terms because HLTB uses strict AND matching and
// these words appear in Steam titles but not in HLTB's shorter canonical titles.
const EDITION_WORDS = new Set([
  'edition',
  'definitive',
  'goty',
  'complete',
  'ultimate',
  'enhanced',
  'remastered',
  'remake',
  'deluxe',
  'gold',
  'premium',
  'collection',
  'bundle',
]);

function normalizeText(s) {
  return s.normalize('NFD').replace(/\p{Mn}/gu, '');
}

function buildSearchTerms(query) {
  // Split on whitespace first, then further split each token on non-alphanumeric runs
  // so that "Bang-On" → ["Bang","On"] and "BIT.TRIP" → ["BIT","TRIP"] rather than
  // being merged into a single token that HLTB's AND search can't match.
  const all = normalizeText(query)
    .split(/\s+/)
    .flatMap((t) => t.split(/[^a-z0-9]+/gi))
    .filter(Boolean);
  const filtered = all.filter((t) => !EDITION_WORDS.has(t.toLowerCase()));
  return filtered.length > 0 ? filtered : all;
}

// Short-lived in-memory token cache (not persisted — tokens are session-bound)
let _hltbAuth = null;
let _hltbAuthTs = 0;
let _hltbAuthPromise = null;
let _hltbAuthFailedAt = 0;
const HLTB_AUTH_TTL_MS = 5 * 60 * 1000;
const HLTB_AUTH_RETRY_MS = 30 * 1000;

// Throttles the "[HLTB] search failed" warning below (not the searches themselves, which still
// each attempt and still each throw as before) — without it, a systemic outage/block mid-batch
// (auth still valid, but the search endpoint itself rejecting everything) would log one
// near-identical line per game in whatever library/comparison is loading, rather than one line
// making the same point repeatedly. Tracked separately from _hltbAuthFailedAt above: an
// auth-init failure and a mid-search rejection are different failure classes, and conflating
// them would suppress a genuine, distinct search-endpoint problem behind an unrelated
// already-throttled init failure (or vice versa).
let _hltbSearchWarnedAt = 0;
const HLTB_SEARCH_WARN_THROTTLE_MS = 30 * 1000;

const searchBreaker = createCircuitBreaker('hltb', 'HLTB');

// Concurrency cap, and UPSTREAM_MIN_INTERVAL_MS per slot — HLTB blocks aggressive scrapers
const hltbLimit = createSemaphore(3, UPSTREAM_MIN_INTERVAL_MS, SEMAPHORE_MAX_QUEUE, 'hltb');

async function _fetchHLTBAuth() {
  try {
    const res = await trackedFetch('hltb', 'auth', `${HLTB_BASE}api/search/site/init?t=${Date.now()}`, {
      headers: { 'User-Agent': HLTB_UA, Referer: HLTB_BASE },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      _hltbAuthFailedAt = Date.now();
      return null;
    }
    const data = await res.json();
    if (!data.token) {
      _hltbAuthFailedAt = Date.now();
      return null;
    }
    _hltbAuth = data;
    _hltbAuthTs = Date.now();
    _hltbAuthFailedAt = 0;
    return _hltbAuth;
  } catch (err) {
    _hltbAuthFailedAt = Date.now();
    console.warn('[HLTB] init failed:', err.message);
    return null;
  } finally {
    _hltbAuthPromise = null;
  }
}

async function getHLTBAuth() {
  if (_hltbAuth && Date.now() - _hltbAuthTs < HLTB_AUTH_TTL_MS) return _hltbAuth;
  if (Date.now() - _hltbAuthFailedAt < HLTB_AUTH_RETRY_MS) return null;
  if (!_hltbAuthPromise) _hltbAuthPromise = _fetchHLTBAuth();
  return _hltbAuthPromise;
}

function roundToHalfHour(seconds) {
  return Math.round(seconds / 1800) / 2;
}

// `query` is getHLTB's already-stripped name.
function pickBestMatch(data, query) {
  let best = null;
  let bestSim = -1;
  for (const e of data) {
    const sim = stringSimilarity(e.game_name, query);
    if (sim > bestSim) [best, bestSim] = [e, sim];
  }
  if (bestSim < 0.35) return null;

  return {
    id: best.game_id,
    // Rounded to the nearest half hour (not a whole hour) — the same granularity
    // HLTB's own site displays (e.g. "2½ Hours"), so we don't discard precision
    // their raw seconds figures actually carry.
    main: roundToHalfHour(best.comp_main),
    extra: roundToHalfHour(best.comp_plus),
    completionist: best.comp_100 ? roundToHalfHour(best.comp_100) : null,
    // "All PlayStyles" — the average of every individual completion-time submission
    // pooled together (not an average of the three category means above), weighted by
    // how many people submitted each category. Usually lands closer to Main Story than
    // to the other two, since far more players report a main-story time than a
    // completionist one.
    all: best.comp_all ? roundToHalfHour(best.comp_all) : null,
  };
}

async function getHLTB(appid, name, { force = false } = {}) {
  if (!name) return null;
  const query = name.replace(/[™®©]/g, '').trim();
  if (!query) return null;

  const cacheKey = `hltb:${appid}`;
  const hit = getCached(cacheKey, { force });
  if (hit !== undefined) return pickBestMatch(hit, query);

  searchBreaker.assertClosed();
  const auth = await getHLTBAuth();
  if (!auth) throw new Error('HLTB auth unavailable');

  try {
    return await hltbLimit(async () => {
      searchBreaker.assertClosed(); // again: it may have tripped while this search was queued
      const res = await trackedFetch('hltb', 'search', `${HLTB_BASE}api/search/site`, {
        method: 'POST',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': HLTB_UA,
          Referer: HLTB_BASE,
          'X-Auth-Token': auth.token,
          'X-Hp-Key': auth.hpKey,
          'X-Hp-Val': auth.hpVal,
        },
        body: JSON.stringify({
          [auth.hpKey]: auth.hpVal,
          searchType: 'games',
          searchTerms: buildSearchTerms(query),
          searchPage: 1,
          size: 5,
          searchOptions: {
            games: {
              userId: 0,
              platform: '',
              sortCategory: 'popular',
              rangeCategory: 'main',
              rangeTime: { min: 0, max: 0 },
              gameplay: { perspective: '', flow: '', genre: '', difficulty: '' },
              rangeYear: { min: '', max: '' },
              modifier: '',
            },
            users: { sortCategory: 'postcount' },
            lists: { sortCategory: 'follows' },
            filter: '',
            sort: 0,
            randomizer: 0,
          },
        }),
      });

      searchBreaker.record(res.status);
      // Token may have expired — clear it so the next call re-fetches. A 403 is more likely a
      // block, so it also holds off re-init for the retry window rather than once per game.
      if (res.status === 401 || res.status === 403) {
        _hltbAuth = null;
        if (res.status === 403) _hltbAuthFailedAt = Date.now();
        throw new Error(`HLTB auth rejected (${res.status})`);
      }
      if (!res.ok) throw new Error(`HLTB API error ${res.status}`);

      const { data } = await res.json();
      setCache(cacheKey, data || []);
      return pickBestMatch(data || [], query);
    });
  } catch (err) {
    if (Date.now() - _hltbSearchWarnedAt >= HLTB_SEARCH_WARN_THROTTLE_MS) {
      _hltbSearchWarnedAt = Date.now();
      console.warn(`[HLTB] search failed for "${query}":`, err.message);
    }
    throw err;
  }
}

function stringSimilarity(a, b) {
  a = normalizeText(a).toLowerCase().trim();
  b = normalizeText(b).toLowerCase().trim();
  const [longer, shorter] = a.length >= b.length ? [a, b] : [b, a];
  if (longer.length === 0) return 1;
  return (longer.length - levenshtein(longer, shorter)) / longer.length;
}

function levenshtein(a, b) {
  const m = a.length,
    n = b.length;
  const row = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = i;
    for (let j = 1; j <= n; j++) {
      const val = a[i - 1] === b[j - 1] ? row[j - 1] : 1 + Math.min(prev, row[j], row[j - 1]);
      row[j - 1] = prev;
      prev = val;
    }
    row[n] = prev;
  }
  return row[n];
}

function _resetAuth() {
  _hltbAuth = null;
  _hltbAuthTs = 0;
  _hltbAuthPromise = null;
  _hltbAuthFailedAt = 0;
  _hltbSearchWarnedAt = 0;
  searchBreaker._reset();
}

module.exports = { getHLTB, stringSimilarity, levenshtein, buildSearchTerms, _resetAuth };
