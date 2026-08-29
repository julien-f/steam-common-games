'use strict';

import { esc, formatMoney, fmtPlaytime, fmtLastPlayed, computeSteamdbRating, computeProductionTier, normalizeInput } from '/utils.js';
import { reorderUrlParams } from '/urlState.js';
import { getPref, setPref } from '/prefs.js';
import { COUNTRY_OPTIONS, getStoredRegion, setStoredRegion, resolveRegion, REGION_CHANGED_EVENT } from '/region.js';
import { initNav, updateNavLink } from '/nav.js';
import { renderAccountChips, bindAccountRefresh, addRecent, renderRecentsBar, bindRecentsBar } from '/accountsBar.js';
import { initGameSearch, addRecentGame, renderRecentGamesBar, bindRecentGamesBar } from '/gameSearch.js';
import { initLightbox, openLightbox, isLightboxOpen } from '/lightbox.js';
import {
  initPanel, panelOpen, panelClose, isPanelOpen, getPanelGame, panelStepHero,
  pickRandomFrom, clearRandomQueue, panelHandleEscape,
  renderPanelBody,
} from '/panel.js';

import { createDataTable } from '@vates/data-table-vanilla';
import { bucketDatePart, formatDatePart } from '@vates/data-table-core';
import {
  fmt, insertColumnsAfter, CORE_COLUMNS, PRICE_COLUMNS, compareDateMissingLast,
  withMissingGroup, formatMissingGroup, halfDecadeBucket, formatHalfDecadeBucket,
  protonDbValue, TYPE_LABELS, discountPct,
} from '/gameColumns.js';

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
const PLAYTIME_COLUMN = {
  key: 'playtime', label: 'Played (h)', type: 'number', groupable: true,
  format: v => v > 0 ? Number(v).toFixed(1) : '—', defaultSortDir: 'desc',
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
const LAST_PLAYED_COLUMN = {
  key: 'lastPlayed', label: 'Last Played', type: 'date', groupable: true, format: fmt.str,
  compare: compareDateMissingLast, defaultSortDir: 'desc', defaultValueSort: { by: 'alpha', dir: 'desc' },
  groupValue: withMissingGroup(bucketDatePart('year'), v => v == null || v === ''),
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

// Passed as part of `initialViewState` at table construction (`@vates/data-table-vanilla` >=
// 0.12) — also what `resetTableView`'s own `setViewState({})` blanking restores, so unlike
// before there's no separate priming call or manual reapply-after-reset needed for this.
const DEFAULT_SORT = [{ key: 'steamdbRating', dir: 'desc' }];

// ── Wishlist-only columns ────────────────────────────────────────────────────
// No defaultSortDir — Steam's wishlist rank is already 1-at-the-top, so the plain ascending
// default a fresh click starts at is the useful direction as-is. Placed right after Name (an
// identity-adjacent "which one is this" attribute for a wishlist row) rather than off in the
// Scores/Dates sections where it doesn't fit either.
const WISHLIST_RANK_COLUMN =
  { key: 'priority',  label: 'Wishlist Rank', type: 'number', groupable: false, format: fmt.num };

// Same "last modified"-style reasoning as the owned-library's Last Played/Released columns
// above — a fresh click (and the filter's date tree) should lead with what was added most
// recently, not the oldest wishlist entry. Placed right after Released, in the same Play
// time & dates section, rather than at the very end of the column list.
// Grouped by year (`bucketDatePart('year')`), same as Released/Last Played above — an exact
// added-on date is close to unique per row, so ungrouped grouping would produce close to one
// group per game, the same "continuous column" problem those two columns already solve for.
// `null` (no wishlist add-date at all) is the only missing case here.
const WISHLIST_DATE_ADDED_COLUMN =
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

const playerInput   = document.getElementById('player-input');
const loadBtn       = document.getElementById('load-btn');
const statusEl      = document.getElementById('status');
const priceStatusEl = document.getElementById('price-status');
const refreshPricesBtn = document.getElementById('refresh-prices-btn');
const accountsBarEl = document.getElementById('accounts-bar');
const recentsBarEl  = document.getElementById('recents-bar');
const recentGamesBarEl = document.getElementById('recent-games-bar');
const tableContainer = document.getElementById('table-container');
const resetViewBtn  = document.getElementById('reset-view-btn');
const shareViewBtn  = document.getElementById('share-view-btn');
const tabLibraryBtn  = document.getElementById('tab-library');
const tabWishlistBtn = document.getElementById('tab-wishlist');
const wishlistRegionLabelEl = document.getElementById('wishlist-region-label');
const wishlistRegionValueEl = document.getElementById('wishlist-region-value');

let table         = null;
let unsyncView    = null;
let rows          = [];
let rowMap        = new Map();
let total         = 0;
let loaded        = 0;
let flushTimer    = null;
// Per-appid cache backing visibleRowsForTable() below — see its own comment for why this
// exists. Keyed the same as rowMap; reset alongside it in resetTableState().
let tableRowCache = new Map();
let activeColumns = COLUMNS;   // COLUMNS or WISHLIST_COLUMNS, whichever tab is active
let activeTab     = 'library'; // 'library' | 'wishlist'
let currentPlayerStr = '';     // last player string actually loaded (not just typed)
// Steam64 ids of every account currently loaded (one flat group — see accountsBar.js's
// comment on why the Library Explorer only ever has one), used to fetch per-game
// achievement progress for the side panel. Achievements aren't tied to a specific tab —
// wishlisted/standalone-looked-up games can still report progress — only to a player
// actually being loaded, so this is shared by both loadLibrary and loadWishlist.
let currentSteamIds = [];
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
let currentPlayers = [];
let playtimeByAppid = {};
let lastPlayedByAppid = {};
// appid → the achievements API's response, cached client-side per (appid, loaded accounts)
// so reopening the same game's panel doesn't refetch. Cleared whenever the loaded
// player(s) change (resetTableState) since a stale entry there would show the wrong
// account's progress.
const achievementsCache = new Map();
const achievementsCacheKey = appid => `${appid}:${currentSteamIds.slice().sort().join(',')}`;

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
// A "Share view" button (shareTableView below) snapshots the current view into the URL param on
// demand instead, and copies the resulting link — same copy-link idiom as panel.js's 🔗 button/
// lightbox.js's share button.

// Applies whichever of the URL param / stored pref should win at load time — an explicit URL
// param (a shared link) always wins over the stored default. Called right after table
// construction (which already seeded the default view via `initialViewState`).
//
// Consumed once, not read on every call: a shared link's view is applied, seeded as the new
// stored default, and stripped from the (live) URL — this table gets rebuilt from scratch far
// more often than "page load" (a tab switch, a fresh player search, an account refresh all call
// this again), and without consuming it, the shared view would keep clobbering whatever the user
// changed since, on every one of those, instead of being a one-time starting point the way a
// bookmarked/shared link is supposed to be.
//
// No stored pref yet (first-ever visit) falls through to `table.setViewState({})`, same as
// before `@vates/data-table-vanilla` 0.12 — but as of that version an empty view state resolves
// each omitted field back to the table's own `initialViewState` (see the createDataTable calls
// below) rather than blanking it, so this no longer needs its own guard against that.
function restoreTableView(table, prefKey, paramName) {
  const params = new URLSearchParams(location.search);
  const raw = params.get(paramName);
  if (raw) {
    try {
      const view = JSON.parse(raw);
      table.setViewState(view);
      setPref(prefKey, view);
      params.delete(paramName);
      history.replaceState(null, '', `?${reorderUrlParams(params)}`);
      return;
    } catch { /* malformed param — fall through to the stored default */ }
  }
  table.setViewState(getPref(prefKey, {}));
}

// Wires the table to auto-persist every future change under prefKey — the only ongoing side
// effect table interaction has now; the URL stays untouched until explicitly shared. Returns the
// unsubscribe function (same shape onViewChange itself returns), stored in `unsyncView` below.
function bindViewPersistence(table, prefKey) {
  return table.onViewChange(view => setPref(prefKey, view));
}

// Snapshots the table's current view into `paramName` and copies the resulting link to the
// clipboard — deliberately does NOT write it to the page's own address bar (no
// `history.replaceState`). It used to, but that left a stale param sitting in the visible URL
// the moment the user made one more change to the table — the address bar would keep showing a
// snapshot that no longer matched what was on screen, silently wrong instead of just not there.
// The stored pref (bindViewPersistence above) already captures live state on every change; the
// only thing this link is for is handing the *current* view to someone else (or a future visit
// via the copied link itself, not the omnibox).
function shareTableView(table, paramName, btn) {
  const params = new URLSearchParams(location.search);
  params.set(paramName, JSON.stringify(table.getViewState()));
  const qs = reorderUrlParams(params).toString();
  const url = `${location.origin}${location.pathname}${qs ? `?${qs}` : ''}`;
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(() => flashShareViewBtn(btn), () => {});
}

function flashShareViewBtn(btn) {
  const prevText = btn.textContent;
  btn.textContent = '✓ Copied!';
  setTimeout(() => { btn.textContent = prevText; }, 1500);
}

// Clears both the stored default and whatever's currently in `paramName`, then blanks the
// table's view state — which resolves back to the table's own `initialViewState` (including
// DEFAULT_SORT) rather than to nothing, same as `restoreTableView`'s own fallback above.
function resetTableView(table, prefKey, paramName) {
  table.setViewState({});
  setPref(prefKey, {});
  const params = new URLSearchParams(location.search);
  params.delete(paramName);
  history.replaceState(null, '', `?${reorderUrlParams(params)}`);
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
  wishlistRegionValueEl.textContent = COUNTRY_OPTIONS.find(c => c.code === code)?.label ?? code;
}

// Only meaningful on the Wishlist tab, and only when there's a pricing feature to show a region
// for at all — hidden on the Library tab (no price columns there) and hidden outright when ITAD
// isn't configured (no point showing a region readout for a feature that isn't running).
async function updateRegionLabelVisibility() {
  const configured = await itadConfiguredPromise;
  wishlistRegionLabelEl.hidden = !(configured && activeTab === 'wishlist');
  if (!wishlistRegionLabelEl.hidden) updateWishlistRegionLabel();
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
  if (activeTab === 'wishlist' && rows.length > 0) loadWishlistPrices(rows);
});

initNav('library');

initPanel({
  inertSelector: '.lib-page',
  showAchievements: true,
  getOwnersHtml: buildLibraryOwnersHtml,
  // Only the Wishlist tab's own loadWishlistPrices batch-prices its rows — the Library tab's
  // rows are owned games with no price columns/batch of their own, same as the comparison
  // page, so they fall through to panel.js's own per-game loadPrice instead. A function (not a
  // plain boolean) since it's read fresh on every panel open/refresh, well after activeTab may
  // have changed since this initPanel call.
  pricesHandledByHost: () => activeTab === 'wishlist',
  onRefresh: async (row) => {
    try {
      const res = await fetch(`/api/game-details/${row.appid}?refresh=1`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Refresh failed');
      applyDetailsEvent(row, data);
      markRowChanged(row.appid);
      if (table) table.setData(visibleRowsForTable());
      await loadAchievements(row, { force: true }); // still meaningful with no player loaded — see loadAchievements
    } catch (err) {
      statusEl.textContent = `Refresh failed: ${err.message}`;
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
  gameHref: appid => {
    const params = new URLSearchParams(location.search);
    params.delete('shot');
    params.set('game', appid);
    return `?${reorderUrlParams(params)}`;
  },
  // Clicking a DLC entry (or the panel's own "← Back" button) — reuses the same "open this
  // appid" mechanism as the "look up any game" search box, just keeping panel.js's own
  // DLC-navigation history stack instead of starting a fresh one.
  onNavigateGame: (appid, name) => openStandaloneLookup(appid, name, { keepHistory: true }),
});
initLightbox({ onParamChange: setLightboxParam, onGameNav: navigateLightboxGame });

initGameSearch({
  inputEl: document.getElementById('game-lookup-input'),
  resultsEl: document.getElementById('game-lookup-results'),
  onSelect: ({ appid, name }) => openStandaloneLookup(appid, name),
});

document.getElementById('shortcuts-backdrop').addEventListener('click', closeShortcuts);
document.querySelector('.shortcuts-close').addEventListener('click', closeShortcuts);

function openShortcuts() {
  document.getElementById('shortcuts-modal').classList.add('open');
  document.getElementById('shortcuts-backdrop').classList.add('open');
}

function closeShortcuts() {
  document.getElementById('shortcuts-modal').classList.remove('open');
  document.getElementById('shortcuts-backdrop').classList.remove('open');
}

function toggleShortcuts() {
  if (document.getElementById('shortcuts-modal').classList.contains('open')) closeShortcuts();
  else openShortcuts();
}

// Rows whose details have streamed in — what's actually shown in the table (see
// visibleRows() below for why unloaded rows are withheld rather than shown as '…' placeholders).
// Returns the canonical `rows`/`rowMap` objects themselves — used by nav/random-pick (below)
// and by onRowClick, all of which need the *same* reference the panel keeps displaying and any
// later mutation (refresh, price loading) needs to keep reaching. table.setData() itself goes
// through visibleRowsForTable() instead — see its own comment for why the two must differ.
function visibleRows() {
  return rows.filter(r => !r.loading);
}

// @vates/data-table-vanilla's setData() only re-renders a row's cells when the object at its
// rowKey is a genuinely *new* reference — mutating an already-visible row in place and calling
// setData() again with an array that still contains that same reference (even a brand-new
// outer array from a fresh .filter()) leaves its rendered cells stale. This never bit
// streamGameDetails's own normal flow, since a row is only ever added to visibleRows()' output
// the moment it first flips `loading: false` — a genuinely new appearance in the rendered set,
// not a mutation of something already there. It does bite the Wishlist tab's price loading
// (loadWishlistPrices) and the panel's "↻ Refresh" button (onRefresh below), both of which
// mutate a row that may already be visible — same underlying bug confirmed live in bundles.js,
// fixed there with this exact pattern (see its own comment on tableRowCache/markRowChanged).
// A row keeps its cached copy across renders until markRowChanged() is called for it, so only
// the row that actually changed gets a new reference and every other row's DOM is left alone.
function visibleRowsForTable() {
  return visibleRows().map(r => {
    if (!tableRowCache.has(r.appid)) tableRowCache.set(r.appid, { ...r });
    return tableRowCache.get(r.appid);
  });
}
function markRowChanged(appid) {
  tableRowCache.delete(appid);
}

// Stable order for prev/next nav — the table's current search/filter/sort order, independent
// of its own display-only grouping/pagination (a grouped multi-value column like Genres fans a
// game out into more than one group, so there's no single well-defined linear order once
// grouping is applied). `table.getProcessedData()` (`@vates/data-table-vanilla` >= 0.13, added
// per vatesfr/data-table#22) exposes exactly this directly — before that, this had to reach
// into @vates/data-table-core/internal's processData/searchData by hand.
function getGameList() {
  return table.getProcessedData();
}

// Same template as the comparison page's buildOwnersHtml (app.js) — kept as a separate copy
// here rather than shared, since the two pages' underlying data shapes differ (slots/groups
// there vs. one flat currentPlayers array here) enough that sharing would need its own
// abstraction layer for what's otherwise a handful of lines. Naturally empty for a standalone
// lookup (the appid won't be a key in playtimeByAppid at all) and for the Wishlist tab
// (playtimeByAppid is only ever populated by loadLibrary — see its declaration above) without
// needing an explicit check for either case.
function buildLibraryOwnersHtml(g) {
  const gamePt = playtimeByAppid[g.appid] || {};
  const gameLp = lastPlayedByAppid[g.appid] || {};
  const owners = currentPlayers
    .filter(p => p.steamid in gamePt)
    .map(p => ({
      name: p.personaname || '?',
      minutes: gamePt[p.steamid] || 0,
      lastPlayedSec: gameLp[p.steamid] || 0,
    }));
  if (!owners.length) return '';
  // Most recently played first, same convention as the comparison page's version — someone
  // who's never launched it (lastPlayedSec 0) sorts last, alphabetically among themselves so
  // the order stays deterministic.
  owners.sort((a, b) => b.lastPlayedSec - a.lastPlayedSec || a.name.localeCompare(b.name));
  const maxMinutes = Math.max(...owners.map(o => o.minutes), 1);
  return `<div class="panel-section panel-card">
    <div class="panel-section-title">Owned by <span class="panel-section-subtitle">most recently played first</span></div>
    <div class="panel-owners">${owners.map(o => {
      const lp = fmtLastPlayed(o.lastPlayedSec);
      const pt = fmtPlaytime(o.minutes);
      return `<div class="panel-owner">
        <div class="panel-owner-top">
          <span class="panel-owner-name">${esc(o.name)}</span>
          <span class="panel-owner-lastplayed">${lp ? esc(lp) : 'never played'}</span>
        </div>
        <div class="panel-owner-meter-track"><div class="panel-owner-meter-fill" style="width:${Math.round(o.minutes / maxMinutes * 100)}%"></div></div>
        <span class="panel-owner-playtime">${pt ? `${esc(pt)} played` : 'not played'}</span>
      </div>`;
    }).join('')}</div>
  </div>`;
}

function renderPanelNav(game) {
  const nav = document.getElementById('panel-nav');
  // A standalone lookup (see openStandaloneLookup below) isn't part of the loaded
  // library/wishlist table — with no table yet (a bare lookup with no player loaded) or no
  // natural list to page through, there's no nav to show.
  if (!table || game.standalone) { nav.innerHTML = ''; return; }
  const list = getGameList();
  const idx = list.findIndex(g => g.appid === game.appid);
  nav.innerHTML = `
    <button class="panel-nav-btn" id="panel-prev" aria-label="Previous game" title="Previous game (↑)">↑</button>
    <span class="panel-nav-pos" aria-live="polite">${idx + 1} / ${list.length}</span>
    <button class="panel-nav-btn" id="panel-next" aria-label="Next game" title="Next game (↓)">↓</button>
    <button class="panel-nav-btn panel-nav-reroll" id="panel-reroll" aria-label="Pick a random game" title="Pick a random game (R)">🎲<span class="panel-nav-kbd">R</span></button>
  `;
  document.getElementById('panel-prev').addEventListener('click', () => {
    openGame(list[(idx - 1 + list.length) % list.length]);
  });
  document.getElementById('panel-next').addEventListener('click', () => {
    openGame(list[(idx + 1) % list.length]);
  });
  document.getElementById('panel-reroll').addEventListener('click', pickRandomGame);
}

function openGame(game, { isRandom = false, keepHistory = false } = {}) {
  if (!isRandom) clearRandomQueue(randomQueueKey());
  panelOpen(game, { keepHistory });
  updateTitle();
  renderPanelNav(game);
  setPanelParam(game.appid);
  loadAchievements(game);
}

// Lightbox's own ↑/↓ handler (see initLightbox below) — same game-list step the
// document keydown handler below does when the lightbox is closed, but also jumps
// straight into the new game's lightbox at shot 0 rather than leaving the lightbox
// closed behind it. No-ops with no group to page through, same guard as below.
function navigateLightboxGame(dir) {
  if (!table || getPanelGame()?.standalone) return;
  const list = getGameList();
  const idx = list.findIndex(g => g.appid === getPanelGame().appid);
  const next = list[(idx + dir + list.length) % list.length];
  openGame(next);
  openLightbox(next, 0);
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
async function loadAchievements(game, { force = false } = {}) {
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
  if (!table || getPanelGame()?.standalone) return; // see renderPanelNav
  const pick = pickRandomFrom(getGameList(), randomQueueKey(), getPanelGame()?.appid);
  if (pick) openGame(pick, { isRandom: true });
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
function openStandaloneLookup(appid, name, { keepHistory = false } = {}) {
  const existing = rowMap.get(appid);
  if (existing) {
    openGame(existing, { keepHistory });
    addRecentGame(existing.appid, existing.name, existing.capsule || null);
    renderRecentGamesBar(recentGamesBarEl);
    return;
  }
  const game = { appid, name: name || `App ${appid}`, loading: true, details: null, standalone: true };
  openGame(game, { keepHistory });
  fetchStandaloneDetails(game);
}

async function fetchStandaloneDetails(game) {
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
    if (getPanelGame() === game) statusEl.textContent = `Lookup failed: ${err.message}`;
  }
}

// ── URL state — deep link to an open game panel (`?game=`, restored via openStandaloneLookup
// above when the appid isn't backed by any loaded row) and, within it, a specific lightbox
// screenshot/video (`?shot=`). Mirrors app.js's setPanelParam/setLightboxParam/
// restorePanelFromUrl for the comparison page; see public/urlState.js for the equivalent
// parsing there (library.js has no analogous shared parser since its only other URL params —
// `u`, `tab`, `lv`/`wv` — are handled by updateUrlParams/restoreTableView/shareTableView
// already). The name
// deliberately never rides along in this URL (see openStandaloneLookup) — only the appid is
// trusted, and the panel just shows a placeholder title until the fetch resolves it.
function setPanelParam(appid) {
  const params = new URLSearchParams(location.search);
  params.delete('shot');
  if (appid == null) params.delete('game');
  else params.set('game', appid);
  history.replaceState(null, '', `?${reorderUrlParams(params)}`);
}

function setLightboxParam(idx) {
  const params = new URLSearchParams(location.search);
  if (idx == null) params.delete('shot');
  else params.set('shot', idx);
  history.replaceState(null, '', `?${reorderUrlParams(params)}`);
}

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
  // Not (yet) in the loaded library/wishlist rows — e.g. a game nobody in it owns/wishlists,
  // or no player loaded at all. Fetch it directly instead of silently giving up. Its name
  // isn't known yet (see openStandaloneLookup) — the panel opens with a placeholder title
  // until the fetch resolves it.
  if (getPanelGame()?.appid === appid) return; // already open / fetch already in flight
  openStandaloneLookup(appid);
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    // panelHandleEscape (panel.js) owns the lightbox-close/fullscreen-guard logic shared by
    // all three pages — delegate to it whenever the lightbox is open so this page can't drift
    // from the other two the way bundles.js once did (see its own comment).
    if (isLightboxOpen()) { panelHandleEscape(); return; }
    if (document.getElementById('shortcuts-modal').classList.contains('open')) { closeShortcuts(); return; }
    panelClose(); // onClose (see initPanel above) handles the URL cleanup
    return;
  }
  // The lightbox owns the keyboard while open — see the identical comment in app.js's
  // own keydown handler for why every other page-level shortcut is blocked here.
  if (isLightboxOpen()) return;
  if (e.key === '?') { e.preventDefault(); toggleShortcuts(); return; }
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.key === '/') {
    e.preventDefault();
    playerInput.focus();
    return;
  }
  if (!isPanelOpen()) return;
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

function scheduleFlush() {
  if (flushTimer !== null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    if (table) table.setData(visibleRowsForTable());
    updateLastPlayedTooltip();
    updateStatus();
  }, 150);
}

// See the `lastPlayed` column comment in COLUMNS above — 0/absent `rtime_last_played` for a
// non-key-owner account is indistinguishable from "never played", so a column that's entirely
// empty for the currently loaded rows is a much stronger signal of "Steam withheld this data"
// than of "this player has never launched a single game". Only the library tab has this column
// (see WISHLIST_COLUMNS) — the selector simply finds nothing on the wishlist tab, a harmless no-op.
function updateLastPlayedTooltip() {
  const th = tableContainer.querySelector('th[data-col-key="lastPlayed"]');
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
  if (total === 0) { statusEl.textContent = ''; return; }
  if (loaded >= total) {
    statusEl.textContent = `${total} games`;
  } else {
    statusEl.textContent = `${loaded} / ${total} games loaded…`;
  }
}

// Rendering, refresh-icon delegation, and localStorage recents all live in the shared
// public/accountsBar.js (also used by the comparison page's app.js).
const RECENTS_KEY = 'library-explorer:recent-players';

function renderAccountsBar(players, countLabel) {
  renderAccountChips(accountsBarEl, players, countLabel);
}

bindAccountRefresh(accountsBarEl, steamid => {
  loadCurrentTab(currentPlayerStr, { refreshIds: [steamid] });
});

bindRecentsBar(recentsBarEl, RECENTS_KEY, playerStr => {
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
function updateUrlParams(patch, { push = false } = {}) {
  const url = new URL(location.href);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === '') url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  url.search = `?${reorderUrlParams(url.searchParams)}`;
  if (push) history.pushState(null, '', url);
  else history.replaceState(null, '', url);
}

// Applies one SSE details event (rating/hltb/meta/tags) to its row. `name` is only
// backfilled from store metadata when the row didn't already have one — owned-game
// rows always do (from Steam's library API); wishlist rows don't, since GetWishlist
// returns no name at all.
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
  row.languages         = event.meta?.languages ?? [];
  row.hasDemo           = event.demo != null;
  // Steam's own content-type enum (`game`/`dlc`/`music`/`video`/`series`/`episode`/`mod`/
  // `hardware`/`advertising`, or `null` if the store response omitted it — see the `type`
  // comment in lib/steam.js's extractAppDetails). Mapped to a friendly label rather than
  // shown as Steam's raw enum string; `TYPE_LABELS` below has the full mapping. `null` is its
  // own bucket ("Unknown") rather than defaulting to "Game" — most rows really are games, but
  // silently assuming that for the rare metadata-fetch failure would hide the difference
  // between "we don't know" and "confirmed a game".
  row.type              = TYPE_LABELS[event.meta?.type] ?? (event.meta?.type ? event.meta.type : null);
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
// event to its row in `rowMap` as it arrives. Shared by loadLibrary and loadWishlist. Only
// `appid` is actually sent — the server always resolves the game's name itself rather than
// trusting a client-supplied one (see CLAUDE.md's "Looking up an arbitrary game" section).
async function streamGameDetails(games) {
  let detailsResp;
  try {
    detailsResp = await fetch('/api/game-details/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ games: games.map(g => ({ appid: g.appid })) }),
    });
  } catch (err) {
    statusEl.textContent = `Details stream failed: ${err.message}`;
    return;
  }

  const reader  = detailsResp.body.getReader();
  const decoder = new TextDecoder();
  let   buffer  = '';

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
      if (isPanelOpen() && getPanelGame().appid === row.appid) { renderPanelBody(row); renderPanelNav(row); }

      loaded++;
      scheduleFlush();
    }
  }

  if (flushTimer !== null) { clearTimeout(flushTimer); flushTimer = null; }
  if (table) table.setData(visibleRowsForTable());
  updateLastPlayedTooltip();
  updateStatus();
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
async function loadWishlistPrices(items, { force = false } = {}) {
  priceStatusEl.textContent = '';
  const configured = await itadConfiguredPromise;
  if (!configured) {
    // No ITAD key configured at all — fill every row with "no data" (not "…", which would
    // otherwise look stuck loading forever) rather than attempting a request bound to 503.
    for (const item of items) {
      const row = rowMap.get(item.appid);
      if (!row) continue;
      row.steamRegular = row.bestDealPrice = row.bestDealShop = row.bestDealUrl = row.bestDealCut = row.lowAll = row.lowY1 = row.lowM3 = row.priceCurrency = null;
      markRowChanged(item.appid);
      if (isPanelOpen() && getPanelGame() === row) renderPanelBody(row);
    }
    if (table) table.setData(visibleRowsForTable());
    return;
  }

  const country = resolveRegion(getStoredRegion());
  // Chunked client-side, sequentially (not in parallel) — a wishlist can run well past the
  // server's own MAX_PRICE_LOOKUP_GAMES cap (a bundle's game list never does, which is why
  // bundles.js's own loadPrices sends everything in one call), and firing several chunks at
  // once would just be several concurrent ITAD-backed requests instead of one, for no benefit.
  const appids = items.map(i => i.appid);
  for (let i = 0; i < appids.length; i += MAX_PRICE_LOOKUP_GAMES) {
    const chunk = appids.slice(i, i + MAX_PRICE_LOOKUP_GAMES);
    try {
      const qs = new URLSearchParams({ country });
      if (force) qs.set('refresh', '1');
      const res = await fetch(`/api/prices?${qs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appids: chunk }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Price lookup failed');
      for (const appid of chunk) {
        const row = rowMap.get(appid);
        const info = data.prices[appid];
        if (!row || !info) continue;
        row.steamRegular  = info.steamRegular?.amount ?? null;
        row.bestDealPrice = info.bestDeal?.price?.amount ?? null;
        row.bestDealShop  = info.bestDeal?.shop          ?? null;
        row.bestDealUrl   = info.bestDeal?.url           ?? null;
        row.bestDealCut   = discountPct(row.bestDealPrice, row.steamRegular);
        row.lowAll        = info.lowAll?.amount          ?? null;
        row.lowY1         = info.lowY1?.amount           ?? null;
        row.lowM3         = info.lowM3?.amount           ?? null;
        // Always set directly from this batch's own response — see the matching comment on
        // formatMoney (public/utils.js)/renderPrice (public/gameColumns.js) for why this can
        // legitimately differ per row.
        row.priceCurrency = info.steamRegular?.currency ?? info.bestDeal?.price?.currency ?? info.lowAll?.currency ?? info.lowY1?.currency ?? info.lowM3?.currency ?? null;
        markRowChanged(appid);
        if (isPanelOpen() && getPanelGame() === row) renderPanelBody(row);
      }
    } catch (err) {
      // Same "don't leave price columns stuck on their loading placeholder forever" treatment
      // as bundles.js's own loadPrices — a failed chunk still fills its own games with `null`
      // (rendered "—", same as any other "no data" case) rather than leaving them on "…".
      for (const appid of chunk) {
        const row = rowMap.get(appid);
        if (!row) continue;
        if (row.steamRegular === undefined) row.steamRegular = null;
        if (row.bestDealPrice === undefined) row.bestDealPrice = null;
        if (row.bestDealShop  === undefined) row.bestDealShop  = null;
        if (row.bestDealUrl   === undefined) row.bestDealUrl   = null;
        if (row.bestDealCut   === undefined) row.bestDealCut   = null;
        if (row.lowAll        === undefined) row.lowAll        = null;
        if (row.lowY1         === undefined) row.lowY1         = null;
        if (row.lowM3         === undefined) row.lowM3         = null;
        markRowChanged(appid);
        if (isPanelOpen() && getPanelGame() === row) renderPanelBody(row);
      }
      priceStatusEl.textContent = `Couldn't load Steam pricing (${err.message}) — other columns are unaffected.`;
    }
  }
  if (table) table.setData(visibleRowsForTable());
}

// preserveGameParam: skip clearing `?game=`/`&shot=` when closing a leftover panel — for a
// caller (loadLibrary/loadWishlist restoring a deep link, or loadFromUrl below on back/forward)
// that's about to reopen a game from those very params once the new data's in. See panel.js's
// own `preserveUrl` option, which this maps straight onto.
function resetTableState({ preserveGameParam = false } = {}) {
  if (isPanelOpen()) panelClose({ preserveUrl: preserveGameParam });
  clearRandomQueue(randomQueueKey());
  if (unsyncView) { unsyncView(); unsyncView = null; }
  if (table) { table.destroy(); table = null; }
  rows = []; rowMap = new Map(); total = 0; loaded = 0; tableRowCache = new Map();
  tableContainer.innerHTML = '';
  priceStatusEl.textContent = '';
  resetViewBtn.hidden = true;
  shareViewBtn.hidden = true;
  refreshPricesBtn.hidden = true;
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

async function loadLibrary(playerStr, { refreshIds, preserveGameParam = false, restoreShot = null, push = true } = {}) {
  // A genuine new load drops any `game`/`shot` left in the URL from a previous player/tab —
  // it may not even exist in the new list. The initial page-load path (bottom of this file)
  // passes preserveGameParam so it can restore the deep link once the new data is in. This
  // doesn't need to wait on the fetch below — unlike the `u` param (see further down), it's
  // not derived from anything the server resolves.
  if (!preserveGameParam) updateUrlParams({ game: null, shot: null });
  currentPlayerStr = playerStr;

  const members = playerStr.split(',').map(s => normalizeInput(s.trim())).filter(Boolean);

  statusEl.textContent = refreshIds ? 'Refreshing account…' : 'Fetching library…';
  resetTableState({ preserveGameParam });

  let result;
  try {
    const resp = await fetch('/api/common-games', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slots: [members], refreshIds }),
    });
    if (!resp.ok) {
      const { error } = await resp.json();
      statusEl.textContent = `Error: ${error}`;
      return;
    }
    result = await resp.json();
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
    return;
  }

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

  rows = allGames.map(game => {
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
      achievementCount:   undefined,
      dlcCount:           undefined,
      platforms:          undefined,
      languages:          undefined,
      hasDemo:            undefined,
      loading:            true,
      details:            null, // { rating, hltb, meta, tags, demo, protondb } — same shape the side panel expects
    };
  });

  rowMap = new Map(rows.map(r => [r.appid, r]));
  total = rows.length;
  activeColumns = COLUMNS;

  table = createDataTable(tableContainer, {
    data: visibleRows(), // empty at this point — every row starts out loading:true, see below
    columns: COLUMNS,
    rowKey: 'appid',
    initialViewState: { pageSize: 50, visibleCols: DEFAULT_VISIBLE, sorts: DEFAULT_SORT },
    // The table's own click handler hands back whatever object is currently in
    // tableRowCache for this row (see visibleRowsForTable's comment above) — a copy, not
    // rowMap's canonical one. Looking the canonical row back up by appid means the panel (and
    // anything that mutates whatever object it opened, like onRefresh below) always operates
    // on the same object rowMap does, not a disconnected copy further updates would stop
    // reaching — same fix bundles.js already needed for the same reason.
    onRowClick: row => openGame(rowMap.get(row.appid) ?? row),
  });
  restoreTableView(table, viewPrefKey(), viewParamName());
  unsyncView = bindViewPersistence(table, viewPrefKey());
  resetViewBtn.hidden = false;
  shareViewBtn.hidden = false;

  updateStatus();
  if (preserveGameParam) restorePanelFromUrl(restoreShot); // early attempt — lightbox needs details, tried again below

  await streamGameDetails(allGames);
  if (preserveGameParam) restorePanelFromUrl(restoreShot);
}

