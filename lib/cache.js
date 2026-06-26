'use strict';

const { DatabaseSync } = require('node:sqlite');
const { LIBRARY_CACHE_TTL_MS, RESOLVE_CACHE_TTL_MS, RATING_CACHE_TTL_MS, META_CACHE_TTL_MS } = require('./config');

const DB_PATH = process.env.DB_FILE || ':memory:';

const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA synchronous = NORMAL');

// Wipes all cache tables on schema version mismatch — safe only because cache
// data is ephemeral. If non-cache tables are added, replace this with
// incremental migrations that target only the changed tables.
const SCHEMA_VERSION = 4;
const { user_version: schemaVer } = db.prepare('PRAGMA user_version').get();
if (schemaVer !== SCHEMA_VERSION) {
  db.exec(`
    DROP TABLE IF EXISTS cache;
    DROP TABLE IF EXISTS cache_short;
    DROP TABLE IF EXISTS cache_library;
    DROP TABLE IF EXISTS cache_resolve;
    DROP TABLE IF EXISTS cache_rating;
    DROP TABLE IF EXISTS cache_meta;
    PRAGMA user_version = ${SCHEMA_VERSION};
  `);
}

// One table per TTL group — eviction is a single DELETE per table.
const GROUPS = [
  { table: 'cache_library',   ttl: LIBRARY_CACHE_TTL_MS,         prefixes: null },
  { table: 'cache_resolve', ttl: RESOLVE_CACHE_TTL_MS,  prefixes: ['resolve:'] },
  { table: 'cache_rating',  ttl: RATING_CACHE_TTL_MS,   prefixes: ['rating:'] },
  { table: 'cache_meta',    ttl: META_CACHE_TTL_MS,     prefixes: ['hltb:', 'meta:', 'tags:'] },
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

function getCached(key) {
  const { table, ttl } = groupFor(key);
  const row = stmts[table].get.get(key);
  if (!row) return undefined;
  if (Date.now() - row.ts < ttl) return JSON.parse(row.value);
  stmts[table].del.run(key);
  return undefined;
}

function setCache(key, value) {
  const { table } = groupFor(key);
  stmts[table].set.run(key, JSON.stringify(value), Date.now());
}

function getCacheStats() {
  const entries = GROUPS.reduce((sum, { table }) => sum + stmts[table].count.get().n, 0);
  return { entries };
}

function _reset(entries = []) {
  for (const { table } of GROUPS) db.exec(`DELETE FROM ${table}`);
  for (const [key, entry] of entries) {
    const { table } = groupFor(key);
    stmts[table].set.run(key, JSON.stringify(entry.value), entry.ts);
  }
}

module.exports = { getCached, setCache, getCacheStats, _reset };
