'use strict';

import { esc, formatMoney, fmtLastPlayed, computeSteamdbRating, computeProductionTier, normalizeInput, discountPct } from '/utils.ts';
import { renderOwnersHtml } from '/ownerListHtml.ts';
import { reorderUrlParams, setPanelParam, setLightboxParam } from '/urlState.ts';
import { restoreTableView, shareTableView, resetTableView } from '/tableViewPrefs.ts';
import { stepGameList } from '/panelNav.ts';
import { bindPanelKeyboardShortcuts } from '/panelKeyboard.ts';
import { postPrices, applyPriceInfo, nullMissingPriceFields, nullAllPriceFields } from '/priceLoading.ts';
import { COUNTRY_OPTIONS, getStoredRegion, setStoredRegion, resolveRegion, REGION_CHANGED_EVENT } from '/region.ts';
import { updateNavLink } from '/nav.tsx';
import { addRecent } from '/accountsBar.ts';
import { renderAccountChips, bindAccountRefresh, renderRecentsBar, bindRecentsBar } from '/accountsBar.tsx';
import { initGameSearch, addRecentGame, renderRecentGamesBar, bindRecentGamesBar } from '/gameSearch.ts';
import { openLightbox, isLightboxOpen } from '/lightbox.tsx';
import {
  panelOpen, panelClose, isPanelOpen, getPanelGame, panelStepHero,
  pickRandomFrom, clearRandomQueue, panelHandleEscape,
  renderPanelBody, bumpPanelNav,
} from '/panel.tsx';
import { initPageShell } from '/pageShell.ts';
import { setPref } from '/prefs.ts';
import { createRowStore } from '/rowStore.ts';
import { createStaleGuard } from '/staleGuard.ts';
import { createStreamBatcher } from '/streamBatcher.ts';

import { createSignal, createRoot, createEffect, batch } from 'solid-js';
import { createStore } from 'solid-js/store';
import { render } from 'solid-js/web';
import { createTableState, DataTableView } from '@vates/data-table-solid';
import type { ColumnDef, SortEntry, TableState } from '@vates/data-table-solid';
import { bucketDatePart, formatDatePart } from '@vates/data-table-core';
import {
  fmt, insertColumnsAfter, CORE_COLUMNS, PRICE_COLUMNS, compareDateMissingLast,
  withMissingGroup, formatMissingGroup, halfDecadeBucket, formatHalfDecadeBucket,
  protonDbValue, TYPE_LABELS,
} from '/gameColumns.ts';
import type { Game, Rating, Hltb, GameMeta, ProtonDb, Achievements } from '/types.ts';
import type { AccountChipPlayer } from '/accountsBar.ts';

// ── Library-tab-only columns — an owned game has playtime/last-played data a wishlist or
// bundle game doesn't (see gameColumns.js's own header comment for what's shared vs.
// page-specific and why everything else lives there instead).
//
// No compare override here either — 0 hours played is real data (owned, never launched), not
// a stand-in for "unknown," so the default numeric sort is already correct. `defaultSortDir:
// 'desc'` still applies — "what have I sunk the most hours into" is the more common question
// than the reverse.
// Same log-scale reasoning as reviewsTotal (gameColumns.js) — Steam playtime is famously
// long-tailed (thousands of hours in a handful of games next to dozens barely launched),
// verified against a real library where p50-p90 of played games alone spanned 1.1h-9.8h,
// entirely inside one base-10 decade. `totalMin / 60` (see loadLibrary below) is always a real
// number, never `null` — a slot that owns but never played a game still sums to a real 0 — so
// no `withMissingGroup` wrapper is needed here, unlike reviewsTotal/hltb*/the date columns.
const PLAYTIME_COLUMN: ColumnDef<Record<string, any>> = {
  key: 'playtime', label: 'Played (h)', type: 'number', groupable: true,
  format: v => (v as number) > 0 ? Number(v).toFixed(1) : '—', defaultSortDir: 'desc',
  groupValue: halfDecadeBucket, groupFormat: formatHalfDecadeBucket('h', 'Not played'),
  keepVisibleWhenGrouped: true, category: 'Play Time & Dates',
};
// Most recent `rtime_last_played` across every account merged into this row (a Steam Family
// slot unions several accounts — see groupByOwnership — so "last played" here means "by
// anyone in the slot", not any one account in particular). '' (never played by anyone in the
// slot) is real data, not missing data, so no compare override is needed beyond the shared
// date comparator below, which already pins an empty string last.
// Hidden by default (see DEFAULT_VISIBLE) — Steam's GetOwnedGames only returns real
// rtime_last_played data for the account whose own key is querying it; every other account
// comes back with it absent, indistinguishable from "owned but never launched". Most searches
// here involve at least one non-key-owner account, so a visible-by-default column would read
// as meaningful data when it's often just an API restriction. updateLastPlayedTooltip() below
// adds a header tooltip warning specifically when every loaded row shows no value at all —
// the tell for "this whole column is unavailable", not "nobody's touched their library".
// `defaultSortDir: 'desc'` — "last modified"-style date column, the textbook case the option's
// own doc comment cites; a first click should surface who's been played most recently, not
// dredge up the stalest entry. `defaultValueSort` (also new in 0.8.0) opens the date filter
// tree most-recent-year-first instead of the tree's own default oldest-first — `by: 'alpha'`
// is what a date tree actually uses (there's no by-count order for a tree of date branches;
// see the Grouped columns / Date filter tree docs), just flipped to descending.
// Grouped by year (`bucketDatePart('year')`) rather than the exact date — an exact last-played
// date is close to unique per game, so ungrouped grouping would produce close to one row-sized
// group per game, the same "continuous column" problem reviewsTotal/playtime have. "Never
// played by anyone in the slot" is `''`, not `null` (see fmtLastPlayed in utils.js), hence the
// explicit `isMissing` override — `withMissingGroup`'s default only checks for `null`/`undefined`.
const LAST_PLAYED_COLUMN: ColumnDef<Record<string, any>> = {
  key: 'lastPlayed', label: 'Last Played', type: 'date', groupable: true, format: fmt.str,
  compare: compareDateMissingLast, defaultSortDir: 'desc', defaultValueSort: { by: 'alpha', dir: 'desc' },
  groupValue: withMissingGroup(bucketDatePart('year'), (v: unknown) => v == null || v === ''),
  groupFormat: formatMissingGroup(formatDatePart('year')), keepVisibleWhenGrouped: true,
  category: 'Play Time & Dates',
};

// The Library tab's own column list — CORE_COLUMNS (public/gameColumns.js) plus Played/Last
// Played inserted right after the HLTB section, the "Play time & dates" position those two
// have always occupied (no price columns — an owned game has nothing to buy).
const COLUMNS = insertColumnsAfter(CORE_COLUMNS, 'hltbCompletionist', PLAYTIME_COLUMN, LAST_PLAYED_COLUMN);

const DEFAULT_VISIBLE = [
  'capsule', 'name', 'steamdbRating', 'hltbAll', 'playtime', 'releaseDate', 'genres',
];

// Passed as part of `initialViewState` at table construction — also what `resetTableView`'s own
// `setViewState({})` blanking restores, so unlike before there's no separate priming call or
// manual reapply-after-reset needed for this.
const DEFAULT_SORT: SortEntry[] = [{ key: 'steamdbRating', dir: 'desc' }];

// ── Wishlist-only columns ────────────────────────────────────────────────────
// No defaultSortDir — Steam's wishlist rank is already 1-at-the-top, so the plain ascending
// default a fresh click starts at is the useful direction as-is. Placed right after Name (an
// identity-adjacent "which one is this" attribute for a wishlist row) rather than off in the
// Scores/Dates sections where it doesn't fit either.
const WISHLIST_RANK_COLUMN: ColumnDef<Record<string, any>> =
  { key: 'priority',  label: 'Wishlist Rank', type: 'number', groupable: false, format: fmt.num };

// Same "last modified"-style reasoning as the owned-library's Last Played/Released columns
// above — a fresh click (and the filter's date tree) should lead with what was added most
// recently, not the oldest wishlist entry. Placed right after Released, in the same Play
// time & dates section, rather than at the very end of the column list.
// Grouped by year (`bucketDatePart('year')`), same as Released/Last Played above — an exact
// added-on date is close to unique per row, so ungrouped grouping would produce close to one
// group per game, the same "continuous column" problem those two columns already solve for.
// `null` (no wishlist add-date at all) is the only missing case here.
const WISHLIST_DATE_ADDED_COLUMN: ColumnDef<Record<string, any>> =
  { key: 'dateAdded', label: 'Added',         type: 'date',   groupable: true,  format: fmt.str, compare: compareDateMissingLast,
    defaultSortDir: 'desc', defaultValueSort: { by: 'alpha', dir: 'desc' },
    groupValue: withMissingGroup(bucketDatePart('year')),
    groupFormat: formatMissingGroup(formatDatePart('year')), keepVisibleWhenGrouped: true,
    category: 'Play Time & Dates' };

