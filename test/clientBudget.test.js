'use strict';

// Each client's share of the outbound budgets (lib/metrics.js's chargeBudget). Its own file: the
// budgets are read from the env at load time. 8 calls an hour per group, 25% → 2 per client.
process.env.STEAM_API_KEY = 'test-key';
process.env.NODE_ENV = 'test';
process.env.DB_FILE = '';
process.env.RATE_LIMIT_ENABLED = 'true';
process.env.TRUST_PROXY = '1';
process.env.OUTBOUND_HOURLY_MAX = '8';
process.env.OUTBOUND_CLIENT_SHARE_PERCENT = '25';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const supertest = require('supertest');
const { app } = require('../server');
const { _reset, getCached, setCache } = require('../lib/cache');
const { createTrackedFetch, getMetrics, runAsClient, _reset: _resetMetrics } = require('../lib/metrics');
const { createSemaphore } = require('../lib/upstream');
const { createDedup } = require('../lib/dedup');
const { getHLTB, _resetAuth } = require('../lib/hltb');
const { getPickAndMix } = require('../lib/fanatical');
const { getPlayerSummaries } = require('../lib/steam');

const api = supertest(app);
const testFetch = createTrackedFetch('test-group');
const spend = () => testFetch('spend', 'https://example.com/');

function setup(t, fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({}) })) {
  _reset();
  _resetMetrics();
  _resetAuth();
  t.mock.method(globalThis, 'fetch', fetchImpl);
  const warn = t.mock.method(console, 'warn', () => {});
  const error = t.mock.method(console, 'error', () => {});
  return { warn, error };
}

// Settles `fn()` and returns the error it threw, or null.
const refusal = (fn) =>
  fn().then(
    () => null,
    (err) => err,
  );

test('a client is refused past its share, other clients are not', async (t) => {
  setup(t);
  await runAsClient('a', async () => {
    await spend();
    await spend();
    const err = await refusal(spend);
    assert.equal(err?.isClientBudgetExhausted, true);
    assert.equal(err.isBudgetExhausted, true);
  });
  await runAsClient('b', () => spend());
  const budget = getMetrics().budgets['test-group'];
  assert.equal(budget.hourUsed, 3);
  assert.equal(budget.hourTopClient, 2);
});

test('a call outside any request counts only against the global budget', async (t) => {
  setup(t);
  await runAsClient('a', async () => {
    await spend();
    await spend();
  });
  for (let i = 0; i < 4; i++) await spend();
  await runAsClient('b', () => spend());
  assert.equal((await runAsClient('a', () => refusal(spend)))?.isClientBudgetExhausted, true);
});

test('the global ceiling still refuses every client, as a global refusal', async (t) => {
  setup(t);
  for (let i = 0; i < 8; i++) await spend();
  const err = await runAsClient('fresh', () => refusal(spend));
  assert.equal(err?.isBudgetExhausted, true);
  assert.equal(err.isClientBudgetExhausted, undefined);
});

test('a client past its share is warned about once per window', async (t) => {
  const { warn } = setup(t);
  for (const client of ['a', 'b']) {
    await runAsClient(client, async () => {
      await spend();
      await spend();
      for (let i = 0; i < 3; i++) await refusal(spend);
    });
  }
  const lines = warn.mock.calls.map((c) => c.arguments[0]).filter((l) => /\[budget:test-group\]/.test(l));
  assert.equal(lines.length, 2);
});

test('a job queued behind another client’s is charged to its own client', async (t) => {
  setup(t);
  await runAsClient('b', async () => {
    await spend();
    await spend();
  });
  const sem = createSemaphore(1, 0, 'test-client-sem');
  let releaseA;
  const a = runAsClient('a', () => sem(() => new Promise((r) => (releaseA = r))));
  const b = runAsClient('b', () => sem(() => refusal(spend)));
  releaseA();
  await a;
  assert.equal((await b)?.isClientBudgetExhausted, true);
});

test('a job refused by a budget frees its semaphore slot at once', async (t) => {
  setup(t);
  const sem = createSemaphore(1, 60_000, 'test-refused-sem');
  await refusal(() => sem(async () => Promise.reject(Object.assign(new Error('x'), { isBudgetExhausted: true }))));
  assert.equal(sem.getStats().active, 0);
});

test('a client coalescing onto another client’s refused call still gets its answer', async (t) => {
  setup(t);
  await runAsClient('a', async () => {
    await spend();
    await spend();
  });
  const withDedup = createDedup();
  const load = () => spend().then(() => 'answer');
  const a = runAsClient('a', () => refusal(() => withDedup('k', load)));
  const b = runAsClient('b', () => withDedup('k', load));
  assert.equal((await a)?.isClientBudgetExhausted, true);
  assert.equal(await b, 'answer');
});

