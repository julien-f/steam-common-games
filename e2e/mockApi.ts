// Serves every /api call from fixtures.ts inside the browser (page.route), and blocks anything
// off localhost — so an e2e run needs no backend, touches no database, and sends nothing to
// Steam, HLTB, IsThereAnyDeal or ProtonDB. Response shapes follow server.js's routes.
//
// States reproduce what the fixtures alone can't (the `mock` cookie under `npm run dev:mock`,
// `mockApi(page, { states })` in a test):
//   no-itad        no ITAD_API_KEY: health says so, every ITAD route answers 503 as server.js does
//   upstream-down  HLTB, ProtonDB and Steam reviews return nothing; ITAD routes answer 502
//   slow           game details stream in one at a time (dev:mock only — page.route can't stream)
//   store-down     Steam store pages return nothing (genres, release date, platforms…)
//   stale          libraries and wishlists read as fetched 12 days ago, until a refresh (D1)
//   untiered       the Co-op Pack lists every game in its first tier, the pricier one empty (as ITAD sends some)
//   slow-media     every banner, screenshot and trailer poster takes 1.5 s to load (Hades has the media)
//   signed-in      signed in with Steam as Alice, whose account already has prefs (fixtures.ts's signedInPrefs)
import type { Page } from '@playwright/test';
import { PLAYERS, CATALOG, BUNDLE, PICK_BUNDLE, SIGNED_IN, signedInPrefs, game, type Player } from './fixtures.ts';
import { flattenBundleGames, type Bundle } from '../public/bundleData.ts';

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