// The Wishlist tab's own column list — CORE_COLUMNS plus its price cluster (PRICE_COLUMNS,
// public/gameColumns.js — Bundles gets the exact same cluster in the exact same relative
// position, right after its own identity/page-specific columns and before Scores & reviews)
// plus Wishlist Rank right after Name and Added right after Released. Unlike owned games —
// whose name is known upfront from Steam's library API — a wishlist row's name only arrives
// once its store metadata streams in; CORE_COLUMNS' own `name` column already uses `fmt.str`
// for that loading state unconditionally (harmless for the Library tab above, whose owned-game
// names are always known upfront), so no per-page override is needed here the way there used
// to be. No playtime/lastPlayed either — those live only on COLUMNS (the Library tab) above,
// never in CORE_COLUMNS itself.
const WISHLIST_COLUMNS = insertColumnsAfter(
  insertColumnsAfter(
    insertColumnsAfter(CORE_COLUMNS, 'name', WISHLIST_RANK_COLUMN),
    'priority', ...PRICE_COLUMNS
  ),
  'releaseDate', WISHLIST_DATE_ADDED_COLUMN
);

// Same as DEFAULT_VISIBLE plus `hasDemo` ("can I try this before buying" matters more on a
// wishlist than in an owned library) and Best Deal/Discount — same "visible by default" pair
// bundles.js's own price columns get, for the same "is this actually worth buying" at-a-glance
// reason. Steam Full Price itself stays hidden (see bundles.js's own DEFAULT_VISIBLE comment).
// Included unconditionally, even when ITAD isn't configured (in which case loadWishlistPrices
// below fills every row's price fields with `null` rather than leaving the columns stuck on
// their loading placeholder) — same "just renders as no-data" treatment any other optional/
// missing field gets elsewhere in this table, rather than needing a second, conditionally-built
// visible-columns list just for this one optional feature.
const WISHLIST_DEFAULT_VISIBLE = [
  'capsule', 'name', 'dateAdded', 'steamdbRating', 'hltbAll', 'releaseDate', 'genres', 'hasDemo',
  'bestDealPrice', 'bestDealCut',
];

const playerInput   = document.getElementById('player-input') as HTMLInputElement;
const loadBtn       = document.getElementById('load-btn')!;
const statusEl      = document.getElementById('status')!;
const priceStatusEl = document.getElementById('price-status')!;
const refreshPricesBtn = document.getElementById('refresh-prices-btn') as HTMLButtonElement;
const accountsBarEl = document.getElementById('accounts-bar')!;
const recentsBarEl  = document.getElementById('recents-bar')!;
const recentGamesBarEl = document.getElementById('recent-games-bar')!;
const tableContainer = document.getElementById('table-container')!;
const resetViewBtn  = document.getElementById('reset-view-btn')!;
const shareViewBtn  = document.getElementById('share-view-btn')!;
const tabLibraryBtn  = document.getElementById('tab-library')!;
const tabWishlistBtn = document.getElementById('tab-wishlist')!;
const wishlistRegionLabelEl = document.getElementById('wishlist-region-label')!;
const wishlistRegionValueEl = document.getElementById('wishlist-region-value')!;
const shortcutsModalEl = document.getElementById('shortcuts-modal')!;
const shortcutsBackdropEl = document.getElementById('shortcuts-backdrop')!;

// ── Page state signals ──────────────────────────────────────────────────────
// The rest of this page's own scalar UI state as Solid
// signals, each driving a small createEffect below against the existing static markup — same
// pattern as bundles.tsx's own step 5. Every function that used to write these directly now
// calls the matching setter instead.
//
// Deliberately NOT converted to a signal: `activeTab` (and the tab buttons' `aria-selected`/
// `loadBtn`'s own label/the region label's visibility that depend on it) stays a plain variable,
// mutated directly inside the one function that ever changes it (`setActiveTab`) exactly as
// before. Unlike the state below, nothing reads `activeTab` reactively from anywhere outside
// that single call site — there's no JSX/component in this file at all (no genuinely list-shaped
// render the way bundles.tsx's bundle list needed one), so a signal here would add Solid
// machinery for zero benefit over the direct imperative update already sitting right there. Same
// reasoning `accountsBarEl`'s own `.hidden`/content stay untouched: `accountsBar.ts`'s
// `renderAccountChips` (shared with the still-unconverted `app.ts`, out of scope for this plan)
// already owns that element directly, and layering a second, Solid-driven writer over the same
// element would just be two mechanisms fighting over one target for no reason.
const [statusText, setStatusText] = createSignal('');
const [priceStatusText, setPriceStatusText] = createSignal('');
const [resetViewHidden, setResetViewHidden] = createSignal(true);
const [shareViewHidden, setShareViewHidden] = createSignal(true);
const [refreshPricesHidden, setRefreshPricesHidden] = createSignal(true);
const [refreshPricesDisabled, setRefreshPricesDisabled] = createSignal(false);
const [refreshPricesLabel, setRefreshPricesLabel] = createSignal('↻ Refresh prices');
const [wishlistRegionHidden, setWishlistRegionHidden] = createSignal(true);
const [wishlistRegionValue, setWishlistRegionValue] = createSignal('');
const [shortcutsOpen, setShortcutsOpen] = createSignal(false);

// One createRoot for every scalar signal → DOM effect — module-lifetime, same as this page's own
// event listeners and initPageShell() call below (nothing on this page tears itself down before
// a full navigation), so it's never explicitly disposed. See bundles.tsx's own identical block
// for the same reasoning.
createRoot(() => {
  createEffect(() => { statusEl.textContent = statusText(); });
  createEffect(() => { priceStatusEl.textContent = priceStatusText(); });
  createEffect(() => { resetViewBtn.hidden = resetViewHidden(); });
  createEffect(() => { shareViewBtn.hidden = shareViewHidden(); });
  createEffect(() => { refreshPricesBtn.hidden = refreshPricesHidden(); });
  createEffect(() => { refreshPricesBtn.disabled = refreshPricesDisabled(); });
  createEffect(() => { refreshPricesBtn.textContent = refreshPricesLabel(); });
  createEffect(() => { wishlistRegionLabelEl.hidden = wishlistRegionHidden(); });
  createEffect(() => { wishlistRegionValueEl.textContent = wishlistRegionValue(); });
  createEffect(() => {
    shortcutsModalEl.classList.toggle('open', shortcutsOpen());
    shortcutsBackdropEl.classList.toggle('open', shortcutsOpen());
  });
});

// The Solid table (@vates/data-table-solid —
// mirrors bundles.tsx's own conversion) — fed by the `tableData()` accessor below, mounted into
// `tableContainer` via Solid's own `render()`. `disposeTable` combines that render's unmount fn
// with `createTableState`'s own disposal (see `buildTable` further down); `table` itself is
// reused as the reactive-state object every other call site (getGameList/tableViewPrefs.ts/etc.)
// reads from, same as before.
let table         : TableState<Game> | null = null;
let disposeTable  : (() => void) | null = null;
let unsyncView    : (() => void) | null            = null;
let total         = 0;
let loaded        = 0;
// `rowsStore`/`panelRows` — a real Solid store for the table + a deliberately separate, plain
// (never store-linked) map for the panel. Same split as bundles.tsx's own conversion — see its
// header comment there for the full "why two objects per row" story: `@vates/data-table-solid`'s
// own per-cell rendering re-renders correctly off a
// store-proxied row with no rowCache.ts-style reference-copy needed, but panel.tsx's own lazy
// loaders (news/DLC/price) mutate whatever `Game` object they're given via plain `game.field = x`
// writes, which a Solid store blocks outright — confirmed to bite this page too, not just
// bundles.tsx, since `onRefresh`/loadAchievements below do the exact same thing. `rowIndex`
// (appid -> array index) replaces the old `rowMap`'s appid -> object mapping for the store side;
// `getRow` is the one place that resolves an appid back to the *panel's* plain copy.
const [rowsStore, setRowsStore] = createStore<Game[]>([]);
// `rowStore` (see rowStore.ts) holds `rowIndex`/`panelRows` and the `getRow`/`mutateRow` pair —
// `getRow` is the one place that resolves an appid back to the *panel's* plain copy.
const rowStore = createRowStore<Game>((idx, updater) => setRowsStore(idx, updater));
// A new generation is taken at the start of every loadLibrary()/loadWishlist() call, and
// checked again at every point afterward that touches rowStore/table/disposeTable or their
// derived UI — rapid Library<->Wishlist tab switching (or two quick player loads) can otherwise
// let an earlier, superseded call's still-running fetch/stream keep writing into the newer
// call's rowStore/table once it resolves, the same race bundles.tsx's openBundle needed
// openBundleGuard for.
const loadGuard = createStaleGuard();
function getRow(appid: number): Game | undefined {
  return rowStore.getRow(appid);
}
function mutateRow(appid: number, fn: (draft: Game) => void): Game | undefined {
  return rowStore.mutateRow(appid, fn);
}
// Non-loading rows, fed straight to `createTableState` as a plain accessor (see `buildTable`
// below) — no explicit "notify the table" call needed anywhere in this file anymore; reading
// `.loading` off every row here is itself a tracked store read, so this recomputes whenever any
// row's `loading` flag flips, same moment an explicit `setTableData(...)` used to be called by
// hand.
function tableData(): Game[] {
  return rowsStore.filter(r => !r.loading);
}
let activeColumns = COLUMNS;   // COLUMNS or WISHLIST_COLUMNS, whichever tab is active
let activeTab     : 'library' | 'wishlist' = 'library'; // 'library' | 'wishlist'
let currentPlayerStr = '';     // last player string actually loaded (not just typed)
// Steam64 ids of every account currently loaded (one flat group — see accountsBar.js's
// comment on why the Library Explorer only ever has one), used to fetch per-game
// achievement progress for the side panel. Achievements aren't tied to a specific tab —
// wishlisted/standalone-looked-up games can still report progress — only to a player
// actually being loaded, so this is shared by both loadLibrary and loadWishlist.
let currentSteamIds: string[] = [];
// Persona name(s) of whoever's currently loaded (joined with " + " for a merged Family), used
// by updateTitle below. Kept separate from currentPlayerStr (which holds raw typed/URL input)
// since the title should show resolved persona names, not account handles.
let currentPlayerLabel = '';
// Full player objects ({steamid, personaname, profileurl}[]) for the side panel's "Owned by"
// section (buildLibraryOwnersHtml) — only ever populated by loadLibrary, never loadWishlist
// (wishlist items aren't owned by anyone), so the section naturally stays hidden on that tab
// without needing its own tab check. playtimeByAppid/lastPlayedByAppid are the matching
// per-account raw maps `/api/common-games` already returns (same shape as app.js's own
// `playtime`/`lastPlayed`) — loadLibrary otherwise only keeps the summed/maxed-across-accounts
// numbers it writes onto each row, which is all the table itself needs but flattens away
// exactly the per-member breakdown a merged Steam Family's owners section wants to show.
let currentPlayers: AccountChipPlayer[] = [];
let playtimeByAppid: Record<string, Record<string, number>> = {};
let lastPlayedByAppid: Record<string, Record<string, number>> = {};
// appid → the achievements API's response, cached client-side per (appid, loaded accounts)
// so reopening the same game's panel doesn't refetch. Cleared whenever the loaded
// player(s) change (resetTableState) since a stale entry there would show the wrong
// account's progress.
const achievementsCache = new Map<string, Achievements>();
const achievementsCacheKey = (appid: number) => `${appid}:${currentSteamIds.slice().sort().join(',')}`;

