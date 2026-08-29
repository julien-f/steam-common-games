'use strict';

import { esc, formatMoney, computeSteamdbRating, computeProductionTier } from '/utils.js';
import { reorderUrlParams } from '/urlState.js';
import { restoreTableView, bindViewPersistence, shareTableView, resetTableView } from '/tableViewPrefs.js';
import { createRowCache } from '/rowCache.js';
import { renderPanelNav as renderPanelNavShared, stepGameList } from '/panelNav.js';
import { postPrices, applyPriceInfo, nullMissingPriceFields } from '/priceLoading.js';
import { COUNTRY_OPTIONS, TIMEZONE_COUNTRY, detectCountry, getStoredRegion, setStoredRegion, resolveRegion, REGION_CHANGED_EVENT } from '/region.js';
import { openLightbox, isLightboxOpen } from '/lightbox.js';
import {
  panelOpen, panelClose, isPanelOpen, getPanelGame, panelStepHero,
  pickRandomFrom, clearRandomQueue, panelHandleEscape,
  renderPanelBody,
} from '/panel.js';
import { initPageShell } from '/pageShell.js';

import { createDataTable } from '@vates/data-table-vanilla';
import {
  fmt, insertColumnsAfter, CORE_COLUMNS, PRICE_COLUMNS, compareNumMissingLast,
  withMissingGroup, formatMissingGroup, priceTierBucket, formatPriceTier,
  protonDbValue, TYPE_LABELS, discountPct,
} from '/gameColumns.js';

// ── Bundle-specific column building blocks — Tier Price/Add-on have no Library/Wishlist
// equivalent (a bundle-tier concept), so they stay local rather than living in the shared
// public/gameColumns.js (see its own header comment for what's shared vs. page-specific and
// why).

