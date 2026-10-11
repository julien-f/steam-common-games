'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');

test('cache-clear: empties every cache table lib/db.js creates and keeps the rest', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-clear-'));
  t.after(() => fs.rmSync(dir, { recursive: true }));
  const file = path.join(dir, 'db.sqlite');
  const env = { ...process.env, DB_FILE: file };
  execFileSync(process.execPath, ['-e', "require('./lib/db')"], { cwd: ROOT, env });

  const db = new DatabaseSync(file);
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'cache\\_%' ESCAPE '\\'")
    .all()
    .map((r) => r.name);
  assert.ok(tables.length > 0);
  for (const table of tables) db.prepare(`INSERT INTO ${table} (key, value, ts) VALUES ('k', 'v', 0)`).run();
  db.prepare("INSERT INTO users (steamid, created_at, updated_at) VALUES ('1', 0, 0)").run();

  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'cache-clear.js')], { env });

  const left = tables.filter((table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n > 0);
  assert.deepStrictEqual(left, []);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1);
  db.close();
});