// Separate shuffle history per tab, so picking randomly in one doesn't affect the other.
const randomQueueKey = () => activeTab;
// `lv`/`wv` — short, consistent with Bundles' own `bv` (see urlState.js's PARAM_ORDER comment).
const viewParamName  = () => (activeTab === 'wishlist' ? 'wv' : 'lv');
const viewPrefKey    = () => (activeTab === 'wishlist' ? 'libraryWishlistView' : 'libraryView');

// ── Table view persistence & sharing ──────────────────────────────────────────
// Sort/filter/columns/grouping state auto-persists locally via the shared prefs.js (getPref/
// setPref — same per-key store region.js's own region preference uses) but is deliberately NOT
// written to the URL as it changes anymore — @vates/data-table-vanilla's own syncViewToUrl did
// that (a replaceState on every single interaction), which fights with a URL that's meant to be
// shared on purpose rather than incidentally carrying along whatever view happened to be active.
// A "Share view" button (shareTableView, from tableViewPrefs.js — shared verbatim with
// bundles.js's own) snapshots the current view into the URL param on demand instead, and copies
// the resulting link — same copy-link idiom as panel.js's 🔗 button/lightbox.js's share button.
// restoreTableView/resetTableView also live there now. bindViewPersistence is the one
// exception (see bindSolidViewPersistence below).

// tableViewPrefs.ts's own bindViewPersistence needs `table.onViewChange`, which the Solid table
// doesn't have (bundles.tsx hit the exact same gap — see its own identical helper) —
// reconstructed locally via a createEffect that
// re-reads getViewState() (tracking every signal it touches) instead of an onViewChange
// subscription.
function bindSolidViewPersistence(ts: TableState<Game>, prefKey: string): () => void {
  let dispose: (() => void) | null = null;
  createRoot(d => {
    dispose = d;
    createEffect(() => setPref(prefKey, ts.getViewState()));
  });
  return () => dispose?.();
}

// Builds and mounts the Solid table, shared by loadLibrary/loadWishlist below (the Library and
// Wishlist tabs' own column sets/default-visible/sort differ, but everything else about
// constructing and mounting the table is identical) — one implementation rather than two
// near-copies that could quietly drift apart on exactly the disposal plumbing that matters most
// here. See bundles.tsx's own identical-shaped table construction for the same
// createTableState/createRoot/render()/disposeTable reasoning.
function buildTable(columns: ColumnDef<Game>[], defaultVisible: string[], sort: SortEntry[]): TableState<Game> {
  let disposeTableState!: () => void;
  const ts = createRoot(dispose => {
    disposeTableState = dispose;
    return createTableState<Game>(tableData, columns, {
      initialViewState: { pageSize: 50, visibleCols: defaultVisible, sorts: sort },
    });
  });
  const disposeView = render(() => DataTableView<Game>({
    table: ts,
    rowKey: 'appid',
    // See the matching comment in bundles.tsx's own onRowClick.
    onRowClick: row => openGame(getRow(row.appid) ?? row),
  }), tableContainer);
  disposeTable = () => { disposeView(); disposeTableState(); };
  return ts;
}

// ── Wishlist pricing setup ────────────────────────────────────────────────────
// Fired once at module load, not awaited here — resolves in the background while the rest of
// the page sets itself up, and is only actually awaited once something (loadWishlistPrices,
// updateRegionLabelVisibility) needs to know whether ITAD is configured. Never rejects: a
// failed health check is treated the same as "not configured" (the price columns/region readout
// just don't do anything) rather than surfacing a separate error for a supplementary feature.
const itadConfiguredPromise = fetch('/api/health')
  .then(res => res.json())
  .then(data => !!data.itadConfigured)
  .catch(() => false);

// Region itself is a single global preference picked from the nav bar's own ⚙ Preferences
// popover (public/nav.js) now, not a picker on this page — this just shows a read-only readout
// of whatever it currently resolves to.
function updateWishlistRegionLabel() {
  const code = resolveRegion(getStoredRegion());
  setWishlistRegionValue(COUNTRY_OPTIONS.find(c => c.code === code)?.label ?? code);
}

// Only meaningful on the Wishlist tab, and only when there's a pricing feature to show a region
// for at all — hidden on the Library tab (no price columns there) and hidden outright when ITAD
// isn't configured (no point showing a region readout for a feature that isn't running).
async function updateRegionLabelVisibility() {
  const configured = await itadConfiguredPromise;
  const hidden = !(configured && activeTab === 'wishlist');
  setWishlistRegionHidden(hidden);
  if (!hidden) updateWishlistRegionLabel();
}
updateRegionLabelVisibility();

// Fired by region.js's setStoredRegion on every change, regardless of which UI made it (now
// always the nav bar's popover) — same reprice-in-place effect this page's own inline picker's
// 'change' handler used to have directly. Unlike the Bundles page's own region change, there's
// no bundle-detail-view/list-collapse state to juggle here, just the one already-loaded table's
// price columns going back to "…" until the new country's prices land (see loadWishlistPrices
// below for why they show as reloading rather than stale).
window.addEventListener(REGION_CHANGED_EVENT, () => {
  updateWishlistRegionLabel();
  if (activeTab === 'wishlist' && rowStore.size() > 0) loadWishlistPrices(rowsStore);
});