// Same pill shape, distinguishing a tier that only adds bonus content (soundtrack, extra
// DLC-ish items) on top of an already-unlocked base game, from a tier that unlocks a base
// game outright — an ITAD-specific fact this app's own library/wishlist tables have no
// equivalent of.
function renderAddonBadge(v) {
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
function renderTierPrice(v, row) {
  if (v === undefined) return document.createTextNode('…');
  if (v == null) return document.createTextNode('Varies');
  if (v === 0) return document.createTextNode('Free');
  return document.createTextNode(formatMoney(v, row.tierCurrency));
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
const TIER_PRICE_COLUMN = {
  key: 'tierPrice', label: 'Tier Price', type: 'number', groupable: true,
  format: v => v == null ? 'Varies' : v === 0 ? 'Free' : v.toFixed(2), render: renderTierPrice,
  compare: compareNumMissingLast, defaultSortDir: 'asc',
  groupValue: withMissingGroup(priceTierBucket), groupFormat: formatMissingGroup(formatPriceTier, 'Varies'), keepVisibleWhenGrouped: true,
  category: 'Pricing',
};
const ADDON_COLUMN =
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
// part of `initialViewState` at table construction (`@vates/data-table-vanilla` >= 0.12) — also
// what `resetTableView`'s own `setViewState({})` blanking restores, so unlike before there's no
// separate priming call or manual reapply-after-reset needed for this.
const DEFAULT_SORT = [{ key: 'tierPrice', dir: 'asc' }, { key: 'steamdbRating', dir: 'desc' }];

// ── Region ────────────────────────────────────────────────────────────────────
// COUNTRY_OPTIONS/TIMEZONE_COUNTRY/detectCountry/getStoredRegion/resolveRegion/
// REGION_CHANGED_EVENT live in the shared public/region.js, imported directly — library.js's
// Wishlist price columns need the exact same curated list and detection heuristic, and there's
// no reason for the two to drift apart. The picker itself now lives in the nav bar's own ⚙
// Preferences popover (public/nav.js), not on this page — see updateBundlesRegionLabel below.

// ── DOM refs ──────────────────────────────────────────────────────────────────
const notConfiguredCard = document.getElementById('not-configured-card');
const browseCard        = document.getElementById('browse-card');
const bundlesRegionValueEl = document.getElementById('bundles-region-value');
const sortSelect         = document.getElementById('sort-select');
const expiredCheckbox    = document.getElementById('expired-checkbox');
const bundlesStatusEl    = document.getElementById('bundles-status');
const bundleListWrapEl   = document.getElementById('bundle-list-wrap');
const bundleListEl       = document.getElementById('bundle-list');
const toggleListBtn      = document.getElementById('toggle-list-btn');
const loadMoreBtn        = document.getElementById('load-more-btn');
const detailCard         = document.getElementById('detail-card');
const detailTitleEl      = document.getElementById('detail-title');
const detailMetaEl       = document.getElementById('detail-meta');
const detailLinksEl      = document.getElementById('detail-links');
const prevBundleBtn      = document.getElementById('prev-bundle-btn');
const nextBundleBtn      = document.getElementById('next-bundle-btn');
const detailStatusEl     = document.getElementById('detail-status');
const priceStatusEl      = document.getElementById('price-status');
const refreshPricesBtn   = document.getElementById('refresh-prices-btn');
const resetViewBtn       = document.getElementById('reset-view-btn');
const tableContainer     = document.getElementById('table-container');
const unresolvedSection  = document.getElementById('unresolved-section');
const unresolvedListEl   = document.getElementById('unresolved-list');
const shareViewBtn       = document.getElementById('share-view-btn');

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
// No stored pref yet (first-ever visit) falls through to `table.setViewState({})`, same as
// before `@vates/data-table-vanilla` 0.12 — but as of that version an empty view state resolves
// each omitted field back to the table's own `initialViewState` (see the createDataTable call
// below) rather than blanking it, so this no longer needs its own guard against that.
// restoreTableView/bindViewPersistence/shareTableView/resetTableView now live in
// tableViewPrefs.js, shared verbatim with library.js's own copies (see its own header comment).

// Collapses the bundle list (see #bundle-list-wrap.collapsed in bundles.html) once a bundle has
// actually been picked — the list itself stops being the thing to focus on at that point, and a
// full-length list otherwise pushes the real content (the opened bundle's game table) far down
// the page. `toggleListBtn` lets it be reopened (e.g. to pick a different bundle) without
// forgetting what's currently open.
function setListCollapsed(collapsed) {
  bundleListWrapEl.classList.toggle('collapsed', collapsed);
  toggleListBtn.hidden = bundles.length === 0;
  toggleListBtn.textContent = collapsed ? 'Show list' : 'Hide list';
}
toggleListBtn.addEventListener('click', () => setListCollapsed(!bundleListWrapEl.classList.contains('collapsed')));

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

let table = null;
let unpersistView = null;
let rows = [];
let rowMap = new Map();
let bundlesOffset = 0;
const BUNDLES_PAGE_SIZE = 20;
let bundles = [];
let activeBundleId = null;
// The `resolved` list (appid + gid per game) for whatever bundle is currently open — kept
// around so the "↻ Refresh prices" button (see the refreshPricesBtn wiring below) can re-run
// just loadPrices() for the open bundle without re-resolving Steam appids or re-streaming
// ratings/HLTB/tags, which openBundle()'s own full reopen would otherwise repeat for nothing.
let currentResolvedGames = [];

// `rows`/`rowMap` hold long-lived, mutated-in-place row objects — every other consumer
// (the panel, achievements cache, prev/next-style lookups) wants that stable identity, and
// panel.js in particular re-renders by reading fields straight off whatever object `panelOpen`
// was called with, so it MUST stay the same reference across a refresh. `@vates/data-table-
// vanilla`'s `setData`, however, only re-renders a row's cells when the object at its rowKey is
// a genuinely new reference — a mutated-but-identity-unchanged row that was already visible in
// a previous `setData` call is not detected as changed and its cells go stale (confirmed live:
// `loadPrices` correctly writes `row.steamRegular`/etc., but a row already made visible by
// `streamGameDetails` before `loadPrices` resolves — the common case once everything is
// cache-warm and both fire near-instantly — never shows it, even though the row object itself
// is provably correct).
//
// `rowCache` (rowCache.js) is what makes the fix targeted rather than blanket:
// `visibleRowsForTable()` reuses a row's cached copy verbatim unless `markRowChanged` was called
// for it since the last render, in which case a fresh copy is made. See rowCache.js's own header
// comment for the full story (shared verbatim with library.js's identical fix).
//
// EVERY mutation site must call `markRowChanged` right after mutating, including
// `streamGameDetails`'s own first-time reveal of a row — not just `loadPrices`/`onRefresh`,
// which touch an already-visible row (see rowCache.js for why the "no cache entry yet" fallback
// alone isn't enough once two async sources can reveal/mutate the same row out of order).
let rowCache = createRowCache();
function markRowChanged(appid) {
  rowCache.markChanged(appid);
}
// Canonical rows whose details have streamed in — the *same* object references `rows`/`rowMap`
// hold, unlike visibleRowsForTable()'s cached copies below. Used by nav/random-pick
// (getGameList/pickRandomGame below) and onRowClick, all of which need the reference the panel
// keeps displaying and any later mutation (refresh, price loading) needs to keep reaching —
// same distinction library.js's own visibleRows()/visibleRowsForTable() pair draws.
function visibleRows() {
  return rows.filter(r => !r.loading);
}
function visibleRowsForTable() {
  return rowCache.visibleRowsForTable(visibleRows(), r => r.appid);
}

// Stable order for the panel's prev/next/random nav — the table's current search/filter/sort
// order, independent of pagination/grouping (display-only, no single well-defined linear order
// once a multi-value column like Genres fans a game out into more than one group).
// `table.getProcessedData()` (`@vates/data-table-vanilla` >= 0.13, added per
// vatesfr/data-table#22) exposes exactly this directly. Same approach library.js's own
// getGameList uses.
function getGameList() {
  return table.getProcessedData();
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
    onRefresh: async (row) => {
      try {
        const res = await fetch(`/api/game-details/${row.appid}?refresh=1`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Refresh failed');
        applyDetailsEvent(row, data);
        markRowChanged(row.appid);
        if (table) table.setData(visibleRowsForTable());
        await loadAchievements(row, { force: true });
      } catch (err) {
        detailStatusEl.textContent = `Refresh failed: ${err.message}`;
      }
    },
    // Clicking a DLC/base-game link inside the panel — the linked appid may not be one of this
    // bundle's own resolved rows (e.g. a DLC not itself included in the bundle), so it's fetched
    // standalone the same way public/library.js's "look up any game" flow does.
    onNavigateGame: (appid, name) => openStandaloneGame(appid, name, { keepHistory: true }),
    // Runs on every close path (see the comment on `onClose` in panel.js) — the backdrop click,
    // × button, and swipe-to-close, not just an explicit Escape — so `?game=` never sticks around
    // after the panel's actually gone. openBundle()'s own panelClose() call (a genuine new bundle
    // open) already clears it beforehand too — see its own comment — so this just runs
    // redundantly-but-harmlessly there.
    onClose: () => setPanelParam(null),
    // A real href (not the placeholder '#' this used to be, back when there was no `?game=` URL
    // to point at) so ctrl/cmd/shift/middle-click on a DLC entry still opens it in a new tab.
    gameHref: appid => {
      const params = new URLSearchParams(location.search);
      params.set('game', appid);
      return `?${params}`;
    },
  },
});

const achievementsCache = new Map();

async function loadAchievements(game, { force = false } = {}) {
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
function renderPanelNav(game) {
  renderPanelNavShared({ table, game, getGameList, onOpen: openGame, onReroll: pickRandomGame });
}

function openGame(game, { isRandom = false, keepHistory = false } = {}) {
  if (!isRandom) clearRandomQueue(RANDOM_QUEUE_KEY);
  panelOpen(game, { keepHistory });
  renderPanelNav(game);
  setPanelParam(game.appid);
  loadAchievements(game);
}

// Lightbox's own ↑/↓ handler (see initLightbox below) — same game-list step the
// document keydown handler below does when the lightbox is closed, but also jumps
// straight into the new game's lightbox at shot 0 rather than leaving the lightbox
// closed behind it. No-ops with no group to page through, same guard as below.
function navigateLightboxGame(dir) {
  const next = stepGameList(table, getGameList, getPanelGame(), dir);
  if (!next) return;
  openGame(next);
  openLightbox(next, 0);
}

function pickRandomGame() {
  if (!table || getPanelGame()?.standalone) return; // see renderPanelNav
  const pick = pickRandomFrom(getGameList(), RANDOM_QUEUE_KEY, getPanelGame()?.appid);
  if (pick) openGame(pick, { isRandom: true });
}

// A game linked from the panel (DLC/base-game nav) that isn't one of this bundle's own
// resolved rows — fetched directly, same "standalone lookup" shape as
// public/library.js/public/gameSearch.js use for the same situation. Routed through openGame
// (rather than calling panelOpen directly, as this used to) so the nav bar actually clears
// itself for a standalone view instead of showing stale buttons/position left over from
// whichever row was open before, and so `?game=` follows this navigation too, same as it does
// library.js's own DLC-link navigation.
function openStandaloneGame(appid, name, { keepHistory = false } = {}) {
  const existing = rowMap.get(appid);
  if (existing) { openGame(existing, { keepHistory }); return; }
  const game = { appid, name: name || `App ${appid}`, loading: true, details: null, standalone: true };
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
// link to an open game panel, mirroring library.js's own setPanelParam/setLightboxParam/
// restorePanelFromUrl for the comparison/Library Explorer pages (see CLAUDE.md's "Looking up
// an arbitrary game" section for the general shape). Not pushed/reordered, same convention as
// this page's own setBundleParam right below.
function setPanelParam(appid) {
  const params = new URLSearchParams(location.search);
  params.delete('shot');
  if (appid == null) params.delete('game');
  else params.set('game', appid);
  history.replaceState(null, '', `?${params}`);
}

function setLightboxParam(idx) {
  const params = new URLSearchParams(location.search);
  if (idx == null) params.delete('shot');
  else params.set('shot', idx);
  history.replaceState(null, '', `?${params}`);
}

// Reopens the panel (and, if present, the lightbox) from `?game=`/`?shot=`. Takes an explicit
// `restoreShot` rather than always re-reading `location.search` — opening the panel calls
// setPanelParam(), which deletes `shot` from the live URL (a fresh panel open always resets to
// the hero), so by the time a row's details are in on the second (post-stream) call below,
// `shot` would already be gone from the URL itself; the caller threads the page-load value
// through instead. Mirrors library.js's own restorePanelFromUrl exactly (see its own comment).
function restorePanelFromUrl(restoreShot = null) {
  const params = new URLSearchParams(location.search);
  const appid = Number(params.get('game'));
  if (!appid) return;
  const row = rowMap.get(appid);
  if (row) {
    if (getPanelGame()?.appid !== appid) openGame(row);
    const shotParam = restoreShot ?? params.get('shot');
    if (shotParam !== null && !row.loading) openLightbox(row, shotParam);
    return;
  }
  if (getPanelGame()?.appid === appid) return; // already open / fetch already in flight
  openStandaloneGame(appid);
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    // panelHandleEscape (panel.js) owns the lightbox-close/fullscreen-guard logic shared by
    // all three pages — this page used to hand-roll its own copy of it, missing the
    // lightbox-close branch entirely (Escape did nothing while the lightbox was open); see
    // panelHandleEscape's own comment.
    if (isLightboxOpen()) { panelHandleEscape(); return; }
    panelClose(); // onClose (see initPanel above) handles the URL cleanup
    return;
  }
  // The lightbox owns the keyboard while open — see the identical comment in app.js's
  // own keydown handler for why every other page-level shortcut is blocked here.
  if (isLightboxOpen()) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (!isPanelOpen()) return;
  // Hero screenshot/video stepping — this page previously only supported it via click/swipe,
  // unlike app.js/library.js's identical keyboard handling for the same shared hero carousel.
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    if (panelStepHero(e.key === 'ArrowRight' ? 1 : -1, { wrap: true })) e.preventDefault();
    return;
  }
  if (e.key === 'r' || e.key === 'R') {
    e.preventDefault();
    pickRandomGame();
    return;
  }
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  if (!table || getPanelGame()?.standalone) return; // see renderPanelNav — no list to page through
  e.preventDefault();
  const list = getGameList();
  const idx = list.findIndex(g => g.appid === getPanelGame().appid);
  const next = (idx + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
  openGame(list[next]);
});

// ── Bundle list ───────────────────────────────────────────────────────────────

function fmtExpiry(iso) {
  if (!iso) return 'no expiry listed';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : `ends ${d.toISOString().slice(0, 10)}`;
}

// Cheapest tier that actually HAS a price. `null` here means no tier had one at all — Fanatical's
// "Build Your Own ⟨N⟩ Bundle" pick-and-mix format (a pool of games with no fixed bundle price,
// price scales with how many you pick), never a free bundle — a genuinely free/$0 tier still has
// a real price object (`{amount: 0, ...}`), which is truthy and included here same as any other
// priced tier. See renderTierPrice's own comment above for the same distinction on the game table.
function cheapestTierPrice(bundle) {
  const priced = (bundle.tiers || []).filter(t => t.price);
  if (!priced.length) return null;
  return priced.reduce((min, t) => t.price.amount < min.amount ? t.price : min, priced[0].price);
}

function fmtBundleListPrice(price) {
  if (!price) return 'Price varies';
  if (price.amount === 0) return 'Free';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: price.currency }).format(price.amount);
}

