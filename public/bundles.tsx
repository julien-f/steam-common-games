'use strict';

import { formatMoney, computeSteamdbRating, computeProductionTier, discountPct } from '/utils.ts';
import { reorderUrlParams, setPanelParam, setLightboxParam } from '/urlState.ts';
import { restoreTableView, shareTableView, resetTableView } from '/tableViewPrefs.ts';
import { renderPanelNav as renderPanelNavShared, stepGameList } from '/panelNav.ts';
import { bindPanelKeyboardShortcuts } from '/panelKeyboard.ts';
import { postPrices, applyPriceInfo, nullMissingPriceFields } from '/priceLoading.ts';
import { COUNTRY_OPTIONS, TIMEZONE_COUNTRY, detectCountry, getStoredRegion, setStoredRegion, resolveRegion, REGION_CHANGED_EVENT } from '/region.ts';
import { openLightbox, isLightboxOpen } from '/lightbox.tsx';
import {
  panelOpen, panelClose, isPanelOpen, getPanelGame, panelStepHero,
  pickRandomFrom, clearRandomQueue, panelHandleEscape,
  renderPanelBody,
} from '/panel.tsx';
import { initPageShell } from '/pageShell.ts';
import { setPref } from '/prefs.ts';
import { createRowStore } from '/rowStore.ts';
import { createStaleGuard } from '/staleGuard.ts';
import { createStreamBatcher } from '/streamBatcher.ts';

import { createSignal, createRoot, createEffect, For, Show, batch } from 'solid-js';
import { createStore } from 'solid-js/store';
import { render } from 'solid-js/web';
import { createTableState, DataTableView } from '@vates/data-table-solid';
import type { ColumnDef, SortEntry, TableState } from '@vates/data-table-solid';
import type { Game, GameDetails } from './types.ts';
import {
  fmt, insertColumnsAfter, CORE_COLUMNS, PRICE_COLUMNS, compareNumMissingLast,
  withMissingGroup, formatMissingGroup, priceTierBucket, formatPriceTier,
  protonDbValue, TYPE_LABELS,
} from '/gameColumns.ts';

// ── Local data shapes ───────────────────────────────────────────────────────
// A game flattened out of a bundle's tiers (see flattenBundleGames) — the ITAD-side
// identity (gid) plus that game's tier price at the cheapest tier it appears at.
interface FlatGame {
  gid: string; slug: string; title: string; type: string;
  assets: { boxart?: string } | null;
  tierPrice: number | null; tierCurrency: string | null; addon: boolean;
}
// A flat game that also resolved to a Steam appid (see openBundle's resolved list).
type ResolvedGame = FlatGame & { appid: number };
// One SSE `data:` payload from POST /api/game-details/stream (a game-details response, plus the
// row's appid, minus the `done` sentinel) — the shape applyDetailsEvent reads.
interface DetailEvent extends GameDetails { appid: number; done?: boolean; }
// One bundle as ITAD's /bundles/v1 (via GET /api/bundles) returns it — only the fields read.
interface PriceAmount { amount: number; currency: string; }
interface BundleTier {
  price: PriceAmount | null;
  games: { id: string; slug: string; title: string; type: string; assets?: { boxart?: string } | null }[];
  addon: boolean | null;
}
interface Bundle {
  id: number; title: string;
  page: { name?: string } | null;
  counts: { games?: number } | null;
  expiry: string | null;
  url: string | null; details: string | null;
  tiers: BundleTier[];
}

// ── Bundle-specific column building blocks — Tier Price/Add-on have no Library/Wishlist
// equivalent (a bundle-tier concept), so they stay local rather than living in the shared
// public/gameColumns.js (see its own header comment for what's shared vs. page-specific and
// why).

// Same pill shape, distinguishing a tier that only adds bonus content (soundtrack, extra
// DLC-ish items) on top of an already-unlocked base game, from a tier that unlocks a base
// game outright — an ITAD-specific fact this app's own library/wishlist tables have no
// equivalent of. Still a plain DOM-Node-returning function, not a Solid component — this is
// the data table's own `render` cell hook (@vates/data-table-solid's `ColumnDef.render`),
// which wants a raw Node back, same contract the vanilla table had.
function renderAddonBadge(v: unknown): Node {
  if (v === undefined) return document.createTextNode('…');
  const span = document.createElement('span');
  span.className = 'status-badge';
  span.style.background = v ? '#8b4513' : 'var(--accent)';
  span.style.color = v ? '#fff' : '#0b1620';
  span.textContent = v ? 'Add-on' : 'Base';
  return span;
}

// A `null` tier price does NOT mean free — ITAD only ever sends an explicit `{amount: 0}` for
// that (observed nowhere in practice, but the correct thing to special-case if it appears); a
// `null` `tiers[].price` means "no single fixed price at all", which in practice is Fanatical's
// "Build Your Own ⟨N⟩ Bundle" pick-and-mix format — one tier, a pool of 15-30 games, price
// scales with however many you pick rather than being a property of the bundle itself. Showing
// "Free" for that (the previous behavior) was flatly wrong — these bundles are never free.
// "Varies" is shown instead; only a real `amount === 0` renders as "Free". `formatMoney` lives
// in utils.js, not here — see gameColumns.js's own header comment for why.
function renderTierPrice(v: unknown, row: Record<string, any>): Node {
  if (v === undefined) return document.createTextNode('…');
  if (v == null) return document.createTextNode('Varies');
  if (v === 0) return document.createTextNode('Free');
  return document.createTextNode(formatMoney(Number(v), row.tierCurrency));
}

// `compare: compareNumMissingLast` — without it, a `null` ("Varies", no fixed price — see
// renderTierPrice above) coerces to 0 under the column's default numeric comparator, which
// would sort every "Build Your Own" bundle's games as if they were the single cheapest thing
// in the table under the default ascending Tier Price sort. Pinned last instead, same as
// every other "missing data" numeric column in this app.
// Grouped via the same PRICE_TIERS breakpoints gameColumns.js's own price columns use, except a
// missing tier price means "Varies" (a Build Your Own bundle's pick-and-mix pricing — see
// renderTierPrice above), not "no data" — its own `missingLabel` reflects that distinction
// instead of the generic '—' the other price columns' groups fall back to.
const TIER_PRICE_COLUMN: ColumnDef<Record<string, any>> = {
  key: 'tierPrice', label: 'Tier Price', type: 'number', groupable: true,
  format: v => v == null ? 'Varies' : v === 0 ? 'Free' : Number(v).toFixed(2), render: renderTierPrice,
  compare: compareNumMissingLast, defaultSortDir: 'asc',
  groupValue: withMissingGroup(priceTierBucket), groupFormat: formatMissingGroup(formatPriceTier, 'Varies'), keepVisibleWhenGrouped: true,
  category: 'Pricing',
};
const ADDON_COLUMN: ColumnDef<Record<string, any>> =
  { key: 'addon', label: 'Add-on', groupable: true, format: v => v ? 'Add-on' : 'Base', render: renderAddonBadge, category: 'Classification' };

// The Bundles page's own column list — CORE_COLUMNS (public/gameColumns.js) plus Tier Price/
// Add-on right after Name, and this page's price cluster (PRICE_COLUMNS — the same shared
// cluster the Wishlist tab gets, in the same relative position: right after its own identity/
// page-specific columns, before Scores & reviews) right after Add-on.
const BUNDLE_COLUMNS = insertColumnsAfter(
  insertColumnsAfter(CORE_COLUMNS, 'name', TIER_PRICE_COLUMN, ADDON_COLUMN),
  'addon', ...PRICE_COLUMNS
);

// Steam Full Price stays hidden by default — Best Deal + Discount (ITAD's own "cut" on that
// deal) together already answer "is this actually worth buying" without needing a third column
// to cross-reference against.
const DEFAULT_VISIBLE = ['capsule', 'name', 'tierPrice', 'bestDealPrice', 'bestDealCut', 'steamdbRating', 'hltbAll', 'releaseDate', 'genres'];
// Cheapest first, best-rated among ties second — a genuinely useful browsing order (unlike a
// single-column sort, which leaves same-priced games in an arbitrary relative order). Passed as
// part of `initialViewState` at table construction — also
// what `resetTableView`'s own `setViewState({})` blanking restores, so unlike before there's no
// separate priming call or manual reapply-after-reset needed for this.
const DEFAULT_SORT: SortEntry[] = [{ key: 'tierPrice', dir: 'asc' }, { key: 'steamdbRating', dir: 'desc' }];

