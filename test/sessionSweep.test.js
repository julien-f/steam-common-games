'use strict';

process.env.DB_FILE = ''; // in-memory: never the real db.sqlite
const { mock, test } = require('node:test');
const assert = require('node:assert/strict');

// Faked before lib/auth loads, so the sweep interval it arms on load runs on this clock.
mock.timers.enable({ apis: ['Date', 'setInterval'], now: Date.now() });
const { db } = require('../lib/db');
const { upsertUser, createSession } = require('../lib/auth');
const { SESSION_TTL_MS } = require('../lib/config');

test('expired sessions are swept every hour, not only at startup', () => {
  const rows = () => db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n;
  upsertUser('76561198000000001');
  createSession('76561198000000001');
  // Two ticks: every interval run inside one tick sees Date.now() at the tick's end, not its own time.
  mock.timers.tick(SESSION_TTL_MS);
  mock.timers.tick(30 * 60 * 1000);
  assert.equal(rows(), 1, 'expired, but not swept before the hour');
  mock.timers.tick(30 * 60 * 1000);
  assert.equal(rows(), 0);
});