function renderBundleList() {
  bundleListEl.innerHTML = '';
  for (const bundle of bundles) {
    const price = cheapestTierPrice(bundle);
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'bundle-item';
    el.setAttribute('aria-current', String(bundle.id === activeBundleId));
    el.innerHTML = `
      <span class="bundle-item-title">${esc(bundle.title)}</span>
      <span class="bundle-item-shop">${esc(bundle.page?.name || '')}</span>
      <span class="bundle-item-price">${esc(fmtBundleListPrice(price))}</span>
      <span class="bundle-item-count">${bundle.counts?.games ?? '?'} games</span>
      <span class="bundle-item-expiry">${esc(fmtExpiry(bundle.expiry))}</span>
    `;
    el.addEventListener('click', () => openBundle(bundle));
    bundleListEl.appendChild(el);
  }
}

// `expandList: false` skips the reset branch's own re-expand — for a caller that's about to
// (re)open a bundle right after this resolves (a `?bundle=` deep link on init, or re-opening
// the still-active bundle after a country change — see both call sites below). Without it, the
// list would flash open with this call's freshly (re-)fetched bundles only to be immediately
// re-collapsed once that other, independent bundle-open call lands — a visible "list pops open
// then snaps shut" flicker, worse the more cache-warm both calls are (i.e. often).
async function loadBundles({ reset = true, expandList = true } = {}) {
  if (reset) {
    bundlesOffset = 0; bundles = []; bundleListEl.innerHTML = '';
    if (expandList) setListCollapsed(false);
  }
  bundlesStatusEl.textContent = 'Loading bundles…';
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
    bundles = reset ? data.bundles : [...bundles, ...data.bundles];
    bundlesOffset += data.bundles.length;
    renderBundleList();
    renderBundleNav(); // the loaded list changed — e.g. "Load more" may have just made Next available
    bundlesStatusEl.textContent = bundles.length ? `${bundles.length} bundles` : 'No current bundles';
    loadMoreBtn.hidden = data.bundles.length < BUNDLES_PAGE_SIZE;
    toggleListBtn.hidden = bundles.length === 0;
  } catch (err) {
    bundlesStatusEl.textContent = `Error: ${err.message}`;
  }
}

