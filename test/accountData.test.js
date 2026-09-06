'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  membersFromAccountId, fetchAccountOwnedGames, fetchAccountWishlistItems,
  fetchAccountOwnedAppids, fetchAccountWishlistAppids,
} = require('../public/accountData.ts');

function withFetch(t, handler) {
  const restore = globalThis.fetch;
  globalThis.fetch = handler;
  t.after(() => { globalThis.fetch = restore; });
}

test('membersFromAccountId: splits the sorted-joined id back into member steam64 ids', () => {
  assert.deepEqual(membersFromAccountId('1+2+3'), ['1', '2', '3']);
});

test('membersFromAccountId: a single-member account round-trips to a one-element array', () => {
  assert.deepEqual(membersFromAccountId('1'), ['1']);
});

test('fetchAccountOwnedGames: sends { slots: [members] }, sums playtime and maxes lastPlayed across members', async (t) => {
  let seenBody;
  withFetch(t, async (url, opts) => {
    seenBody = JSON.parse(opts.body);
    return {
      ok: true,
      json: async () => ({
        groups: [{ games: [{ appid: 440, name: 'Team Fortress 2' }] }],
        slots: [[{ steamid: '1' }, { steamid: '2' }]],
        playtime: { 440: { 1: 100, 2: 50 } },
        lastPlayed: { 440: { 1: 1000, 2: 2000 } },
      }),
    };
  });

  const games = await fetchAccountOwnedGames(['1', '2']);
  assert.deepEqual(seenBody, { slots: [['1', '2']], refresh: false });
  assert.deepEqual(games, [{ appid: 440, name: 'Team Fortress 2', playtimeMinutes: 150, lastPlayedUnix: 2000 }]);
});

test('fetchAccountOwnedGames: missing playtime/lastPlayed entries default to 0', async (t) => {
  withFetch(t, async () => ({
    ok: true,
    json: async () => ({
      groups: [{ games: [{ appid: 440, name: 'Team Fortress 2' }] }],
      slots: [[{ steamid: '1' }]],
      playtime: {},
      lastPlayed: {},
    }),
  }));

  const games = await fetchAccountOwnedGames(['1']);
  assert.deepEqual(games, [{ appid: 440, name: 'Team Fortress 2', playtimeMinutes: 0, lastPlayedUnix: 0 }]);
});

test('fetchAccountOwnedGames: throws with the server error message on a non-2xx response', async (t) => {
  withFetch(t, async () => ({ ok: false, json: async () => ({ error: 'rate limited' }) }));
  await assert.rejects(() => fetchAccountOwnedGames(['1']), /rate limited/);
});

test('fetchAccountOwnedGames: passes refresh through', async (t) => {
  let seenBody;
  withFetch(t, async (url, opts) => {
    seenBody = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ groups: [], slots: [[]], playtime: {}, lastPlayed: {} }) };
  });
  await fetchAccountOwnedGames(['1'], { refresh: true });
  assert.equal(seenBody.refresh, true);
});

test('fetchAccountWishlistItems: sends { members }, returns items as-is', async (t) => {
  let seenBody;
  withFetch(t, async (url, opts) => {
    seenBody = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ items: [{ appid: 620, priority: 1, dateAdded: '2024-01-01' }] }) };
  });

  const items = await fetchAccountWishlistItems(['1']);
  assert.deepEqual(seenBody, { members: ['1'], refresh: false });
  assert.deepEqual(items, [{ appid: 620, priority: 1, dateAdded: '2024-01-01' }]);
});

test('fetchAccountWishlistItems: throws with the server error message on a non-2xx response', async (t) => {
  withFetch(t, async () => ({ ok: false, json: async () => ({ error: 'private profile' }) }));
  await assert.rejects(() => fetchAccountWishlistItems(['1']), /private profile/);
});

test('fetchAccountOwnedAppids: resolves an accountId straight to a flat appid Set', async (t) => {
  let seenBody;
  withFetch(t, async (url, opts) => {
    seenBody = JSON.parse(opts.body);
    return {
      ok: true,
      json: async () => ({
        groups: [{ games: [{ appid: 440, name: 'TF2' }, { appid: 620, name: 'Portal 2' }] }],
        slots: [[{ steamid: '1' }, { steamid: '2' }]],
        playtime: {}, lastPlayed: {},
      }),
    };
  });

  const appids = await fetchAccountOwnedAppids('1+2');
  assert.deepEqual(seenBody.slots, [['1', '2']]);
  assert.deepEqual(appids, new Set([440, 620]));
});

test('fetchAccountWishlistAppids: resolves an accountId straight to a flat appid Set', async (t) => {
  let seenBody;
  withFetch(t, async (url, opts) => {
    seenBody = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ items: [{ appid: 620, priority: 1, dateAdded: null }] }) };
  });

  const appids = await fetchAccountWishlistAppids('1+2');
  assert.deepEqual(seenBody.members, ['1', '2']);
  assert.deepEqual(appids, new Set([620]));
});
