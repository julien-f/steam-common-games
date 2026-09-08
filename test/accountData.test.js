'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  membersFromAccountId, fetchAccountOwnedGames, fetchAccountWishlistItems, fetchAccountWishlist,
  fetchAccountOwnedAppids, fetchAccountWishlistAppids, resolveAccountSummary,
  fetchAccountOverview, toAccountPlayer,
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

// ── resolveAccountSummary ────────────────────────────────────────────────────────────────────

test('resolveAccountSummary: a single account resolves members/label/avatar/both counts', async (t) => {
  withFetch(t, async (url) => {
    if (url === '/api/common-games') {
      return {
        ok: true,
        json: async () => ({
          groups: [{ games: [{ appid: 440, name: 'TF2' }] }],
          slots: [[{ steamid: '1', personaname: 'Alice', avatarmedium: 'https://x/a.jpg' }]],
          playtime: {}, lastPlayed: {},
        }),
      };
    }
    return { ok: true, json: async () => ({ items: [{ appid: 620, priority: 1, dateAdded: null }] }) };
  });

  const summary = await resolveAccountSummary(['alice']);
  assert.deepEqual(summary.members, ['1']);
  assert.equal(summary.label, 'Alice');
  assert.equal(summary.avatarUrl, 'https://x/a.jpg');
  assert.equal(summary.ownedCount, 1);
  assert.equal(summary.wishlistCount, 1);
});

test('resolveAccountSummary: a multi-member Family sorts members, joins the label, and has no single avatar', async (t) => {
  withFetch(t, async (url) => {
    if (url === '/api/common-games') {
      return {
        ok: true,
        json: async () => ({
          groups: [],
          slots: [[{ steamid: '2', personaname: 'Bob' }, { steamid: '1', personaname: 'Alice' }]],
          playtime: {}, lastPlayed: {},
        }),
      };
    }
    return { ok: true, json: async () => ({ items: [] }) };
  });

  const summary = await resolveAccountSummary(['bob', 'alice']);
  assert.deepEqual(summary.members, ['1', '2']);
  assert.equal(summary.label, 'Bob + Alice');
  assert.equal(summary.avatarUrl, null);
});

test('resolveAccountSummary: throws with the server error message when the account itself fails to resolve', async (t) => {
  withFetch(t, async () => ({ ok: false, json: async () => ({ error: 'profile not found' }) }));
  await assert.rejects(() => resolveAccountSummary(['ghost']), /profile not found/);
});

test('resolveAccountSummary: a failed/private wishlist just yields wishlistCount 0, doesn\'t fail the whole resolve', async (t) => {
  withFetch(t, async (url) => {
    if (url === '/api/common-games') {
      return {
        ok: true,
        json: async () => ({ groups: [], slots: [[{ steamid: '1', personaname: 'Alice' }]], playtime: {}, lastPlayed: {} }),
      };
    }
    return { ok: false, json: async () => ({ error: 'private profile' }) };
  });

  const summary = await resolveAccountSummary(['alice']);
  assert.equal(summary.wishlistCount, 0);
  assert.equal(summary.label, 'Alice');
});

// ── toAccountPlayer / fetchAccountOverview ───────────────────────────────────

test('toAccountPlayer: maps a full player object onto display-ready fields', () => {
  assert.deepEqual(toAccountPlayer({
    steamid: '1', personaname: 'Alice', profileurl: 'https://steamcommunity.com/id/alice/',
    avatarmedium: 'https://cdn/a.jpg', communityvisibilitystate: 3, personastate: 1, gameCount: 42,
  }), {
    steamid: '1', name: 'Alice', profileUrl: 'https://steamcommunity.com/id/alice/',
    avatarUrl: 'https://cdn/a.jpg', isPrivate: false, gameCount: 42,
  });
});

test('toAccountPlayer: presence is deliberately not mapped — see accountData.ts', () => {
  const p = toAccountPlayer({ steamid: '1', personastate: 3, gameextrainfo: 'Team Fortress 2' });
  assert.equal('statusClass' in p, false);
  assert.equal('statusLabel' in p, false);
});

test('toAccountPlayer: communityvisibilitystate other than 3 is private; absent is not', () => {
  assert.equal(toAccountPlayer({ steamid: '1', communityvisibilitystate: 1 }).isPrivate, true);
  assert.equal(toAccountPlayer({ steamid: '1' }).isPrivate, false);
});

test('toAccountPlayer: drops a non-http profile/avatar URL and falls back to the steamid for a name', () => {
  const p = toAccountPlayer({ steamid: '76561198000000000', profileurl: 'javascript:alert(1)', avatarmedium: 'data:image/png;base64,x' });
  assert.equal(p.profileUrl, '');
  assert.equal(p.avatarUrl, '');
  assert.equal(p.name, '76561198000000000');
});

test('toAccountPlayer: a missing gameCount is null, not 0', () => {
  assert.equal(toAccountPlayer({ steamid: '1' }).gameCount, null);
  assert.equal(toAccountPlayer({ steamid: '1', gameCount: 0 }).gameCount, 0);
});

test('fetchAccountOverview: returns the slot library and its member accounts from one call', async (t) => {
  let calls = 0;
  withFetch(t, async () => {
    calls++;
    return {
      ok: true,
      json: async () => ({
        groups: [{ games: [{ appid: 440, name: 'Team Fortress 2' }] }],
        slots: [[
          { steamid: '1', personaname: 'Alice', profileurl: 'https://steamcommunity.com/id/alice/', gameCount: 1 },
          { steamid: '2', personaname: 'Bob', gameCount: 0 },
        ]],
        playtime: { 440: { 1: 10 } },
        lastPlayed: {},
      }),
    };
  });

  const { games, players } = await fetchAccountOverview(['1', '2']);
  assert.equal(calls, 1);
  assert.deepEqual(games, [{ appid: 440, name: 'Team Fortress 2', playtimeMinutes: 10, lastPlayedUnix: 0 }]);
  assert.deepEqual(players.map(p => p.name), ['Alice', 'Bob']);
  assert.equal(players[0].profileUrl, 'https://steamcommunity.com/id/alice/');
  assert.equal(players[1].profileUrl, '');
});

test('fetchAccountOverview/fetchAccountWishlist: surface the server\'s fetchedAt', async (t) => {
  withFetch(t, async (url) => ({
    ok: true,
    json: async () => (String(url).includes('wishlist')
      ? { items: [{ appid: 2, priority: 1, dateAdded: null }], fetchedAt: 5678 }
      : { groups: [{ games: [{ appid: 1, name: 'A' }] }], slots: [[{ steamid: '1' }]], playtime: {}, lastPlayed: {}, fetchedAt: 1234 }),
  }));
  assert.equal((await fetchAccountOverview(['1'])).fetchedAt, 1234);
  assert.equal((await fetchAccountWishlist(['1'])).fetchedAt, 5678);
});

test('fetchAccountOverview: a response with no fetchedAt (fetched fresh) is null, not undefined', async (t) => {
  withFetch(t, async () => ({ ok: true, json: async () => ({ groups: [], slots: [[]], playtime: {}, lastPlayed: {} }) }));
  assert.equal((await fetchAccountOverview(['1'])).fetchedAt, null);
});
