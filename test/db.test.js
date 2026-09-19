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