test('one client’s refused HLTB login doesn’t hold off another client’s', async (t) => {
  setup(t, async (url) => {
    if (url.includes('search/site/init'))
      return { ok: true, json: async () => ({ token: 't', hpKey: 'k', hpVal: 'v' }) };
    return { ok: true, json: async () => ({ data: [{ game_id: 1, game_name: 'Portal', comp_main: 3600 }] }) };
  });
  const hltb = createTrackedFetch('hltb');
  await runAsClient('a', async () => {
    await hltb('spend', 'https://example.com/');
    await hltb('spend', 'https://example.com/');
    await refusal(() => getHLTB(1, 'Portal'));
  });
  assert.equal((await runAsClient('b', () => getHLTB(1, 'Portal')))?.id, 1);
});

test('one client’s refused Fanatical call isn’t cached as a failure for everyone', async (t) => {
  setup(t, async () => ({ ok: true, json: async () => ({ pickandmix: [] }) }));
  const fanatical = createTrackedFetch('fanatical');
  await runAsClient('a', async () => {
    await fanatical('spend', 'https://example.com/');
    await fanatical('spend', 'https://example.com/');
    assert.deepEqual(await getPickAndMix(), {});
  });
  assert.equal(getCached('fanatical-pnm:v2'), undefined);
});

test('player names refused by a budget log no line per batch', async (t) => {
  const { warn } = setup(t);
  for (let i = 0; i < 8; i++) await createTrackedFetch('steam-api')('spend', 'https://example.com/');
  const ids = Array.from({ length: 250 }, (_, i) => String(76561198000000000n + BigInt(i)));
  const players = await getPlayerSummaries(ids);
  assert.equal(players.length, 250);
  assert.deepEqual(
    warn.mock.calls.map((c) => c.arguments[0]).filter((l) => /\[steam\]/.test(l)),
    [],
  );
});

// Answers the Steam Web API calls the achievements and friends routes make.
const steamApi = async (url) => {
  const json = (body) => ({ ok: true, status: 200, json: async () => body });
  if (String(url).includes('GetPlayerAchievements')) return json({ playerstats: { success: true, achievements: [] } });
  if (String(url).includes('GetFriendList')) return json({ friendslist: { friends: [] } });
  if (String(url).includes('GetGlobalAchievementPercentages'))
    return json({ achievementpercentages: { achievements: [] } });
  if (String(url) === 'https://example.com/') return json({});
  throw new Error(`Unexpected fetch: ${url}`);
};

const playerIds = (from, n) => Array.from({ length: n }, (_, i) => String(76561198000001000n + BigInt(from + i)));

function cacheAchievementGame(appid) {
  setCache(`meta:${appid}`, { name: 'Game' });
  setCache(`schema:${appid}`, [{ apiname: 'A', name: 'A' }]);
  setCache(`achrarity:${appid}`, {});
}

test('a route answers 429 to the client past its share, and 200 to another', async (t) => {
  const { error } = setup(t, steamApi);
  cacheAchievementGame(10);
  const over = await api
    .get(`/api/achievements/10?steamids=${playerIds(0, 3).join(',')}`)
    .set('X-Forwarded-For', '203.0.113.1');
  assert.equal(over.status, 429);
  assert.match(over.body.error, /your network/);
  const other = await api
    .get(`/api/achievements/10?steamids=${playerIds(10, 1).join(',')}`)
    .set('X-Forwarded-For', '203.0.113.2');
  assert.equal(other.status, 200);
  assert.deepEqual(
    error.mock.calls.map((c) => c.arguments[0]),
    [],
  );
});

test('a route with a JSON body is charged to its client', async (t) => {
  setup(t, steamApi);
  const res = await api
    .post('/api/friends')
    .set('X-Forwarded-For', '203.0.113.3')
    .send({ members: playerIds(20, 3) });
  assert.equal(res.status, 429);
});

test('a refused rarity lookup logs no [achievements] line', async (t) => {
  const { warn } = setup(t, steamApi);
  setCache('meta:11', { name: 'Game' });
  setCache('schema:11', [{ apiname: 'A', name: 'A' }]);
  for (let i = 0; i < 8; i++) await createTrackedFetch('steam-api')('spend', 'https://example.com/');
  const res = await api.get('/api/achievements/11').set('X-Forwarded-For', '203.0.113.4');
  assert.equal(res.status, 200);
  assert.equal(res.body.rarityFailed, true);
  assert.deepEqual(
    warn.mock.calls.map((c) => c.arguments[0]).filter((l) => /\[achievements\]/.test(l)),
    [],
  );
});
