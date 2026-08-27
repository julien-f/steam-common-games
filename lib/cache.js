'use strict';

const { DatabaseSync } = require('node:sqlite');
const { LIBRARY_CACHE_TTL_MS, RESOLVE_CACHE_TTL_MS, RATING_CACHE_TTL_MS, META_CACHE_TTL_MS, SEARCH_CACHE_TTL_MS, NEWS_CACHE_TTL_MS, BUNDLES_CACHE_TTL_MS } = require('./config');
const { recordCacheEvent } = require('./metrics');

const DB_PATH = process.env.DB_FILE || ':memory:';

const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA synchronous = NORMAL');

// Wipes all cache tables on schema version mismatch — safe only because cache
// data is ephemeral. If non-cache tables are added, replace this with
// incremental migrations that target only the changed tables.
const SCHEMA_VERSION = 5;
const { user_version: schemaVer } = db.prepare('PRAGMA user_version').get();
if (schemaVer !== SCHEMA_VERSION) {
  db.exec(`
    DROP TABLE IF EXISTS cache;
    DROP TABLE IF EXISTS cache_short;
    DROP TABLE IF EXISTS cache_library;
    DROP TABLE IF EXISTS cache_resolve;
    DROP TABLE IF EXISTS cache_rating;
    DROP TABLE IF EXISTS cache_meta;
    DROP TABLE IF EXISTS cache_search;
    DROP TABLE IF EXISTS cache_news;
    DROP TABLE IF EXISTS cache_bundles;
    PRAGMA user_version = ${SCHEMA_VERSION};
  `);
}

// One table per TTL group — eviction is a single DELETE per table. `label` is a short,
// external-facing name for the group (used by recordCacheEvent above and getCacheEntryCounts
// below, for GET /api/metrics) — kept separate from `table` so that internal identifier is
// free to stay as-is even though it isn't something anyone outside this file should need to
// know about.
const GROUPS = [
  { table: 'cache_library',  label: 'library', ttl: LIBRARY_CACHE_TTL_MS,  prefixes: null },
  { table: 'cache_resolve',  label: 'resolve', ttl: RESOLVE_CACHE_TTL_MS,  prefixes: ['resolve:'] },
  { table: 'cache_rating',   label: 'rating',  ttl: RATING_CACHE_TTL_MS,   prefixes: ['rating:'] },
  { table: 'cache_meta',     label: 'meta',    ttl: META_CACHE_TTL_MS,     prefixes: ['hltb:', 'meta:', 'browse:', 'tagnames:', 'protondb:', 'schema:', 'achrarity:'] },
  { table: 'cache_search',   label: 'search',  ttl: SEARCH_CACHE_TTL_MS,   prefixes: ['search:'] },
  { table: 'cache_news',     label: 'news',    ttl: NEWS_CACHE_TTL_MS,     prefixes: ['news:'] },
  // ITAD bundle listings and their Steam-appid resolutions — see the BUNDLES_CACHE_TTL_MINUTES
  // comment in default.env for why appid resolution (near-permanent in reality) shares this
  // shorter tier rather than getting its own. `itad-gid:` is the reverse resolution (Steam
  // appid → ITAD gid, resolveItadIds in lib/itad.js) backing the Library Explorer's Wishlist
  // price columns — same near-permanent-in-reality reasoning, so it shares the same tier too.
  { table: 'cache_bundles',  label: 'bundles', ttl: BUNDLES_CACHE_TTL_MS, prefixes: ['itad-bundles:', 'itad-shop:', 'itad-appid:', 'itad-gid:', 'itad-price:'] },
];

for (const { table } of GROUPS) {
  db.exec(`CREATE TABLE IF NOT EXISTS ${table} (key TEXT PRIMARY KEY, value TEXT NOT NULL, ts INTEGER NOT NULL)`);
}

function groupFor(key) {
  for (const g of GROUPS) {
    if (g.prefixes && g.prefixes.some(p => key.startsWith(p))) return g;
  }
  return GROUPS[0]; // cache_library
}

// Prepared statements per table
const stmts = Object.fromEntries(GROUPS.map(({ table }) => [table, {
  get: db.prepare(`SELECT value, ts FROM ${table} WHERE key = ?`),
  set: db.prepare(`INSERT OR REPLACE INTO ${table} (key, value, ts) VALUES (?, ?, ?)`),
  del: db.prepare(`DELETE FROM ${table} WHERE key = ?`),
  evict: db.prepare(`DELETE FROM ${table} WHERE ts < ?`),
  count: db.prepare(`SELECT COUNT(*) AS n FROM ${table}`),
}]));

// Evict entries that expired while the server was stopped.
// TTL changes take effect immediately on the next restart.
for (const { table, ttl } of GROUPS) stmts[table].evict.run(Date.now() - ttl);

// { force: true } treats the entry as a miss without deleting it — the caller is
// expected to setCache() a fresh value right after, which overwrites it anyway. Every outcome
// is reported to lib/metrics.js's recordCacheEvent — see its own comment for why hit/miss/
// forced tracking lives there rather than as a local counter in this file: a collapsing hit
// rate on one label (TTL misconfigured, an eviction bug, a route calling `{force: true}` more
// than expected) needs the same sinceRestart/lastHour treatment every other counter in
// GET /api/metrics gets, and that bookkeeping is centralized in lib/metrics.js.
function getCached(key, { force = false } = {}) {
  const { table, label, ttl } = groupFor(key);
  if (force) { recordCacheEvent(label, 'forced'); return undefined; }
  const row = stmts[table].get.get(key);
  if (!row) { recordCacheEvent(label, 'misses'); return undefined; }
  if (Date.now() - row.ts < ttl) { recordCacheEvent(label, 'hits'); return JSON.parse(row.value); }
  stmts[table].del.run(key);
  recordCacheEvent(label, 'misses');
  return undefined;
}

function setCache(key, value) {
  const { table } = groupFor(key);
  stmts[table].set.run(key, JSON.stringify(value), Date.now());
}

// Per-group cache row counts for GET /api/metrics — unlike recordCacheEvent's hit/miss/forced
// counters (in-memory, reset on restart), row counts are read straight from db.sqlite so they
// reflect entries from before the current process even started. Read alongside cacheHits, this
// tells apart "few entries, lots of misses" (a TTL too short, evicting before reuse) from "many
// entries, lots of misses" (a large/low-locality key space the cache structurally can't help
// much with) — neither is distinguishable from hit/miss counts alone.
function getCacheEntryCounts() {
  return Object.fromEntries(GROUPS.map(({ table, label }) => [label, stmts[table].count.get().n]));
}

function getCacheStats() {
  const entries = Object.values(getCacheEntryCounts()).reduce((sum, n) => sum + n, 0);
  return { entries };
}

// Test-only: wipes cache rows. Does NOT touch recordCacheEvent's hit/miss/forced counters —
// those now live in lib/metrics.js, which has its own `_reset` for that (see test callers).
function _reset(entries = []) {
  for (const { table } of GROUPS) db.exec(`DELETE FROM ${table}`);
  for (const [key, entry] of entries) {
    const { table } = groupFor(key);
    stmts[table].set.run(key, JSON.stringify(entry.value), entry.ts);
  }
}

module.exports = { getCached, setCache, getCacheStats, getCacheEntryCounts, _reset };