// ── Bundle detail — resolve games to Steam appids, then stream details ────────

function applyDetailsEvent(row, event) {
  row.capsule           = event.meta?.capsule ?? null;
  if (!row.name) row.name = event.meta?.name || '';
  row.score             = event.rating?.score ?? null;
  row.positivePct       = (event.rating?.positive != null && event.rating?.total)
    ? Math.round((event.rating.positive / event.rating.total) * 100) : null;
  row.steamdbRating     = computeSteamdbRating(event.rating?.positive, event.rating?.total);
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
  row.achievementCount  = event.meta?.achievementCount ?? null;
  row.dlcCount          = event.meta?.dlc?.length ?? null;
  row.platforms         = event.meta?.platforms ?? [];
  row.languages          = event.meta?.languages ?? [];
  row.hasDemo            = event.demo != null;
  row.type                = TYPE_LABELS[event.meta?.type] ?? (event.meta?.type ? event.meta.type : null);
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

async function streamGameDetails(appids) {
  let resp;
  try {
    resp = await fetch('/api/game-details/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ games: appids.map(appid => ({ appid })) }),
    });
  } catch (err) {
    detailStatusEl.textContent = `Details stream failed: ${err.message}`;
    return;
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let loaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop();
    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith('data: ')) continue;
      let event;
      try { event = JSON.parse(line.slice(6)); } catch { continue; }
      if (event.done) continue;
      const row = rowMap.get(event.appid);
      if (!row) continue;
      applyDetailsEvent(row, event);
      markRowChanged(row.appid);
      // renderPanelNav too, not just renderPanelBody — the nav bar's list/position (see
      // getGameList) only includes non-loading rows, so a panel opened via a `?game=` deep
      // link (which opens the row immediately, before the stream starts — see openBundle's
      // early restorePanelFromUrl call) would otherwise be stuck showing "0 / 0" and a stale,
      // empty nav-button list until every game in the bundle finished loading, not just this
      // one. Same fix library.js's own stream loop already has.
      if (isPanelOpen() && getPanelGame()?.appid === row.appid) { renderPanelBody(row); renderPanelNav(row); }
      loaded++;
      if (table) table.setData(visibleRowsForTable());
      detailStatusEl.textContent = `${loaded} / ${appids.length} games loaded…`;
    }
  }
  if (table) table.setData(visibleRowsForTable());
  detailStatusEl.textContent = `${rows.length} games`;
}