async function loadWishlist(playerStr, { refreshIds, preserveGameParam = false, restoreShot = null, push = true } = {}) {
  // See the matching comment in loadLibrary above — game/shot clearing doesn't need the
  // fetch below, but the `u` param does (it's written further down from resolved steamids).
  if (!preserveGameParam) updateUrlParams({ game: null, shot: null });
  currentPlayerStr = playerStr;

  const members = playerStr.split(',').map(s => normalizeInput(s.trim())).filter(Boolean);

  statusEl.textContent = refreshIds ? 'Refreshing account…' : 'Fetching wishlist…';
  resetTableState({ preserveGameParam });

  let result;
  try {
    const resp = await fetch('/api/wishlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ members, refreshIds }),
    });
    if (!resp.ok) {
      const { error } = await resp.json();
      statusEl.textContent = `Error: ${error}`;
      return;
    }
    result = await resp.json();
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
    return;
  }

  // Written from the server-resolved `steamid`s, not the raw typed input — see the matching
  // comment in loadLibrary above.
  const idStr = result.players.map(p => p.steamid).join(',');
  // See the matching comment in loadLibrary above.
  updateUrlParams({ u: idStr }, { push: push && !refreshIds });
  currentSteamIds = result.players.map(p => p.steamid);
  currentPlayerLabel = result.players.map(p => p.personaname || '?').join(' + ');
  updateTitle();
  updateBackLink();
  renderAccountsBar(result.players, 'wishlisted');
  addRecent(RECENTS_KEY, idStr, [result.players], idStr);
  renderRecentsBar(recentsBarEl, RECENTS_KEY);

  rows = result.items.map(item => ({
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
    achievementCount:   undefined,
    dlcCount:           undefined,
    platforms:          undefined,
    languages:          undefined,
    hasDemo:            undefined,
    loading:            true,
    details:            null,
  }));

  rowMap = new Map(rows.map(r => [r.appid, r]));
  total = rows.length;
  activeColumns = WISHLIST_COLUMNS;

  table = createDataTable(tableContainer, {
    data: visibleRows(), // empty at this point — every row starts out loading:true, see below
    columns: WISHLIST_COLUMNS,
    rowKey: 'appid',
    initialViewState: { pageSize: 50, visibleCols: WISHLIST_DEFAULT_VISIBLE, sorts: DEFAULT_SORT },
    // See the matching comment in loadLibrary above.
    onRowClick: row => openGame(rowMap.get(row.appid) ?? row),
  });
  restoreTableView(table, viewPrefKey(), viewParamName());
  unsyncView = bindViewPersistence(table, viewPrefKey());
  resetViewBtn.hidden = false;
  shareViewBtn.hidden = false;
  // Same "don't show a control for a feature that isn't running" reasoning as
  // wishlistRegionLabelEl (see updateRegionLabelVisibility above) — no point offering a price
  // refresh when ITAD isn't configured and every price column is just going to read "—".
  itadConfiguredPromise.then(configured => { refreshPricesBtn.hidden = !configured; });

  updateStatus();
  if (preserveGameParam) restorePanelFromUrl(restoreShot); // early attempt — lightbox needs details, tried again below

  // Independent of each other — Steam pricing has nothing to do with the rating/HLTB/tags
  // pipeline — so they run concurrently rather than one after the other, same reasoning as
  // bundles.js's own openBundle.
  await Promise.all([streamGameDetails(result.items), loadWishlistPrices(result.items)]);
  if (preserveGameParam) restorePanelFromUrl(restoreShot);
}