// Drawn inline rather than fetched, so the lightbox has media to page through under both a test
// and dev:mock. One game only: the rest keep just their banner.
const MEDIA_APPID = 1145360;
const SLOW_MEDIA_MS = 1500;
// The media game's DLC: more than the card's first page, so "Show more" appears.
const DLC_APPIDS = Array.from({ length: 25 }, (_, i) => 900001 + i);
const dlcMeta = (appid: number) => ({
  name: `Expansion ${appid - 900000}`,
  capsule: `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/capsule_231x87.jpg`,
  releaseDate: `${(appid % 28) + 1} Jan, 2024`,
  comingSoon: false,
});
const svg = (label: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="100%" height="100%" fill="hsl(${[...label].reduce((h, c) => h + c.charCodeAt(0) * 7, 0) % 360} 45% 35%)"/><text x="50%" y="50%" fill="#fff" font-family="sans-serif" font-size="64" text-anchor="middle">${label}</text></svg>`;
// `slow-media` serves each image from /api/mock-media after SLOW_MEDIA_MS instead; `variant` keeps a
// screenshot's thumbnail and full image apart, as Steam's are.
const mediaUrl = (label: string, slow: boolean, variant = '') =>
  slow
    ? `/api/mock-media/${encodeURIComponent(label)}.svg${variant && `?${variant}`}`
    : `data:image/svg+xml,${encodeURIComponent(svg(label))}`;
// `hls: null`, as Steam sends for a trailer with no H.264 stream: the player and its controls
// show, nothing plays (Playwright's Chromium has no H.264 decoder anyway).
const media = (slow: boolean) => ({
  movies: [{ id: 1, thumbnail: mediaUrl('Trailer', slow), hls: null }],
  screenshots: [1, 2, 3].map((n) => ({
    id: n,
    thumbnail: mediaUrl(`Screenshot ${n}`, slow, 'thumb'),
    full: mediaUrl(`Screenshot ${n}`, slow, 'full'),
  })),
});

function details(appid: number, slowMedia = false) {
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
      // Public store art; a test's browser blocks it (off localhost), dev:mock shows it.
      capsule: `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/capsule_231x87.jpg`,
      banner: slowMedia ? mediaUrl(`Banner ${appid}`, true) : null,
      ...(appid === MEDIA_APPID ? media(slowMedia) : { movies: [], screenshots: [] }),
      dlc: appid === MEDIA_APPID ? DLC_APPIDS : [],
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
    protondb: g.protondb ? { tier: g.protondb, confidence: 'strong', total: 100 } : null,
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
    // The pick-and-mix one ends within 48 h, for the Bundles page's "Ending soon".
    expiry: new Date(NOW + (b === PICK_BUNDLE ? 20 * 3600_000 : 10 * 86400_000)).toISOString(),
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

export interface MockResponse {
  status: number;
  contentType: string;
  body: string;
  delayMs?: number;
}

const json = (body: unknown, status = 200): MockResponse => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

const ITAD_ROUTE = /^\/api\/(bundles|game-bundles|prices)(\/|$)/;

// Plain request in, response out: shared by mockApi() below and `npm run dev:mock` (vite.config.js).
export function respond(
  method: string,
  url: URL,
  rawBody: string | null,
  states: ReadonlySet<string> = new Set(),
): MockResponse {
  const path = url.pathname;
  const body = rawBody ? JSON.parse(rawBody) : {};

  if (states.has('no-itad') && ITAD_ROUTE.test(path))
    return json(
      { error: "Bundles and prices aren't available on this instance: it isn't connected to IsThereAnyDeal." },
      503,
    );
  if (states.has('upstream-down') && ITAD_ROUTE.test(path))
    return json({ error: 'IsThereAnyDeal request failed (mock: upstream-down)' }, 502);
  const slowMedia = states.has('slow-media');
  const detailsFor = (appid: number) =>
    states.has('upstream-down')
      ? {
          ...details(appid, slowMedia),
          rating: null,
          hltb: null,
          protondb: null,
          failed: ['rating', 'hltb', 'protondb'],
        }
      : states.has('store-down')
        ? { ...details(appid, slowMedia), meta: null, failed: ['meta'] }
        : details(appid, slowMedia);
  const mediaPath = path.match(/^\/api\/mock-media\/(.+)\.svg$/);
  if (mediaPath)
    return {
      status: 200,
      contentType: 'image/svg+xml',
      body: svg(decodeURIComponent(mediaPath[1])),
      delayMs: SLOW_MEDIA_MS,
    };

  if (path === '/api/health')
    return json({ ok: true, configured: true, itadConfigured: !states.has('no-itad'), cache: { entries: 0 } });
  if (path === '/api/me')
    return json(
      states.has('signed-in')
        ? { steamid: SIGNED_IN.steamid, prefs: signedInPrefs(NOW) }
        : { steamid: null, prefs: null },
    );
  // Accepted, not stored: the next /api/me still answers the fixture prefs.
  if (states.has('signed-in') && method === 'PUT' && path.startsWith('/api/me/prefs/'))
    return json({ ok: true, applied: true });

  // A refresh is fetched now; otherwise as of server start, or 12 days before it under `stale`.
  const accountFetchedAt = () => (body.refresh ? Date.now() : states.has('stale') ? NOW - 12 * 86400_000 : NOW);

  if (path === '/api/common-games') {
    const slot: string[] = body.slots?.[0] ?? [];
    const players = slot.map(findPlayer);
    const missing = slot.find((_, i) => !players[i]);
    if (missing) return json({ error: `Cannot find Steam account: "${missing}"` }, 400);
    const members = players as Player[];
    const appids = [...new Set(members.flatMap((p) => p.owned))];
    const playtime = Object.fromEntries(
      appids.map((a) => [a, Object.fromEntries(members.map((p) => [p.steamid, p.playtime?.[a] ?? 0]))]),
    );
    return json({
      groups: [{ userIndices: [0], games: appids.map((a) => ({ appid: a, name: game(a).name })) }],
      slots: [members.map(playerJson)],
      playtime,
      lastPlayed: {},
      fetchedAt: accountFetchedAt(),
    });
  }
  if (path === '/api/wishlist') {
    const members = (body.members ?? []).map(findPlayer).filter(Boolean) as Player[];
    const items = members.flatMap((p) =>
      (p.wishlist ?? []).map((appid) => ({ appid, priority: 0, dateAdded: '2026-01-01' })),
    );
    return json({ items, players: members.map(playerJson), fetchedAt: accountFetchedAt() });
  }
  if (path === '/api/friends') return json({ friends: [], unavailable: body.members ?? [], fetchedAt: NOW });

  if (path === '/api/game-details/stream') {
    const lines = (body.games ?? []).map((g: { appid: number }) => `data: ${JSON.stringify(detailsFor(g.appid))}\n\n`);
    return {
      status: 200,
      contentType: 'text/event-stream',
      body: `${lines.join('')}data: {"done":true}\n\n`,
    };
  }
  const one = path.match(/^\/api\/game-details\/(\d+)$/);
  if (one) return json(detailsFor(Number(one[1])));
  const metaOnly = path.match(/^\/api\/game-meta\/(\d+)$/);
  if (metaOnly) {
    const appid = Number(metaOnly[1]);
    return json({ meta: DLC_APPIDS.includes(appid) ? dlcMeta(appid) : detailsFor(appid).meta });
  }
  if (/^\/api\/(game-news|achievements)\//.test(path)) return json({ items: [], news: [], achievements: [] });

  if (path === '/api/search-games') {
    const q = (url.searchParams.get('q') ?? '').toLowerCase();
    const results = CATALOG.filter((g) => g.name.toLowerCase().includes(q)).map((g) => ({
      appid: g.appid,
      name: g.name,
      tinyImage: '',
    }));
    return json({ results });
  }

  const bundleGames = [...BUNDLE.games, ...PICK_BUNDLE.games];
  const coopBundleJson = () => {
    const b = bundleJson();
    if (!states.has('untiered')) return b;
    const [first, ...rest] = b.tiers;
    return {
      ...b,
      tiers: [{ ...first, games: b.tiers.flatMap((t) => t.games) }, ...rest.map((t) => ({ ...t, games: [] }))],
    };
  };
  if (path === '/api/bundles') {
    return json({ bundles: [coopBundleJson(), pickBundleJson()], offset: 0, limit: 50, fetchedAt: NOW });
  }
  if (path === '/api/bundles/resolve') {
    return json({ appids: Object.fromEntries(bundleGames.map((g) => [g.gid, g.appid])) });
  }
  const bundle = path.match(/^\/api\/bundles\/(\d+)$/);
  if (bundle) {
    const found = { [BUNDLE.id]: coopBundleJson, [PICK_BUNDLE.id]: pickBundleJson }[Number(bundle[1])];
    return found ? json({ bundle: found(), fetchedAt: NOW }) : json({ error: 'Bundle not found' }, 404);
  }
  const inBundles = path.match(/^\/api\/game-bundles\/(\d+)$/);
  if (inBundles) {
    const appid = Number(inBundles[1]);
    const bundles = [coopBundleJson(), pickBundleJson()].flatMap((b) => {
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
          tierPriceMax:
            flattenBundleGames(b as unknown as Bundle).find((g) => tier.games.some((t) => t.id === g.gid))
              ?.tierPriceMax ?? null,
          ...('pickAndMix' in b && { pickAndMix: b.pickAndMix }),
        },
      ];
    });
    return json({ bundles });
  }
  if (path === '/api/prices') {
    const keys: (string | number)[] = body.gids ?? body.appids ?? [];
    const appidOf = (key: string | number) =>
      typeof key === 'number' ? key : [bundleGames.find((g) => g.gid === key)?.appid].flat()[0];
    const prices = Object.fromEntries(keys.flatMap((key) => (appidOf(key) ? [[key, priceInfo(appidOf(key)!)]] : [])));
    return json({ prices, fetchedAt: NOW });
  }

  return json({ error: `e2e mock: no fixture for ${method} ${path}` }, 501);
}

export async function mockApi(page: Page, { states = [] as string[] } = {}): Promise<void> {
  await page.context().route(
    (url) => url.hostname !== 'localhost' && url.hostname !== '127.0.0.1',
    (route) => route.abort(),
  );
  await page.context().route('**/api/**', async (route) => {
    const req = route.request();
    const { delayMs, ...response } = respond(req.method(), new URL(req.url()), req.postData(), new Set(states));
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    return route.fulfill(response);
  });
}