// ── Region ────────────────────────────────────────────────────────────────────
// COUNTRY_OPTIONS/TIMEZONE_COUNTRY/detectCountry/getStoredRegion/resolveRegion/
// REGION_CHANGED_EVENT live in the shared public/region.js, imported directly — library.js's
// Wishlist price columns need the exact same curated list and detection heuristic, and there's
// no reason for the two to drift apart. The picker itself now lives in the nav bar's own ⚙
// Preferences popover (public/nav.js), not on this page — see updateBundlesRegionLabel below.

// ── DOM refs ──────────────────────────────────────────────────────────────────
// Every element below is still real, static markup from bundles.html (unchanged) — this page
// isn't rendering its own shell in JSX, just the genuinely dynamic pieces within it (see the
// signals/effects and the three render()-mounted list/link components further down). Elements
// whose *content* becomes a Solid component (bundleListEl/unresolvedListEl/detailLinksEl) are
// mount targets for render(); every other element here is written to from a small createEffect
// synced to one of this page's own signals, replacing what used to be direct
// textContent/hidden/classList writes scattered across the functions below.
const notConfiguredCard = document.getElementById('not-configured-card')!;
const browseCard        = document.getElementById('browse-card')!;
const bundlesRegionValueEl = document.getElementById('bundles-region-value')!;
const sortSelect         = document.getElementById('sort-select') as HTMLSelectElement;
const expiredCheckbox    = document.getElementById('expired-checkbox') as HTMLInputElement;
const bundlesStatusEl    = document.getElementById('bundles-status')!;
const bundleListWrapEl   = document.getElementById('bundle-list-wrap')!;
const bundleListEl       = document.getElementById('bundle-list')!;
const toggleListBtn      = document.getElementById('toggle-list-btn')!;
const loadMoreBtn        = document.getElementById('load-more-btn')!;
const detailCard         = document.getElementById('detail-card')!;
const detailTitleEl      = document.getElementById('detail-title')!;
const detailMetaEl       = document.getElementById('detail-meta')!;
const detailLinksEl      = document.getElementById('detail-links')!;
const prevBundleBtn      = document.getElementById('prev-bundle-btn') as HTMLButtonElement;
const nextBundleBtn      = document.getElementById('next-bundle-btn') as HTMLButtonElement;
const detailStatusEl     = document.getElementById('detail-status')!;
const priceStatusEl      = document.getElementById('price-status')!;
const refreshPricesBtn   = document.getElementById('refresh-prices-btn') as HTMLButtonElement;
const resetViewBtn       = document.getElementById('reset-view-btn')!;
const tableContainer     = document.getElementById('table-container')!;
const unresolvedSection  = document.getElementById('unresolved-section')!;
const unresolvedListEl   = document.getElementById('unresolved-list')!;
const shareViewBtn       = document.getElementById('share-view-btn')!;

// ── Page state signals ──────────────────────────────────────────────────────
// The rest of this page's own UI state (bundle list/nav, region
// readout, price/detail status lines, view-button visibility, etc.) as Solid signals rather than
// scattered direct DOM writes. Each one either drives a small createEffect below (for a plain
// text/hidden/disabled/class write against the static markup above) or is read reactively by one
// of the three render()-mounted components further down (the bundle list, the unresolved-games
// list, and the detail links — the genuinely list-shaped pieces, which get real JSX/<For> instead
// of hand-built HTML strings). Defaults match whatever bundles.html's own markup already starts
// as (e.g. a button with a bare `hidden` attribute starts its signal at `true`), so the first
// effect run is a no-op rather than an initial flicker.
const [notConfiguredHidden, setNotConfiguredHidden] = createSignal(true);
const [browseHidden, setBrowseHidden] = createSignal(false);
const [regionLabel, setRegionLabel] = createSignal('');
const [bundlesStatusText, setBundlesStatusText] = createSignal('');
const [listCollapsedSig, setListCollapsedSig] = createSignal(false);
const [bundlesSig, setBundlesSig] = createSignal<Bundle[]>([]);
const [activeBundleIdSig, setActiveBundleIdSig] = createSignal<number | null>(null);
const [loadMoreHidden, setLoadMoreHidden] = createSignal(true);
const [detailHidden, setDetailHidden] = createSignal(true);
const [detailTitleSig, setDetailTitleSig] = createSignal('');
const [detailMetaSig, setDetailMetaSig] = createSignal('');
const [detailLinksSig, setDetailLinksSig] = createSignal<{ details: string | null; url: string | null } | null>(null);
const [prevDisabled, setPrevDisabled] = createSignal(true);
const [nextDisabled, setNextDisabled] = createSignal(true);
const [detailStatusSig, setDetailStatusSig] = createSignal('');
const [priceStatusSig, setPriceStatusSig] = createSignal('');
const [refreshPricesHidden, setRefreshPricesHidden] = createSignal(true);
const [refreshPricesDisabled, setRefreshPricesDisabled] = createSignal(false);
const [refreshPricesLabel, setRefreshPricesLabel] = createSignal('↻ Refresh prices');
const [resetViewHidden, setResetViewHidden] = createSignal(true);
const [shareViewHidden, setShareViewHidden] = createSignal(true);
const [unresolvedGamesSig, setUnresolvedGamesSig] = createSignal<FlatGame[]>([]);

// One createRoot for every scalar signal → DOM effect — module-lifetime, same as the page's own
// event listeners and initPageShell() call below (nothing on this page tears itself down before
// a full navigation), so it's never explicitly disposed. `bundleListWrapEl`'s collapsed class and
// `toggleListBtn`'s hidden/label both need `bundlesSig()` too (an empty list always hides the
// toggle, regardless of collapsed state) — combined into one effect rather than two so they can't
// drift out of sync with each other's read of `bundlesSig()`.
createRoot(() => {
  createEffect(() => { notConfiguredCard.hidden = notConfiguredHidden(); });
  createEffect(() => { browseCard.hidden = browseHidden(); });
  createEffect(() => { bundlesRegionValueEl.textContent = regionLabel(); });
  createEffect(() => { bundlesStatusEl.textContent = bundlesStatusText(); });
  createEffect(() => { bundleListWrapEl.classList.toggle('collapsed', listCollapsedSig()); });
  createEffect(() => {
    toggleListBtn.hidden = bundlesSig().length === 0;
    toggleListBtn.textContent = listCollapsedSig() ? 'Show list' : 'Hide list';
  });
  createEffect(() => { loadMoreBtn.hidden = loadMoreHidden(); });
  createEffect(() => { detailCard.hidden = detailHidden(); });
  createEffect(() => { detailTitleEl.textContent = detailTitleSig(); });
  createEffect(() => { detailMetaEl.textContent = detailMetaSig(); });
  createEffect(() => { prevBundleBtn.disabled = prevDisabled(); });
  createEffect(() => { nextBundleBtn.disabled = nextDisabled(); });
  createEffect(() => { detailStatusEl.textContent = detailStatusSig(); });
  createEffect(() => { priceStatusEl.textContent = priceStatusSig(); });
  createEffect(() => { refreshPricesBtn.hidden = refreshPricesHidden(); });
  createEffect(() => { refreshPricesBtn.disabled = refreshPricesDisabled(); });
  createEffect(() => { refreshPricesBtn.textContent = refreshPricesLabel(); });
  createEffect(() => { resetViewBtn.hidden = resetViewHidden(); });
  createEffect(() => { shareViewBtn.hidden = shareViewHidden(); });
  // unresolvedSection's own visibility is derived straight from the list signal — no separate
  // "hidden" signal to keep in sync with it.
  createEffect(() => { unresolvedSection.hidden = unresolvedGamesSig().length === 0; });
});

// ── Table view persistence & sharing ──────────────────────────────────────────
// Same mechanism as library.js's own copy (see its header comment) — sort/filter/columns/
// grouping auto-persist locally via prefs.js, but the URL is only ever written on demand via the
// "Share view" button, not on every interaction the way @vates/data-table-vanilla's own
// persistViewToLocalStorage/syncViewToUrl did. Kept as its own local copy rather than shared
// with library.js — same "genuinely page-specific fetch/state logic stays local" convention the
// rest of this file and library.js already follow (see gameColumns.js's own header comment for
// the one deliberate exception to that). Deliberately not routed through urlState.js's
// reorderUrlParams either, matching this file's own existing convention for `bundle`/`game`/
// `shot` (see setBundleParam's comment) rather than library.js's.