// Flattens a bundle's tiers into one row per unique game — a game unlocked at more than one
// tier (common: a cheap tier's games are still included in every pricier tier) keeps only the
// cheapest tier it first appears at, since that's the price that actually gets you this game.
// ITAD's tiers are already price-ascending in every bundle observed, so "first occurrence" and
// "cheapest occurrence" are the same thing here.
function flattenBundleGames(bundle) {
  const seen = new Map(); // gid -> { gid, slug, title, type, assets, tierPrice, tierCurrency, addon }
  for (const tier of bundle.tiers || []) {
    for (const g of tier.games || []) {
      if (seen.has(g.id)) continue;
      seen.set(g.id, {
        gid: g.id, slug: g.slug, title: g.title, type: g.type, assets: g.assets,
        tierPrice: tier.price ? tier.price.amount : null,
        tierCurrency: tier.price ? tier.price.currency : null,
        addon: !!tier.addon,
      });
    }
  }
  return [...seen.values()];
}

function renderUnresolvedList(games) {
  unresolvedSection.hidden = games.length === 0;
  unresolvedListEl.innerHTML = games.map(g => `
    <div class="unresolved-item">
      ${g.assets?.boxart ? `<img src="${esc(g.assets.boxart)}" alt="" loading="lazy">` : ''}
      <div>
        <div class="unresolved-item-title">${esc(g.title)}</div>
        <div class="unresolved-item-type">${esc(TYPE_LABELS[g.type] || g.type || 'Game')}</div>
      </div>
    </div>
  `).join('');
}

