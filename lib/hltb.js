'use strict';

const HLTB_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const HLTB_BASE = 'https://howlongtobeat.com/';
const TIMEOUT_MS = 10000;

// Words stripped from search terms because HLTB uses strict AND matching and
// these words appear in Steam titles but not in HLTB's shorter canonical titles.
const EDITION_WORDS = new Set([
  'edition', 'definitive', 'goty', 'complete', 'ultimate', 'enhanced',
  'remastered', 'remake', 'deluxe', 'gold', 'premium', 'collection', 'bundle',
]);

// Short-lived in-memory token cache (not persisted — tokens are session-bound)
let _hltbAuth = null;
let _hltbAuthTs = 0;
let _hltbAuthPromise = null;
let _hltbAuthFailedAt = 0;
const HLTB_AUTH_TTL_MS = 5 * 60 * 1000;
const HLTB_AUTH_RETRY_MS = 30 * 1000;

// Concurrency cap — HLTB blocks aggressive scrapers; keep simultaneous searches low
const HLTB_MAX_CONCURRENT = 3;
let _hltbInFlight = 0;
const _hltbQueue = [];

function _acquireHltb() {
  return new Promise(resolve => {
    if (_hltbInFlight < HLTB_MAX_CONCURRENT) { _hltbInFlight++; resolve(); }
    else _hltbQueue.push(resolve);
  });
}

function _releaseHltb() {
  if (_hltbQueue.length > 0) _hltbQueue.shift()();
  else _hltbInFlight--;
}

async function _fetchHLTBAuth() {
  try {
    const res = await fetch(`${HLTB_BASE}api/bleed/init?t=${Date.now()}`, {
      headers: { 'User-Agent': HLTB_UA, 'Referer': HLTB_BASE },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) { _hltbAuthFailedAt = Date.now(); return null; }
    const data = await res.json();
    if (!data.token) { _hltbAuthFailedAt = Date.now(); return null; }
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

async function getHLTB(name) {
  if (!name) return null;
  const query = name.replace(/[™®©]/g, '').trim();
  if (!query) return null;

  await _acquireHltb();
  try {
    const auth = await getHLTBAuth();
    if (!auth) return null;

    const res = await fetch(`${HLTB_BASE}api/bleed`, {
      method: 'POST',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': HLTB_UA,
        'Referer': HLTB_BASE,
        'X-Auth-Token': auth.token,
        'X-Hp-Key': auth.hpKey,
        'X-Hp-Val': auth.hpVal,
      },
      body: JSON.stringify({
        [auth.hpKey]: auth.hpVal,
        searchType: 'games',
        searchTerms: (() => {
          const terms = query.split(/\s+/)
            .map(t => t.replace(/[^a-z0-9]/gi, ''))
            .filter(t => t.length > 0 && !EDITION_WORDS.has(t.toLowerCase()));
          return terms.length > 0
            ? terms
            : query.split(/\s+/).map(t => t.replace(/[^a-z0-9]/gi, '')).filter(Boolean);
        })(),
        searchPage: 1,
        size: 5,
        searchOptions: {
          games: {
            userId: 0, platform: '', sortCategory: 'popular',
            rangeCategory: 'main', rangeTime: { min: 0, max: 0 },
            gameplay: { perspective: '', flow: '', genre: '', difficulty: '' },
            rangeYear: { min: '', max: '' }, modifier: '',
          },
          users: { sortCategory: 'postcount' },
          lists: { sortCategory: 'follows' },
          filter: '', sort: 0, randomizer: 0,
        },
      }),
    });

    // Token may have expired — clear it so the next call re-fetches
    if (res.status === 401 || res.status === 403) {
      _hltbAuth = null;
      return null;
    }
    if (!res.ok) return null;

    const { data } = await res.json();
    if (!data?.length) return null;

    // Pick best match by Levenshtein similarity
    const best = data.reduce((best, e) => {
      const sim = stringSimilarity(e.game_name, query);
      return sim > best.sim
        ? { main: Math.round(e.comp_main / 3600), extra: Math.round(e.comp_plus / 3600), sim }
        : best;
    }, { sim: -1 });
    if (best.sim < 0.35) return null;

    return { main: best.main, extra: best.extra };
  } catch (err) {
    console.warn(`[HLTB] search failed for "${query}":`, err.message);
    return null;
  } finally {
    _releaseHltb();
  }
}

function stringSimilarity(a, b) {
  a = a.toLowerCase().trim();
  b = b.toLowerCase().trim();
  const [longer, shorter] = a.length >= b.length ? [a, b] : [b, a];
  if (longer.length === 0) return 1;
  return (longer.length - levenshtein(longer, shorter)) / longer.length;
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const row = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = i;
    for (let j = 1; j <= n; j++) {
      const val = a[i - 1] === b[j - 1]
        ? row[j - 1]
        : 1 + Math.min(prev, row[j], row[j - 1]);
      row[j - 1] = prev;
      prev = val;
    }
    row[n] = prev;
  }
  return row[n];
}

function _resetAuth() { _hltbAuth = null; _hltbAuthTs = 0; _hltbAuthPromise = null; _hltbAuthFailedAt = 0; }

module.exports = { getHLTB, stringSimilarity, levenshtein, _resetAuth };