// Consumed once, not read on every call — see library.js's own copy of this comment. This page
// rebuilds its table on every bundle open (list click, ‹/›, a region-reopen), far more often
// than a single page load, so a shared `?bv=` link is applied once, seeded as the new stored
// default, and stripped from the URL rather than clobbering later edits on every reopen.
//
// No stored pref yet (first-ever visit) falls through to `table.setViewState({})` — an empty
// view state resolves each omitted field back to the table's own `initialViewState` (see the
// createTableState call below) rather than blanking it, so this needs no guard against that.
// restoreTableView/shareTableView/resetTableView now live in tableViewPrefs.js, shared verbatim
// with library.js's own copies (see its own header comment) — they only touch
// setViewState/getViewState, which @vates/data-table-solid's TableState exposes under the same
// names/signatures both pages already relied on. bindViewPersistence is the one exception: it
// needs `table.onViewChange`, which the Solid table has no equivalent of, so both pages
// reconstruct the same "persist on every view change" effect locally instead (this page's own
// copy just below), via a createEffect over getViewState() rather than an onViewChange
// subscription.
function bindSolidViewPersistence(ts: TableState<Game>, prefKey: string): () => void {
  let dispose: (() => void) | null = null;
  createRoot(d => {
    dispose = d;
    // getViewState() reads every signal (sorts/filters/columns/grouping/etc.) that composes
    // it, so this effect re-runs — and re-persists — on any one of them changing, the same
    // "every subsequent change" behavior an onViewChange subscription would give.
    createEffect(() => setPref(prefKey, ts.getViewState()));
  });
  return () => dispose?.();
}

// Collapses the bundle list (see #bundle-list-wrap.collapsed in bundles.html) once a bundle has
// actually been picked — the list itself stops being the thing to focus on at that point, and a
// full-length list otherwise pushes the real content (the opened bundle's game table) far down
// the page. `toggleListBtn` lets it be reopened (e.g. to pick a different bundle) without
// forgetting what's currently open.
function setListCollapsed(collapsed: boolean) {
  setListCollapsedSig(collapsed);
}
toggleListBtn.addEventListener('click', () => setListCollapsed(!listCollapsedSig()));

// One shared key rather than per-bundle — this is "how I like the table set up" (which
// columns, sort, grouping), not something tied to any one bundle's own data, so it should
// carry over from whichever bundle was open last to the next one, same as it would if this
// page only ever showed a single table. Stored via the shared prefs.js (getPref/setPref) under
// its own key, same store region.js's own region preference and library.js's table views use —
// see prefs.js's own header comment for why (one store, ready for a future per-key server sync).
const TABLE_VIEW_PREF_KEY = 'bundlesTableView';
// `bv` in the URL — see urlState.js's PARAM_ORDER comment for why this and library.js's `lv`/
// `wv` share one short naming scheme. Unlike those, `bv` isn't written automatically as the
// table changes anymore either — only by the "Share view" button (shareTableView below).
const TABLE_VIEW_PARAM = 'bv';

// The Solid table itself (@vates/data-table-solid) — fed directly
// by `rowsStore` (below) via the `tableData()` accessor, mounted into `tableContainer` via
// Solid's own `render()`. `disposeTable` is that render's own unmount function (no
// `table.destroy()` method the way the vanilla table had); `table` itself is reused as the
// reactive-state object every other call site (getGameList/tableViewPrefs.ts/etc.) reads from,
// same as before.
let table: TableState<Game> | null = null;
let disposeTable: (() => void) | null = null;
let unpersistView: (() => void) | null = null;
let bundlesOffset = 0;
const BUNDLES_PAGE_SIZE = 20;
// The `resolved` list (appid + gid per game) for whatever bundle is currently open — kept
// around so the "↻ Refresh prices" button (see the refreshPricesBtn wiring below) can re-run
// just loadPrices() for the open bundle without re-resolving Steam appids or re-streaming
// ratings/HLTB/tags, which openBundle()'s own full reopen would otherwise repeat for nothing.
let currentResolvedGames: ResolvedGame[] = [];

// `rowsStore`/`setRowsStore` — a real Solid store, replacing the
// plain `rows` array + `rowCache.ts` reference-copy workaround the table itself needed
// (a bare `createStore` with direct `row.field = x` mutation is
// actively blocked in Solid's dev mode, and was empirically found to leave the table permanently
// empty). The fix isn't to avoid the store, it's to mutate it correctly: every mutation site
// below goes through `mutateRow`, which wraps the existing mutate-in-place helpers
// (`applyDetailsEvent`/`applyPriceInfo`/`nullMissingPriceFields`, all unchanged) in `produce()`
// (`solid-js/store`) — `produce` hands its callback a draft that *does* support direct property
// assignment, diffing it against the real store on return, so none of those shared functions
// needed their own signature to change.
//
// Because each array element is itself a store-proxied object, `@vates/data-table-solid`'s own
// per-cell rendering (confirmed by reading its source: each `<td>` is a small reactive insertion
// that reads `row[column.key]` directly) re-renders exactly the cell that changed, with no need
// to give the row a new object reference at all — that half of `rowCache.ts`'s old job (the
// table's own re-render) is done by the store itself now.
//
// The other half isn't: `panel.tsx` is deliberately left untouched and
// still expects to mutate whatever `Game` object it's given via plain `game.field = x` writes —
// its own lazy news/DLC/price loaders do exactly that. Handing it a `rowsStore` proxy directly
// hit that same "Cannot mutate a Store directly" wall live (confirmed via Playwright: opening a
// panel from this table warned 7 times, once per panel-owned field those loaders touch). So the
// table and the panel deliberately read from *two different objects per row* — `rowsStore` (the
// reactive one, table-only) and `panelRows` (a plain `Map<number, Game>`, never store-linked,
// the only thing ever passed to `panelOpen`). `mutateRow` updates both from the same mutate
// function, so they never drift; `getRow`/`openGame` (below) are the only two places that read
// `panelRows`, same "one indirection point" `rowMap` used to be.
const [rowsStore, setRowsStore] = createStore<Game[]>([]);
// `rowStore` (see rowStore.ts) holds `rowIndex`/`panelRows` and the `getRow`/`mutateRow` pair —
// `getRow`/`openGame` (below) are the only two places that read `panelRows`, same "one
// indirection point" `rowMap` used to be.
const rowStore = createRowStore<Game>((idx, updater) => setRowsStore(idx, updater));
// A new generation is taken at the start of every openBundle() call, and checked again at
// every point afterward that touches disposeTable/table/rowIndex/panelRows or their derived UI —
// a stale call (superseded by a newer openBundle() fired while it was still resolving/streaming,
// e.g. rapid ‹/› clicks) bails out instead of racing the newer call to reassign that state and
// mount a second, orphaned Solid table root into tableContainer alongside the winning call's own.
const openBundleGuard = createStaleGuard();
function getRow(appid: number): Game | undefined {
  return rowStore.getRow(appid);
}
function mutateRow(appid: number, fn: (draft: Game) => void): Game | undefined {
  return rowStore.mutateRow(appid, fn);
}

// Batches detail-stream events (see streamBatcher.ts's own header comment) — bundles are
// usually small enough that calling mutateRow unbatched per streamed game went unnoticed, but
// there's no structural reason this page should be exempt from the exact bug library.tsx had to
// fix live (a large-enough game list freezing the browser tab's main thread while streaming).
const detailBatcher = createStreamBatcher<DetailEvent>({
  apply: event => {
    const row = mutateRow(event.appid, draft => applyDetailsEvent(draft, event));
    if (!row) return;
    // renderPanelNav too, not just renderPanelBody — the nav bar's list/position (see
    // getGameList) only includes non-loading rows, so a panel opened via a `?game=` deep
    // link (which opens the row immediately, before the stream starts — see openBundle's
    // early restorePanelFromUrl call) would otherwise be stuck showing "0 / 0" and a stale,
    // empty nav-button list until every game in the bundle finished loading, not just this one.
    if (isPanelOpen() && getPanelGame()?.appid === row.appid) { renderPanelBody(row); renderPanelNav(row); }
  },
  isStale: gen => openBundleGuard.isStale(gen),
});