// Bundle-level actions kept out of the (already-crowded) list rows and shown only once a
// bundle is actually open — a plain link to ITAD's own page for it, and its real purchase
// link. `bundle.url` is the shop/affiliate link exactly as ITAD returned it — never rewritten
// or stripped of tracking params (ITAD's terms require passing prices/links through
// unmodified; see CLAUDE.md).
function renderDetailLinks(bundle) {
  detailLinksEl.innerHTML = `
    ${bundle.details ? `<a class="btn btn-ghost btn-sm" href="${esc(bundle.details)}" target="_blank" rel="noopener">View on IsThereAnyDeal ↗</a>` : ''}
    ${bundle.url ? `<a class="btn btn-primary btn-sm" href="${esc(bundle.url)}" target="_blank" rel="noopener">Get this bundle ↗</a>` : ''}
  `;
}

// Prev/Next step through whatever's currently loaded in `bundles` (respecting its current
// sort/filter), not the full remote list — no auto-"Load more" and no wraparound at the ends,
// both buttons just disable there. A bundle opened via deep link that isn't part of the
// currently loaded page (or opened before any list has loaded at all) has no list position to
// navigate from, so both buttons disable rather than guessing.
function renderBundleNav() {
  const idx = bundles.findIndex(b => b.id === activeBundleId);
  prevBundleBtn.disabled = idx <= 0;
  nextBundleBtn.disabled = idx === -1 || idx >= bundles.length - 1;
}
prevBundleBtn.addEventListener('click', () => {
  const idx = bundles.findIndex(b => b.id === activeBundleId);
  if (idx > 0) openBundle(bundles[idx - 1]);
});
nextBundleBtn.addEventListener('click', () => {
  const idx = bundles.findIndex(b => b.id === activeBundleId);
  if (idx !== -1 && idx < bundles.length - 1) openBundle(bundles[idx + 1]);
});

// Fetches Steam's non-discounted price + historical lows for the bundle's resolved games (see
// the shared POST /api/prices — gid-keyed here, since Bundles already has ITAD gids; the
// Library Explorer's Wishlist price columns hit the same route with `appids` instead — see its
// own comment in server.js) and applies them once available — a single batch call, not
// streamed per-game like ratings/HLTB/tags, so it can land before or after any given row has
// finished streaming its other details. Either order is fine: rows not yet visible (still
// `loading`) simply carry the price fields already set by the time they do appear; rows
// already visible get a follow-up `table.setData` to pick the new columns up.
//
// `force`: set by the "↻ Refresh prices" button below — bypasses the server's `itad-price:`
// cache read for this call (?refresh=1, same convention as every other force-refresh in this
// app) so a stale price actually gets re-fetched from ITAD instead of just re-reading the same
// cached response back.
async function loadPrices(resolved, { force = false } = {}) {
  priceStatusEl.textContent = '';
  try {
    const prices = await postPrices({ gids: resolved.map(g => g.gid), country: resolveRegion(getStoredRegion()), force });
    for (const g of resolved) {
      const row = rowMap.get(g.appid);
      const info = prices[g.gid];
      if (!row || !info) continue;
      applyPriceInfo(row, info, discountPct);
      markRowChanged(g.appid);
      if (isPanelOpen() && getPanelGame() === row) renderPanelBody(row);
    }
  } catch (err) {
    console.warn('[bundles] price lookup failed:', err.message);
    // Without this, a failed request (rate limited, transient upstream error) left every
    // price-ish cell stuck on its "…" loading placeholder forever — indistinguishable from
    // "still loading" and easy to mistake for a hung page rather than a failure. `null` here
    // means "we tried and it didn't work", same as the "no data" state these columns already
    // render for a genuinely missing price — and a status line makes the failure visible
    // rather than only a console warning nobody but a developer would see.
    for (const g of resolved) {
      const row = rowMap.get(g.appid);
      if (!row) continue;
      nullMissingPriceFields(row);
      markRowChanged(g.appid);
      if (isPanelOpen() && getPanelGame() === row) renderPanelBody(row);
    }
    priceStatusEl.textContent = `Couldn't load Steam pricing (${err.message}) — other columns are unaffected.`;
  } finally {
    if (table) table.setData(visibleRowsForTable());
  }
}

