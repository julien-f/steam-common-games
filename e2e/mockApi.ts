// Serves every /api call from fixtures.ts inside the browser (page.route), and blocks anything
// off localhost — so an e2e run needs no backend, touches no database, and sends nothing to
// Steam, HLTB, IsThereAnyDeal or ProtonDB. Response shapes follow server.js's routes.
import type { Page, Route } from '@playwright/test';
import { PLAYERS, CATALOG, BUNDLE, PICK_BUNDLE, game, type Player } from './fixtures.ts';

const NOW = Date.now();

function findPlayer(identifier: string): Player | undefined {
  const id = identifier
    .trim()
    .replace(/\/+$/, '')
    .replace(/^.*\/(id|profiles)\//, '');
  return PLAYERS.find((p) => p.steamid === id || p.vanity === id.toLowerCase());
}

function playerJson(p: Player) {
  return {
    steamid: p.steamid,
    communityvisibilitystate: 3,
    personaname: p.personaname,
    profileurl: `https://steamcommunity.com/id/${p.vanity}/`,
    avatar: '',
    avatarmedium: '',
    avatarfull: '',
    timecreated: 1300000000,
    loccountrycode: 'FR',
    gameCount: p.owned.length,
  };
}

function details(appid: number) {
  const g = game(appid);
  return {
    appid,
    fetchedAt: NOW,
    fetchedAts: { rating: NOW, hltb: NOW, meta: NOW, tags: NOW, protondb: NOW },
    rating: {
      score: g.score,
      desc: 'Very Positive',
      positive: Math.round((g.reviews * g.score) / 100),
      total: g.reviews,
    },
    hltb: { id: appid, main: g.hltb * 0.6, extra: g.hltb * 0.9, completionist: g.hltb * 1.5, all: g.hltb },
    meta: {
      name: g.name,
      type: 'game',
      genres: g.genres,
      categories: g.categories,
      developers: ['Test Studio'],
      publishers: ['Test Publisher'],
      description: `${g.name}, a fixture game.`,
      releaseDate: g.release,
      comingSoon: false,
      metacritic: null,
      capsule: null,
      banner: null,
      movies: [],
      screenshots: [],
      dlc: [],
      fullgame: null,
      website: null,
      achievementCount: 0,
      platforms: { windows: true, mac: false, linux: false },
      languages: [],
      isFree: false,
      priceInitial: null,
    },
    tags: g.categories.includes('Co-op') ? ['Co-op'] : ['Singleplayer'],
    demo: null,
    protondb: { tier: g.protondb, confidence: 'strong', total: 100 },
  };
}

const money = (amount: number) => ({ amount, amountInt: Math.round(amount * 100), currency: 'EUR' });

function priceInfo(appid: number) {
  const regular = 20;
  const best = 5 + (appid % 7);
  return {
    steamRegular: money(regular),
    lowAll: money(best - 1),
    lowY1: money(best),
    lowM3: money(best),
    bestDeal: { price: money(best), shop: 'Test Shop', url: 'https://example.invalid/deal' },
  };
}

function pickBundleJson() {
  return {
    ...bundleJson(PICK_BUNDLE),
    tiers: [
      {
        price: null,
        addon: false,
        games: PICK_BUNDLE.games.map((g) => ({ id: g.gid, slug: g.gid, title: g.title, type: 'game', assets: {} })),
      },
    ],
    pickAndMix: PICK_BUNDLE.pickAndMix,
    pickAndMixNames: PICK_BUNDLE.pickAndMixNames,
  };
}

function bundleJson(b: typeof BUNDLE | typeof PICK_BUNDLE = BUNDLE) {
  return {
    id: b.id,
    title: b.title,
    page: { id: 1, name: b.shop, shopId: 1 },
    url: 'https://example.invalid/bundle',
    details: 'https://example.invalid/itad-bundle',
    isMature: false,
    publish: new Date(NOW - 2 * 86400_000).toISOString(),
    expiry: new Date(NOW + 10 * 86400_000).toISOString(),
    note: null,
    counts: { games: b.games.length, media: 0 },
    tiers: BUNDLE.tiers.map((price, i) => ({
      price: money(price),
      addon: false,
      games: BUNDLE.games
        .filter((g) => g.tier === i + 1)
        .map((g) => ({ id: g.gid, slug: g.gid, title: g.title, type: 'game', mature: false, assets: {} })),
    })),
  };
}

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function handle(route: Route): Promise<void> {
  const req = route.request();
  const url = new URL(req.url());
  const path = url.pathname;
  const body = req.postData() ? JSON.parse(req.postData()!) : {};

  if (path === '/api/health')
    return json(route, { ok: true, configured: true, itadConfigured: true, cache: { entries: 0 } });
  if (path === '/api/me') return json(route, { steamid: null, prefs: null });

  if (path === '/api/common-games') {
    const slot: string[] = body.slots?.[0] ?? [];
    const players = slot.map(findPlayer);
    const missing = slot.find((_, i) => !players[i]);
    if (missing) return json(route, { error: `Cannot find Steam account: "${missing}"` }, 400);
    const members = players as Player[];
    const appids = [...new Set(members.flatMap((p) => p.owned))];
    const playtime = Object.fromEntries(
      appids.map((a) => [a, Object.fromEntries(members.map((p) => [p.steamid, p.playtime?.[a] ?? 0]))]),
    );
    return json(route, {
      groups: [{ userIndices: [0], games: appids.map((a) => ({ appid: a, name: game(a).name })) }],
      slots: [members.map(playerJson)],
      playtime,
      lastPlayed: {},
      fetchedAt: NOW,
    });
  }
  if (path === '/api/wishlist') {
    const members = (body.members ?? []).map(findPlayer).filter(Boolean) as Player[];
    const items = members.flatMap((p) =>
      (p.wishlist ?? []).map((appid) => ({ appid, priority: 0, dateAdded: '2026-01-01' })),
    );
    return json(route, { items, players: members.map(playerJson), fetchedAt: NOW });
  }
  if (path === '/api/friends') return json(route, { friends: [], unavailable: body.members ?? [], fetchedAt: NOW });

  if (path === '/api/game-details/stream') {
    const lines = (body.games ?? []).map((g: { appid: number }) => `data: ${JSON.stringify(details(g.appid))}\n\n`);
    return route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: `${lines.join('')}data: {"done":true}\n\n`,
    });
  }
  const one = path.match(/^\/api\/game-details\/(\d+)$/);
  if (one) return json(route, details(Number(one[1])));
  if (/^\/api\/(game-news|achievements)\//.test(path)) return json(route, { items: [], news: [], achievements: [] });

  if (path === '/api/search-games') {
    const q = (url.searchParams.get('q') ?? '').toLowerCase();
    const results = CATALOG.filter((g) => g.name.toLowerCase().includes(q)).map((g) => ({
      appid: g.appid,
      name: g.name,
      tinyImage: '',
    }));
    return json(route, { results });
  }

  const bundleGames = [...BUNDLE.games, ...PICK_BUNDLE.games];
  if (path === '/api/bundles') {
    return json(route, { bundles: [bundleJson(), pickBundleJson()], offset: 0, limit: 50, fetchedAt: NOW });
  }
  if (path === '/api/bundles/resolve') {
    return json(route, { appids: Object.fromEntries(bundleGames.map((g) => [g.gid, g.appid])) });
  }
  const bundle = path.match(/^\/api\/bundles\/(\d+)$/);
  if (bundle) {
    const found = { [BUNDLE.id]: bundleJson, [PICK_BUNDLE.id]: pickBundleJson }[Number(bundle[1])];
    return found ? json(route, { bundle: found(), fetchedAt: NOW }) : json(route, { error: 'Bundle not found' }, 404);
  }
  const inBundles = path.match(/^\/api\/game-bundles\/(\d+)$/);
  if (inBundles) {
    const appid = Number(inBundles[1]);
    const bundles = [bundleJson(), pickBundleJson()].flatMap((b) => {
      const tier = b.tiers.find((t) =>
        t.games.some((g) => [bundleGames.find((x) => x.gid === g.id)?.appid].flat().includes(appid)),
      );
      if (!tier) return [];
      const { id, title, page, url, expiry } = b;
      return [
        {
          id,
          title,
          shop: page.name,
          url,
          expiry,
          tierPrice: tier.price?.amount ?? null,
          tierCurrency: tier.price?.currency ?? null,
        },
      ];
    });
    return json(route, { bundles });
  }
  if (path === '/api/prices') {
    const keys: (string | number)[] = body.gids ?? body.appids ?? [];
    const appidOf = (key: string | number) =>
      typeof key === 'number' ? key : [bundleGames.find((g) => g.gid === key)?.appid].flat()[0];
    const prices = Object.fromEntries(keys.flatMap((key) => (appidOf(key) ? [[key, priceInfo(appidOf(key)!)]] : [])));
    return json(route, { prices, fetchedAt: NOW });
  }

  return json(route, { error: `e2e mock: no fixture for ${req.method()} ${path}` }, 501);
}

export async function mockApi(page: Page): Promise<void> {
  await page.context().route(
    (url) => url.hostname !== 'localhost' && url.hostname !== '127.0.0.1',
    (route) => route.abort(),
  );
  await page.context().route('**/api/**', handle);
}