// Non-loading rows, fed straight to `createTableState` as a plain accessor — no explicit
// "notify the table" call needed anywhere below; reading `.loading` off every row here is itself
// a tracked store read, so this recomputes whenever any row's `loading` flag flips (its own
// first-time reveal), same moment an explicit `setTableData(...)` used to be called by hand.
function tableData(): Game[] {
  return rowsStore.filter(r => !r.loading);
}

// Stable order for the panel's prev/next/random nav — the table's current search/filter/sort
// order, independent of pagination/grouping (display-only, no single well-defined linear order
// once a multi-value column like Genres fans a game out into more than one group).
// `table.processedData()` (an Accessor, `@vates/data-table-solid`'s equivalent of the vanilla
// table's `getProcessedData()` method) exposes exactly this directly. Same approach library.js's
// own getGameList uses.
function getGameList(): Game[] {
  return table ? table.processedData() : [];
}

// This page only ever has one game list open at a time (the currently open bundle's table),
// unlike library.js's Library/Wishlist tabs — a fixed queueKey is enough (see pickRandomFrom's
// own comment in panel.js). Switching bundles doesn't need to explicitly clear it either:
// pickRandomFrom already rebuilds the queue on its own once none of its remaining entries match
// the current list's appids, which a bundle switch naturally causes.
const RANDOM_QUEUE_KEY = 'bundle-games';

// initNav('bundles') used to be the first line of init() below, called only once the page's own
// async setup ran — an accidental difference from app.js/library.js, which both call it
// immediately. It has no dependency on anything init() computes, so it's folded into the same
// initPageShell() sequence those two pages use instead.
initPageShell({
  page: 'bundles',
  lightbox: { onParamChange: setLightboxParam, onGameNav: navigateLightboxGame },
  panel: {
    inertSelector: '.bundles-page',
    showAchievements: true,
    // Every row here is always batch-priced by loadPrices (see its own comment) — never a
    // per-game fetch of panel.js's own, which would just duplicate that same call.
    pricesHandledByHost: true,
    onRefresh: async (row: Game) => {
      try {
        const res = await fetch(`/api/game-details/${row.appid}?refresh=1`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Refresh failed');
        // Not every open game is one of this bundle's own store-backed rows (a DLC/base-game
        // link can navigate to something outside it — see openStandaloneGame); mutateRow returns
        // undefined for those, so fall back to mutating the plain standalone object directly,
        // same as before this row data was store-backed.
        const updated = mutateRow(row.appid, draft => applyDetailsEvent(draft, data));
        if (!updated) applyDetailsEvent(row, data);
        await loadAchievements(updated ?? row, { force: true });
      } catch (err) {
        setDetailStatusSig(`Refresh failed: ${(err as Error).message}`);
      }
    },
    // Clicking a DLC/base-game link inside the panel — the linked appid may not be one of this
    // bundle's own resolved rows (e.g. a DLC not itself included in the bundle), so it's fetched
    // standalone the same way public/library.js's "look up any game" flow does.
    onNavigateGame: (appid: number, name: string) => openStandaloneGame(appid, name, { keepHistory: true }),
    // Runs on every close path (see the comment on `onClose` in panel.js) — the backdrop click,
    // × button, and swipe-to-close, not just an explicit Escape — so `?game=` never sticks around
    // after the panel's actually gone. openBundle()'s own panelClose() call (a genuine new bundle
    // open) already clears it beforehand too — see its own comment — so this just runs
    // redundantly-but-harmlessly there.
    onClose: () => setPanelParam(null),
    // A real href (not the placeholder '#' this used to be, back when there was no `?game=` URL
    // to point at) so ctrl/cmd/shift/middle-click on a DLC entry still opens it in a new tab.
    gameHref: (appid: number | string) => {
      const params = new URLSearchParams(location.search);
      params.set('game', String(appid));
      return `?${params}`;
    },
  },
});

const achievementsCache = new Map();

async function loadAchievements(game: Game, { force = false } = {}) {
  if (!force) {
    const cached = achievementsCache.get(game.appid);
    if (cached) { game.achievements = cached; if (isPanelOpen() && getPanelGame() === game) renderPanelBody(game); return; }
  }
  game.achievementsLoading = true;
  if (isPanelOpen() && getPanelGame() === game) renderPanelBody(game);
  try {
    const qs = new URLSearchParams();
    if (force) qs.set('refresh', '1');
    const res = await fetch(`/api/achievements/${game.appid}?${qs}`);
    const data = await res.json();
    if (res.ok) achievementsCache.set(game.appid, data);
    game.achievements = res.ok ? data : null;
  } catch {
    game.achievements = null;
  } finally {
    game.achievementsLoading = false;
    if (isPanelOpen() && getPanelGame() === game) renderPanelBody(game);
  }
}

// Builds the panel's prev/next/random nav bar (`#panel-nav`, shared markup/CSS/keys with
// library.js/app.js — see panelNav.js/CLAUDE.md's panel.js bullet) from getGameList()'s current
// search/filter/sort order. Empty for a standalone lookup (see openStandaloneGame below) —
// there's no natural list to page through, same as library.js's own version of this function.
function renderPanelNav(game: Game) {
  renderPanelNavShared({ table, game, getGameList, onOpen: openGame, onReroll: pickRandomGame });
}

function openGame(game: Game, { isRandom = false, keepHistory = false } = {}) {
  if (!isRandom) clearRandomQueue(RANDOM_QUEUE_KEY);
  // Always open against the plain panelRows copy, never a rowsStore proxy — see that map's own
  // comment above for why (panel.tsx's lazy loaders mutate whatever object they're given
  // directly, which a Solid store blocks). A `game` not in panelRows (a genuine standalone
  // lookup) falls through to whatever was actually passed, unchanged from before.
  const resolved = getRow(game.appid) ?? game;
  panelOpen(resolved, { keepHistory });
  renderPanelNav(resolved);
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

function pickRandomGame() {
  const current = getPanelGame();
  if (!table || !current || current.standalone) return; // see renderPanelNav
  const pick = pickRandomFrom(getGameList(), RANDOM_QUEUE_KEY, current.appid);
  if (pick) openGame(pick as Game, { isRandom: true });
}

// A game linked from the panel (DLC/base-game nav) that isn't one of this bundle's own
// resolved rows — fetched directly, same "standalone lookup" shape as
// public/library.js/public/gameSearch.js use for the same situation. Routed through openGame
// (rather than calling panelOpen directly, as this used to) so the nav bar actually clears
// itself for a standalone view instead of showing stale buttons/position left over from
// whichever row was open before, and so `?game=` follows this navigation too, same as it does
// library.js's own DLC-link navigation.
function openStandaloneGame(appid: number, name = '', { keepHistory = false } = {}) {
  const existing = getRow(appid);
  if (existing) { openGame(existing, { keepHistory }); return; }
  const game = { appid, name: name || `App ${appid}`, loading: true, details: null, standalone: true } as Game;
  openGame(game, { keepHistory });
  fetch(`/api/game-details/${appid}`)
    .then(res => res.json().then(data => ({ ok: res.ok, data })))
    .then(({ ok, data }) => {
      if (!ok) throw new Error(data.error || 'Lookup failed');
      applyDetailsEvent(game, data);
      if (data.meta?.name) game.name = data.meta.name;
      if (getPanelGame() === game) renderPanelBody(game);
    })
    .catch(() => {});
}

// `?game=<appid>` (and, within it, `&shot=<idx>` for an open lightbox screenshot/video) — deep
// link to an open game panel. `setPanelParam`/`setLightboxParam` (`urlState.ts`) are shared with
// `app.tsx`/`library.tsx` (see CLAUDE.md's "Looking up an arbitrary game" section for the general
// shape) — this page's own copies used to skip `reorderUrlParams` entirely, unlike the other two,
// which could leave `?game=`/`?shot=` in a different position than the canonical order the rest
// of the app enforces. Not pushed, same convention as this page's own `setBundleParam` below.

// Reopens the panel (and, if present, the lightbox) from `?game=`/`?shot=`. Takes an explicit
// `restoreShot` rather than always re-reading `location.search` — opening the panel calls
// setPanelParam(), which deletes `shot` from the live URL (a fresh panel open always resets to
// the hero), so by the time a row's details are in on the second (post-stream) call below,
// `shot` would already be gone from the URL itself; the caller threads the page-load value
// through instead. Mirrors library.js's own restorePanelFromUrl exactly (see its own comment).
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
  if (getPanelGame()?.appid === appid) return; // already open / fetch already in flight
  openStandaloneGame(appid);
}

// No `shortcuts` modal, no `/`-focus target — this page has neither, unlike app.tsx/library.tsx.
bindPanelKeyboardShortcuts({
  isLightboxOpen,
  isPanelOpen,
  panelClose,
  panelStepHero,
  pickRandom: pickRandomGame,
  stepGame: dir => {
    const next = stepGameList(table, getGameList, getPanelGame(), dir);
    if (!next) return false;
    openGame(next);
    return true;
  },
});

// ── Bundle list ───────────────────────────────────────────────────────────────

function fmtExpiry(iso: string | null) {
  if (!iso) return 'no expiry listed';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : `ends ${d.toISOString().slice(0, 10)}`;
}

// Cheapest tier that actually HAS a price. `null` here means no tier had one at all — Fanatical's
// "Build Your Own ⟨N⟩ Bundle" pick-and-mix format (a pool of games with no fixed bundle price,
// price scales with how many you pick), never a free bundle — a genuinely free/$0 tier still has
// a real price object (`{amount: 0, ...}`), which is truthy and included here same as any other
// priced tier. See renderTierPrice's own comment above for the same distinction on the game table.
function cheapestTierPrice(bundle: Bundle): PriceAmount | null {
  const priced = (bundle.tiers || []).filter(t => t.price);
  if (!priced.length) return null;
  return priced.reduce((min, t) => (t.price as PriceAmount).amount < min.amount ? (t.price as PriceAmount) : min, priced[0].price as PriceAmount);
}

function fmtBundleListPrice(price: PriceAmount | null) {
  if (!price) return 'Price varies';
  if (price.amount === 0) return 'Free';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: price.currency }).format(price.amount);
}