// `preserveGameParam`: true only for the initial page-load deep link (init() below) — a
// genuine new bundle open (list click, ‹/› nav, a fresh `?bundle=` deep link) always closes
// whatever's open and clears `?game=` first, since that game's nav position/owners-equivalent
// belonged to whichever bundle (or standalone lookup) was open before and no longer applies —
// same "a new Load clears the panel unless explicitly restoring" convention library.js's own
// resetTableState/loadLibrary use. Region changes (see the REGION_CHANGED_EVENT handler below) are the
// one case that reopens the *same* bundle in place and does pass this, so the open game — same
// bundle, same rows, same order, just re-priced — stays open across it.
async function openBundle(bundle, { preserveGameParam = false, restoreShot = null } = {}) {
  if (!preserveGameParam) {
    if (isPanelOpen()) panelClose(); // onClose (see initPanel above) clears `?game=` itself
    else setPanelParam(null); // no panel open, but a leftover `?game=` from before should still go
  }
  activeBundleId = bundle.id;
  renderBundleList();
  renderBundleNav();
  setListCollapsed(true);
  setBundleParam(bundle.id);

  detailCard.hidden = false;
  detailTitleEl.textContent = bundle.title;
  detailMetaEl.textContent = `${bundle.page?.name || 'Unknown shop'} · ${bundle.counts?.games ?? '?'} games · ${fmtExpiry(bundle.expiry)}`;
  renderDetailLinks(bundle);
  detailStatusEl.textContent = 'Resolving games to Steam…';
  priceStatusEl.textContent = '';
  unresolvedSection.hidden = true;
  unresolvedListEl.innerHTML = '';

  if (unpersistView) { unpersistView(); unpersistView = null; }
  if (table) { table.destroy(); table = null; }
  tableContainer.innerHTML = '';
  resetViewBtn.hidden = true;
  shareViewBtn.hidden = true;
  refreshPricesBtn.hidden = true;
  rows = [];
  rowMap = new Map();
  rowCache.reset();
  currentResolvedGames = [];

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
    detailStatusEl.textContent = `Error: ${err.message}`;
    renderUnresolvedList(games);
    return;
  }

  const resolved = [];
  const unresolved = [];
  for (const g of games) {
    const appid = appidsByGid[g.gid];
    if (appid) resolved.push({ ...g, appid });
    else unresolved.push(g);
  }
  renderUnresolvedList(unresolved);
  currentResolvedGames = resolved;

  if (resolved.length === 0) {
    detailStatusEl.textContent = 'No games in this bundle could be matched to a Steam listing.';
    return;
  }

  rows = resolved.map(g => ({
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
    protondb: undefined, achievementCount: undefined, dlcCount: undefined, platforms: undefined,
    languages: undefined, hasDemo: undefined,
    loading: true, details: null,
  }));
  rowMap = new Map(rows.map(r => [r.appid, r]));

  table = createDataTable(tableContainer, {
    data: [],
    columns: BUNDLE_COLUMNS,
    rowKey: 'appid',
    initialViewState: { pageSize: 50, visibleCols: DEFAULT_VISIBLE, sorts: DEFAULT_SORT },
    // The table's own click handler hands back whatever object is currently in
    // `rowCache` for this row — a copy, not `rowMap`'s canonical one (see
    // `visibleRowsForTable`'s comment above). Looking the canonical row back up by appid
    // before opening it means the panel (and anything that mutates whatever object it opened,
    // like `onRefresh` below) always operates on the same object `rowMap` does, not a
    // disconnected copy that further updates would silently stop reaching.
    onRowClick: row => openGame(rowMap.get(row.appid) ?? row),
  });
  // Loads whatever URL param / stored pref should win (see restoreTableView's own comment) on
  // top of the construction-time default view just applied above, then persists every
  // subsequent change locally.
  restoreTableView(table, TABLE_VIEW_PREF_KEY, TABLE_VIEW_PARAM);
  unpersistView = bindViewPersistence(table, TABLE_VIEW_PREF_KEY);
  resetViewBtn.hidden = false;
  shareViewBtn.hidden = false;
  refreshPricesBtn.hidden = false;

  detailStatusEl.textContent = `0 / ${resolved.length} games loaded…`;
  // Early attempt — rowMap is populated (just above) well before the stream below finishes, so
  // a `?game=` that's part of this bundle can open right away as a real, progressively-filling
  // row instead of waiting for every game in the bundle to finish loading first; the lightbox
  // needs actual media data though, so `restorePanelFromUrl` is tried again once the stream
  // below completes — same two-call shape library.js's own loadLibrary/loadWishlist use, for
  // the same reason (see restorePanelFromUrl's own comment).
  if (preserveGameParam) restorePanelFromUrl(restoreShot);
  // Independent calls — Steam pricing has nothing to do with the rating/HLTB/tags pipeline —
  // run concurrently rather than one after the other.
  await Promise.all([streamGameDetails(resolved.map(g => g.appid)), loadPrices(resolved)]);
  if (preserveGameParam) restorePanelFromUrl(restoreShot);
}