initPageShell({
  page: 'library',
  lightbox: { onParamChange: setLightboxParam, onGameNav: navigateLightboxGame },
  panel: {
    inertSelector: '.lib-page',
    showAchievements: true,
    getOwnersHtml: buildLibraryOwnersHtml,
    // `table` is reassigned whenever the table itself is (re)built (a Load/tab switch), so
    // `hasTable` reads it fresh on every nav recompute rather than capturing today's value.
    // `getGameList`/`pickRandomGame` already ignore the `game` argument PanelNav (panel.tsx)
    // passes — this page has only one flat list, unlike the comparison page's per-group one.
    nav: { hasTable: () => !!table, getGameList, onOpen: openGame, onReroll: pickRandomGame },
    // Only the Wishlist tab's own loadWishlistPrices batch-prices its rows — the Library tab's
    // rows are owned games with no price columns/batch of their own, same as the comparison
    // page, so they fall through to panel.js's own per-game loadPrice instead. A function (not a
    // plain boolean) since it's read fresh on every panel open/refresh, well after activeTab may
    // have changed since this initPanel call.
    pricesHandledByHost: () => activeTab === 'wishlist',
    onRefresh: async (row: Game) => {
      try {
        const res = await fetch(`/api/game-details/${row.appid}?refresh=1`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Refresh failed');
        // Not every open game is one of the currently loaded tab's own store-backed rows (a
        // standalone lookup isn't) — mutateRow returns undefined for those, so fall back to
        // mutating the plain standalone object directly, same as before this row data was
        // store-backed.
        const updated = mutateRow(row.appid, draft => applyDetailsEvent(draft, data));
        if (!updated) applyDetailsEvent(row, data);
        await loadAchievements(updated ?? row, { force: true }); // still meaningful with no player loaded — see loadAchievements
      } catch (err) {
        setStatusText(`Refresh failed: ${(err as Error).message}`);
      }
    },
    // Runs on every close path (see the comment on `onClose` in panel.js) — not just the
    // Escape-key one, which used to be the only one that remembered to clear `?game=`/
    // `&shot=`; the backdrop click, × button, and swipe-to-close left them stale otherwise.
    // resetTableState()'s own panelClose() call (a genuine new Load/refresh/tab-switch)
    // already clears these params itself beforehand via updateUrlParams, so this just runs
    // redundantly-but-harmlessly there — see loadLibrary/loadWishlist.
    onClose: () => { setPanelParam(null); updateTitle(); },
    // Backs the DLC card's links (public/panel.js) — a real href so ctrl/cmd/shift/middle
    // click still opens it in a new tab, alongside whatever else is in the current URL.
    gameHref: (appid: number | string) => {
      const params = new URLSearchParams(location.search);
      params.delete('shot');
      params.set('game', String(appid));
      return `?${reorderUrlParams(params)}`;
    },
    // Clicking a DLC entry (or the panel's own "← Back" button) — reuses the same "open this
    // appid" mechanism as the "look up any game" search box, just keeping panel.js's own
    // DLC-navigation history stack instead of starting a fresh one.
    onNavigateGame: (appid: number, name: string) => openStandaloneLookup(appid, name, { keepHistory: true }),
  },
});

initGameSearch({
  inputEl: document.getElementById('game-lookup-input') as HTMLInputElement,
  resultsEl: document.getElementById('game-lookup-results')!,
  onSelect: ({ appid, name }) => openStandaloneLookup(appid, name),
});

shortcutsBackdropEl.addEventListener('click', closeShortcuts);
document.querySelector('.shortcuts-close')!.addEventListener('click', closeShortcuts);

function openShortcuts() {
  setShortcutsOpen(true);
}

function closeShortcuts() {
  setShortcutsOpen(false);
}

function toggleShortcuts() {
  setShortcutsOpen(!shortcutsOpen());
}

// Rows whose details have streamed in — used by updateLastPlayedTooltip below. Table rendering
// itself goes through tableData() (see the rowsStore comment above), which does the same
// `.filter(r => !r.loading)`; this is a second, thin call for the one non-table consumer left.
function visibleRows() {
  return rowsStore.filter(r => !r.loading);
}

// Stable order for prev/next nav — the table's current search/filter/sort order, independent
// of its own display-only grouping/pagination (a grouped multi-value column like Genres fans a
// game out into more than one group, so there's no single well-defined linear order once
// grouping is applied). `table.processedData()` (an Accessor, `@vates/data-table-solid`'s
// equivalent of the vanilla table's `getProcessedData()` method) exposes exactly this directly.
function getGameList(): Game[] {
  return table ? table.processedData() : [];
}

// Resolves this game's owners for renderOwnersHtml (ownerListHtml.js) — the shared markup/sort/
// meter logic, same one the comparison page's buildOwnersHtml (app.js) uses; only this
// resolution step stays a separate copy, since the two pages' underlying data shapes differ
// (slots/groups there vs. one flat currentPlayers array here). Naturally empty for a standalone
// lookup (the appid won't be a key in playtimeByAppid at all) and for the Wishlist tab
// (playtimeByAppid is only ever populated by loadLibrary — see its declaration above) without
// needing an explicit check for either case.
function buildLibraryOwnersHtml(g: Game) {
  const gamePt = playtimeByAppid[g.appid] || {};
  const gameLp = lastPlayedByAppid[g.appid] || {};
  const owners = currentPlayers
    .filter(p => p.steamid in gamePt)
    .map(p => ({
      name: p.personaname || '?',
      minutes: gamePt[p.steamid] || 0,
      lastPlayedSec: gameLp[p.steamid] || 0,
    }));
  return renderOwnersHtml(owners);
}

// ── Ownership status (in-library / on-wishlist badges) ───────────────────────
// Only one of the Library/Wishlist tabs is actually loaded into `rowsStore`/`panelRows` at a time
// (see COLUMNS/WISHLIST_COLUMNS/activeTab above), but the panel's ownership badge (panel.js's
// ownershipHtml) wants to answer both questions regardless of which tab happens to be open.
// libraryAppidSet/wishlistAppidSet are populated independently of activeTab: whichever tab
// loads first fills its own set directly from data it already fetched (no extra call), then
// kicks off a background fetch for the *other* tab's set purely for this membership check —
// not surfaced as a second table. Keyed to ownershipPlayerStr (the resolved steamid string,
// same as `u`) so a player switch invalidates a stale set still in flight from the previous one.
let ownershipPlayerStr = '';
let libraryAppidSet  : Set<number> | null = null; // null = not yet known; Set once resolved
let wishlistAppidSet : Set<number> | null = null;

// Fetches just enough of the *other* tab's data to know appid membership — same endpoints
// loadLibrary/loadWishlist already call (so this rides the same cache tier and costs nothing
// extra once either tab has been genuinely loaded for this player), just without building any
// table/row state from the response.
async function ensureOtherOwnershipSet(idStr: string, tab: 'library' | 'wishlist') {
  // idStr is comma-joined (a merged Steam Family is more than one resolved steamid) — split
  // back into individual members, same shape both endpoints already expect elsewhere in this
  // file (each member being a resolved steamid64 resolves trivially, see resolveSteamId).
  const members = idStr.split(',');
  try {
    if (tab === 'library') {
      if (wishlistAppidSet !== null) return;
      const res = await fetch('/api/wishlist', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ members }),
      });
      if (ownershipPlayerStr !== idStr || !res.ok) return;
      const data = await res.json();
      wishlistAppidSet = new Set(data.items.map((i: { appid: number }) => i.appid));
    } else {
      if (libraryAppidSet !== null) return;
      const res = await fetch('/api/common-games', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slots: [members] }),
      });
      if (ownershipPlayerStr !== idStr || !res.ok) return;
      const data = await res.json();
      libraryAppidSet = new Set(data.groups.flatMap((g: { games: { appid: number }[] }) => g.games).map((g: { appid: number }) => g.appid));
    }
  } catch {
    return; // best-effort — the badge just stays absent/"still checking" for this session
  }
  refreshOpenGameOwnership();
}

// Stamps inLibrary/onWishlist onto a game object right before it's opened, so panel.js's
// ownership badge (passive, like the Price card) always has the latest known status. `null`
// (not yet fetched) is left as `null` rather than coerced to `false` — see panel.js's own
// comment on why that renders as nothing instead of a premature "not owned".
function applyOwnershipFlags(game: Game) {
  game.inLibrary  = libraryAppidSet  === null ? null : libraryAppidSet.has(game.appid);
  game.onWishlist = wishlistAppidSet === null ? null : wishlistAppidSet.has(game.appid);
}

// Called once a background ownership-set fetch resolves — re-stamps and re-renders whatever
// game is currently open, if any, so a badge that opened before the fetch landed updates in
// place rather than staying stuck on "still checking".
function refreshOpenGameOwnership() {
  const game = getPanelGame();
  if (!game) return;
  applyOwnershipFlags(game);
  renderPanelBody(game);
}

function openGame(game: Game, { isRandom = false, keepHistory = false }: { isRandom?: boolean; keepHistory?: boolean } = {}) {
  if (!isRandom) clearRandomQueue(randomQueueKey());
  // Always open against the plain panelRows copy, never a rowsStore proxy — see that map's own
  // comment above for why (panel.tsx's lazy loaders mutate whatever object they're given
  // directly, which a Solid store blocks). A `game` not in panelRows (a standalone lookup) falls
  // through to whatever was actually passed, unchanged from before.
  const resolved = getRow(game.appid) ?? game;
  applyOwnershipFlags(resolved);
  panelOpen(resolved, { keepHistory });
  updateTitle();
  bumpPanelNav(); // no table yet, or a standalone lookup, both render no nav — see panel.tsx's PanelNav
  setPanelParam(resolved.appid);
  loadAchievements(resolved);
}

// Lightbox's own ↑/↓ handler (see initLightbox below) — same game-list step the
// document keydown handler below does when the lightbox is closed, but also jumps
// straight into the new game's lightbox at shot 0 rather than leaving the lightbox
// closed behind it. No-ops with no group to page through, same guard as below.
function navigateLightboxGame(dir: number) {
  const next = stepGameList(table, getGameList, getPanelGame(), dir as 1 | -1);
  if (!next) return;
  openGame(next);
  // getGameList() (used by stepGameList above) reads off the table's own rowsStore-backed
  // processedData, so `next` may be a store proxy — resolve to the same plain panelRows copy
  // openGame just opened the panel with, same reasoning as openGame's own comment.
  openLightbox(getRow(next.appid) ?? next, 0);
}

// Fetches this game's achievement schema + unlock state for whichever account(s) are
// currently loaded, and re-renders the panel body as it goes (loading, then loaded) if
// the panel is still open on this same game by the time each stage settles — the panel
// may have moved on to a different game mid-fetch (fast prev/next/random navigation).
// currentSteamIds is optional here — the achievement *list* (names, descriptions, icons,
// community-wide rarity) is store metadata, not tied to any account, so it's still worth
// fetching with nobody loaded (e.g. a standalone "look up any game" lookup). Only the
// achieved/unlocktime state per item needs an account; the server's `playerCount` field
// (see achievementsHtml in panel.js) tells the panel whether that part applies at all.
async function loadAchievements(game: Game, { force = false }: { force?: boolean } = {}) {
  const key = achievementsCacheKey(game.appid);
  if (!force) {
    const cached = achievementsCache.get(key);
    if (cached) {
      game.achievements = cached;
      if (isPanelOpen() && getPanelGame() === game) renderPanelBody(game);
      return;
    }
  }

  game.achievementsLoading = true;
  if (isPanelOpen() && getPanelGame() === game) renderPanelBody(game);

  try {
    const qs = new URLSearchParams();
    if (currentSteamIds.length) qs.set('steamids', currentSteamIds.join(','));
    if (force) qs.set('refresh', '1');
    const res = await fetch(`/api/achievements/${game.appid}?${qs}`);
    const data = await res.json();
    if (res.ok) {
      // Links out to this specific account's own Steam achievements page — the server has
      // no single "the" account to link to when a slot merges a Steam Family, so this picks
      // whichever account loaded first, same "first-seen wins" convention used elsewhere
      // (e.g. the owned-games union) rather than trying to represent every member at once.
      // Only meaningful with an account loaded at all — omitted otherwise.
      if (currentSteamIds.length) {
        data.steamUrl = `https://steamcommunity.com/profiles/${currentSteamIds[0]}/stats/${game.appid}/achievements/`;
      }
      achievementsCache.set(key, data);
    }
    game.achievements = res.ok ? data : null;
  } catch {
    game.achievements = null;
  } finally {
    game.achievementsLoading = false;
    if (isPanelOpen() && getPanelGame() === game) renderPanelBody(game);
  }
}

