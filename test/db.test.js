'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { migrate, MIGRATIONS } = require('../lib/db');

test('migrate: a fresh database ends up at the latest version with every table', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db, MIGRATIONS);
  const { user_version } = db.prepare('PRAGMA user_version').get();
  assert.equal(user_version, MIGRATIONS.at(-1).version);
  for (const table of ['cache_library', 'cache_resolve', 'cache_rating', 'cache_meta', 'cache_search', 'cache_news', 'cache_bundles', 'cache_itad_ids']) {
    assert.doesNotThrow(() => db.prepare(`SELECT * FROM ${table}`).all());
  }
});

test('migrate: a database already at a migration\'s version treats it as applied, preserving existing rows', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE cache_library (key TEXT PRIMARY KEY, value TEXT NOT NULL, ts INTEGER NOT NULL, expires INTEGER)');
  db.exec("INSERT INTO cache_library (key, value, ts) VALUES ('k', 'v', 1)");
  db.exec('PRAGMA user_version = 7');

  migrate(db, MIGRATIONS);

  const row = db.prepare('SELECT value FROM cache_library WHERE key = ?').get('k');
  assert.equal(row.value, 'v');
});

test('migrate: running twice is a no-op the second time', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db, MIGRATIONS);
  db.exec("INSERT INTO cache_library (key, value, ts) VALUES ('k', 'v', 1)");

  migrate(db, MIGRATIONS);

  const row = db.prepare('SELECT value FROM cache_library WHERE key = ?').get('k');
  assert.equal(row.value, 'v');
});

test('migrate: a failed migration rolls back and leaves user_version unchanged', () => {
  const db = new DatabaseSync(':memory:');
  const migrations = [{ version: 1, up(db) { db.exec('CREATE TABLE t (id INTEGER)'); } }, { version: 2, up() { throw new Error('boom'); } }];

  migrate(db, [migrations[0]]);
  assert.throws(() => migrate(db, migrations), /boom/);

  const { user_version } = db.prepare('PRAGMA user_version').get();
  assert.equal(user_version, 1);
});

test('migrate: version 9 splits an existing users.prefs blob into one user_prefs row per key', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db, MIGRATIONS.filter(m => m.version <= 8));
  db.exec(`
    INSERT INTO users (steamid, prefs, created_at, updated_at)
    VALUES ('1', '${JSON.stringify({ region: 'DE', myAccount: { id: '1' } })}', 1000, 5000)
  `);

  migrate(db, MIGRATIONS);

  // node:sqlite rows are null-prototype objects — spread into plain ones so deepEqual doesn't
  // trip over the prototype difference.
  const rows = db.prepare('SELECT key, value, updated_at FROM user_prefs WHERE steamid = ? ORDER BY key').all('1').map(r => ({ ...r }));
  assert.deepEqual(rows, [
    { key: 'myAccount', value: JSON.stringify({ id: '1' }), updated_at: 5000 },
    { key: 'region', value: JSON.stringify('DE'), updated_at: 5000 },
  ]);
});

test('migrate: version 9 tolerates a user with no prefs at all', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db, MIGRATIONS.filter(m => m.version <= 8));
  db.exec("INSERT INTO users (steamid, created_at, updated_at) VALUES ('1', 1000, 1000)");

  assert.doesNotThrow(() => migrate(db, MIGRATIONS));
  const rows = db.prepare('SELECT * FROM user_prefs WHERE steamid = ?').all('1');
  assert.deepEqual(rows, []);
});
