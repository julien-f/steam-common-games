// The generic list viewer — table + docked panel for a list, per docs/list-centric-redesign.md
// and the implementation plan's Phase 4/5. Registered for /lists/owned, /lists/wishlist,
// /lists/bundle/:bundleId, the generic /lists/:listId, and /game/:appid? (see AppRoot.tsx) — the
// last of these is the "Recently Looked Up" system list's own address (kind 'recent' below),
// folding in what used to be a separate, mostly-empty GameRoute.tsx: `params.appid`, when given,
// is opened the same way a live in-route lookup is (see handleOpenGameRequest/
// openOrAddRecentGame below), not treated as a special standalone-only view.
//
// **Current scope**: every kind ('owned', 'wishlist', 'bundle', 'recent', 'user') is wired up
// for real now (Phase 5 steps 1-2, 4, 6, and 7). This is deliberately narrower than the full plan
// on a few more axes though: ownership cross-referencing (in-library/on-wishlist badges — done
// in the side panel/gameSearch.ts's dropdown via myOwnership.ts, but not surfaced as its own
// table column here) and achievements are not ported yet (both need a second background fetch
// this first pass omits); 'recent'/'user' have no dedicated extra columns — plain CORE_COLUMNS,
// no owned/wishlist/bundle extras. A 'user' list resolves via listResolve.ts's
// resolveGameList/createDefaultFetchers; a manual list, or a dynamic one using any op other than
// group-by-membership, renders as one flat table (flattened via flattenCombineResult when
// needed, same as when it's resolved as someone *else's* combine source) — but
// group-by-membership renders one real table PER group instead (see buildGroupTables below),
// generalizing the old Comparison page's "one table per owner set, most owners to fewest"
// layout. Per-group tables also skip view persistence entirely (a single list only has room for
// one stored `tableView`, and dividing that across however many groups a combine happens to
// produce isn't solved here yet) — each group table just uses the construction-time default
// view, and (see the selection toolbar below) skips row-selection too: selection is only wired
// up on the single-table path, since every real use case for it (saving some games from an
// Owned/Wishlist/bundle/recent/manual-list view into another list) is there already, and
// spreading one selection across N independent per-group tables is a bigger problem than this
// first pass solves. `currentAccount` is read once per mount, not live-reactive to being changed
// elsewhere while this route stays open — accountsStore.ts is a plain module with no Solid
// signal of its own yet, so there's nothing to subscribe to reactively here until one exists (a
// real follow-up, not an oversight); a bundle's own unresolved ("Not on Steam") games and its
// detail card (title/expiry/outbound links) aren't rendered here either — only the resolved
// games' table, the actual point of this generic viewer.
//
// Row-selection-based add/remove-to-list: any kind's table can select rows (`selectable: true`
// on the single-table path) and add them to an existing manual list, or a brand-new one created
// on the spot — the one piece of `listsStore.ts`'s already-built manual-list CRUD
// (`addAppidsToList`/`removeAppidsFromList`, both thin wrappers over `setListAppids` built on
// `combine.ts`'s own `union`/`subtract`) that had no UI calling it until now. "Remove from this
// list" only shows when the list actually being viewed is itself a manual one (`kind === 'user'
// && userList.kind === 'manual'`) — removing from a dynamic list makes no sense, its contents
// are a computed formula, not a stored array.
//
// Ported from library.tsx's loadLibrary/loadWishlist/streamGameDetails/buildTable et al., but
// NOT a copy-paste: every mutable variable that used to be module-level there (table, rowsStore,
// loadGuard, total/loaded, …) is now local to this component's own closure, created fresh on
// each mount and torn down on unmount via onCleanup — library.tsx's page loads exactly once, but
// a router-driven route mounts/unmounts every time its path is navigated to/away from.
import { onMount, onCleanup, createSignal, createRoot, createEffect, batch, For, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import { render } from 'solid-js/web';
import { useParams, useLocation, useNavigate } from '@solidjs/router';
import { createTableState, DataTableView } from '@vates/data-table-solid';
import type { ColumnDef, SortEntry, TableState } from '@vates/data-table-solid';
import { bucketDatePart, formatDatePart } from '@vates/data-table-core';
import {
  fmt, insertColumnsAfter, CORE_COLUMNS, PRICE_COLUMNS, compareDateMissingLast,
  withMissingGroup, formatMissingGroup, halfDecadeBucket, formatHalfDecadeBucket,
  protonDbValue, TYPE_LABELS, priceTierBucket, formatPriceTier, compareNumMissingLast,
  OWNERSHIP_STATUS_COLUMN,
} from './gameColumns.ts';
import { computeSteamdbRating, computeProductionTier, discountPct, fmtLastPlayed, formatMoney } from './utils.ts';
import { restoreTableView } from './tableViewPrefs.ts';
import { renderPanelNav as renderPanelNavShared, stepGameList } from './panelNav.ts';
import { createRowStore } from './rowStore.ts';
import { createStaleGuard } from './staleGuard.ts';
import { createStreamBatcher } from './streamBatcher.ts';
import {
  panelOpen, panelClose, isPanelOpen, getPanelGame, pickRandomFrom, clearRandomQueue, renderPanelBody,
} from './panel.tsx';
import { setPanelParam } from './urlState.ts';
import { setPref } from './prefs.ts';
import { getCurrentAccount } from './accountsStore.ts';
import { fetchAccountOwnedGames, fetchAccountWishlistItems } from './accountData.ts';
import { loadRecentGames, addRecentGame } from './recentGames.ts';
import { fetchBundleById, resolveBundleGames, type ResolvedGame } from './bundleData.ts';
import { getBrowsedBundles } from './bundleBrowseStore.ts';
import { postPrices, applyPriceInfo, nullMissingPriceFields, nullAllPriceFields } from './priceLoading.ts';
import { getStoredRegion, resolveRegion } from './region.ts';
import { registerRouteHandlers } from './AppShell.tsx';
import type { Game, Rating, Hltb, GameMeta, ProtonDb, GameList } from './types.ts';
import { getList, getLists, createList, addAppidsToList, removeAppidsFromList, setListTableView } from './listsStore.ts';
import { resolveGameList, flattenCombineResult, createDefaultFetchers } from './listResolve.ts';
import type { MembershipGroup } from './combine.ts';
import { peekMyOwnershipStatus, onMyOwnershipReady } from './myOwnership.ts';

type ListKind = 'owned' | 'wishlist' | 'bundle' | 'recent' | 'user';

// /game (bare) and /game/:appid both live here, kind 'recent' either way — see this file's own
// header comment and AppRoot.tsx.
function kindFromPath(pathname: string, params: { bundleId?: string; listId?: string; appid?: string }): ListKind {
  if (pathname === '/lists/owned') return 'owned';
  if (pathname === '/lists/wishlist') return 'wishlist';
  if (params.bundleId) return 'bundle';
  if (pathname === '/game' || pathname.startsWith('/game/')) return 'recent';
  return 'user';
}

// ── Columns — ported verbatim from library.tsx's own (see its comments for the full reasoning
// behind each column's grouping/format/category choices) ──────────────────────────────────────

const PLAYTIME_COLUMN: ColumnDef<Record<string, any>> = {
  key: 'playtime', label: 'Played (h)', type: 'number', groupable: true,
  format: v => (v as number) > 0 ? Number(v).toFixed(1) : '—', defaultSortDir: 'desc',
  groupValue: halfDecadeBucket, groupFormat: formatHalfDecadeBucket('h', 'Not played'),
  keepVisibleWhenGrouped: true, category: 'Play Time & Dates',
};

const LAST_PLAYED_COLUMN: ColumnDef<Record<string, any>> = {
  key: 'lastPlayed', label: 'Last Played', type: 'date', groupable: true, format: fmt.str,
  compare: compareDateMissingLast, defaultSortDir: 'desc', defaultValueSort: { by: 'alpha', dir: 'desc' },
  groupValue: withMissingGroup(bucketDatePart('year'), (v: unknown) => v == null || v === ''),
  groupFormat: formatMissingGroup(formatDatePart('year')), keepVisibleWhenGrouped: true,
  category: 'Play Time & Dates',
};

const WISHLIST_RANK_COLUMN: ColumnDef<Record<string, any>> =
  { key: 'priority', label: 'Wishlist Rank', type: 'number', groupable: false, format: fmt.num };

const WISHLIST_DATE_ADDED_COLUMN: ColumnDef<Record<string, any>> =
  { key: 'dateAdded', label: 'Added', type: 'date', groupable: true, format: fmt.str, compare: compareDateMissingLast,
    defaultSortDir: 'desc', defaultValueSort: { by: 'alpha', dir: 'desc' },
    groupValue: withMissingGroup(bucketDatePart('year')),
    groupFormat: formatMissingGroup(formatDatePart('year')), keepVisibleWhenGrouped: true,
    category: 'Play Time & Dates' };

const OWNED_COLUMNS = insertColumnsAfter(CORE_COLUMNS, 'hltbCompletionist', PLAYTIME_COLUMN, LAST_PLAYED_COLUMN);
const OWNED_DEFAULT_VISIBLE = ['capsule', 'name', 'steamdbRating', 'hltbAll', 'releaseDate', 'genres', 'playtime'];

// 'recent' (the "Recently Looked Up" system list) is CORE_COLUMNS plus OWNERSHIP_STATUS_COLUMN
// (gameColumns.ts) — a recent lookup isn't necessarily owned or wishlisted (that's exactly the
// point of the column), so none of owned's Played/Last Played or wishlist's price cluster apply
// here. Hidden by default (not in RECENT_DEFAULT_VISIBLE below) — CORE_COLUMNS' own Name column
// already renders the same status inline (color + a ✓/☆ badge, see gameColumns.ts's
// renderNameCell), so this dedicated column is there for sort/group/filter, not a default-visible
// restatement of what the Name column right next to it already shows.
const RECENT_COLUMNS = insertColumnsAfter(CORE_COLUMNS, 'name', OWNERSHIP_STATUS_COLUMN);
const RECENT_DEFAULT_VISIBLE = ['capsule', 'name', 'steamdbRating', 'hltbAll', 'releaseDate', 'genres'];

const WISHLIST_COLUMNS = insertColumnsAfter(
  insertColumnsAfter(
    insertColumnsAfter(CORE_COLUMNS, 'name', WISHLIST_RANK_COLUMN),
    'priority', ...PRICE_COLUMNS,
  ),
  'releaseDate', WISHLIST_DATE_ADDED_COLUMN,
);
const WISHLIST_DEFAULT_VISIBLE = [
  'capsule', 'name', 'dateAdded', 'steamdbRating', 'hltbAll', 'releaseDate', 'genres', 'hasDemo',
  'bestDealPrice', 'bestDealCut',
];

function renderAddonBadge(v: unknown): Node {
  if (v === undefined) return document.createTextNode('…');
  const span = document.createElement('span');
  span.className = 'status-badge';
  span.style.background = v ? '#8b4513' : 'var(--accent)';
  span.style.color = v ? '#fff' : '#0b1620';
  span.textContent = v ? 'Add-on' : 'Base';
  return span;
}

// A `null` tier price means "no single fixed price" (in practice, a pick-and-mix "Build Your
// Own" tier), not free — an actual free/pay-what-you-want tier is a real `{amount: 0}`.
function renderTierPrice(v: unknown, row: Record<string, any>): Node {
  if (v === undefined) return document.createTextNode('…');
  if (v == null) return document.createTextNode('Varies');
  if (v === 0) return document.createTextNode('Free');
  return document.createTextNode(formatMoney(Number(v), row.tierCurrency));
}

const TIER_PRICE_COLUMN: ColumnDef<Record<string, any>> = {
  key: 'tierPrice', label: 'Tier Price', type: 'number', groupable: true,
  format: v => v == null ? 'Varies' : v === 0 ? 'Free' : Number(v).toFixed(2), render: renderTierPrice,
  compare: compareNumMissingLast, defaultSortDir: 'asc',
  groupValue: withMissingGroup(priceTierBucket), groupFormat: formatMissingGroup(formatPriceTier, 'Varies'), keepVisibleWhenGrouped: true,
  category: 'Pricing',
};
const ADDON_COLUMN: ColumnDef<Record<string, any>> =
  { key: 'addon', label: 'Add-on', groupable: true, format: v => v ? 'Add-on' : 'Base', render: renderAddonBadge, category: 'Classification' };

// OWNERSHIP_STATUS_COLUMN hidden by default here too, same reasoning as RECENT_DEFAULT_VISIBLE
// above — the Name column right next to it already shows the same status inline.
const BUNDLE_COLUMNS = insertColumnsAfter(
  insertColumnsAfter(CORE_COLUMNS, 'name', OWNERSHIP_STATUS_COLUMN, TIER_PRICE_COLUMN, ADDON_COLUMN),
  'addon', ...PRICE_COLUMNS,
);
const BUNDLE_DEFAULT_VISIBLE = ['capsule', 'name', 'tierPrice', 'bestDealPrice', 'bestDealCut', 'steamdbRating', 'hltbAll', 'releaseDate', 'genres'];
const BUNDLE_DEFAULT_SORT: SortEntry[] = [{ key: 'tierPrice', dir: 'asc' }, { key: 'steamdbRating', dir: 'desc' }];

const DEFAULT_SORT: SortEntry[] = [{ key: 'steamdbRating', dir: 'desc' }];
const MAX_PRICE_LOOKUP_GAMES = 500; // mirrors the server's own cap — see loadWishlistPrices below

// The shape of one `data:` line in /api/game-details/stream's SSE response.
interface DetailsEvent {
  appid: number; done?: boolean;
  rating: Rating | null; hltb: Hltb | null; meta: GameMeta | null; tags: string[] | null;
  demo: { appid: number } | null; protondb: ProtonDb | null;
}

function applyDetailsEvent(row: Game, event: DetailsEvent) {
  row.capsule           = event.meta?.capsule ?? null;
  if (!row.name) row.name = event.meta?.name || '';
  row.score             = event.rating?.score ?? null;
  row.positivePct       = (event.rating?.positive != null && event.rating?.total)
    ? Math.round((event.rating.positive / event.rating.total) * 100) : null;
  row.steamdbRating     = computeSteamdbRating(event.rating?.positive ?? 0, event.rating?.total ?? 0);
  row.reviewsTotal      = event.rating?.total ?? null;
  row.hltbMain          = event.hltb?.main           ?? null;
  row.hltbExtra         = event.hltb?.extra          ?? null;
  row.hltbCompletionist = event.hltb?.completionist  ?? null;
  row.hltbAll           = event.hltb?.all            ?? null;
  row.metacritic        = event.meta?.metacritic?.score ?? null;
  row.releaseDate       = event.meta?.releaseDate    ?? null;
  row.comingSoon        = event.meta?.comingSoon     ?? false;
  row.genres            = event.meta?.genres     ?? [];
  row.developers        = event.meta?.developers ?? [];
  row.publishers        = event.meta?.publishers ?? [];
  row.categories        = event.meta?.categories ?? [];
  row.tags              = event.tags ?? [];
  row.protondb          = protonDbValue(event.protondb?.tier);
  row.protondbPending   = event.protondb?.pending ?? false;
  row.achievementCount  = event.meta?.achievementCount ?? null;
  row.dlcCount          = event.meta?.dlc?.length ?? null;
  row.platforms         = event.meta?.platforms ?? [];
  row.languages         = event.meta?.languages ?? [];
  row.hasDemo           = event.demo != null;
  row.type              = (TYPE_LABELS as Record<string, string>)[event.meta?.type ?? ''] ?? (event.meta?.type ? event.meta.type : null);
  row.productionTier    = computeProductionTier({
    isFree:       event.meta?.isFree ?? false,
    priceInitial: event.meta?.priceInitial ?? null,
    reviewsTotal: event.rating?.total ?? null,
    hasMetacritic: event.meta?.metacritic != null,
    isDlc:        event.meta?.fullgame != null,
    type:         event.meta?.type ?? null,
  });
  row.loading           = false;
  row.details           = { rating: event.rating, hltb: event.hltb, meta: event.meta, tags: event.tags, demo: event.demo, protondb: event.protondb };
}

// tableViewPrefs.ts's own bindViewPersistence needs `table.onViewChange`, which the Solid table
// doesn't have — reconstructed via a createEffect that re-reads getViewState() (tracking every
// signal it touches) instead, same as library.tsx's/bundles.tsx's own identical helper.
function bindSolidViewPersistence(ts: TableState<Game>, prefKey: string): () => void {
  let dispose: (() => void) | null = null;
  createRoot(d => {
    dispose = d;
    createEffect(() => setPref(prefKey, ts.getViewState()));
  });
  return () => dispose?.();
}

export default function ListRoute() {
  const params = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const kind = kindFromPath(location.pathname, params);

  let tableContainer!: HTMLDivElement;
  let groupsContainer!: HTMLDivElement;
  const [statusText, setStatusText] = createSignal('');
  const [priceStatusText, setPriceStatusText] = createSignal('');
  // kind === 'bundle' only — the open bundle's own title, for the header below (nothing else on
  // this route otherwise names which bundle is loaded at all).
  const [bundleTitle, setBundleTitle] = createSignal('');

  const [rowsStore, setRowsStore] = createStore<Game[]>([]);
  const rowStore = createRowStore<Game>((idx, updater) => setRowsStore(idx, updater));
  const loadGuard = createStaleGuard();
  let table: TableState<Game> | null = null;
  let disposeTable: (() => void) | null = null;
  let unsyncView: (() => void) | null = null;
  // Set only for kind === 'user' — its own per-list tableView, not a shared pref key. A signal
  // (not a plain variable, unlike most of this component's other imperative state) specifically
  // because the selection toolbar's JSX reads it reactively: /lists/:listId is one route
  // *definition* shared across every list id (see the createEffect at the bottom of this file),
  // so navigating between two user lists reuses this component instance without a remount —
  // a plain `let` wouldn't tell the already-mounted JSX that "the list being viewed" changed.
  const [userList, setUserList] = createSignal<GameList | null>(null);

  // ── Row-selection-based add/remove-to-list (see this file's own header comment) ────────────
  const [selectedRows, setSelectedRows] = createSignal<Game[]>([]);
  const [manualLists, setManualLists] = createSignal<GameList[]>(getLists().filter(l => l.kind === 'manual'));
  const NEW_LIST_OPTION = '__new__';
  const [addTarget, setAddTarget] = createSignal('');
  const [selectionActionStatus, setSelectionActionStatus] = createSignal('');

  function refreshManualLists(): void { setManualLists(getLists().filter(l => l.kind === 'manual')); }

  async function handleAddSelectedToList(): Promise<void> {
    const target = addTarget();
    const rows = selectedRows();
    if (!target || rows.length === 0) return;
    const appids = rows.map(r => r.appid);
    if (target === NEW_LIST_OPTION) {
      const name = window.prompt('New list name?');
      if (!name) return;
      const list = createList({ name, kind: 'manual', appids });
      refreshManualLists();
      setSelectionActionStatus(`Added ${appids.length} game(s) to new list "${list.name}".`);
    } else {
      const list = getList(target);
      addAppidsToList(target, appids);
      setSelectionActionStatus(`Added ${appids.length} game(s) to "${list?.name ?? 'list'}".`);
    }
    setAddTarget('');
    table?.selection.clear();
  }

  // Only ever called while viewing a manual list (`kind === 'user' && userList().kind ===
  // 'manual'` — see the JSX below), so `userList()` is always set here. Re-resolves the whole
  // route afterward (`load()`) rather than just splicing the removed rows out of `rowsStore`
  // directly — this is a genuine re-fetch-worthy state change (the list's own stored contents
  // changed), and `load()` already correctly handles every other piece of teardown/rebuild this
  // needs (table/rowsStore/stream), so re-deriving it by hand here would just be a second,
  // easier-to-drift-out-of-sync copy of that same logic. The status message is set *after*
  // `load()` resolves, not before — `load()`'s own reset (`setSelectionActionStatus('')`, same
  // as `setSelectedRows([])`, right at its top) runs synchronously the moment it's called and
  // would otherwise wipe out this exact message in the same tick it was set, before Solid ever
  // gets a chance to render it (confirmed live: the message never appeared until this was fixed).
  async function handleRemoveSelectedFromList(): Promise<void> {
    const list = userList();
    const rows = selectedRows();
    if (!list || rows.length === 0) return;
    const appids = rows.map(r => r.appid);
    removeAppidsFromList(list.id, appids);
    await load();
    setSelectionActionStatus(`Removed ${appids.length} game(s) from "${list.name}".`);
  }
  // group-by-membership mode: one real table per group instead of the single `table` above (see
  // buildGroupTables) — all sharing the one `rowsStore`/`rowStore` above (every game belongs to
  // exactly one group, so there's no overlap to worry about), one shared detail stream, and each
  // group's own createTableState fed by a filtered view into that shared store.
  let groupTables: { key: string; appids: Set<number>; table: TableState<Game>; disposeTable: () => void }[] = [];
  let activeGroupKey: string | null = null; // whichever group the currently-open game belongs to, for prev/next/random
  let total = 0;
  let loaded = 0;
  // kind === 'recent' only: the one row addRecentGame should persist once its data streams in —
  // set by openOrAddRecentGame right before kicking off that row's own stream call, cleared once
  // the matching event lands (see the detailBatcher below). Every *other* 'recent' row (already
  // in the persisted list before this mount) deliberately does NOT get re-persisted just because
  // its rating/HLTB/etc. happened to stream in again — that would bump its recency/order on
  // every visit to /game, not only when it's the one actually just looked up.
  let pendingRecentFocus: number | null = null;
  // kind === 'recent' only: whether load()'s full rebuild (below) has already run once for this
  // mount. /game/:appid? is one route *definition* shared across every appid (see the
  // createEffect at the bottom of this file), so navigating from /game/440 to /game/620 re-runs
  // load() without remounting the component — without this flag, that would re-fetch and
  // re-stream the *entire* recents list from scratch just to focus one more game already sitting
  // right there in rowsStore. Only 'recent' needs this: every other kind's own path/query
  // segment that can change without a remount (bundleId, listId) genuinely does warrant a full
  // reload (a different bundle/list is different data), unlike a same-list appid focus change.
  let hasLoadedOnce = false;
  // Guards a standalone-in-place lookup (openStandaloneInPlace) the same way GameRoute.tsx's own
  // `currentToken` used to — a slower earlier lookup resolving after a faster later one started
  // must not clobber it.
  let standaloneLookupToken = 0;

  function tableData(): Game[] { return rowsStore.filter(r => !r.loading); }

  // In group mode there's no single `table` — prev/next/random operate on whichever group the
  // currently-open game belongs to (activeGroupKey, kept in sync by renderPanelNav below).
  function activeTable(): TableState<Game> | null {
    if (groupTables.length) return groupTables.find(g => g.key === activeGroupKey)?.table ?? null;
    return table;
  }
  function getGameList(): Game[] { const t = activeTable(); return t ? t.processedData() : []; }

  // Scoped by specific id (and, in group mode, the active group) — kind/listId alone would
  // collide between two different bundles/user lists/groups navigated between without a remount
  // (see the createEffect below).
  function randomQueueKey(): string {
    if (kind === 'bundle') return `list-route:bundle:${params.bundleId}`;
    if (kind === 'user') return `list-route:user:${params.listId}:${activeGroupKey ?? ''}`;
    return `list-route:${kind}`;
  }

  // ‹/› bundle-to-bundle nav (kind === 'bundle' only) — steps through whatever's currently in
  // bundleBrowseStore.ts (the last-loaded /bundles list), same "no auto-load-more, no wraparound,
  // disable at either end or when the open bundle isn't part of that list at all (e.g. a fresh
  // deep link)" behavior bundles.tsx's own renderBundleNav had. Re-reads the store fresh on every
  // call rather than caching the index, so it stays correct as the store itself changes (a
  // "Load more" on /bundles while this route is open elsewhere) — cheap, a bundle list is never
  // more than a few hundred entries.
  function bundleNavIndex(): number {
    return getBrowsedBundles().findIndex(b => b.id === Number(params.bundleId));
  }
  function prevBundleId(): number | null {
    const idx = bundleNavIndex();
    return idx > 0 ? getBrowsedBundles()[idx - 1].id : null;
  }
  function nextBundleId(): number | null {
    const list = getBrowsedBundles();
    const idx = bundleNavIndex();
    return idx !== -1 && idx < list.length - 1 ? list[idx + 1].id : null;
  }

  function updateStatus(): void {
    if (total === 0) { setStatusText(''); return; }
    setStatusText(loaded >= total ? `${total} games` : `${loaded} / ${total} games loaded…`);
  }

  function renderPanelNav(game: Game): void {
    if (groupTables.length) {
      const owning = groupTables.find(g => g.appids.has(game.appid));
      activeGroupKey = owning?.key ?? null;
    }
    renderPanelNavShared({ table: activeTable(), game, getGameList, onOpen: openGame, onReroll: pickRandomGame });
  }

  function openGame(game: Game, { isRandom = false, keepHistory = false }: { isRandom?: boolean; keepHistory?: boolean } = {}): void {
    if (!isRandom) clearRandomQueue(randomQueueKey());
    const resolved = rowStore.getRow(game.appid) ?? game;
    panelOpen(resolved, { keepHistory });
    renderPanelNav(resolved);
    // 'recent' is the one kind whose address IS the focused game (see this file's own header
    // comment) — a row click/prev-next/random pick here updates the path, not a `?game=` query
    // param, so the address bar always matches whatever the panel is actually showing. This
    // re-triggers load()'s own createEffect, but harmlessly: the panel is already open by the
    // time this runs (right above), and load()'s fast path (see its own comment) checks the
    // panel's current game before doing anything, so the re-entry is a no-op rather than a
    // second open. Every other kind keeps the existing `?game=` contextual param instead.
    if (kind === 'recent') navigate(`/game/${resolved.appid}`, { replace: true });
    else setPanelParam(resolved.appid);
  }

  function pickRandomGame(): void {
    if (!activeTable() || getPanelGame()?.standalone) return;
    const pick = pickRandomFrom(getGameList(), randomQueueKey(), getPanelGame()?.appid ?? 0);
    if (pick) openGame(pick as Game, { isRandom: true });
  }

  function stepGame(dir: 1 | -1): boolean {
    const t = activeTable();
    if (!t) return false;
    const next = stepGameList(t, getGameList, getPanelGame(), dir);
    if (!next) return false;
    openGame(next);
    return true;
  }

  // Opens `appid` as a standalone panel docked to *this* route, without adding it to the route's
  // own table — used when a game looked up from here (nav search, a DLC/base-game link inside
  // the open panel) isn't one of this list's own rows. Ported from GameRoute.tsx's own
  // single-game fetch (this route is its only remaining caller now that a lookup with no route
  // of its own falls through to /game instead — see AppShell.tsx's openGameGlobally); `openGame`
  // already resolves `rowStore.getRow(appid) ?? game` and no-ops the nav bar for
  // `game.standalone` (panelNav.ts), so there's no extra plumbing needed here beyond that.
  async function openStandaloneInPlace(appid: number): Promise<void> {
    const token = ++standaloneLookupToken;
    if (!Number.isInteger(appid) || appid <= 0) { setStatusText('Invalid game id.'); return; }
    const game = { appid, name: `App ${appid}`, loading: true, details: null, standalone: true } as Game;
    openGame(game);
    try {
      const res = await fetch(`/api/game-details/${appid}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Lookup failed');
      if (token !== standaloneLookupToken) return; // a newer lookup has since taken over
      game.details = data;
      game.loading = false;
      if (data.meta?.name) game.name = data.meta.name;
      if (getPanelGame() === game) renderPanelBody(game);
      addRecentGame(game.appid, game.name, data.meta?.capsule || null);
    } catch (err) {
      if (token !== standaloneLookupToken) return;
      if (getPanelGame() === game) setStatusText(`Lookup failed: ${(err as Error).message}`);
    }
  }

  // kind === 'recent' only: opens `appid` within the recent-games list itself — an existing row
  // (full prev/next/random, same as clicking it) or, for a lookup not seen before, a freshly
  // prepended row that streams in alongside the rest of the list via the same batched
  // /api/game-details/stream every other row here uses (rather than the one-off single-game
  // fetch openStandaloneInPlace uses for every other kind) — since here the lookup IS meant to
  // become a real row, not a standalone aside. Used both by load()'s own params.appid handling
  // (a fresh /game/:appid navigation) and by handleOpenGameRequest (a lookup made while already
  // sitting on this route) — same behavior either way, since /game/:appid *is* this route now.
  function openOrAddRecentGame(appid: number): void {
    const existing = rowStore.getRow(appid);
    if (existing) { openGame(existing); return; }
    if (!Number.isInteger(appid) || appid <= 0) { setStatusText('Invalid game id.'); return; }
    const placeholder = { appid, name: '', loading: true, details: null } as unknown as Game;
    const rows = [placeholder, ...rowsStore];
    setRowsStore(rows);
    rowStore.load(rows);
    total++;
    updateStatus();
    pendingRecentFocus = appid;
    openGame(rowStore.getRow(appid)!);
    streamGameDetails([{ appid }], loadGuard.current());
  }

  // Registered with the shell (see onMount below) so a game looked up from the nav-bar search
  // box, or a DLC/base-game link inside an already-open panel, opens right here instead of
  // navigating away — every kind can place it somewhere sensible, so this always returns true;
  // the shell's own fallback (navigating to /game/:appid) is only ever reached from a route with
  // no game/list context at all (Home, Bundles browse, About — see AppShell.tsx's own comment).
  function handleOpenGameRequest(appid: number): boolean {
    // 'recent' is the one kind whose address IS the focused game (/game/:appid, not a query
    // param — see this file's own header comment) — navigating (rather than calling
    // openOrAddRecentGame directly) is what keeps the URL correct; load()'s own fast path below
    // (hasLoadedOnce) is what keeps that navigation cheap; it re-runs load() but, once already
    // mounted on this kind, that just calls straight back into openOrAddRecentGame instead of
    // refetching the whole recents list.
    if (kind === 'recent') { navigate(`/game/${appid}`, { replace: true }); return true; }
    const existing = rowStore.getRow(appid);
    if (existing) openGame(existing);
    else openStandaloneInPlace(appid);
    return true;
  }

  // Registered with the shell too (see onMount below), called from `initPanel`'s own `onClose` —
  // the direct counterpart to handleOpenGameRequest's own navigate() above, so closing the panel
  // strips `:appid` back off the address the same way opening one put it there. kind === 'recent'
  // only; every other kind's `?game=` clearing is handled generically by the shell itself
  // (setPanelParam(null), called unconditionally alongside this).
  function handleGameClose(): void {
    if (kind === 'recent' && params.appid) navigate('/game', { replace: true });
  }

  const detailBatcher = createStreamBatcher<DetailsEvent>({
    apply: event => {
      const row = rowStore.mutateRow(event.appid, draft => applyDetailsEvent(draft, event));
      if (!row) return;
      if (pendingRecentFocus === event.appid) {
        addRecentGame(row.appid, row.name, (row as { capsule?: string | null }).capsule ?? null);
        pendingRecentFocus = null;
      }
      // renderPanelBody reads straight off `row` (the plain panelRows copy mutateRow already
      // updated synchronously above), so it's always current regardless of batching. renderPanelNav
      // is NOT called here, though, even for this exact row — apply() runs inside flushNow()'s own
      // batch(), and renderPanelNav's own list comes from the *table's* processedData(), a Solid
      // memo derived from rowsStore; batch() defers that recomputation until the batch itself
      // returns, so a read here would still see this row (and anything else applied earlier in
      // this same flush) as it was *before* this flush — for a flush that's just this one row
      // (exactly the case a fresh single-game lookup hits), that means an empty list, a "0 / 0"
      // position stuck on screen, and a crash on Previous/Next (confirmed live before this fix:
      // `list[(idx - 1 + list.length) % list.length]` with `idx = -1, list = []` reads `list[NaN]`,
      // and onOpen(undefined) throws). onFlush below runs right after the batch instead.
      if (isPanelOpen() && getPanelGame()?.appid === row.appid) renderPanelBody(row);
    },
    isStale: gen => loadGuard.isStale(gen),
    onFlush: () => {
      updateStatus();
      const g = getPanelGame();
      if (g) renderPanelNav(g);
    },
  });

  async function streamGameDetails(games: { appid: number }[], gen: number): Promise<void> {
    let resp: Response;
    try {
      resp = await fetch('/api/game-details/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ games: games.map(g => ({ appid: g.appid })) }),
      });
    } catch (err) {
      if (loadGuard.isStale(gen)) return;
      setStatusText(`Details stream failed: ${(err as Error).message}`);
      return;
    }

    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      if (loadGuard.isStale(gen)) { reader.cancel(); return; }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';
      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith('data: ')) continue;
        let event: DetailsEvent;
        try { event = JSON.parse(line.slice(6)); } catch { continue; }
        if (event.done) continue;
        detailBatcher.push(event, gen);
        loaded++;
      }
    }
    if (loadGuard.isStale(gen)) return;
    detailBatcher.flushNow();
  }

  const itadConfiguredPromise = fetch('/api/health')
    .then(res => res.json())
    .then(data => !!data.itadConfigured)
    .catch(() => false);

  async function loadWishlistPrices(items: { appid: number }[], gen: number): Promise<void> {
    setPriceStatusText('');
    const configured = await itadConfiguredPromise;
    if (loadGuard.isStale(gen)) return;
    if (!configured) {
      batch(() => {
        for (const item of items) {
          const row = rowStore.mutateRow(item.appid, draft => nullAllPriceFields(draft));
          if (!row) continue;
          if (isPanelOpen() && getPanelGame() === row) renderPanelBody(row);
        }
      });
      return;
    }

    const country = resolveRegion(getStoredRegion());
    const appids = items.map(i => i.appid);
    for (let i = 0; i < appids.length; i += MAX_PRICE_LOOKUP_GAMES) {
      if (loadGuard.isStale(gen)) return;
      const chunk = appids.slice(i, i + MAX_PRICE_LOOKUP_GAMES);
      try {
        const prices = await postPrices({ appids: chunk, country });
        if (loadGuard.isStale(gen)) return;
        batch(() => {
          for (const appid of chunk) {
            const info = prices[appid];
            if (!info) continue;
            const row = rowStore.mutateRow(appid, draft => applyPriceInfo(draft, info, discountPct));
            if (!row) continue;
            if (isPanelOpen() && getPanelGame() === row) renderPanelBody(row);
          }
        });
      } catch (err) {
        if (loadGuard.isStale(gen)) return;
        batch(() => {
          for (const appid of chunk) {
            const row = rowStore.mutateRow(appid, draft => nullMissingPriceFields(draft));
            if (!row) continue;
            if (isPanelOpen() && getPanelGame() === row) renderPanelBody(row);
          }
        });
        setPriceStatusText(`Couldn't load Steam pricing (${(err as Error).message}) — other columns are unaffected.`);
      }
    }
  }

  // Stamps `inLibrary`/`onWishlist` onto every row from myOwnership.ts's own owned/wishlist
  // appid sets, checked against `currentAccount` (whichever account's list this route itself
  // loaded — see myOwnership.ts's own comment) — unlike loadWishlistPrices/loadBundlePrices
  // above, this is never a per-row fetch: myOwnership.ts already loads (and caches) the whole
  // sets once per loaded account, so checking membership for every row here costs nothing extra.
  // `peekMyOwnershipStatus` is a synchronous, non-blocking peek that can return null for "no
  // currentAccount loaded" *or* "still loading" (see its own comment in myOwnership.ts) —
  // indistinguishable here, so this just stamps whatever's already resolved immediately, then
  // re-stamps once via onMyOwnershipReady for whichever rows peeked null the first time around
  // (a no-op forever if no currentAccount is ever loaded, same as the panel's own "no badge at
  // all" behavior in that case).
  function stampMyOwnership(items: { appid: number }[]) {
    batch(() => {
      for (const item of items) {
        const status = peekMyOwnershipStatus(item.appid);
        if (!status) continue;
        const row = rowStore.mutateRow(item.appid, draft => {
          draft.inLibrary = status.inLibrary;
          draft.onWishlist = status.onWishlist;
        });
        if (row && isPanelOpen() && getPanelGame() === row) renderPanelBody(row);
      }
    });
  }
  function loadMyOwnership(items: { appid: number }[], gen: number): void {
    stampMyOwnership(items);
    onMyOwnershipReady(() => {
      if (loadGuard.isStale(gen)) return;
      stampMyOwnership(items);
    });
  }

  // Bundle prices are looked up by ITAD gid (already known upfront from the bundle's own
  // resolved games), not appid — mirrors bundles.tsx's own loadPrices. No chunking: unlike a
  // wishlist, a single bundle's game list never runs past the server's own cap.
  async function loadBundlePrices(resolved: ResolvedGame[], gen: number): Promise<void> {
    setPriceStatusText('');
    try {
      const prices = await postPrices({ gids: resolved.map(g => g.gid), country: resolveRegion(getStoredRegion()) });
      if (loadGuard.isStale(gen)) return;
      batch(() => {
        for (const g of resolved) {
          const info = prices[g.gid];
          if (!info) continue;
          const row = rowStore.mutateRow(g.appid, draft => applyPriceInfo(draft, info, discountPct));
          if (!row) continue;
          if (isPanelOpen() && getPanelGame() === row) renderPanelBody(row);
        }
      });
    } catch (err) {
      if (loadGuard.isStale(gen)) return;
      batch(() => {
        for (const g of resolved) {
          const row = rowStore.mutateRow(g.appid, draft => nullMissingPriceFields(draft));
          if (!row) continue;
          if (isPanelOpen() && getPanelGame() === row) renderPanelBody(row);
        }
      });
      setPriceStatusText(`Couldn't load Steam pricing (${(err as Error).message}) — other columns are unaffected.`);
    }
  }

  function viewPrefKey(): string {
    if (kind === 'wishlist') return 'wishlistListView';
    if (kind === 'bundle') return 'bundleListView';
    if (kind === 'recent') return 'recentListView';
    return 'ownedListView';
  }
  function viewParamName(): string {
    if (kind === 'wishlist') return 'wv';
    if (kind === 'bundle') return 'bv';
    if (kind === 'recent') return 'rv';
    return 'lv';
  }

  // Real per-group tables for a group-by-membership dynamic list — generalizes the old
  // Comparison page's "one table per owner set, most owners to fewest" layout (already sorted
  // that way by combine.ts's groupByMembership). Each group gets its own createTableState fed by
  // a filtered view into the one shared rowsStore (every game belongs to exactly one group, so
  // there's no overlap), and its own DOM container appended to groupsContainer — mounted
  // imperatively (document.createElement + render()) rather than via a reactive <For>, matching
  // the single-table path's own imperative construction just above.
  function buildGroupTables(groups: MembershipGroup[]): void {
    groupsContainer.innerHTML = '';
    groupTables = groups.map(group => {
      const appidSet = new Set(group.appids);

      const heading = document.createElement('h3');
      heading.className = 'list-group-heading';
      heading.textContent = `${group.keys.join(' + ')} (${group.appids.length})`;
      const container = document.createElement('div');
      container.className = 'table-container';
      groupsContainer.appendChild(heading);
      groupsContainer.appendChild(container);

      let disposeTableState!: () => void;
      const ts = createRoot(dispose => {
        disposeTableState = dispose;
        return createTableState<Game>(
          () => rowsStore.filter(r => !r.loading && appidSet.has(r.appid)),
          RECENT_COLUMNS as unknown as ColumnDef<Game>[],
          { initialViewState: { pageSize: 50, visibleCols: RECENT_DEFAULT_VISIBLE, sorts: DEFAULT_SORT } },
        );
      });
      const disposeView = render(() => DataTableView<Game>({
        table: ts,
        rowKey: 'appid',
        onRowClick: row => openGame(rowStore.getRow(row.appid) ?? row),
      }), container);

      return {
        key: group.keys.join(' '),
        appids: appidSet,
        table: ts,
        disposeTable: () => { disposeView(); disposeTableState(); },
      };
    });
  }

  async function load(): Promise<void> {
    if (kind === 'recent' && hasLoadedOnce) {
      // Guarded by "is this appid already the open panel's game" — openGame() above navigates
      // here too (to keep the address bar in sync with a row click/prev-next/random pick made
      // *within* this already-loaded list), which re-runs this same effect right after the panel
      // was already opened; without this check that re-entry would call openOrAddRecentGame a
      // second time for a game that's already showing.
      const focusAppid = params.appid ? Number(params.appid) : null;
      if (focusAppid != null && getPanelGame()?.appid !== focusAppid) openOrAddRecentGame(focusAppid);
      else if (focusAppid == null && isPanelOpen()) panelClose();
      return;
    }

    const gen = loadGuard.next();

    if (disposeTable) { disposeTable(); disposeTable = null; }
    table = null;
    groupTables.forEach(g => g.disposeTable());
    groupTables = [];
    activeGroupKey = null;
    setRowsStore([]);
    rowStore.reset();
    total = 0;
    loaded = 0;
    tableContainer.innerHTML = '';
    groupsContainer.innerHTML = '';

    let initialRows: Game[];
    let streamTargets: { appid: number }[];
    let resolvedBundleGames: ResolvedGame[] | null = null;
    let pendingGroups: MembershipGroup[] | null = null;
    setUserList(null);
    setSelectedRows([]); // a fresh load means a fresh table — nothing carries a prior selection over
    setSelectionActionStatus('');

    if (kind === 'user') {
      // A manual list, or a dynamic one using any op other than group-by-membership, renders as
      // one flat table (flattened via flattenCombineResult, same as when it's resolved as
      // someone *else's* combine source). group-by-membership instead keeps its raw
      // MembershipGroup[] result (stashed in pendingGroups) for buildGroupTables to render as
      // real per-group tables further down, once the shared rowsStore/stream have loaded.
      const list = getList(params.listId!);
      if (!list) { setStatusText('This list no longer exists.'); return; }
      setUserList(list);
      setStatusText('Resolving list…');
      const isGroupMode = list.kind === 'dynamic' && list.op === 'group-by-membership';
      let appids: Set<number>;
      try {
        const result = await resolveGameList(list, createDefaultFetchers());
        if (loadGuard.isStale(gen)) return;
        if (isGroupMode && Array.isArray(result)) {
          pendingGroups = result;
          appids = new Set(result.flatMap(g => g.appids));
        } else {
          appids = flattenCombineResult(result);
        }
      } catch (err) {
        if (loadGuard.isStale(gen)) return;
        setStatusText(`Error: ${(err as Error).message}`);
        return;
      }
      initialRows = [...appids].map(appid => ({
        appid, name: '', loading: true, details: null,
      })) as unknown as Game[];
      streamTargets = [...appids].map(appid => ({ appid }));
    } else if (kind === 'recent') {
      const recents = loadRecentGames();
      initialRows = recents.map(g => ({
        appid: g.appid, name: g.name || `App ${g.appid}`, capsule: g.tinyImage || undefined,
        loading: true, details: null,
      })) as unknown as Game[];
      streamTargets = recents;
    } else if (kind === 'bundle') {
      setStatusText('Resolving games to Steam…');
      try {
        const bundle = await fetchBundleById(Number(params.bundleId), { country: resolveRegion(getStoredRegion()) });
        if (loadGuard.isStale(gen)) return;
        setBundleTitle(bundle.title);
        const { resolved } = await resolveBundleGames(bundle);
        if (loadGuard.isStale(gen)) return;
        if (resolved.length === 0) { setStatusText('No games in this bundle could be matched to a Steam listing.'); return; }
        resolvedBundleGames = resolved;
        initialRows = resolved.map(g => ({
          appid: g.appid, name: g.title, tierPrice: g.tierPrice, tierCurrency: g.tierCurrency, addon: g.addon,
          steamRegular: undefined, bestDealPrice: undefined, bestDealShop: undefined, bestDealUrl: undefined,
          bestDealCut: undefined, lowAll: undefined, lowY1: undefined, lowM3: undefined, priceCurrency: undefined,
          loading: true, details: null,
        })) as unknown as Game[];
        streamTargets = resolved;
      } catch (err) {
        if (loadGuard.isStale(gen)) return;
        setStatusText(`Error: ${(err as Error).message}`);
        return;
      }
    } else {
      const account = getCurrentAccount();
      if (!account) { setStatusText('No account selected — pick one from Home once it exists.'); return; }
      setStatusText(kind === 'wishlist' ? 'Fetching wishlist…' : 'Fetching library…');
      try {
        if (kind === 'owned') {
          const games = await fetchAccountOwnedGames(account.members);
          if (loadGuard.isStale(gen)) return;
          initialRows = games.map(g => ({
            appid: g.appid, name: g.name,
            playtime: g.playtimeMinutes / 60, lastPlayed: fmtLastPlayed(g.lastPlayedUnix),
            loading: true, details: null,
          })) as unknown as Game[];
          streamTargets = games;
        } else {
          const items = await fetchAccountWishlistItems(account.members);
          if (loadGuard.isStale(gen)) return;
          initialRows = items.map(item => ({
            appid: item.appid, name: '', priority: item.priority, dateAdded: item.dateAdded,
            steamRegular: undefined, bestDealPrice: undefined, bestDealShop: undefined, bestDealUrl: undefined,
            bestDealCut: undefined, lowAll: undefined, lowY1: undefined, lowM3: undefined, priceCurrency: undefined,
            loading: true, details: null,
          })) as unknown as Game[];
          streamTargets = items;
        }
      } catch (err) {
        if (loadGuard.isStale(gen)) return;
        setStatusText(`Error: ${(err as Error).message}`);
        return;
      }
    }

    setRowsStore(initialRows);
    rowStore.load(initialRows);
    total = initialRows.length;

    if (pendingGroups) {
      buildGroupTables(pendingGroups);
    } else {
      const columns = (
        kind === 'wishlist' ? WISHLIST_COLUMNS
          : kind === 'bundle' ? BUNDLE_COLUMNS
          : kind === 'recent' || kind === 'user' ? RECENT_COLUMNS
          : OWNED_COLUMNS
      ) as unknown as ColumnDef<Game>[];
      const defaultVisible = kind === 'wishlist' ? WISHLIST_DEFAULT_VISIBLE
        : kind === 'bundle' ? BUNDLE_DEFAULT_VISIBLE
        : kind === 'recent' || kind === 'user' ? RECENT_DEFAULT_VISIBLE
        : OWNED_DEFAULT_VISIBLE;
      const sort = kind === 'bundle' ? BUNDLE_DEFAULT_SORT : DEFAULT_SORT;

      let disposeTableState!: () => void;
      const ts = createRoot(dispose => {
        disposeTableState = dispose;
        const state = createTableState<Game>(tableData, columns, {
          initialViewState: { pageSize: 50, visibleCols: defaultVisible, sorts: sort },
        });
        // Mirrors this table's own selection into a component-level signal so the JSX selection
        // toolbar below stays correct regardless of which load() constructed the table it's
        // currently reading from — disposed alongside the table itself (same createRoot), so a
        // later reload's own fresh table doesn't fight this effect over who last wrote the signal.
        createEffect(() => setSelectedRows(state.selection.rows()));
        return state;
      });
      table = ts;
      const disposeView = render(() => DataTableView<Game>({
        table: ts,
        rowKey: 'appid',
        selectable: true,
        onRowClick: row => openGame(rowStore.getRow(row.appid) ?? row),
      }), tableContainer);
      disposeTable = () => { disposeView(); disposeTableState(); };
      if (userList()) {
        // A user list's view lives on the list itself (GameList.tableView), not a shared pref
        // key — every user list keeps its own, unlike the fixed system kinds above which share
        // one key regardless of instance (see docs/list-centric-redesign.md's storage schema).
        const list = userList()!;
        table.setViewState(list.tableView ?? {});
        unsyncView = (() => {
          let dispose: (() => void) | null = null;
          createRoot(d => {
            dispose = d;
            createEffect(() => setListTableView(list.id, ts.getViewState()));
          });
          return () => dispose?.();
        })();
      } else {
        restoreTableView(table, viewPrefKey(), viewParamName());
        unsyncView = bindSolidViewPersistence(table, viewPrefKey());
      }
    }

    updateStatus();
    hasLoadedOnce = true;

    // Opens whatever this load's own URL says should be open — params.appid (a /game/:appid
    // navigation) for 'recent', or a route-local ?game= query param for every other kind (see
    // handleOpenGameRequest's own comment for why these are two different mechanisms: 'recent'
    // rows come from the same path the game itself lives at, everything else is contextual state
    // layered on top of a route that already has its own identity). Placed after the table/rows
    // are built (openGame/openOrAddRecentGame both need rowStore/table to already exist) and
    // before the streamTargets-empty early return below, since a first-ever /game/:appid lookup
    // can arrive with an otherwise-empty recents list. Only the *first* load needs to do this
    // here — a later appid-only change is handled by load()'s own fast path above instead.
    if (kind === 'recent') {
      if (params.appid) openOrAddRecentGame(Number(params.appid));
    } else {
      const gameParam = new URLSearchParams(location.search).get('game');
      if (gameParam) {
        const focusAppid = Number(gameParam);
        const existing = rowStore.getRow(focusAppid);
        if (existing) openGame(existing);
        else openStandaloneInPlace(focusAppid);
      }
    }

    // An empty result set was practically unreachable before row-selection-based remove-from-
    // list existed (a bundle already early-returns its own "no games matched" message above;
    // every other kind just happened to always have at least one row) — now that "Remove from
    // this list" can genuinely empty a manual list out from under the route currently viewing
    // it, streamGameDetails needs its own guard too: the server 400s a `games: []` stream
    // request outright ("Provide at least one game"), confirmed live the first time this path
    // was actually reachable through the UI.
    if (streamTargets.length === 0) { setStatusText('No games to show.'); return; }

    if (kind === 'wishlist') loadWishlistPrices(streamTargets, gen); // runs concurrently, not awaited
    if (kind === 'bundle' && resolvedBundleGames) loadBundlePrices(resolvedBundleGames, gen); // ditto
    if (kind === 'bundle' || kind === 'recent' || kind === 'user') loadMyOwnership(streamTargets, gen); // ditto
    await streamGameDetails(streamTargets, gen);
  }

  onMount(() => {
    const unregister = registerRouteHandlers({ pickRandom: pickRandomGame, stepGame, openGame: handleOpenGameRequest, onGameClose: handleGameClose });
    onCleanup(unregister);
  });

  // A plain createEffect, not onMount — /lists/bundle/:bundleId, the generic /lists/:listId, and
  // /game/:appid? are each one route *definition* shared across every id, so navigating from one
  // bundle/list/game to another under the same pattern reuses this component instance rather
  // than remounting it. params.bundleId/params.listId/params.appid are read reactively inside
  // load() itself (via the outer `params` object) — referencing them here is what makes this
  // effect re-run on a param-only navigation; 'owned'/'wishlist' have no such param and so only
  // ever run once, identically to the old onMount-based call.
  createEffect(() => { params.bundleId; params.listId; params.appid; load(); });

  onCleanup(() => {
    // The panel's own nav bar (renderPanelNav) points at *this* mount's table/getGameList —
    // leaving the route without closing it would leave the panel open on a stale game with a
    // prev/next list that no longer exists once disposeTable runs just below.
    if (isPanelOpen()) panelClose();
    loadGuard.next(); // invalidate any still-in-flight fetch/stream from this mount
    if (disposeTable) disposeTable();
    groupTables.forEach(g => g.disposeTable());
    if (unsyncView) unsyncView();
  });

  return (
    <div class="list-route">
      <Show when={kind === 'bundle'}>
        <div class="bundle-detail-header">
          <div class="bundle-detail-titlebar">
            <div class="bundle-detail-nav">
              <button type="button" disabled={prevBundleId() == null} onClick={() => { const id = prevBundleId(); if (id != null) navigate(`/lists/bundle/${id}`); }}>‹</button>
              <button type="button" disabled={nextBundleId() == null} onClick={() => { const id = nextBundleId(); if (id != null) navigate(`/lists/bundle/${id}`); }}>›</button>
            </div>
            <span class="bundle-detail-title">{bundleTitle()}</span>
          </div>
          <a class="btn btn-ghost btn-sm" href="/bundles">← All bundles</a>
        </div>
      </Show>
      <div class="list-status">{statusText()}</div>
      {(kind === 'wishlist' || kind === 'bundle') && <div class="price-status">{priceStatusText()}</div>}
      <Show when={selectedRows().length > 0}>
        <div class="selection-toolbar">
          <span class="selection-count">{selectedRows().length} selected</span>
          <select value={addTarget()} onChange={e => setAddTarget(e.currentTarget.value)}>
            <option value="">Add to list…</option>
            <For each={manualLists().filter(l => l.id !== userList()?.id)}>
              {l => <option value={l.id}>{l.name}</option>}
            </For>
            <option value={NEW_LIST_OPTION}>+ Create new list…</option>
          </select>
          <button type="button" disabled={!addTarget()} onClick={handleAddSelectedToList}>Add</button>
          <Show when={kind === 'user' && userList()?.kind === 'manual'}>
            <button type="button" onClick={handleRemoveSelectedFromList}>Remove from this list</button>
          </Show>
          <button type="button" onClick={() => table?.selection.clear()}>Clear selection</button>
        </div>
      </Show>
      {/* Outside the selection-gated block above on purpose — "Add"/"Remove" both clear the
          selection right after acting (Add explicitly; Remove via load()'s own reset), and the
          whole point of this message is to confirm what just happened *after* that clears. */}
      {selectionActionStatus() && <div class="selection-status">{selectionActionStatus()}</div>}
      <div ref={tableContainer} class="table-container"></div>
      <div ref={groupsContainer} class="list-groups"></div>
    </div>
  );
}