function pickRandomGame() {
  if (!table || getPanelGame()?.standalone) return; // see panel.tsx's PanelNav
  const pick = pickRandomFrom(getGameList(), randomQueueKey(), getPanelGame()?.appid ?? 0);
  if (pick) openGame(pick as Game, { isRandom: true });
}

// Opens the panel for a game from the "look up any game" search box (public/gameSearch.js)
// rather than a table row — works with or without a player/library currently loaded. `name`
// is known client-side (picked from the search dropdown) and used only to avoid a title flash
// while the panel's own fetch is in flight — it's never sent to the server or the URL; the
// server always resolves the real name itself from store metadata, keyed on the appid, same
// as it does for a nameless wishlist row. If the appid turns out to already be a loaded row
// (the looked-up game is actually owned/wishlisted by the current player), open that row
// instead — full nav, playtime, etc. rather than a lesser standalone view of data already
// sitting in `rows`.
function openStandaloneLookup(appid: number, name = '', { keepHistory = false }: { keepHistory?: boolean } = {}) {
  const existing = getRow(appid);
  if (existing) {
    openGame(existing, { keepHistory });
    addRecentGame(existing.appid, existing.name, (existing.capsule as string | undefined) || null);
    renderRecentGamesBar(recentGamesBarEl);
    return;
  }
  const game = { appid, name: name || `App ${appid}`, loading: true, details: null, standalone: true } as Game;
  openGame(game, { keepHistory });
  fetchStandaloneDetails(game);
  // Not part of `rowsStore`/`panelRows`, so loadWishlistPrices' own appid-keyed batch (see below)
  // never reaches it — a standalone lookup made while on the Wishlist tab would otherwise
  // show no Price card at all, since panel.js's priceHtml is purely passive (see its own
  // comment) and nothing else ever sets bestDealPrice/etc. on this one-off game object.
  if (activeTab === 'wishlist') fetchStandalonePrice(game);
}

// Prices a single standalone-lookup game directly (not via mutateRow, which loadWishlistPrices
// above is keyed on) — same ITAD call/field mapping, just applied straight onto `game`.
async function fetchStandalonePrice(game: Game) {
  const configured = await itadConfiguredPromise;
  if (!configured) { nullAllPriceFields(game); if (getPanelGame() === game) renderPanelBody(game); return; }
  const country = resolveRegion(getStoredRegion());
  try {
    const prices = await postPrices({ appids: [game.appid], country });
    const info = prices[game.appid];
    if (info) applyPriceInfo(game, info, discountPct);
    else nullAllPriceFields(game);
  } catch {
    nullMissingPriceFields(game);
  }
  if (getPanelGame() === game) renderPanelBody(game);
}

async function fetchStandaloneDetails(game: Game) {
  try {
    const res = await fetch(`/api/game-details/${game.appid}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lookup failed');
    game.details = data;
    game.loading = false;
    if (data.meta?.name) game.name = data.meta.name;
    if (getPanelGame() === game) { renderPanelBody(game); setPanelParam(game.appid); updateTitle(); }
    addRecentGame(game.appid, game.name, data.meta?.capsule || null);
    renderRecentGamesBar(recentGamesBarEl);
  } catch (err) {
    if (getPanelGame() === game) setStatusText(`Lookup failed: ${(err as Error).message}`);
  }
}

// ── URL state — deep link to an open game panel (`?game=`, restored via openStandaloneLookup
// above when the appid isn't backed by any loaded row) and, within it, a specific lightbox
// screenshot/video (`?shot=`). `setPanelParam`/`setLightboxParam` (`urlState.ts`) are shared
// with `app.tsx`/`bundles.tsx`; this page has no analogous shared parser for the rest of its own
// URL params since they're handled by updateUrlParams/restoreTableView/shareTableView already.
// The name deliberately never rides along in this URL (see openStandaloneLookup) — only the
// appid is trusted, and the panel just shows a placeholder title until the fetch resolves it.

// Reopens the panel (and, if present, the lightbox) from the current `?game=`/`?shot=`
// URL params. Only called on the initial page load (see the bottom of this file) —
// a genuine new Load/refresh/tab-switch explicitly clears those params instead (see
// loadLibrary/loadWishlist) since a game left open from a previous player/tab may not
// even exist in the new list.
//
// `restoreShot` must be threaded through from the page-load URL rather than re-read from
// location.search on the second (post-stream) call: opening the panel on the first call
// calls setPanelParam(), which deletes `shot` from the live URL (a fresh panel open always
// resets to the hero) — by the time the row's details are in, `shot` would already be gone.
function restorePanelFromUrl(restoreShot: string | null = null) {
  const params = new URLSearchParams(location.search);
  const appid = Number(params.get('game'));
  if (!appid) return;
  const row = getRow(appid);
  if (row) {
    if (getPanelGame()?.appid !== appid) openGame(row);
    const shotParam = restoreShot ?? params.get('shot');
    if (shotParam !== null && !row.loading) openLightbox(row, shotParam);
    return;
  }
  // Not (yet) in the loaded library/wishlist rows — e.g. a game nobody in it owns/wishlists,
  // or no player loaded at all. Fetch it directly instead of silently giving up. Its name
  // isn't known yet (see openStandaloneLookup) — the panel opens with a placeholder title
  // until the fetch resolves it.
  if (getPanelGame()?.appid === appid) return; // already open / fetch already in flight
  openStandaloneLookup(appid);
}

bindPanelKeyboardShortcuts({
  isLightboxOpen,
  isPanelOpen,
  panelClose,
  panelStepHero,
  shortcuts: { isOpen: shortcutsOpen, toggle: toggleShortcuts, close: closeShortcuts },
  focusSearchInput: () => playerInput.focus(),
  pickRandom: pickRandomGame,
  stepGame: dir => {
    const next = stepGameList(table, getGameList, getPanelGame(), dir);
    if (!next) return false;
    openGame(next);
    return true;
  },
});

// Batches detail-stream events (see streamBatcher.ts's own header comment for the full story:
// this restores the ~150ms-amortized table-update cadence the pre-Solid
// `@vates/data-table-vanilla` table got for free via an explicit, timer-gated `table.setData()`
// call, which the Solid conversion silently dropped once the table started reading live off the
// store instead). `onFlush` covers the same status-text/tooltip refresh `scheduleFlush`'s old
// timer callback did.
const detailBatcher = createStreamBatcher<DetailsEvent>({
  apply: event => {
    const row = mutateRow(event.appid, draft => applyDetailsEvent(draft, event));
    if (!row) return;
    if (isPanelOpen() && getPanelGame()?.appid === row.appid) { renderPanelBody(row); bumpPanelNav(); }
  },
  isStale: gen => loadGuard.isStale(gen),
  onFlush: () => { updateLastPlayedTooltip(); updateStatus(); },
});

// See the `lastPlayed` column comment in COLUMNS above — 0/absent `rtime_last_played` for a
// non-key-owner account is indistinguishable from "never played", so a column that's entirely
// empty for the currently loaded rows is a much stronger signal of "Steam withheld this data"
// than of "this player has never launched a single game". Only the library tab has this column
// (see WISHLIST_COLUMNS) — the selector simply finds nothing on the wishlist tab, a harmless no-op.
function updateLastPlayedTooltip() {
  const th = tableContainer.querySelector('th[data-col-key="lastPlayed"]') as HTMLElement | null;
  if (!th) return;
  const loadedRows = visibleRows();
  const allMissing = loadedRows.length > 0 && loadedRows.every(r => !r.lastPlayed);
  th.title = allMissing
    ? 'No Last Played data for any game here — Steam\'s API only reports this for the account whose own key is being used, so this is likely unavailable rather than "never played".'
    : '';
}

// Single source of truth for the tab title: an open game (from a table row or a standalone
// lookup) takes over the title entirely, same convention as the comparison page's app.js —
// it's what the user is looking at, and what they'll want to find again in history/tab search.
function updateTitle() {
  const game = getPanelGame();
  if (game) {
    document.title = `${game.name} — Library Explorer`;
    return;
  }
  if (currentPlayerLabel) {
    const tabLabel = activeTab === 'wishlist' ? 'Wishlist' : 'Library';
    document.title = `${currentPlayerLabel}'s ${tabLabel} — Library Explorer`;
    return;
  }
  document.title = 'Library Explorer — Steam Common Games'; // matches the static <title> in library.html
}

// The site nav's Comparison link (see public/nav.js) carries the currently-loaded player(s)
// along — they arrive there as a single slot (comma-joined, same as a Steam Family), showing
// that player's library rather than landing on the bare empty form.
function updateBackLink() {
  updateNavLink('compare', currentSteamIds.length ? `/?u=${currentSteamIds.join(',')}` : '/');
}

function updateStatus() {
  if (total === 0) { setStatusText(''); return; }
  if (loaded >= total) {
    setStatusText(`${total} games`);
  } else {
    setStatusText(`${loaded} / ${total} games loaded…`);
  }
}

// Rendering, refresh-icon delegation, and localStorage recents all live in the shared
// public/accountsBar.js (also used by the comparison page's app.js).
const RECENTS_KEY = 'library-explorer:recent-players';

function renderAccountsBar(players: AccountChipPlayer[], countLabel: string) {
  renderAccountChips(accountsBarEl, players, countLabel);
}

bindAccountRefresh(accountsBarEl, steamid => {
  loadCurrentTab(currentPlayerStr, { refreshIds: [steamid] });
});

bindRecentsBar(recentsBarEl, RECENTS_KEY, data => {
  // addRecent's 4th arg (the opaque `data`) is this page's own `idStr` — see the addRecent call in loadLibrary.
  const playerStr = String(data);
  playerInput.value = playerStr;
  loadCurrentTab(playerStr);
});

renderRecentsBar(recentsBarEl, RECENTS_KEY);

// Shared, un-namespaced across both pages — see gameSearch.js.
bindRecentGamesBar(recentGamesBarEl, (appid, name) => openStandaloneLookup(appid, name));
renderRecentGamesBar(recentGamesBarEl);

// Defaults to replaceState — most callers are just keeping the URL in sync with state that's
// already reflected in the page (a stream event landing, a panel closing), not a new
// back/forward-worthy navigation. Pass `push: true` for the one action per logical "search"
// that should actually be undoable — see loadLibrary/loadWishlist/setActiveTab below, which
// used to each push their own partial update (clearing game/shot, then setting `u`, then
// `tab`), piling up several near-duplicate history entries per click.
function updateUrlParams(patch: Record<string, string | number | null>, { push = false }: { push?: boolean } = {}) {
  const url = new URL(location.href);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === '') url.searchParams.delete(key);
    else url.searchParams.set(key, String(value));
  }
  url.search = `?${reorderUrlParams(url.searchParams)}`;
  if (push) history.pushState(null, '', url);
  else history.replaceState(null, '', url);
}