// ── Wiring ──────────────────────────────────────────────────────────────────

// Region itself is picked from the nav bar's own ⚙ Preferences popover (public/nav.js) now, not
// a picker on this page — this just shows a read-only readout of whatever it currently resolves to.
function updateBundlesRegionLabel() {
  const code = resolveRegion(getStoredRegion());
  bundlesRegionValueEl.textContent = COUNTRY_OPTIONS.find(c => c.code === code)?.label ?? code;
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
  const reopening = activeBundleId != null;
  // Skip the list's own re-expand when we're about to reopen the still-active bundle right
  // after — it's already collapsed (a bundle is open) and openBundle() will just collapse it
  // again once the reopen resolves, so expanding it here only produces a pointless flicker.
  // When no bundle is open, this is a plain browsing action and the list expands as usual.
  loadBundles({ expandList: !reopening });
  // Same bundle, same rows, same order, just re-priced — whatever game is open should stay
  // open across this, not get closed the way a genuine new bundle open otherwise would (see
  // openBundle's own comment).
  if (reopening) openBundleById(activeBundleId, { preserveGameParam: true });
});
sortSelect.addEventListener('change', () => loadBundles());
expiredCheckbox.addEventListener('change', () => loadBundles());
loadMoreBtn.addEventListener('click', () => loadBundles({ reset: false }));

resetViewBtn.addEventListener('click', () => {
  if (!table) return;
  resetTableView(table, TABLE_VIEW_PREF_KEY, TABLE_VIEW_PARAM);
});

shareViewBtn.addEventListener('click', () => shareTableView(table, TABLE_VIEW_PARAM, shareViewBtn));

// Refreshes just the price columns for the currently open bundle's games, in one shot — no
// reason to make a user step through every game's own panel "↻ Refresh" one at a time when
// the whole batch is a single cheap POST /api/prices call anyway.
refreshPricesBtn.addEventListener('click', async () => {
  if (currentResolvedGames.length === 0 || refreshPricesBtn.disabled) return;
  refreshPricesBtn.disabled = true;
  refreshPricesBtn.textContent = 'Refreshing…';
  try {
    await loadPrices(currentResolvedGames, { force: true });
  } finally {
    refreshPricesBtn.disabled = false;
    refreshPricesBtn.textContent = '↻ Refresh prices';
  }
});

// `?bundle=<id>` deep link — writes/clears the param while preserving everything else already
// in the URL. Not pushed — opening a different bundle isn't meant to be a separate back/
// forward-navigable step (this page has no popstate listener at all, unlike library.js/app.js),
// same as how `sort`/`view` elsewhere in this app are written. `country` is deliberately not
// part of this (or any) URL — it's a `localStorage` preference (see public/region.js), not
// shareable state, since it says more about the viewer than about which bundle they're looking
// at.
function setBundleParam(id) {
  const params = new URLSearchParams(location.search);
  if (id == null) params.delete('bundle');
  else params.set('bundle', id);
  history.replaceState(null, '', `?${params}`);
}

// There's no single-bundle-fetch endpoint upstream (see findBundleById's own comment in
// lib/itad.js) — a deep link always goes straight to GET /api/bundles/:id (a bounded
// server-side search) rather than trying to find the id in whatever's already loaded in
// `bundles`, which may not even include it (a different sort/page, or not loaded yet at all on
// initial page load — this runs concurrently with loadBundles(), not after it).
async function openBundleById(id, { preserveGameParam = false, restoreShot = null } = {}) {
  try {
    const qs = new URLSearchParams({ country: resolveRegion(getStoredRegion()) });
    const res = await fetch(`/api/bundles/${id}?${qs}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Bundle not found');
    await openBundle(data.bundle, { preserveGameParam, restoreShot });
  } catch (err) {
    // Same UI slot a normally-opened bundle would use — there's no other sensible place to
    // surface "the bundle this link pointed at doesn't exist (anymore)". The invalid id is
    // dropped from the URL so a refresh doesn't repeat the same failed lookup.
    detailCard.hidden = false;
    detailTitleEl.textContent = 'Bundle not found';
    detailMetaEl.textContent = '';
    detailLinksEl.innerHTML = '';
    detailStatusEl.textContent = err.message;
    priceStatusEl.textContent = '';
    unresolvedSection.hidden = true;
    if (unpersistView) { unpersistView(); unpersistView = null; }
    if (table) { table.destroy(); table = null; }
    tableContainer.innerHTML = '';
    resetViewBtn.hidden = true;
    shareViewBtn.hidden = true;
    activeBundleId = null;
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
      notConfiguredCard.hidden = false;
      browseCard.hidden = true;
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
