// Shared frontend types. Deliberately permissive at the edges (row/game objects are
// assembled from several independent async sources — the game-details stream, price
// lookups, ownership checks — each mutating different fields), so the interfaces keep
// every field optional and add an index signature: strictness is enforced on the pure
// functions that consume these, not by pretending the row objects are fully formed at
// any single point in time.

export interface Rating {
  score: number;
  desc: string;
  positive: number;
  total: number;
}

export interface Hltb {
  id: number;
  main: number | null;
  extra: number | null;
  completionist: number | null;
  all: number | null;
}

export interface GameMeta {
  name: string | null;
  type: string | null;
  genres: string[];
  categories: string[];
  developers: string[];
  publishers: string[];
  description: string | null;
  releaseDate: string | null;
  comingSoon: boolean;
  metacritic: { score: number; url: string | null } | null;
  capsule: string;
  banner: string;
  movies: { id: number; thumbnail: string; hls: string | null }[];
  screenshots: { id: number; thumbnail: string; full: string }[];
  dlc: number[];
  fullgame: { appid: number; name: string | null } | null;
  website: string | null;
  achievementCount: number | null;
  platforms: string[]; // subset of ['Windows', 'Mac', 'Linux']
  languages: string[];
  isFree: boolean;
  priceInitial: number | null;
}

export interface ProtonDb {
  // A human-readable tier word straight from ProtonDB's API ("borked"/"bronze"/.../"native"),
  // or a `provisionalTier` when `pending` is set (too few reports to be confident).
  tier: string;
  confidence: string | null;
  total: number | null;
  pending?: boolean;
}

export interface GameDetails {
  rating: Rating | null;
  hltb: Hltb | null;
  meta: GameMeta | null;
  tags: string[] | null;
  protondb: ProtonDb | null;
  demo: { appid: number } | null;
}

// One game in a table/panel — the shared base every page's row extends. `appid` is a
// number on the wire (Steam's own APIs and every one of this app's server responses carry
// it as a JSON number; the server normalizes `req.params.appid` through `Number(...)`
// before it ever reaches a row), so a row's `g.appid` is a number and DOM `data-appid`
// attributes are compared against it via `Number(row.dataset.appid)`.
export interface Game extends PriceFields {
  appid: number;
  name: string;
  loading: boolean;
  details: GameDetails | null;
  // panel-adjacent state
  news?: NewsItem[] | null;
  newsLoading?: boolean;
  newsError?: boolean;
  // standalone-lookup flag (see gameSearch.js) — true for a game opened from the
  // "look up any game" box that isn't a loaded row/comparison game
  standalone?: boolean;
  // ownership status (library.js) — null = "not resolved yet"
  inLibrary?: boolean | null;
  onWishlist?: boolean | null;
  // panel's own lazy single-game price fetch (see loadPrice, panel.js)
  priceLoading?: boolean;
  // DLC list (see loadDlc, panel.js) — undefined = not fetched, null = failed
  dlc?: { appid: number; name: string; capsule: string; releaseDate: string; comingSoon: boolean }[] | null;
  dlcLoading?: boolean;
  dlcPartial?: ({ appid: number; name: string; capsule: string; releaseDate: string; comingSoon: boolean } | undefined)[];
  // achievements (library.js) — undefined = not fetched, null = failed
  achievements?: Achievements | null;
  achievementsLoading?: boolean;
  [key: string]: unknown;
}

// A single official news/announcement item (see extractNews in lib/steam.js).
export interface NewsItem {
  title: string;
  url: string;
  date: number; // unix seconds
  feedLabel: string | null;
}

// A single achievement on the server's GET /api/achievements response.
export interface Achievement {
  apiname: string;
  name: string | null;
  description: string | null;
  icon: string;
  icongray: string | null;
  achieved: number | boolean | null;
  unlocktime: number | null;
  globalPct: number | null;
  hidden: boolean | null;
}

// The full GET /api/achievements payload for one game. `_sortedAchievements` is cached
// client-side by panel.js (see achievementsHtml) on the first render after a fetch.
export interface Achievements {
  achievements: Achievement[];
  total: number;
  unlocked: number;
  private: boolean;
  playerCount: number;
  steamUrl: string | null;
  _sortedAchievements?: Achievement[];
}

// IsThereAnyDeal-backed price fields, set by priceLoading.js's applyPriceInfo.
export interface PriceFields {
  steamRegular: number | null;
  bestDealPrice: number | null;
  bestDealCut: number | null;
  bestDealShop: string | null;
  bestDealUrl: string | null;
  lowAll: number | null;
  lowY1: number | null;
  lowM3: number | null;
  priceCurrency: string | null;
}