function loadCurrentTab(playerStr, opts) {
  return activeTab === 'wishlist' ? loadWishlist(playerStr, opts) : loadLibrary(playerStr, opts);
}

function setActiveTab(tab, { fetch: shouldFetch = true } = {}) {
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
}

tabLibraryBtn.addEventListener('click', () => setActiveTab('library'));
tabWishlistBtn.addEventListener('click', () => setActiveTab('wishlist'));

loadBtn.addEventListener('click', () => {
  const val = playerInput.value.trim();
  if (val) loadCurrentTab(val);
});

resetViewBtn.addEventListener('click', () => {
  resetTableView(table, viewPrefKey(), viewParamName());
});

shareViewBtn.addEventListener('click', () => shareTableView(table, viewParamName(), shareViewBtn));

// Refreshes just the price columns for the currently loaded wishlist, in one shot — same
// reasoning as bundles.js's own refreshPricesBtn: it's a single cheap POST /api/prices call
// either way, no reason to make the user step through every game's own panel "↻ Refresh".
// Only ever visible on the Wishlist tab (see loadWishlist above), so `rows` here is always the
// wishlist's own rows.
refreshPricesBtn.addEventListener('click', async () => {
  if (rows.length === 0 || refreshPricesBtn.disabled) return;
  refreshPricesBtn.disabled = true;
  refreshPricesBtn.textContent = 'Refreshing…';
  try {
    await loadWishlistPrices(rows, { force: true });
  } finally {
    refreshPricesBtn.disabled = false;
    refreshPricesBtn.textContent = '↻ Refresh prices';
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