// The shape of one `data:` line in /api/game-details/stream's SSE response (see server.js's
// own loop — `{ appid, ...result }` per game, result being fetchGameDetails's response).
interface DetailsEvent {
  appid: number;
  done?: boolean;
  rating: Rating | null;
  hltb: Hltb | null;
  meta: GameMeta | null;
  tags: string[] | null;
  demo: { appid: number } | null;
  protondb: ProtonDb | null;
}

// Applies one SSE details event (rating/hltb/meta/tags) to its row. `name` is only
// backfilled from store metadata when the row didn't already have one — owned-game
// rows always do (from Steam's library API); wishlist rows don't, since GetWishlist
// returns no name at all.
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
  // Steam's own content-type enum (`game`/`dlc`/`music`/`video`/`series`/`episode`/`mod`/
  // `hardware`/`advertising`, or `null` if the store response omitted it — see the `type`
  // comment in lib/steam.js's extractAppDetails). Mapped to a friendly label rather than
  // shown as Steam's raw enum string; `TYPE_LABELS` below has the full mapping. `null` is its
  // own bucket ("Unknown") rather than defaulting to "Game" — most rows really are games, but
  // silently assuming that for the rare metadata-fetch failure would hide the difference
  // between "we don't know" and "confirmed a game".
  row.type              = (TYPE_LABELS as Record<string, string>)[event.meta?.type ?? ''] ?? (event.meta?.type ? event.meta.type : null);
  // Heuristic, not fact — see computeProductionTier's own doc comment (public/utils.js) and
  // CLAUDE.md's AAA/AA/Indie section for what it's derived from and where it's known to be
  // wrong (cheap AAA remasters, prestige-priced small-studio sims, veteran-founded small
  // studios). Recomputed client-side from fields already delivered rather than added as its
  // own backend field, same pattern as steamdbRating above.
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

// Streams rating/hltb/meta/tags for `games` ({appid, name}[]) over SSE and applies each
// event to its row via mutateRow as it arrives. Shared by loadLibrary and loadWishlist. Only
// `appid` is actually sent — the server always resolves the game's name itself rather than
// trusting a client-supplied one (see CLAUDE.md's "Looking up an arbitrary game" section).
//
// `gen`: the calling loadLibrary()/loadWishlist()'s own generation (see loadGuard above) —
// checked at the top of every loop iteration, not just once at the start, since a stream spans
// many `await`s and a newer load can supersede this one (resetting rowStore/`loaded`/`total` for
// a *different* tab/player) at any point while it's still reading. Without this, a superseded
// stream kept incrementing the new load's own `loaded` counter and calling mutateRow against
// its rowStore — same bug class bundles.tsx's openBundle needed its own generation guard for.
async function streamGameDetails(games: { appid: number }[], gen: number) {
  let detailsResp: Response;
  try {
    detailsResp = await fetch('/api/game-details/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ games: games.map(g => ({ appid: g.appid })) }),
    });
  } catch (err) {
    if (loadGuard.isStale(gen)) return;
    setStatusText(`Details stream failed: ${(err as Error).message}`);
    return;
  }

  const reader  = detailsResp.body!.getReader();
  const decoder = new TextDecoder();
  let   buffer  = '';

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

      // Queued rather than applied immediately — see streamBatcher.ts's own header comment for
      // why: applying every event's mutateRow call the moment it arrives means
      // @vates/data-table-solid's own live `tableData()` reactivity fully re-sorts/re-filters/
      // re-paginates once per streamed game instead of once per flush, which is the actual
      // "browser freezes for up to a minute" bug this queue+batch fixes for a large library.
      detailBatcher.push(event, gen);
      loaded++;
    }
  }

  if (loadGuard.isStale(gen)) return;
  detailBatcher.flushNow(); // don't drop whatever's still queued from since the last flush; also runs onFlush (status/tooltip)
}

// Fetches Steam's non-discounted price + historical lows for the Wishlist tab's games, via the
// same shared POST /api/prices route bundles.js uses — `appids` here (a wishlist row already
// has a Steam appid, no ITAD game id) rather than `gids`, resolved to gids server-side first
// (resolveItadIds in lib/itad.js). A single batch call, not streamed per-game like ratings/
// HLTB/tags — see streamGameDetails above — run concurrently with it (Promise.all in
// loadWishlist), so it can land before or after any given row has finished streaming its other
// details; either order is fine, same reasoning as bundles.js's own loadPrices.
const MAX_PRICE_LOOKUP_GAMES = 500; // mirrors the server's own cap (server.js) — see the chunking below
// `force`: set by the "↻ Refresh prices" button below — bypasses the server's `itad-price:`
// cache read for this call (?refresh=1, same convention as every other force-refresh in this
// app, and the same option bundles.js's own loadPrices takes) so a stale price actually gets
// re-fetched from ITAD instead of just re-reading the same cached response back.
// `gen`: defaults to whatever generation is currently in effect — right for the region-change
// handler and the "↻ Refresh prices" button below, neither of which is itself starting a new
// load, just re-pricing whatever's already loaded. loadWishlist passes its own generation
// explicitly, same reasoning as bundles.tsx's own loadPrices.
async function loadWishlistPrices(items: { appid: number }[], { force = false, gen = loadGuard.current() }: { force?: boolean; gen?: number } = {}) {
  setPriceStatusText('');
  const configured = await itadConfiguredPromise;
  if (loadGuard.isStale(gen)) return;
  if (!configured) {
    // No ITAD key configured at all — fill every row with "no data" (not "…", which would
    // otherwise look stuck loading forever) rather than attempting a request bound to 503.
    // `batch()` here (and around the two chunk loops below) for the same reason streamGameDetails
    // now goes through streamBatcher.ts instead of calling mutateRow per event unbatched — a
    // wishlist can have hundreds of items, and each is a synchronous loop with no `await` in
    // between, so without batch() every single mutateRow call would trigger its own full
    // @vates/data-table-solid re-sort/re-filter/re-paginate instead of just one at the end.
    batch(() => {
      for (const item of items) {
        const row = mutateRow(item.appid, draft => nullAllPriceFields(draft));
        if (!row) continue;
        if (isPanelOpen() && getPanelGame() === row) renderPanelBody(row);
      }
    });
    return;
  }

  const country = resolveRegion(getStoredRegion());
  // Chunked client-side, sequentially (not in parallel) — a wishlist can run well past the
  // server's own MAX_PRICE_LOOKUP_GAMES cap (a bundle's game list never does, which is why
  // bundles.js's own loadPrices sends everything in one call), and firing several chunks at
  // once would just be several concurrent ITAD-backed requests instead of one, for no benefit.
  const appids = items.map(i => i.appid);
  for (let i = 0; i < appids.length; i += MAX_PRICE_LOOKUP_GAMES) {
    if (loadGuard.isStale(gen)) return;
    const chunk = appids.slice(i, i + MAX_PRICE_LOOKUP_GAMES);
    try {
      const prices = await postPrices({ appids: chunk, country, force });
      if (loadGuard.isStale(gen)) return;
      batch(() => {
        for (const appid of chunk) {
          const info = prices[appid];
          if (!info) continue;
          const row = mutateRow(appid, draft => applyPriceInfo(draft, info, discountPct));
          if (!row) continue;
          if (isPanelOpen() && getPanelGame() === row) renderPanelBody(row);
        }
      });
    } catch (err) {
      if (loadGuard.isStale(gen)) return;
      // Same "don't leave price columns stuck on their loading placeholder forever" treatment
      // as bundles.js's own loadPrices — a failed chunk still fills its own games with `null`
      // (rendered "—", same as any other "no data" case) rather than leaving them on "…".
      batch(() => {
        for (const appid of chunk) {
          const row = mutateRow(appid, draft => nullMissingPriceFields(draft));
          if (!row) continue;
          if (isPanelOpen() && getPanelGame() === row) renderPanelBody(row);
        }
      });
      setPriceStatusText(`Couldn't load Steam pricing (${(err as Error).message}) — other columns are unaffected.`);
    }
  }
}

