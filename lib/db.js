'use strict';

const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DB_FILE || ':memory:';

const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA synchronous = NORMAL');

// Ordered, append-only, applied incrementally against whatever `user_version` the database is
// already at — never drop-and-recreate, so upgrading never loses data (cache rows included).
// Version 7 is the pre-migration baseline (this repo's old wipe-on-mismatch SCHEMA_VERSION), so
// a database already at 7 treats it as already applied; new migrations start at 8. Once a
// migration has shipped, never edit it — add a new one instead, even to fix it.
const MIGRATIONS = [
  {
    version: 7,
    up(db) {
      for (const table of ['cache_library', 'cache_resolve', 'cache_rating', 'cache_meta', 'cache_search', 'cache_news', 'cache_bundles', 'cache_itad_ids']) {
        db.exec(`CREATE TABLE IF NOT EXISTS ${table} (key TEXT PRIMARY KEY, value TEXT NOT NULL, ts INTEGER NOT NULL, expires INTEGER)`);
      }
    },
  },
  {
    // Steam-authenticated users and their server-synced preferences (lib/auth.js). `prefs` holds
    // the same opaque JSON blob the frontend used to keep in localStorage only, so the sync layer
    // above it doesn't need its own schema.
    version: 8,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          steamid TEXT PRIMARY KEY,
          prefs TEXT NOT NULL DEFAULT '{}',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);
      db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          steamid TEXT NOT NULL,
          expires_at INTEGER NOT NULL
        )
      `);
    },
  },
];

function migrate(db, migrations) {
  const { user_version: current } = db.prepare('PRAGMA user_version').get();
  const pending = migrations.filter(m => m.version > current).sort((a, b) => a.version - b.version);
  for (const m of pending) {
    db.exec('BEGIN');
    try {
      m.up(db);
      db.exec(`PRAGMA user_version = ${m.version}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

migrate(db, MIGRATIONS);

module.exports = { db, migrate, MIGRATIONS };
