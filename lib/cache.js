'use strict';

const { DatabaseSync } = require('node:sqlite');
const { LIBRARY_CACHE_TTL_MS, RESOLVE_CACHE_TTL_MS, RATING_CACHE_TTL_MS, META_CACHE_TTL_MS, SEARCH_CACHE_TTL_MS, NEWS_CACHE_TTL_MS, BUNDLES_CACHE_TTL_MS, ITAD_ID_CACHE_TTL_MS } = require('./config');
const { recordCacheEvent } = require('./metrics');

const DB_PATH = process.env.DB_FILE || ':memory:';

const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA synchronous = NORMAL');

// Wipes all cache tables on schema version mismatch — safe only because cache
// data is ephemeral. If non-cache tables are added, replace this with
// incremental migrations that target only the changed tables.
const SCHEMA_VERSION = 7;
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
    DROP TABLE IF EXISTS cache_itad_ids;
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
  // ITAD bundle listings and per-region price lookups — the genuinely time-sensitive half of
  // the ITAD data (a bundle goes live or expires; a sale starts or ends). Both are refreshable
  // on demand from the UI (the browse page's ↻, and "↻ Refresh prices" on a list).
  { table: 'cache_bundles',  label: 'bundles', ttl: BUNDLES_CACHE_TTL_MS, prefixes: ['itad-bundles:', 'itad-price:'] },
  // ITAD identity mappings: the Steam shop id, and both directions of the ITAD gid ↔ Steam appid
  // resolution (`itad-appid:` from resolveSteamAppIds, `itad-gid:` from resolveItadIds). These
  // used to ride the bundles tier above on the reasoning that over-invalidating them was cheap —
  // it isn't: nothing about them is time-sensitive (a game's Steam listing doesn't move), yet
  // every 2 hours the whole mapping was thrown away and re-resolved from scratch, one upstream
  // call per batch, purely as a side effect of sharing a table with data that does change.
  { table: 'cache_itad_ids', label: 'itad-ids', ttl: ITAD_ID_CACHE_TTL_MS, prefixes: ['itad-shop:', 'itad-appid:', 'itad-gid:'] },
];

for (const { table } of GROUPS) {
  // `expires` is normally NULL — the entry lives for its group's TTL, counted from `ts`. A
  // caller can override it per entry via setCache's `ttlMs` (see its own comment): that's what
  // keeps a *cached miss* (a confirmed "no such game/listing/account") from inheriting a tier
  // TTL measured in months, since a miss is far likelier to stop being true than a real answer
  // is to stop being right.
  db.exec(`CREATE TABLE IF NOT EXISTS ${table} (key TEXT PRIMARY KEY, value TEXT NOT NULL, ts INTEGER NOT NULL, expires INTEGER)`);
}

function groupFor(key) {
  for (const g of GROUPS) {
    if (g.prefixes && g.prefixes.some(p => key.startsWith(p))) return g;
  }
  return GROUPS[0]; // cache_library
}

// Prepared statements per table
const stmts = Object.fromEntries(GROUPS.map(({ table }) => [table, {
  get: db.prepare(`SELECT value, ts, expires FROM ${table} WHERE key = ?`),
  set: db.prepare(`INSERT OR REPLACE INTO ${table} (key, value, ts, expires) VALUES (?, ?, ?, ?)`),
  del: db.prepare(`DELETE FROM ${table} WHERE key = ?`),
  evict: db.prepare(`DELETE FROM ${table} WHERE COALESCE(expires, ts + ?) < ?`),
  count: db.prepare(`SELECT COUNT(*) AS n FROM ${table}`),
}]));

// Evict entries that expired while the server was stopped.
// TTL changes take effect immediately on the next restart.
for (const { table, ttl } of GROUPS) stmts[table].evict.run(ttl, Date.now());

// When does this row stop being valid? — its own `expires` when it has one, otherwise its
// group's TTL counted from the write time.
const expiryOf = (row, ttl) => (row.expires === null || row.expires === undefined ? row.ts + ttl : row.expires);

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
  if (Date.now() < expiryOf(row, ttl)) { recordCacheEvent(label, 'hits'); return JSON.parse(row.value); }
  stmts[table].del.run(key);
  recordCacheEvent(label, 'misses');
  return undefined;
}

// When was this key's cached value written? — undefined when it isn't cached (or has expired),
// so callers can't tell a stale entry apart from a fresh one by timestamp alone. Backs the
// "Updated <when>" readout the frontend shows next to its ↻ Refresh buttons: with the library
// tier's TTL now measured in weeks (see default.env), the age of what's on screen is something
// the user has to be able to see, not just something the server knows. Deliberately does NOT
// record a cache event — this is metadata about an entry, not a read of it.
function getCachedAt(key) {
  const { table, ttl } = groupFor(key);
  const row = stmts[table].get.get(key);
  if (!row) return undefined;
  if (Date.now() >= expiryOf(row, ttl)) return undefined;
  return row.ts;
}

// `ttlMs` overrides the key's group TTL for this one entry. Used for cached *misses* — a
// confirmed "this appid has no store page" / "this game has no Steam listing" / "no such vanity
// URL" — which are worth caching (they otherwise cost an upstream call every single time
// someone asks) but must not inherit a tier TTL measured in months: an unreleased game gets a
// store page, a listing gets added, a person registers the vanity URL they were about to. See
// MISS_CACHE_TTL_MINUTES/RESOLVE_MISS_CACHE_TTL_MINUTES in default.env.
function setCache(key, value, { ttlMs } = {}) {
  const { table } = groupFor(key);
  const now = Date.now();
  stmts[table].set.run(key, JSON.stringify(value), now, ttlMs === undefined ? null : now + ttlMs);
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
    stmts[table].set.run(key, JSON.stringify(entry.value), entry.ts, entry.expires ?? null);
  }
}

module.exports = { getCached, getCachedAt, setCache, getCacheStats, getCacheEntryCounts, _reset };
