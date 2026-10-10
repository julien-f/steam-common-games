'use strict';

// Opts into rate limiting (the main suite bypasses it); each test file runs in its own process.
process.env.DB_FILE = '';
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_ENABLED = 'true';
process.env.DETAILS_RATE_LIMIT_MAX = '100';
process.env.STREAM_MAX_PER_IP = '2';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const supertest = require('supertest');
const { app } = require('../server');
const { _reset } = require('../lib/cache');

const api = supertest(app);
const stream = (appid) => api.post('/api/game-details/stream').send({ games: [{ appid }] });

test('POST /api/game-details/stream: at most STREAM_MAX_PER_IP open at once per client', async (t) => {
  _reset();
  t.mock.method(console, 'warn', () => {});
  let open;
  const gate = new Promise((r) => (open = r));
  t.after(() => open()); // let pending streams finish even if an assertion fails
  t.mock.method(globalThis, 'fetch', async () => {
    await gate;
    return { ok: false, status: 500, headers: new Headers(), text: async () => '', json: async () => ({}) };
  });

  const first = stream(801).then((res) => res);
  const second = stream(802).then((res) => res);
  await new Promise((r) => setTimeout(r, 50)); // both are open, waiting on upstream

  // Refused at once rather than queued: without the cap it would wait on the gate too.
  const third = await Promise.race([stream(803), new Promise((r) => setTimeout(() => r({ status: 'pending' }), 1000))]);
  assert.equal(third.status, 429);
  assert.match(third.body.error, /at once/);

  open();
  assert.equal((await first).status, 200);
  assert.equal((await second).status, 200);
  assert.equal((await stream(804)).status, 200, 'a finished stream frees its slot');
});