// preserveGameParam: skip clearing `?game=`/`&shot=` when closing a leftover panel — for a
// caller (loadLibrary/loadWishlist restoring a deep link, or loadFromUrl below on back/forward)
// that's about to reopen a game from those very params once the new data's in. See panel.js's
// own `preserveUrl` option, which this maps straight onto.
function resetTableState({ preserveGameParam = false } = {}) {
  if (isPanelOpen()) panelClose({ preserveUrl: preserveGameParam });
  clearRandomQueue(randomQueueKey());
  if (unsyncView) { unsyncView(); unsyncView = null; }
  if (disposeTable) { disposeTable(); disposeTable = null; }
  table = null;
  setRowsStore([]); rowStore.reset(); total = 0; loaded = 0;
  tableContainer.innerHTML = '';
  setPriceStatusText('');
  setResetViewHidden(true);
  setShareViewHidden(true);
  setRefreshPricesHidden(true);
  accountsBarEl.hidden = true;
  accountsBarEl.innerHTML = '';
  currentSteamIds = [];
  currentPlayerLabel = '';
  currentPlayers = [];
  playtimeByAppid = {};
  lastPlayedByAppid = {};
  updateBackLink();
  achievementsCache.clear();
}

// Shared options for loadLibrary/loadWishlist — the same "genuine new load vs. restoring a
// deep link vs. a same-search account refresh" knobs both need.
interface LoadOpts {
  refreshIds?: string[];
  preserveGameParam?: boolean;
  restoreShot?: string | null;
  push?: boolean;
}

// The shape of `/api/common-games`'s success response, as read below — only the fields this
// page touches (the Library Explorer always loads a single slot, so `slots[0]`).
interface CommonGamesResponse {
  groups: { games: { appid: number; name: string }[] }[];
  slots: AccountChipPlayer[][];
  playtime: Record<string, Record<string, number>>;
  lastPlayed: Record<string, Record<string, number>>;
}

// The shape of `/api/wishlist`'s success response, as read below.
interface WishlistResponse {
  players: AccountChipPlayer[];
  items: { appid: number; priority: number; dateAdded: string | null }[];
}

async function loadLibrary(playerStr: string, { refreshIds, preserveGameParam = false, restoreShot = null, push = true }: LoadOpts = {}) {
  // A genuine new load drops any `game`/`shot` left in the URL from a previous player/tab —
  // it may not even exist in the new list. The initial page-load path (bottom of this file)
  // passes preserveGameParam so it can restore the deep link once the new data is in. This
  // doesn't need to wait on the fetch below — unlike the `u` param (see further down), it's
  // not derived from anything the server resolves.
  if (!preserveGameParam) updateUrlParams({ game: null, shot: null });
  currentPlayerStr = playerStr;
  const gen = loadGuard.next();

  const members = playerStr.split(',').map(s => normalizeInput(s.trim())).filter(Boolean);

  setStatusText(refreshIds ? 'Refreshing account…' : 'Fetching library…');
  resetTableState({ preserveGameParam });

  let result: CommonGamesResponse;
  try {
    const resp = await fetch('/api/common-games', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slots: [members], refreshIds }),
    });
    if (!resp.ok) {
      const { error } = await resp.json();
      if (loadGuard.isStale(gen)) return;
      setStatusText(`Error: ${error}`);
      return;
    }
    result = await resp.json();
  } catch (err) {
    if (loadGuard.isStale(gen)) return;
    setStatusText(`Error: ${(err as Error).message}`);
    return;
  }
  // A newer loadLibrary()/loadWishlist() call has since taken over resetTableState's own
  // rowStore/table/disposeTable — everything below builds on top of those, so bail out rather
  // than racing the newer call to reassign them (same class of bug bundles.tsx's openBundle had
  // before its own generation guard).
  if (loadGuard.isStale(gen)) return;

  const allGames = result.groups.flatMap(g => g.games);
  const slotSteamIds = result.slots[0].map(p => p.steamid);
  // Written from the server-resolved `steamid`s, not the raw typed input — a vanity name (or
  // an account whose vanity name changes later) always canonicalizes to the same shareable
  // URL and recent-search entry. `u` is deliberately not written until here, once the fetch
  // above has actually resolved it — see the comment on the `game`/`shot` clearing above.
  const idStr = slotSteamIds.join(',');
  // A single push per genuine new load (never for a same-search account refresh, never when
  // just restoring whatever the URL already says on initial load/back-forward — see `push`
  // above) — this used to be a separate pushState from the game/shot clear above, piling up
  // two history entries per click.
  updateUrlParams({ u: idStr }, { push: push && !refreshIds });
  // See the "Ownership status" section above — populate this tab's own set directly from
  // data just fetched, and kick off a background fetch for the other tab's set.
  if (ownershipPlayerStr !== idStr) { ownershipPlayerStr = idStr; wishlistAppidSet = null; }
  libraryAppidSet = new Set(allGames.map(g => g.appid));
  ensureOtherOwnershipSet(idStr, 'library');
  currentSteamIds = slotSteamIds;
  currentPlayerLabel = result.slots[0].map(p => p.personaname || '?').join(' + ');
  currentPlayers = result.slots[0];
  playtimeByAppid = result.playtime || {};
  lastPlayedByAppid = result.lastPlayed || {};
  updateTitle();
  updateBackLink();
  renderAccountsBar(result.slots[0], 'games');
  addRecent(RECENTS_KEY, idStr, [result.slots[0]], idStr);
  renderRecentsBar(recentsBarEl, RECENTS_KEY);

  const initialRows = allGames.map(game => {
    const ptByAccount = (result.playtime && result.playtime[game.appid]) || {};
    const totalMin = slotSteamIds.reduce((s, id) => s + (ptByAccount[id] || 0), 0);
    const lpByAccount = (result.lastPlayed && result.lastPlayed[game.appid]) || {};
    const lastPlayedMax = Math.max(0, ...slotSteamIds.map(id => lpByAccount[id] || 0));
    return {
      appid:              game.appid,
      name:               game.name,
      playtime:           totalMin / 60,
      lastPlayed:         fmtLastPlayed(lastPlayedMax),
      capsule:            undefined,
      score:              undefined,
      positivePct:        undefined,
      steamdbRating:      undefined,
      reviewsTotal:       undefined,
      hltbMain:           undefined,
      hltbExtra:          undefined,
      hltbCompletionist:  undefined,
      hltbAll:            undefined,
      metacritic:         undefined,
      releaseDate:        undefined,
      genres:             undefined,
      developers:         undefined,
      publishers:         undefined,
      tags:               undefined,
      categories:         undefined,
      protondb:           undefined,
      protondbPending:    undefined,
      achievementCount:   undefined,
      dlcCount:           undefined,
      platforms:          undefined,
      languages:          undefined,
      hasDemo:            undefined,
      loading:            true,
      details:            null, // { rating, hltb, meta, tags, demo, protondb } — same shape the side panel expects
    };
  }) as unknown as Game[]; // price fields (steamRegular/bestDeal*/lows) filled in later by the stream — see bundles.js's identical cast

  setRowsStore(initialRows);
  rowStore.load(initialRows);
  total = initialRows.length;
  activeColumns = COLUMNS;

  table = buildTable(COLUMNS as unknown as ColumnDef<Game>[], DEFAULT_VISIBLE, DEFAULT_SORT);
  restoreTableView(table, viewPrefKey(), viewParamName());
  unsyncView = bindSolidViewPersistence(table, viewPrefKey());
  setResetViewHidden(false);
  setShareViewHidden(false);

  updateStatus();
  if (preserveGameParam) restorePanelFromUrl(restoreShot); // early attempt — lightbox needs details, tried again below

  await streamGameDetails(allGames, gen);
  if (loadGuard.isStale(gen)) return;
  if (preserveGameParam) restorePanelFromUrl(restoreShot);
}

