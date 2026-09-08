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
  // When the oldest of this game's cached details (rating/HLTB/store metadata/tags/ProtonDB) was
  // written server-side, epoch ms — null when they were fetched fresh, undefined before any
  // details have arrived. Shown only in the panel refresh button's tooltip; see server.js's
  // fetchGameDetails for why it isn't on screen.
  detailsFetchedAt?: number | null;
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

// ── List-centric redesign (see docs/list-centric-redesign.md) ──────────────────────────────
// These back accountsStore.ts/listsStore.ts/combine.ts/listResolve.ts — see that doc for the
// full design rationale (why accounts are pinned explicitly rather than "whichever is
// current", why soft-delete/restore exists, why cycles are rejected at save time, etc.).

// A resolved account identity — "myAccount"/"currentAccount" are full objects of this shape
// (not just an id reference) so clearing recentAccounts can never orphan either of them.
export interface AccountSlot {
  id: string; // canonical: sorted-joined member steam64 ids (stable identity, incl. Family unions)
  members: string[]; // resolved steam64 ids, sorted
  rawInputs: string[]; // original typed identifiers (vanity name/URL/id), same order as entered
  label?: string; // last-known display name(s) ("PersonaName" or "A + B" for a Family) — cached
                  // for instant recents rendering before a fresh fetch resolves
  avatarUrl?: string; // last-known avatar, same reason
  lastUsedAt: number;
  removedAt?: number; // soft-removed from the recents UI, kept while referenced by a dynamic list
}

// A node in the user's list-organizing tree — flat arrays keyed by parentId, not a nested
// structure, so rename/move/reorder is a single-item mutation rather than a tree walk.
export interface Folder {
  id: string;
  name: string;
  parentId: string | null; // null = root
  order: number; // sibling order — shared numbering space with GameList at the same parentId
  createdAt: number;
}

export type CombineOp = 'union' | 'intersect' | 'subtract' | 'group-by-membership';

// Points at any list-shaped data source a dynamic list can combine, or the tree can hold a
// shortcut to (not used for that yet — see the design doc's "tree scope" decision). Account-
// scoped refs always pin an explicit accountId, never "whichever account is current", so a
// saved "Alice ∩ Bob" comparison keeps meaning that regardless of what currentAccount becomes.
export interface ListRef {
  kind: 'account-owned' | 'account-wishlist' | 'bundle' | 'recent-games' | 'user';
  accountId?: string; // AccountSlot.id
  bundleId?: string;
  listId?: string; // → GameList.id
}

// A user-created list — either a stored, directly-editable set of appids ('manual'), or a
// stored formula recomputed live every time it's opened ('dynamic'). Lives in the same
// Folder/GameList tree via parentId/order.
export interface GameList {
  id: string;
  name: string;
  parentId: string | null;
  order: number;
  createdAt: number;
  updatedAt: number;
  kind: 'manual' | 'dynamic';
  appids?: number[]; // kind: 'manual'
  op?: CombineOp; // kind: 'dynamic'
  sources?: ListRef[]; // kind: 'dynamic'
  tableView?: object; // persisted per-list (not shared across lists), same shape tableViewPrefs.ts stores
  deletedAt?: number; // soft-deleted — hidden from the tree/pickers, kept for dynamic-list
                      // resolution + restore as long as something still references it
}
