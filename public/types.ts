import type { ProductionTier } from './utils.ts';

// Shared frontend types. A row/game object is assembled from several independent async sources
// (the game-details stream, price lookups, per-list fields), so most fields are optional — but
// every one of them is *declared*: this interface used to end in an `[key: string]: unknown`
// index signature, which made a typo'd field name compile as valid and turned every read of a
// real field into `unknown`. Optional means "not filled in yet"; unknown-to-the-type means
// "nobody checks", which is what that index signature actually bought.

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

  // ── The flattened projection of `details` the table reads ─────────────────────────────────
  // One field per sortable/filterable/groupable column (see gameColumns.ts's own `key`s, plus
  // each list kind's own columns in ListRoute.tsx) — `details` itself is nested, and the table
  // addresses a row by flat key. All written in one place, applyDetailsEvent (ListRoute.tsx), so
  // they're `undefined` until that row's details have streamed in and never partially filled.
  // These used to be undeclared, covered by an `[key: string]: unknown` index signature on this
  // interface: that made every one of them an `unknown` read *and* made a typo'd write
  // (`row.hltbMian = …`) compile silently. Declaring them is what turns both into typecheck
  // failures — the same reason `ReadonlyGame` below exists for the read paths.
  capsule?: string | null;
  score?: number | null;
  positivePct?: number | null;
  steamdbRating?: number | null;
  reviewsTotal?: number | null;
  hltbMain?: number | null;
  hltbExtra?: number | null;
  hltbCompletionist?: number | null;
  hltbAll?: number | null;
  metacritic?: number | null;
  releaseDate?: string | null;
  comingSoon?: boolean;
  genres?: string[];
  developers?: string[];
  publishers?: string[];
  categories?: string[];
  tags?: string[];
  platforms?: string[];
  languages?: string[];
  protondb?: string | null;
  protondbPending?: boolean;
  achievementCount?: number | null;
  dlcCount?: number | null;
  hasDemo?: boolean;
  type?: string | null;
  productionTier?: ProductionTier | null;

  // ── Per-list-kind fields, set when the row is built rather than by the details stream ──────
  // An owned list knows playtime, a wishlist knows rank/date-added, a bundle knows which tier
  // unlocks the game — each only exists on that kind's own rows, and only that kind inserts the
  // column that reads it (see ListRoute.tsx's OWNED_/WISHLIST_/BUNDLE_ column sets).
  playtime?: number;
  lastPlayed?: string;
  priority?: number;
  dateAdded?: string | null;
  tierPrice?: number | null;
  tierCurrency?: string | null;
  addon?: boolean;

  // standalone-lookup flag (see gameSearch.ts) — true for a game opened from the
  // "look up any game" box that isn't one of the loaded rows
  standalone?: boolean;
  // Ownership status for whichever account is loaded, stamped onto every row by the host route
  // for the table's own ✓/☆ name-cell markers (see gameColumns.ts). `null` = "not resolved yet".
  // The side panel does NOT read these — it has its own `ownership` resource (panel.tsx), so a
  // standalone lookup that was never a row still gets a badge; both go through myOwnership.ts's
  // one cached pair of sets.
  inLibrary?: boolean | null;
  onWishlist?: boolean | null;
  // When the oldest of this game's cached details (rating/HLTB/store metadata/tags/ProtonDB) was
  // written server-side, epoch ms — null when they were fetched fresh, undefined before any
  // details have arrived. Shown only in the panel refresh button's tooltip; see server.js's
  // fetchGameDetails for why it isn't on screen.
  detailsFetchedAt?: number | null;
}

// A row as everything outside its own store sees it: readable, not writable. The side panel, the
// table's column renderers and the panel-nav helpers all take this, so a `game.field = x` write
// outside the store that owns the row is a typecheck failure rather than a silent no-op — which
// is what it would be, since a row is a Solid store row (see rowStore.ts) and the whole app
// renders it per field. The only legitimate writers are `rowStore.mutateRow`'s `produce` draft
// (typed as plain `Game`) and whoever builds a row in the first place.
//
// Not deep: `Readonly` stops `g.details = …`, not `g.details.rating = …`. `details` is only ever
// replaced wholesale (see applyDetailsEvent in ListRoute.tsx), so the shallow version covers the
// writes that actually happen without a hand-rolled DeepReadonly over every nested type.
export type ReadonlyGame = Readonly<Game>;

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

// IsThereAnyDeal-backed price fields, set by priceLoading.ts's applyPriceInfo. Optional because
// `undefined` is a real, load-bearing state distinct from `null`: "nothing has looked this price
// up (yet)", which renders as a loading placeholder and is what nullMissingPriceFields keys off
// after a failed batch, versus "looked up, no data", which renders as "—".
export interface PriceFields {
  steamRegular?: number | null;
  bestDealPrice?: number | null;
  bestDealCut?: number | null;
  bestDealShop?: string | null;
  bestDealUrl?: string | null;
  lowAll?: number | null;
  lowY1?: number | null;
  lowM3?: number | null;
  priceCurrency?: string | null;
}

// ── List-centric redesign (see docs/dev/lists-and-accounts.md) ──────────────────────────────
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
  vanities?: Record<string, string>; // steam64 → that member's Steam custom-URL name, for the
                                     // members that set one — captured at resolve time so the
                                     // nicest copyable identifier needs no fetch of its own
                                     // (accountsStore.ts's accountIdentifiers)
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
  // Optional for a dynamic list only: absent means "no name typed", and every surface labels it
  // from its own formula instead (listLabels.ts's listDisplayName), so the label follows a source
  // edit or an account rename instead of freezing at creation time.
  name?: string;
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