async function loadWishlist(playerStr: string, { refreshIds, preserveGameParam = false, restoreShot = null, push = true }: LoadOpts = {}) {
  // See the matching comment in loadLibrary above — game/shot clearing doesn't need the
  // fetch below, but the `u` param does (it's written further down from resolved steamids).
  if (!preserveGameParam) updateUrlParams({ game: null, shot: null });
  currentPlayerStr = playerStr;
  const gen = loadGuard.next();

  const members = playerStr.split(',').map(s => normalizeInput(s.trim())).filter(Boolean);

  setStatusText(refreshIds ? 'Refreshing account…' : 'Fetching wishlist…');
  resetTableState({ preserveGameParam });

  let result: WishlistResponse;
  try {
    const resp = await fetch('/api/wishlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ members, refreshIds }),
    });
    if (!resp.ok) {
      const { error } = await resp.json();
      if (loadGuard.isStale(gen)) return;
      setStatusText(`Error: ${error}`);
      return;
    }
    result = await resp.json();
  } catch (err) {
    if (loadGuard.isStale(gen)) return;
    setStatusText(`Error: ${(err as Error).message}`);
    return;
  }
  // See the matching comment in loadLibrary above.
  if (loadGuard.isStale(gen)) return;

  // Written from the server-resolved `steamid`s, not the raw typed input — see the matching
  // comment in loadLibrary above.
  const idStr = result.players.map(p => p.steamid).join(',');
  // See the matching comment in loadLibrary above.
  updateUrlParams({ u: idStr }, { push: push && !refreshIds });
  // See the "Ownership status" section above.
  if (ownershipPlayerStr !== idStr) { ownershipPlayerStr = idStr; libraryAppidSet = null; }
  wishlistAppidSet = new Set(result.items.map(i => i.appid));
  ensureOtherOwnershipSet(idStr, 'wishlist');
  currentSteamIds = result.players.map(p => p.steamid);
  currentPlayerLabel = result.players.map(p => p.personaname || '?').join(' + ');
  updateTitle();
  updateBackLink();
  renderAccountsBar(result.players, 'wishlisted');
  addRecent(RECENTS_KEY, idStr, [result.players], idStr);
  renderRecentsBar(recentsBarEl, RECENTS_KEY);

  const initialRows = result.items.map(item => ({
    appid:              item.appid,
    name:               undefined, // unknown until store metadata streams in
    priority:           item.priority,
    dateAdded:          item.dateAdded,
    // Filled by loadWishlistPrices below, concurrently with streamGameDetails — same
    // "undefined until its own async source resolves" convention as everything else here.
    steamRegular:       undefined,
    bestDealPrice:      undefined,
    bestDealShop:       undefined,
    bestDealUrl:        undefined,
    bestDealCut:        undefined,
    lowAll:             undefined,
    lowY1:              undefined,
    lowM3:              undefined,
    priceCurrency:      undefined,
    capsule:            undefined,
    score:              undefined,
    positivePct:        undefined,
    steamdbRating:      undefined,
    reviewsTotal:       undefined,
    hltbMain:           undefined,
    hltbExtra:          undefined,
    hltbCompletionist:  undefined,
    hltbAll:            undefined,
    metacritic:         undefined,
    releaseDate:        undefined,
    genres:             undefined,
    developers:         undefined,
    publishers:         undefined,
    tags:               undefined,
    categories:         undefined,
    protondb:           undefined,
    protondbPending:    undefined,
    achievementCount:   undefined,
    dlcCount:           undefined,
    platforms:          undefined,
    languages:          undefined,
    hasDemo:            undefined,
    loading:            true,
    details:            null,
  })) as unknown as Game[]; // name: undefined until the stream resolves it, price fields filled in by loadWishlistPrices — same cast as loadLibrary above

  setRowsStore(initialRows);
  rowStore.load(initialRows);
  total = initialRows.length;
  activeColumns = WISHLIST_COLUMNS;

  table = buildTable(WISHLIST_COLUMNS as unknown as ColumnDef<Game>[], WISHLIST_DEFAULT_VISIBLE, DEFAULT_SORT);
  restoreTableView(table, viewPrefKey(), viewParamName());
  unsyncView = bindSolidViewPersistence(table, viewPrefKey());
  setResetViewHidden(false);
  setShareViewHidden(false);
  // Same "don't show a control for a feature that isn't running" reasoning as
  // wishlistRegionLabelEl (see updateRegionLabelVisibility above) — no point offering a price
  // refresh when ITAD isn't configured and every price column is just going to read "—".
  itadConfiguredPromise.then(configured => { setRefreshPricesHidden(!configured); });

  updateStatus();
  if (preserveGameParam) restorePanelFromUrl(restoreShot); // early attempt — lightbox needs details, tried again below

  // Independent of each other — Steam pricing has nothing to do with the rating/HLTB/tags
  // pipeline — so they run concurrently rather than one after the other, same reasoning as
  // bundles.js's own openBundle.
  await Promise.all([streamGameDetails(result.items, gen), loadWishlistPrices(result.items, { gen })]);
  if (loadGuard.isStale(gen)) return;
  if (preserveGameParam) restorePanelFromUrl(restoreShot);
}

function loadCurrentTab(playerStr: string, opts: LoadOpts = {}) {
  return activeTab === 'wishlist' ? loadWishlist(playerStr, opts) : loadLibrary(playerStr, opts);
}

function setActiveTab(tab: 'library' | 'wishlist', { fetch: shouldFetch = true }: { fetch?: boolean } = {}) {
  if (tab === activeTab) return;
  activeTab = tab;
  tabLibraryBtn.setAttribute('aria-selected', String(tab === 'library'));
  tabWishlistBtn.setAttribute('aria-selected', String(tab === 'wishlist'));
  loadBtn.textContent = tab === 'wishlist' ? 'Load Wishlist' : 'Load Library';
  // Never pushes on its own — when a load follows right below, that load's own `u` update
  // (see loadLibrary/loadWishlist) pushes the single history entry for "switched to this tab
  // for this player", already carrying the `tab` value set here. With nothing to fetch (no
  // player loaded yet) there's nothing worth a history entry for either.
  updateUrlParams({ tab: tab === 'wishlist' ? 'wishlist' : null });
  updateTitle();
  updateRegionLabelVisibility();
  if (shouldFetch && currentPlayerStr) loadCurrentTab(currentPlayerStr);
  // A standalone lookup (see openStandaloneLookup) only prices itself when opened while
  // already on the Wishlist tab — switching to this tab afterward (with or without a player
  // loaded) would otherwise leave it permanently unpriced, since loadCurrentTab above is a
  // no-op with no player loaded and never touches a standalone game either way.
  const panelGame = getPanelGame();
  if (tab === 'wishlist' && panelGame?.standalone && panelGame.bestDealPrice === undefined) {
    fetchStandalonePrice(panelGame);
  }
}

tabLibraryBtn.addEventListener('click', () => setActiveTab('library'));
tabWishlistBtn.addEventListener('click', () => setActiveTab('wishlist'));

loadBtn.addEventListener('click', () => {
  const val = playerInput.value.trim();
  if (val) loadCurrentTab(val);
});

resetViewBtn.addEventListener('click', () => {
  if (!table) return;
  resetTableView(table, viewPrefKey(), viewParamName());
});

shareViewBtn.addEventListener('click', () => shareTableView(table!, viewParamName(), shareViewBtn));

// Refreshes just the price columns for the currently loaded wishlist, in one shot — same
// reasoning as bundles.js's own refreshPricesBtn: it's a single cheap POST /api/prices call
// either way, no reason to make the user step through every game's own panel "↻ Refresh".
// Only ever visible on the Wishlist tab (see loadWishlist above), so `rowsStore` here is always
// the wishlist's own rows.
refreshPricesBtn.addEventListener('click', async () => {
  if (rowStore.size() === 0 || refreshPricesDisabled()) return;
  setRefreshPricesDisabled(true);
  setRefreshPricesLabel('Refreshing…');
  try {
    await loadWishlistPrices(rowsStore, { force: true });
  } finally {
    setRefreshPricesDisabled(false);
    setRefreshPricesLabel('↻ Refresh prices');
  }
});

playerInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const val = playerInput.value.trim();
    if (val) loadCurrentTab(val);
  }
});

// Shared by the initial page load and browser back/forward — now that loadLibrary/loadWishlist
// push one real history entry per load/tab-switch (see `push` there), back/forward need an
// actual handler to act on those entries rather than just changing the address bar.
function loadFromUrl() {
  const params = new URLSearchParams(location.search);
  const player = params.get('u');
  const tab = params.get('tab') === 'wishlist' ? 'wishlist' : 'library';
  if (tab !== activeTab) setActiveTab(tab, { fetch: false }); // the load below does the fetching, in the right order
  if (player) {
    playerInput.value = player;
    currentPlayerStr = player;
    // preserveGameParam: a `?game=<appid>` (and `&shot=<idx>`) present in the URL on page
    // load should reopen that game/media once its row is in — see restorePanelFromUrl().
    // `shot` is captured here (not re-read later) since opening the panel deletes it from
    // the live URL — see the comment on restorePanelFromUrl(). `push: false` since this is
    // restoring state the URL already has, not a new navigable action.
    loadCurrentTab(player, { preserveGameParam: true, restoreShot: params.get('shot'), push: false });
  } else {
    if (currentPlayerStr) {
      currentPlayerStr = '';
      resetTableState({ preserveGameParam: true }); // a `?game=` in the new URL is restored below
      // No player loaded anymore — drop the ownership sets too, so a later standalone lookup
      // doesn't show stale in-library/on-wishlist badges left over from the previous player.
      ownershipPlayerStr = ''; libraryAppidSet = null; wishlistAppidSet = null;
      updateStatus();
      updateTitle();
    }
    // No player loaded at all — still honor a bare `?game=` standalone-lookup deep link
    // (loadLibrary/loadWishlist would otherwise be the only callers of restorePanelFromUrl).
    restorePanelFromUrl(params.get('shot'));
  }
}

window.addEventListener('popstate', loadFromUrl);
loadFromUrl();
