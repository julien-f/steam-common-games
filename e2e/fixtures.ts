// What the mocked /api (mockApi.ts) serves: made-up players and a small catalog of real, public
// games. No real Steam account belongs here — steam64 ids are in the reserved-looking
// 7656119800000000x range and every persona is fictional.

export interface Player {
  steamid: string;
  vanity: string;
  personaname: string;
  owned: number[];
  playtime?: Record<number, number>; // minutes
  wishlist?: number[];
}

export const ALICE: Player = {
  steamid: '76561198000000001',
  vanity: 'alice',
  personaname: 'Alice',
  owned: [620, 105600, 413150, 1145360, 892970, 367520],
  playtime: { 620: 600, 105600: 1200, 1145360: 45 },
  wishlist: [1426210, 728880],
};

export const BOB: Player = {
  steamid: '76561198000000002',
  vanity: 'bob',
  personaname: 'Bob',
  owned: [620, 105600, 322330, 728880],
};

export const CAROL: Player = {
  steamid: '76561198000000003',
  vanity: 'carol',
  personaname: 'Carol',
  owned: [620, 322330, 1426210],
};

export const PLAYERS = [ALICE, BOB, CAROL];

export interface CatalogGame {
  appid: number;
  name: string;
  score: number; // review score, 0–100
  reviews: number;
  hltb: number; // hours, all playstyles
  genres: string[];
  categories: string[];
  release: string;
  protondb: 'platinum' | 'gold' | 'silver' | 'bronze' | 'borked';
}

const coop = ['Multi-player', 'Co-op', 'Online Co-op'];

export const CATALOG: CatalogGame[] = [
  {
    appid: 620,
    name: 'Portal 2',
    score: 98,
    reviews: 400000,
    hltb: 10.5,
    genres: ['Action', 'Adventure'],
    categories: coop,
    release: 'Apr 18, 2011',
    protondb: 'platinum',
  },
  {
    appid: 105600,
    name: 'Terraria',
    score: 97,
    reviews: 900000,
    hltb: 106,
    genres: ['Action', 'Adventure', 'Indie', 'RPG'],
    categories: coop,
    release: 'May 16, 2011',
    protondb: 'platinum',
  },
  {
    appid: 413150,
    name: 'Stardew Valley',
    score: 98,
    reviews: 600000,
    hltb: 100.5,
    genres: ['Indie', 'RPG', 'Simulation'],
    categories: coop,
    release: 'Feb 26, 2016',
    protondb: 'platinum',
  },
  {
    appid: 1145360,
    name: 'Hades',
    score: 98,
    reviews: 250000,
    hltb: 44.5,
    genres: ['Action', 'Indie', 'RPG'],
    categories: ['Single-player'],
    release: 'Sep 17, 2020',
    protondb: 'platinum',
  },
  {
    appid: 892970,
    name: 'Valheim',
    score: 94,
    reviews: 400000,
    hltb: 115,
    genres: ['Action', 'Adventure', 'Indie', 'RPG'],
    categories: coop,
    release: 'Feb 2, 2021',
    protondb: 'gold',
  },
  {
    appid: 367520,
    name: 'Hollow Knight',
    score: 97,
    reviews: 300000,
    hltb: 42,
    genres: ['Action', 'Adventure', 'Indie'],
    categories: ['Single-player'],
    release: 'Feb 24, 2017',
    protondb: 'platinum',
  },
  {
    appid: 322330,
    name: "Don't Starve Together",
    score: 95,
    reviews: 280000,
    hltb: 81.5,
    genres: ['Adventure', 'Indie', 'Simulation'],
    categories: coop,
    release: 'Apr 21, 2016',
    protondb: 'platinum',
  },
  {
    appid: 728880,
    name: 'Overcooked! 2',
    score: 90,
    reviews: 60000,
    hltb: 10.5,
    genres: ['Action', 'Casual', 'Indie'],
    categories: coop,
    release: 'Aug 7, 2018',
    protondb: 'gold',
  },
  {
    appid: 1426210,
    name: 'It Takes Two',
    score: 95,
    reviews: 200000,
    hltb: 14,
    genres: ['Action', 'Adventure'],
    categories: coop,
    release: 'Mar 25, 2021',
    protondb: 'silver',
  },
];

export const game = (appid: number): CatalogGame => {
  const found = CATALOG.find((g) => g.appid === appid);
  if (!found) throw new Error(`No fixture game ${appid}`);
  return found;
};

// One bundle; its ITAD game ids ("gids") resolve to catalog appids, one of them to nothing (a
// game with no Steam listing).
export const BUNDLE = {
  id: 90001,
  title: 'Test Co-op Pack',
  shop: 'Humble Bundle',
  games: [
    { gid: 'gid-portal-2', title: 'Portal 2', appid: 620, tier: 1 },
    { gid: 'gid-hades', title: 'Hades', appid: 1145360, tier: 1 },
    { gid: 'gid-overcooked-2', title: 'Overcooked! 2', appid: 728880, tier: 2 },
    { gid: 'gid-it-takes-two', title: 'It Takes Two', appid: 1426210, tier: 2 },
    { gid: 'gid-soundtrack', title: 'Test Soundtrack', appid: null, tier: 2 },
  ],
  tiers: [5, 12],
};

// A Fanatical "Build your own" bundle: one unpriced ITAD tier, priced by quantity instead
// (server.js adds `pickAndMix` from lib/fanatical.js). USD-only, so the region doesn't matter.
export const PICK_BUNDLE = {
  id: 90002,
  title: 'Test Build Your Own Bundle',
  shop: 'Fanatical',
  games: [
    { gid: 'pnm-portal-2', title: 'Portal 2', appid: 620, tier: 1 },
    { gid: 'pnm-hades', title: 'Hades', appid: 1145360, tier: 1 },
    { gid: 'pnm-terraria', title: 'Terraria', appid: 105600, tier: 1 },
    // One ITAD game that is a Steam package of two apps: one pick, two rows.
    { gid: 'pnm-pack', title: 'Test Survival Pack', appid: [367520, 322330], tier: 1 },
  ],
  pickAndMix: [
    { quantity: 1, prices: { USD: 2 } },
    { quantity: 3, prices: { USD: 3.5 } },
  ],
  // What lib/fanatical.js's matchPickAndMix found on Fanatical's page; Terraria went unmatched.
  pickAndMixNames: { 'pnm-portal-2': 'Portal 2', 'pnm-hades': 'Hades', 'pnm-pack': 'Test Survival Pack' },
};
