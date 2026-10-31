'use strict';

// Opts into rate limiting (the main suite bypasses it); each test file runs in its own process.
process.env.DB_FILE = '';
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_ENABLED = 'true';
process.env.DETAILS_RATE_LIMIT_MAX = '100';
process.env.STREAM_MAX_PER_IP = '2';
process.env.TRUST_PROXY = '1'; // lets a test pick its client address through X-Forwarded-For

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { until } = require('./until');
const supertest = require('supertest');
const { app } = require('../server');
const { _reset } = require('../lib/cache');

const api = supertest(app);
const stream = (appid, ip) => {
  const req = api.post('/api/game-details/stream');
  if (ip) req.set('X-Forwarded-For', ip);
  return req.send({ games: [{ appid }] }).then((res) => res); // supertest only sends once awaited
};

function gateFetch(t) {
  let open;
  const gate = new Promise((r) => (open = r));
  t.after(() => open()); // let pending streams finish even if an assertion fails
  const urls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    urls.push(String(url));
    await gate;
    return { ok: false, status: 500, headers: new Headers(), text: async () => '', json: async () => ({}) };
  });
  // Both streams waiting on upstream: each has reached its game's first fetch.
  const fetching = (id) => urls.some((u) => u.includes(String(id)));
  const waiting = (...appids) => until(() => appids.every(fetching), `fetches for ${appids}`);
  // The stream's answer, or `fetched upstream` once it reaches its game's fetch, which only a stream the cap let through does.
  const answerOrFetch = async (req, appid) => {
    let res;
    req.then((r) => (res = r));
    await until(() => res || fetching(appid), `stream ${appid} answering or fetching`);
    return res ?? { status: 'fetched upstream' };
  };
  return { open, waiting, answerOrFetch };
}

test('POST /api/game-details/stream: at most STREAM_MAX_PER_IP open at once per client', async (t) => {
  _reset();
  t.mock.method(console, 'warn', () => {});
  const { open, waiting, answerOrFetch } = gateFetch(t);

  const first = stream(801);
  const second = stream(802);
  await waiting(801, 802);

  // Refused at once rather than queued: without the cap it would wait on the gate too.
  const third = await answerOrFetch(stream(803), 803);
  assert.equal(third.status, 429);
  assert.match(third.body.error, /at once/);

  open();
  assert.equal((await first).status, 200);
  assert.equal((await second).status, 200);
  assert.equal((await stream(804)).status, 200, 'a finished stream frees its slot');
});

// express-rate-limit keys IPv6 clients on their /56, so rotating addresses inside it isn't a new client.
test('POST /api/game-details/stream: the cap counts an IPv6 client by its /56, like the rate limits', async (t) => {
  _reset();
  t.mock.method(console, 'warn', () => {});
  const { open, waiting, answerOrFetch } = gateFetch(t);

  const first = stream(811, '2001:db8:1:2::1');
  const second = stream(812, '2001:db8:1:2::2');
  await waiting(811, 812);

  const thirdReq = stream(813, '2001:db8:1:3::3');
  const third = await answerOrFetch(thirdReq, 813);
  open();
  await thirdReq; // settled either way before asserting, so a failure leaves no request open
  assert.equal(third.status, 429);
  assert.equal((await first).status, 200);
  assert.equal((await second).status, 200);
});