// The bundle list itself, as a real Solid <For> — mounted once via render() below, reacting to
// `bundlesSig`/`activeBundleIdSig` on its own from then on (no more renderBundleList() call
// needed at every loadBundles()/openBundle() site the way the old innerHTML-rebuild version
// needed). JSX text/attribute interpolation escapes on its own (it sets textContent/attributes
// directly, never innerHTML), so this needs none of the old version's `esc()` calls.
function BundleListView() {
  return (
    <For each={bundlesSig()}>
      {bundle => {
        const price = cheapestTierPrice(bundle);
        return (
          <button
            type="button"
            class="bundle-item"
            aria-current={bundle.id === activeBundleIdSig() ? 'true' : 'false'}
            onClick={() => openBundle(bundle)}
          >
            <span class="bundle-item-title">{bundle.title}</span>
            <span class="bundle-item-shop">{bundle.page?.name || ''}</span>
            <span class="bundle-item-price">{fmtBundleListPrice(price)}</span>
            <span class="bundle-item-count">{bundle.counts?.games ?? '?'} games</span>
            <span class="bundle-item-expiry">{fmtExpiry(bundle.expiry)}</span>
          </button>
        );
      }}
    </For>
  );
}
render(() => <BundleListView />, bundleListEl);

// `expandList: false` skips the reset branch's own re-expand — for a caller that's about to
// (re)open a bundle right after this resolves (a `?bundle=` deep link on init, or re-opening
// the still-active bundle after a country change — see both call sites below). Without it, the
// list would flash open with this call's freshly (re-)fetched bundles only to be immediately
// re-collapsed once that other, independent bundle-open call lands — a visible "list pops open
// then snaps shut" flicker, worse the more cache-warm both calls are (i.e. often).
async function loadBundles({ reset = true, expandList = true } = {}) {
  if (reset) {
    bundlesOffset = 0; setBundlesSig([]);
    if (expandList) setListCollapsed(false);
  }
  setBundlesStatusText('Loading bundles…');
  const qs = new URLSearchParams({
    country: resolveRegion(getStoredRegion()),
    sort: sortSelect.value,
    expired: String(expiredCheckbox.checked),
    offset: String(bundlesOffset),
    limit: String(BUNDLES_PAGE_SIZE),
  });
  try {
    const res = await fetch(`/api/bundles?${qs}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load bundles');
    setBundlesSig(reset ? data.bundles : [...bundlesSig(), ...data.bundles]);
    bundlesOffset += data.bundles.length;
    renderBundleNav(); // the loaded list changed — e.g. "Load more" may have just made Next available
    setBundlesStatusText(bundlesSig().length ? `${bundlesSig().length} bundles` : 'No current bundles');
    setLoadMoreHidden(data.bundles.length < BUNDLES_PAGE_SIZE);
  } catch (err) {
    setBundlesStatusText(`Error: ${(err as Error).message}`);
  }
}

// ── Bundle detail — resolve games to Steam appids, then stream details ────────

function applyDetailsEvent(row: Game, event: DetailEvent) {
  row.capsule           = event.meta?.capsule ?? null;
  if (!row.name) row.name = event.meta?.name || '';
  row.score             = event.rating?.score ?? null;
  row.positivePct       = (event.rating?.positive != null && event.rating?.total)
    ? Math.round((event.rating.positive / event.rating.total) * 100) : null;
  row.steamdbRating     = (event.rating?.positive != null && event.rating?.total != null)
    ? computeSteamdbRating(event.rating.positive, event.rating.total) : null;
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
  row.languages          = event.meta?.languages ?? [];
  row.hasDemo            = event.demo != null;
  const metaType = event.meta?.type;
  row.type                = (metaType && (TYPE_LABELS as Record<string, string>)[metaType]) ?? (metaType ?? null);
  row.productionTier      = computeProductionTier({
    isFree:       event.meta?.isFree ?? false,
    priceInitial: event.meta?.priceInitial ?? null,
    reviewsTotal: event.rating?.total ?? null,
    hasMetacritic: event.meta?.metacritic != null,
    isDlc:        event.meta?.fullgame != null,
    type:         event.meta?.type ?? null,
  });
  row.loading = false;
  row.details = { rating: event.rating, hltb: event.hltb, meta: event.meta, tags: event.tags, demo: event.demo, protondb: event.protondb };
}

// `gen`: the calling openBundle()'s own generation (see openBundleGuard above) — checked at the
// top of every loop iteration, not just once at the start, since a stream spans many `await`s
// and a newer openBundle() call can supersede this one (resetting rowIndex/panelRows/the status
// line for a *different* bundle) at any point while it's still reading. Without this, a
// superseded stream kept calling mutateRow (a harmless no-op once rowIndex has moved on, or
// worse, a hit against a same-appid row belonging to the new bundle) and overwriting the new
// bundle's own status line with this one's stale counts.
async function streamGameDetails(appids: number[], gen: number) {
  let resp: Response;
  try {
    resp = await fetch('/api/game-details/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ games: appids.map(appid => ({ appid })) }),
    });
  } catch (err) {
    if (openBundleGuard.isStale(gen)) return;
    setDetailStatusSig(`Details stream failed: ${(err as Error).message}`);
    return;
  }
  const reader = resp.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let loaded = 0;
  while (true) {
    if (openBundleGuard.isStale(gen)) { reader.cancel(); return; }
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';
    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith('data: ')) continue;
      let event: DetailEvent;
      try { event = JSON.parse(line.slice(6)); } catch { continue; }
      if (event.done) continue;
      // Queued rather than applied immediately — see streamBatcher.ts's own header comment
      // (and CLAUDE.md's matching note under library.tsx) for why: an unbatched `mutateRow` per
      // streamed game triggers @vates/data-table-solid's own full sort/filter/paginate recompute
      // once per game instead of once per flush, confirmed to freeze the browser tab's main
      // thread for a large-enough game list. Bundles are usually small enough that this went
      // unnoticed, but there's no reason to leave the same gap library.tsx just had to fix live.
      detailBatcher.push(event, gen);
      loaded++;
      setDetailStatusSig(`${loaded} / ${appids.length} games loaded…`);
    }
  }
  if (openBundleGuard.isStale(gen)) return;
  detailBatcher.flushNow();
  setDetailStatusSig(`${rowStore.size()} games`);
}

// Flattens a bundle's tiers into one row per unique game — a game unlocked at more than one
// tier (common: a cheap tier's games are still included in every pricier tier) keeps only the
// cheapest tier it first appears at, since that's the price that actually gets you this game.
// ITAD's tiers are already price-ascending in every bundle observed, so "first occurrence" and
// "cheapest occurrence" are the same thing here.
function flattenBundleGames(bundle: Bundle): FlatGame[] {
  const seen = new Map<string, FlatGame>(); // gid -> { gid, slug, title, type, assets, tierPrice, tierCurrency, addon }
  for (const tier of bundle.tiers || []) {
    for (const g of tier.games || []) {
      if (seen.has(g.id)) continue;
      seen.set(g.id, {
        gid: g.id, slug: g.slug, title: g.title, type: g.type, assets: g.assets ?? null,
        tierPrice: tier.price ? tier.price.amount : null,
        tierCurrency: tier.price ? tier.price.currency : null,
        addon: !!tier.addon,
      });
    }
  }
  return [...seen.values()];
}

// The "Not on Steam" list — a real Solid <For>, mounted once via render() below, reacting to
// `unresolvedGamesSig` on its own (replaces the old renderUnresolvedList()'s innerHTML rebuild;
// its own two call sites now just call setUnresolvedGamesSig directly — see openBundle below).
function UnresolvedListView() {
  return (
    <For each={unresolvedGamesSig()}>
      {g => (
        <div class="unresolved-item">
          <Show when={g.assets?.boxart}>
            {(boxart: () => string) => <img src={boxart()} alt="" loading="lazy" />}
          </Show>
          <div>
            <div class="unresolved-item-title">{g.title}</div>
            <div class="unresolved-item-type">{(g.type && (TYPE_LABELS as Record<string, string>)[g.type]) || g.type || 'Game'}</div>
          </div>
        </div>
      )}
    </For>
  );
}
render(() => <UnresolvedListView />, unresolvedListEl);

// Bundle-level actions kept out of the (already-crowded) list rows and shown only once a
// bundle is actually open — a plain link to ITAD's own page for it, and its real purchase
// link. `bundle.url` is the shop/affiliate link exactly as ITAD returned it — never rewritten
// or stripped of tracking params (ITAD's terms require passing prices/links through
// unmodified; see CLAUDE.md). A real Solid <Show> pair, mounted once via render() below,
// reacting to `detailLinksSig` (replaces the old renderDetailLinks()'s innerHTML rebuild).
function DetailLinksView() {
  return (
    <Show when={detailLinksSig()}>
      {(links: () => { details: string | null; url: string | null }) => (
        <>
          <Show when={links().details}>
            {(href: () => string) => <a class="btn btn-ghost btn-sm" href={href()} target="_blank" rel="noopener">View on IsThereAnyDeal ↗</a>}
          </Show>
          <Show when={links().url}>
            {(href: () => string) => <a class="btn btn-primary btn-sm" href={href()} target="_blank" rel="noopener">Get this bundle ↗</a>}
          </Show>
        </>
      )}
    </Show>
  );
}
render(() => <DetailLinksView />, detailLinksEl);

// Prev/Next step through whatever's currently loaded in `bundlesSig()` (respecting its current
// sort/filter), not the full remote list — no auto-"Load more" and no wraparound at the ends,
// both buttons just disable there. A bundle opened via deep link that isn't part of the
// currently loaded page (or opened before any list has loaded at all) has no list position to
// navigate from, so both buttons disable rather than guessing.
function renderBundleNav() {
  const list = bundlesSig();
  const idx = list.findIndex(b => b.id === activeBundleIdSig());
  setPrevDisabled(idx <= 0);
  setNextDisabled(idx === -1 || idx >= list.length - 1);
}
prevBundleBtn.addEventListener('click', () => {
  const list = bundlesSig();
  const idx = list.findIndex(b => b.id === activeBundleIdSig());
  if (idx > 0) openBundle(list[idx - 1]);
});
nextBundleBtn.addEventListener('click', () => {
  const list = bundlesSig();
  const idx = list.findIndex(b => b.id === activeBundleIdSig());
  if (idx !== -1 && idx < list.length - 1) openBundle(list[idx + 1]);
});

// Fetches Steam's non-discounted price + historical lows for the bundle's resolved games (see
// the shared POST /api/prices — gid-keyed here, since Bundles already has ITAD gids; the
// Library Explorer's Wishlist price columns hit the same route with `appids` instead — see its
// own comment in server.js) and applies them once available — a single batch call, not
// streamed per-game like ratings/HLTB/tags, so it can land before or after any given row has
// finished streaming its other details. Either order is fine: rows not yet visible (still
// `loading`) simply carry the price fields already set by the time they do appear; rows already
// visible pick the new columns up automatically once mutateRow updates the store.
//
// `force`: set by the "↻ Refresh prices" button below — bypasses the server's `itad-price:`
// cache read for this call (?refresh=1, same convention as every other force-refresh in this
// app) so a stale price actually gets re-fetched from ITAD instead of just re-reading the same
// cached response back.
// `gen`: defaults to whatever generation is currently in effect — right for the `refreshPricesBtn`
// handler below, which isn't itself starting a new bundle load, just re-running work for
// whatever's already loaded. openBundle passes its own generation explicitly instead, so a
// superseded call (a newer openBundle() already in progress) doesn't write this bundle's prices
// onto the new one's rows once the fetch resolves.
async function loadPrices(resolved: ResolvedGame[], { force = false, gen = openBundleGuard.current() }: { force?: boolean; gen?: number } = {}) {
  setPriceStatusSig('');
  try {
    const prices = await postPrices({ gids: resolved.map(g => g.gid), country: resolveRegion(getStoredRegion()), force });
    if (openBundleGuard.isStale(gen)) return;
    // batch() — same reasoning as streamGameDetails/streamBatcher.ts above and library.tsx's
    // loadWishlistPrices: `resolved` has no per-item await between iterations, so without this
    // every mutateRow call here would trigger its own @vates/data-table-solid re-sort/re-filter/
    // re-paginate instead of just one at the end of the loop.
    batch(() => {
      for (const g of resolved) {
        const info = prices[g.gid];
        if (!info) continue;
        const row = mutateRow(g.appid, draft => applyPriceInfo(draft, info, discountPct));
        if (!row) continue;
        if (isPanelOpen() && getPanelGame() === row) renderPanelBody(row);
      }
    });
  } catch (err) {
    if (openBundleGuard.isStale(gen)) return;
    console.warn('[bundles] price lookup failed:', (err as Error).message);
    // Without this, a failed request (rate limited, transient upstream error) left every
    // price-ish cell stuck on its "…" loading placeholder forever — indistinguishable from
    // "still loading" and easy to mistake for a hung page rather than a failure. `null` here
    // means "we tried and it didn't work", same as the "no data" state these columns already
    // render for a genuinely missing price — and a status line makes the failure visible
    // rather than only a console warning nobody but a developer would see.
    batch(() => {
      for (const g of resolved) {
        const row = mutateRow(g.appid, draft => nullMissingPriceFields(draft));
        if (!row) continue;
        if (isPanelOpen() && getPanelGame() === row) renderPanelBody(row);
      }
    });
    setPriceStatusSig(`Couldn't load Steam pricing (${(err as Error).message}) — other columns are unaffected.`);
  }
}

// Tears down whatever bundle table/rows are currently on screen (a real open one, or a partial
// one from a resolve that never finished) — shared by openBundle's own genuine-new-bundle reset
// and openBundleById's "the deep link failed, there's no bundle to show" cleanup, which used to
// each carry their own near-identical copy of this same block (the latter's copy was a strict
// subset, missing setRefreshPricesHidden/setRowsStore/rowStore.reset/currentResolvedGames —
// harmless in practice since those only matter once a bundle has actually started resolving,
// but there's no reason for the two copies to be able to drift like that). Mirrors library.js's
// own named `resetTableState`.
function resetBundleTableState() {
  if (unpersistView) { unpersistView(); unpersistView = null; }
  if (disposeTable) { disposeTable(); disposeTable = null; }
  table = null;
  tableContainer.innerHTML = '';
  setResetViewHidden(true);
  setShareViewHidden(true);
  setRefreshPricesHidden(true);
  setRowsStore([]);
  rowStore.reset();
  currentResolvedGames = [];
}

// `preserveGameParam`: true only for the initial page-load deep link (init() below) — a
// genuine new bundle open (list click, ‹/› nav, a fresh `?bundle=` deep link) always closes
// whatever's open and clears `?game=` first, since that game's nav position/owners-equivalent
// belonged to whichever bundle (or standalone lookup) was open before and no longer applies —
// same "a new Load clears the panel unless explicitly restoring" convention library.js's own
// resetTableState/loadLibrary use. Region changes (see the REGION_CHANGED_EVENT handler below) are the
// one case that reopens the *same* bundle in place and does pass this, so the open game — same
// bundle, same rows, same order, just re-priced — stays open across it.
async function openBundle(bundle: Bundle, { preserveGameParam = false, restoreShot = null }: { preserveGameParam?: boolean; restoreShot?: string | null } = {}) {
  const gen = openBundleGuard.next();
  if (!preserveGameParam) {
    if (isPanelOpen()) panelClose(); // onClose (see initPanel above) clears `?game=` itself
    else setPanelParam(null); // no panel open, but a leftover `?game=` from before should still go
  }
  setActiveBundleIdSig(bundle.id);
  renderBundleNav();
  setListCollapsed(true);
  setBundleParam(bundle.id);

  setDetailHidden(false);
  setDetailTitleSig(bundle.title);
  setDetailMetaSig(`${bundle.page?.name || 'Unknown shop'} · ${bundle.counts?.games ?? '?'} games · ${fmtExpiry(bundle.expiry)}`);
  setDetailLinksSig({ details: bundle.details, url: bundle.url });
  setDetailStatusSig('Resolving games to Steam…');
  setPriceStatusSig('');
  setUnresolvedGamesSig([]);

  resetBundleTableState();

  const games = flattenBundleGames(bundle);

  let appidsByGid;
  try {
    const res = await fetch('/api/bundles/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gids: games.map(g => g.gid) }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Resolution failed');
    appidsByGid = data.appids;
  } catch (err) {
    if (openBundleGuard.isStale(gen)) return; // stale — a newer openBundle() call has since taken over
    setDetailStatusSig(`Error: ${(err as Error).message}`);
    setUnresolvedGamesSig(games);
    return;
  }
  if (openBundleGuard.isStale(gen)) return; // stale — a newer openBundle() call has since taken over disposeTable/table/rowIndex/panelRows

  const resolved = [];
  const unresolved = [];
  // rowIndex/panelRows below (and the table itself, via DataTableView's own `rowKey: 'appid'`)
  // are all keyed by Steam appid, not ITAD gid — but flattenBundleGames only dedupes by *gid*,
  // and two distinct ITAD game ids occasionally do resolve to the same Steam appid (an observed
  // ITAD data-quality case, not expected to be common). A second row for an appid already seen
  // can't be shown as its own row either way, so it's dropped here rather than silently
  // colliding in rowIndex later (which used to leave the earlier row's `loading: true` flag
  // never cleared — mutateRow could never reach it once its Map slot was overwritten by the
  // later duplicate — so it just vanished from the table with no trace). `games`' own order
  // (from flattenBundleGames) is already cheapest-tier-first, so keeping the first occurrence
  // here is the same "keep first occurrence" convention that function already uses for gid.
  const seenAppids = new Set<number>();
  for (const g of games) {
    const appid = appidsByGid[g.gid];
    if (!appid) { unresolved.push(g); continue; }
    if (seenAppids.has(appid)) continue;
    seenAppids.add(appid);
    resolved.push({ ...g, appid });
  }
  setUnresolvedGamesSig(unresolved);
  currentResolvedGames = resolved;

  if (resolved.length === 0) {
    setDetailStatusSig('No games in this bundle could be matched to a Steam listing.');
    return;
  }

  // The price/score/etc. fields start `undefined` (each "still loading until its own async
  // source resolves") rather than `null` ("no data"), so this literal is cast to Game[] — the
  // same "permissive at the edges, assembled from several async sources" convention types.ts's
  // own header describes.
  const initialRows = resolved.map(g => ({
    appid: g.appid,
    name: g.title,
    tierPrice: g.tierPrice,
    tierCurrency: g.tierCurrency,
    priceCurrency: undefined, // set by loadPrices — see the comment on formatMoney (utils.js)/renderPrice (gameColumns.js) for why this is a separate field from tierCurrency
    addon: g.addon,
    steamRegular: undefined, bestDealPrice: undefined, bestDealShop: undefined, bestDealUrl: undefined, bestDealCut: undefined,
    lowAll: undefined, lowY1: undefined, lowM3: undefined,
    capsule: undefined, score: undefined, positivePct: undefined, steamdbRating: undefined,
    reviewsTotal: undefined, hltbMain: undefined, hltbExtra: undefined, hltbCompletionist: undefined,
    hltbAll: undefined, metacritic: undefined, releaseDate: undefined, genres: undefined,
    developers: undefined, publishers: undefined, tags: undefined, categories: undefined,
    protondb: undefined, protondbPending: undefined, achievementCount: undefined, dlcCount: undefined, platforms: undefined,
    languages: undefined, hasDemo: undefined,
    loading: true, details: null,
  })) as unknown as Game[];
  setRowsStore(initialRows);
  rowStore.load(initialRows);

  // @vates/data-table-solid: `createTableState` builds the reactive state (fed by the
  // `tableData` accessor above), `DataTableView` renders it — mounted by hand via Solid's own
  // `render()`. `createTableState` itself needs its own `createRoot` — it isn't called from
  // inside `render()`'s own tree, and without one every memo/effect it creates internally
  // warns "created outside a createRoot ... will never be disposed" (and genuinely leaks
  // across bundle opens) — `disposeTableState` disposes those; `disposeTable` (below) combines
  // it with `render()`'s own unmount fn, replacing the vanilla table's single
  // `table.destroy()` with the two disposals this needs.
  let disposeTableState!: () => void;
  const ts = createRoot(dispose => {
    disposeTableState = dispose;
    return createTableState<Game>(tableData, BUNDLE_COLUMNS as unknown as ColumnDef<Game>[], {
      initialViewState: { pageSize: 50, visibleCols: DEFAULT_VISIBLE, sorts: DEFAULT_SORT },
    });
  });
  table = ts;
  const disposeView = render(() => DataTableView<Game>({
    table: ts,
    rowKey: 'appid',
    // `row` here is already the canonical store-proxied object (rowsStore itself, not a copy —
    // unlike the old rowCache-backed table, there's no separate cache to look past), but look it
    // back up via getRow anyway for the same appid-indirection every other call site uses, and
    // as a safety net for a row somehow not part of this bundle's own store.
    onRowClick: row => openGame(getRow(row.appid) ?? (row as Game)),
  }), tableContainer);
  disposeTable = () => { disposeView(); disposeTableState(); };
  // Loads whatever URL param / stored pref should win (see restoreTableView's own comment) on
  // top of the construction-time default view just applied above, then persists every
  // subsequent change locally.
  restoreTableView(table, TABLE_VIEW_PREF_KEY, TABLE_VIEW_PARAM);
  // tableViewPrefs.ts's own bindViewPersistence needs `table.onViewChange`, which the Solid
  // table doesn't have (unlike the vanilla one library.ts still uses) — reconstructed locally
  // via a createEffect that re-reads getViewState() (tracking every signal it touches) instead.
  unpersistView = bindSolidViewPersistence(ts, TABLE_VIEW_PREF_KEY);
  setResetViewHidden(false);
  setShareViewHidden(false);
  setRefreshPricesHidden(false);

  setDetailStatusSig(`0 / ${resolved.length} games loaded…`);
  // Early attempt — rowIndex/rowsStore are populated (just above) well before the stream below finishes, so
  // a `?game=` that's part of this bundle can open right away as a real, progressively-filling
  // row instead of waiting for every game in the bundle to finish loading first; the lightbox
  // needs actual media data though, so `restorePanelFromUrl` is tried again once the stream
  // below completes — same two-call shape library.js's own loadLibrary/loadWishlist use, for
  // the same reason (see restorePanelFromUrl's own comment).
  if (preserveGameParam) restorePanelFromUrl(restoreShot);
  // Independent calls — Steam pricing has nothing to do with the rating/HLTB/tags pipeline —
  // run concurrently rather than one after the other.
  await Promise.all([streamGameDetails(resolved.map(g => g.appid), gen), loadPrices(resolved, { gen })]);
  if (openBundleGuard.isStale(gen)) return; // stale — a newer openBundle() call has since taken over
  if (preserveGameParam) restorePanelFromUrl(restoreShot);
}

// ── Wiring ──────────────────────────────────────────────────────────────────

// Region itself is picked from the nav bar's own ⚙ Preferences popover (public/nav.js) now, not
// a picker on this page — this just shows a read-only readout of whatever it currently resolves to.
function updateBundlesRegionLabel() {
  const code = resolveRegion(getStoredRegion());
  setRegionLabel(COUNTRY_OPTIONS.find(c => c.code === code)?.label ?? code);
}
updateBundlesRegionLabel();

// Fired by region.js's setStoredRegion on every change, regardless of which UI made it (now
// always the nav bar's popover) — same effect this page's own inline picker's 'change' handler
// used to have directly.
window.addEventListener(REGION_CHANGED_EVENT, () => {
  updateBundlesRegionLabel();
  // A bundle's tier price and its games' Steam Full Price/Best Deal/lows (loadPrices above)
  // are all region-specific, but loadBundles() only refreshes the browse list above — it
  // never touches whatever bundle is currently open in the detail view below it. Re-open it
  // the same way a `?bundle=` deep link does, so its prices actually pick up the new country
  // instead of staying stuck on whatever was loaded before.
  const activeId = activeBundleIdSig();
  const reopening = activeId != null;
  // Skip the list's own re-expand when we're about to reopen the still-active bundle right
  // after — it's already collapsed (a bundle is open) and openBundle() will just collapse it
  // again once the reopen resolves, so expanding it here only produces a pointless flicker.
  // When no bundle is open, this is a plain browsing action and the list expands as usual.
  loadBundles({ expandList: !reopening });
  // Same bundle, same rows, same order, just re-priced — whatever game is open should stay
  // open across this, not get closed the way a genuine new bundle open otherwise would (see
  // openBundle's own comment).
  if (activeId != null) openBundleById(activeId, { preserveGameParam: true });
});
sortSelect.addEventListener('change', () => loadBundles());
expiredCheckbox.addEventListener('change', () => loadBundles());
loadMoreBtn.addEventListener('click', () => loadBundles({ reset: false }));

resetViewBtn.addEventListener('click', () => {
  if (!table) return;
  resetTableView(table, TABLE_VIEW_PREF_KEY, TABLE_VIEW_PARAM);
});

shareViewBtn.addEventListener('click', () => shareTableView(table!, TABLE_VIEW_PARAM, shareViewBtn));

// Refreshes just the price columns for the currently open bundle's games, in one shot — no
// reason to make a user step through every game's own panel "↻ Refresh" one at a time when
// the whole batch is a single cheap POST /api/prices call anyway.
refreshPricesBtn.addEventListener('click', async () => {
  if (currentResolvedGames.length === 0 || refreshPricesDisabled()) return;
  setRefreshPricesDisabled(true);
  setRefreshPricesLabel('Refreshing…');
  try {
    await loadPrices(currentResolvedGames, { force: true });
  } finally {
    setRefreshPricesDisabled(false);
    setRefreshPricesLabel('↻ Refresh prices');
  }
});

// `?bundle=<id>` deep link — writes/clears the param while preserving everything else already
// in the URL. Not pushed — opening a different bundle isn't meant to be a separate back/
// forward-navigable step (this page has no popstate listener at all, unlike library.js/app.js),
// same as how `sort`/`view` elsewhere in this app are written. `country` is deliberately not
// part of this (or any) URL — it's a `localStorage` preference (see public/region.js), not
// shareable state, since it says more about the viewer than about which bundle they're looking
// at.
function setBundleParam(id: number | null) {
  const params = new URLSearchParams(location.search);
  if (id == null) params.delete('bundle');
  else params.set('bundle', String(id));
  // `bundle` isn't in urlState.ts's own PARAM_ORDER (page-specific, no other page has it) —
  // reorderUrlParams still appends it after every known param, same "byte-identical regardless
  // of write order" guarantee `game`/`shot`/`bv` etc. already get.
  history.replaceState(null, '', `?${reorderUrlParams(params)}`);
}

// There's no single-bundle-fetch endpoint upstream (see findBundleById's own comment in
// lib/itad.js) — a deep link always goes straight to GET /api/bundles/:id (a bounded
// server-side search) rather than trying to find the id in whatever's already loaded in
// `bundlesSig()`, which may not even include it (a different sort/page, or not loaded yet at
// all on initial page load — this runs concurrently with loadBundles(), not after it).
async function openBundleById(id: number, { preserveGameParam = false, restoreShot = null }: { preserveGameParam?: boolean; restoreShot?: string | null } = {}) {
  // Takes its own generation before the id-lookup fetch — a *different* concurrent
  // openBundleById()/openBundle() call finishing first (e.g. two rapid `?bundle=` deep links,
  // or a list click racing a still-in-flight deep link) must win over this one's own catch
  // block below, the same way two concurrent openBundle() calls already needed openBundleGuard
  // for. Only checked in the catch: the success path already hands off to openBundle(), which
  // takes its own fresh generation and manages the same race for everything it touches.
  const gen = openBundleGuard.next();
  try {
    const qs = new URLSearchParams({ country: resolveRegion(getStoredRegion()) });
    const res = await fetch(`/api/bundles/${id}?${qs}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Bundle not found');
    await openBundle(data.bundle, { preserveGameParam, restoreShot });
  } catch (err) {
    if (openBundleGuard.isStale(gen)) return; // stale — a newer open has since taken over
    // Same UI slot a normally-opened bundle would use — there's no other sensible place to
    // surface "the bundle this link pointed at doesn't exist (anymore)". The invalid id is
    // dropped from the URL so a refresh doesn't repeat the same failed lookup.
    setDetailHidden(false);
    setDetailTitleSig('Bundle not found');
    setDetailMetaSig('');
    setDetailLinksSig(null);
    setDetailStatusSig((err as Error).message);
    setPriceStatusSig('');
    setUnresolvedGamesSig([]);
    resetBundleTableState();
    setActiveBundleIdSig(null);
    renderBundleNav();
    setBundleParam(null);
    // No bundle ended up open, so this is back to being a plain browsing state — re-expand the
    // list rather than leaving it stuck collapsed with nothing open underneath it (a caller
    // that skipped loadBundles' own expand in anticipation of this call succeeding — see
    // `expandList` above — otherwise has no other path back to an expanded list).
    setListCollapsed(false);
  }
}

async function init() {
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    if (!data.itadConfigured) {
      setNotConfiguredHidden(false);
      setBrowseHidden(true);
      return;
    }
  } catch { /* if health itself fails, fall through and let loadBundles surface the real error */ }
  // Independent of each other — the deep link's own server-side search doesn't depend on
  // whatever page of the list loadBundles happens to fetch.
  const deepLinkId = Number(new URLSearchParams(location.search).get('bundle'));
  const hasDeepLink = Number.isInteger(deepLinkId) && deepLinkId > 0;
  // Captured once, up front — opening the panel deletes `shot` from the live URL (see
  // restorePanelFromUrl's own comment), so re-reading location.search for it after that point
  // would already be too late.
  const restoreShot = new URLSearchParams(location.search).get('shot');
  // Skip loadBundles' own list expand when a deep link is about to open a bundle right after —
  // otherwise the list would flash open with the freshly loaded bundles only to be immediately
  // collapsed again once the deep link resolves (see `expandList`'s own comment above).
  if (hasDeepLink) setListCollapsed(true);
  loadBundles({ expandList: !hasDeepLink }); // deliberately not awaited — unrelated to either deep link below
  if (hasDeepLink) {
    // `preserveGameParam: true` — this is the initial page-load open, so a `?game=`/`&shot=`
    // alongside `?bundle=` needs to survive until openBundle()'s own restorePanelFromUrl calls
    // get to read them; openBundle() would otherwise clear `?game=` immediately (no panel is
    // open yet to preserve).
    await openBundleById(deepLinkId, { preserveGameParam: true, restoreShot });
  } else {
    // No bundle deep link at all — still honor a bare `?game=`/`&shot=` standalone lookup
    // (openBundle's own restorePanelFromUrl calls would otherwise be the only callers).
    restorePanelFromUrl(restoreShot);
  }
}

init();
