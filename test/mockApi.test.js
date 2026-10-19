'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const ask = async (path) => {
  const { respond } = await import('../e2e/mockApi.ts');
  const res = respond('GET', new URL(path, 'http://localhost'), null);
  return { status: res.status, body: JSON.parse(res.body) };
};

// As server.js: a store with no page for the appid leaves every source empty, not failed.
test('mockApi: game details for an appid outside the fixtures answer empty, as the real API does', async () => {
  const { status, body } = await ask('/api/game-details/999999');
  assert.equal(status, 200);
  assert.equal(body.meta, null);
  assert.equal(body.rating, null);
  assert.equal(body.failed, undefined);
});

test('mockApi: game meta for an appid outside the fixtures is null', async () => {
  assert.deepEqual(await ask('/api/game-meta/999999'), { status: 200, body: { meta: null } });
});
