'use strict';

import { createDataTable, syncViewToUrl, resetView } from '@vates/data-table-vanilla';
import { processData, searchData, DEFAULT_LABELS, compareMissingLast } from '@vates/data-table-core';

const fmt = {
  loading: v => v === undefined ? '…' : v,
  num:  v => v === undefined ? '…' : v === null ? '—' : String(v),
  numRound: v => v === undefined ? '…' : v === null ? '—' : String(Math.round(v)),
  dec1: v => v === undefined ? '…' : v === null ? '—' : Number(v).toFixed(1),
  str:  v => v === undefined ? '…' : v || '—',
  ct:   v => v === undefined ? '…' : v === null ? '—' : Number(v).toLocaleString(),
  arr:  v => v === undefined ? '…' : Array.isArray(v) ? (v.length ? v.join(', ') : '—') : (v || '—'),
};

// Bare colored number rather than a progress bar — a bar's fill color carries the same
// good/bad signal the number's color already does, and with up to four score-ish columns
// (SteamDB Rating, Wilson Score, Steam %, Metacritic Score) visible at once, bars add visual
// weight without adding information. Uses the global `scoreColor()` from utils.js so the
// color scale matches the side panel's score display exactly, instead of a second copy of
// the same thresholds.
// `computeSteamdbRating` returns unrounded precision (0-100) so sort/group operate on the full
// number rather than the display-rounded integer — round only where displayed (here, and in
// `fmt.numRound`/`applyDetailsEvent` below).
function renderScoreNum(v) {
  if (v === undefined) return document.createTextNode('…');
  if (v === null) return document.createTextNode('—');
  const rounded = Math.round(v);
  const span = document.createElement('span');
  span.style.color = scoreColor(rounded);
  span.textContent = String(rounded);
  return span;
}

// ProtonDB's Linux/Steam Deck compatibility tiers, worst to best (see the matching color map
// in public/panel.js, which renders the same badge in the side panel — kept as a separate copy
// there since panel.js is a classic script and library.js a module, not for any semantic
// reason). "Native" (an actual Linux port, no Proton needed) ranks above "Platinum" (flawless
// *through* Proton). No "pending" entry — extractProtonDb (lib/steam.js) already collapses that
// tier to null server-side, since "too few reports to rate yet" isn't a quality tier at all, so
// it never reaches the client as a value that would need a place in this ordering.
const PROTON_TIER_ORDER = ['borked', 'bronze', 'silver', 'gold', 'platinum', 'native'];
const PROTON_TIER_COLORS = {
  borked: '#b91c1c', bronze: '#8b4513', silver: '#757575', gold: '#b8860b',
  platinum: '#5b6b85', native: '#15803d',
};

// Backing value is the plain capitalized tier name ("Gold", "Platinum") — @vates/data-table-core
// 0.7.0 added a per-column `compare` option (see the ProtonDB column below) precisely so a
// categorical column can sort by real quality order without needing display text to double as
// a sort key; see https://github.com/vatesfr/data-table/issues/15 for the request behind it (an
// earlier version of this column baked a rank digit into the value itself — "3 Gold" — to work
// around not having this, which leaked into the filter checklist/search text; not needed anymore).
function protonDbValue(tier) {
  if (PROTON_TIER_ORDER.indexOf(tier) === -1) return null;
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

// Ordering used by the ProtonDB column's `compare` below — same tier list as protonDbValue.
// `compareMissingLast` (new in 0.7.0 alongside `compare` itself) pins a missing rating to the
// end of the sort regardless of ascending/descending, rather than an empty value sorting first
// under plain ascending lexicographic comparison — games with no ProtonDB data yet shouldn't
// float to the top just because "" sorts before every real tier name.
const compareProtonTier = compareMissingLast((a, b) =>
  PROTON_TIER_ORDER.indexOf(a.toLowerCase()) - PROTON_TIER_ORDER.indexOf(b.toLowerCase()));

// Same colored pill as the side panel's ProtonDB badge (`.proton-badge`, shared style.css rule).
function renderProtonBadge(v) {
  if (v === undefined) return document.createTextNode('…');
  if (!v) return document.createTextNode('—');
  const span = document.createElement('span');
  span.className = 'proton-badge';
  span.style.background = PROTON_TIER_COLORS[v.toLowerCase()] || '#52525b';
  span.textContent = v;
  return span;
}

// Ignores `value` and reads `row.capsule` directly — `value` is forced to null on this column
// (see COLUMNS below) so the raw image URL never surfaces in full-text search matches.
function renderThumb(_, row) {
  const img = document.createElement('img');
  img.className = 'game-thumb';
  img.alt = '';
  img.loading = 'lazy';
  img.width = 120;
  img.height = 45;
  if (row.capsule) img.src = row.capsule;
  img.addEventListener('error', () => { img.style.visibility = 'hidden'; });
  return img;
}

// Plain numeric comparator, wrapped so a `null` ("no data" — no reviews, no Metacritic score,
// no HLTB match) always sorts last regardless of direction. Without this, a `type: 'number'`
// column's own coercion (`Number(null) === 0`) makes "no data" indistinguishable from an actual
// zero score/duration — most visibly on `steamdbRating`, the default sort column: a game with
// zero reviews currently ties with one confirmed 0% positive instead of being set apart from it.
const compareNumMissingLast = compareMissingLast((a, b) => a - b);

// Steam's release_date.date only gets this coarse ("2026", "Fall 2026", "2026 or later") while
// a game is still unreleased — once it ships, Steam always returns a specific day. JS's own Date
// parser anchors whatever it can partially recognize at the START of that period ("2026" -> Jan 1,
// "October 2026" -> Oct 1), which would sort a still-unreleased game BEFORE games that already
// shipped earlier that same year/month — backwards, since the real date can only land later.
// Anchor coarse dates at the END of their stated period instead (the latest point consistent with
// what Steam told us); a fully-specified date (or wishlist's `dateAdded`, always a precise
// timestamp) matches none of these patterns and falls through to plain `new Date()` unchanged.
//
// A bare year and Q4 of that same year both anchor at Dec 31 — same timestamp, so without a
// tie-break they wouldn't sort in any defined order relative to each other. "2026" carries less
// information than "Q4 2026" (it could still land in Q1-Q3), so nudge it 1ms later: a vaguer claim
// for the same end-of-period ranks just after a more specific one, without disturbing its order
// against any other, actually-different, day.
//
// Steam also uses two placeholders with no date in them at all: "Coming soon" and "To be
// announced"/"TBA". Deliberately NOT handled here — this function is also the column's
// `parseDate`, which the table framework reuses for the range-filter bounds and the date-tree
// filter dropdown, not just sorting. If a placeholder produced a real (if huge) timestamp, one
// "Coming soon" wishlist row would drag the whole column's computed max to that fake date,
// squashing every real release date into a sliver of the range slider, and a "released after X"
// filter would wrongly match games we have no actual date for. Letting them fall through to plain
// `new Date(s).getTime()` (NaN, same as any other unrecognized string) makes every one of those
// consumers correctly treat "unreleased" as "no known date" instead of "year 9999". Sort order is
// handled separately below, by `releaseSortTimestamp`, the only consumer that actually wants a
// deterministic placeholder position.
const SEASON_END = { spring: [5, 20], summer: [8, 21], fall: [11, 20], autumn: [11, 20], winter: [2, 19] };
function endOfReleasePeriod(str) {
  const s = String(str).trim();
  let m;
  if ((m = /^(spring|summer|fall|autumn|winter)\s+(\d{4})$/i.exec(s))) {
    const [month, day] = SEASON_END[m[1].toLowerCase()];
    const year = m[1].toLowerCase() === 'winter' ? Number(m[2]) + 1 : Number(m[2]); // winter spills into next year
    return new Date(year, month, day).getTime();
  }
  if ((m = /^Q([1-4])\s+(\d{4})$/i.exec(s))) {
    return new Date(Number(m[2]), Number(m[1]) * 3, 0).getTime(); // last day of the quarter's final month
  }
  if ((m = /^(\d{4})(?:\s+or\s+later)?$/i.exec(s))) {
    return new Date(Number(m[1]), 11, 31).getTime() + 1; // bare year, or open-ended "2026 or later" — end of that year, nudged 1ms past a same-year Q4 tie
  }
  if (/^[A-Za-z]+\s+\d{4}$/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) return new Date(d.getFullYear(), d.getMonth() + 1, 0).getTime(); // month name + year, no day — last day of that month
  }
  return new Date(s).getTime();
}

// Sort-only view of the Released column. "Coming soon" (some info — it's presumably nearer than a
// distant bare year) and "To be announced"/"TBA" (no info whatsoever) both need to sort after
// every real or coarse date — including a far-future bare year like "2028" — while still
// preserving Coming soon < TBA between themselves. Sentinel timestamps anchored past any realistic
// release year do that; they're deliberately not NaN (unlike a genuinely unrecognized string) so
// they get a real, deterministic position instead of falling into the null/empty "missing" bucket
// handled by compareDateMissingLast below. Kept local to the sort comparator (not folded back into
// endOfReleasePeriod/parseDate) so the range-filter bounds and date-tree — which also read
// `parseDate` — never see these fake dates; see the comment on endOfReleasePeriod above.
const COMING_SOON_SENTINEL = new Date(9999, 0, 1).getTime();
const TBA_SENTINEL         = new Date(9999, 0, 2).getTime();
function releaseSortTimestamp(str) {
  const s = String(str).trim();
  if (/^coming soon$/i.test(s)) return COMING_SOON_SENTINEL;
  if (/^(to be announced|tba)$/i.test(s)) return TBA_SENTINEL;
  return endOfReleasePeriod(s);
}

// Same idea for `type: 'date'` columns (`releaseDate`, wishlist's `dateAdded`) — setting
// `compare` bypasses the column's own `parseDate`/type coercion too, so a `null` date would
// otherwise become epoch 1970 via `new Date(null).getTime()` and sort as impossibly old, and a
// string neither `releaseSortTimestamp` nor plain `new Date()` can make sense of (not one of the
// recognized coarse forms, and not a valid date either) would sort at a nondeterministic spot via
// NaN comparisons — both need to be pinned last instead. "Coming soon" and "To be announced" are
// NOT examples of that — `releaseSortTimestamp` gives them real sentinel positions (see above) so
// they sort deterministically after every dated/coarse entry instead of landing in this bucket.
const compareDateMissingLast = compareMissingLast(
  (a, b) => releaseSortTimestamp(a) - releaseSortTimestamp(b),
  v => v == null || v === '' || isNaN(releaseSortTimestamp(v)),
);

// Amber-flags still-unreleased games in the Released column — reuses scoreColor's own
// mid-tier amber (`#e4a82e`) rather than introducing a new color, so it reads as "notable,
// not final" the same way a middling score does elsewhere in the table. Backed by Steam's own
// `comingSoon` flag (see extractAppDetails in lib/steam.js), not by comparing the parsed date
// to today — a coarse placeholder like "Coming soon" has no parseable date to compare at all.
function renderReleaseDate(v, row) {
  if (v === undefined) return document.createTextNode('…');
  if (!v) return document.createTextNode('—');
  const span = document.createElement('span');
  if (row.comingSoon) span.style.color = '#e4a82e';
  span.textContent = v;
  return span;
}

const COLUMNS = [
  { key: 'capsule', label: '', width: 128, sortable: false, filterable: false, groupable: false,
    value: () => null, render: renderThumb },
  { key: 'name',             label: 'Name',            filterable: false },
  // The default-visible score: SteamDB's current formula (see computeSteamdbRating in utils.js)
  // — shown first because it's the number most people recognize from SteamDB itself. Stored
  // unrounded so sort/default-sort operate on full precision (two games both displaying "97"
  // still order deterministically); not groupable for the same reason — grouping keys off the
  // raw value, and a near-unique float per game would produce a useless one-row-per-group split.
  // `defaultSortDir: 'desc'` (new in @vates/data-table-core 0.8.0) on this and the other three
  // score-ish columns below — a fresh click on any of them should show the best-rated games
  // first, not the worst; without it a first click started every numeric column ascending
  // (worst-first) regardless of what the number actually means. Only changes where a *new* sort
  // entry starts; it doesn't touch this column's own already-applied `DEFAULT_SORT` above.
  { key: 'steamdbRating',    label: 'SteamDB Rating',  type: 'number', groupable: false, format: fmt.numRound, render: renderScoreNum, compare: compareNumMissingLast, defaultSortDir: 'desc' },
  // Wilson score lower bound — statistically rigorous but harder to explain than SteamDB's
  // current formula (which is why it isn't the default-visible score anymore); kept available
  // for anyone who wants the more conservative, confidence-bound number instead.
  { key: 'score',            label: 'Wilson Score',    type: 'number', groupable: true, format: fmt.num, render: renderScoreNum, compare: compareNumMissingLast, defaultSortDir: 'desc' },
  // Raw positive/total ratio — the plain percentage Steam's own store page shows, as opposed to
  // the two adjusted scores above. No "%" in the cell (the column header already says so) —
  // same bare colored number treatment as the other three score columns for consistency.
  { key: 'positivePct',      label: 'Steam %',         type: 'number', groupable: true, format: fmt.num, render: renderScoreNum, compare: compareNumMissingLast, defaultSortDir: 'desc' },
  // Grouped with the other user-review scores above rather than off near HLTB/playtime — it's a
  // critic (not player) score, but it's still one of the four "how good is this game" numbers,
  // and keeping all of them contiguous makes them easier to compare at a glance.
  { key: 'metacritic',       label: 'Metacritic Score',type: 'number', groupable: true, format: fmt.num, render: renderScoreNum, compare: compareNumMissingLast, defaultSortDir: 'desc' },
  // No compare override here — 0 reviews is a real, meaningful value (not "no data" standing in
  // for one), so the default numeric sort already treats it correctly, unlike the score/HLTB
  // columns above and below. `defaultSortDir: 'desc'` still applies though — the most-reviewed
  // (most talked-about) games are the more useful thing to see on a first click, same reasoning
  // as the score columns just without the missing-data wrinkle.
  { key: 'reviewsTotal',     label: 'Review Count',    type: 'number', groupable: true, format: fmt.ct, defaultSortDir: 'desc' },
  // "All PlayStyles" listed first among the HLTB columns — same convention as the side panel,
  // which shows it leftmost precisely because it's a single representative number rather than
  // one specific playstyle (see the comment on `all` in lib/hltb.js). Keeping it first here too
  // means toggling on Main/+Extra/100% doesn't push it out of its default-visible position.
  { key: 'hltbAll',          label: 'All (h)',         type: 'number', groupable: true, format: fmt.dec1, compare: compareNumMissingLast },
  { key: 'hltbMain',         label: 'Main (h)',        type: 'number', groupable: true, format: fmt.dec1, compare: compareNumMissingLast },
  { key: 'hltbExtra',        label: '+Extra (h)',      type: 'number', groupable: true, format: fmt.dec1, compare: compareNumMissingLast },
  { key: 'hltbCompletionist',label: '100% (h)',        type: 'number', groupable: true, format: fmt.dec1, compare: compareNumMissingLast },
  // No compare override here either — 0 hours played is real data (owned, never launched), not
  // a stand-in for "unknown," so the default numeric sort is already correct. `defaultSortDir:
  // 'desc'` still applies — "what have I sunk the most hours into" is the more common question
  // than the reverse.
  { key: 'playtime',         label: 'Played (h)',      type: 'number', groupable: true,
    format: v => v > 0 ? Number(v).toFixed(1) : '—', defaultSortDir: 'desc' },
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
  { key: 'lastPlayed',       label: 'Last Played',   type: 'date', groupable: true, format: fmt.str,
    compare: compareDateMissingLast, defaultSortDir: 'desc', defaultValueSort: { by: 'alpha', dir: 'desc' } },
  { key: 'releaseDate',      label: 'Released',     type: 'date', groupable: true, format: fmt.str,
    parseDate: endOfReleasePeriod, compare: compareDateMissingLast, render: renderReleaseDate,
    defaultSortDir: 'desc', defaultValueSort: { by: 'alpha', dir: 'desc' } },
  { key: 'genres',           label: 'Genres',       groupable: true, format: fmt.arr },
  // `defaultValueSort: { by: 'count', dir: 'desc' }` (new in 0.8.0) — Developer/Publisher/Tags/
  // Categories are all higher-cardinality than Genres (a small, well-known fixed list that reads
  // fine alphabetically), so their filter checklists open "most common first" instead of A→Z;
  // still just the starting point — `cycleValueSort`'s toggle still cycles through all 4 states
  // the same as before.
  { key: 'developers',       label: 'Developer',    groupable: true, format: fmt.arr, defaultValueSort: { by: 'count', dir: 'desc' } },
  { key: 'publishers',       label: 'Publisher',    groupable: true, format: fmt.arr, defaultValueSort: { by: 'count', dir: 'desc' } },
  { key: 'tags',             label: 'Tags',         groupable: true, format: fmt.arr, defaultValueSort: { by: 'count', dir: 'desc' } },
  { key: 'categories',       label: 'Categories',   groupable: true, format: fmt.arr, defaultValueSort: { by: 'count', dir: 'desc' } },
  // Linux/Steam Deck compatibility tier from ProtonDB — sorted/grouped by actual compatibility
  // quality (see compareProtonTier above), not alphabetically; public/panel.js shows the same
  // data as a colored badge in the side panel. `defaultSortDir: 'desc'` shows the best-compatibility
  // games first on a fresh click, matching compareProtonTier's worst-to-best ordering.
  { key: 'protondb',         label: 'ProtonDB',     groupable: true, format: fmt.str, render: renderProtonBadge, compare: compareProtonTier, defaultSortDir: 'desc' },
];

const DEFAULT_VISIBLE = [
  'capsule', 'name', 'steamdbRating', 'hltbAll', 'playtime', 'releaseDate', 'genres',
];

// Applied via setViewState() after table creation and after "Reset view" — there's no
// construction-time default-sort option, only defaultVisibleColumns (see README).
const DEFAULT_SORT = [{ key: 'steamdbRating', dir: 'desc' }];

// Same as COLUMNS minus playtime and lastPlayed (wishlist games aren't owned, so there's no
// playtime or last-played data to show), plus two wishlist-specific columns. Unlike owned
// games — whose name is known upfront from Steam's library API — a wishlist row's name
// only arrives once its store metadata streams in, so it needs a loading state.
const WISHLIST_COLUMNS = [
  ...COLUMNS.filter(c => c.key !== 'playtime' && c.key !== 'lastPlayed').map(c => (c.key === 'name' ? { ...c, format: fmt.str } : c)),
  // No defaultSortDir here — Steam's wishlist rank is already 1-at-the-top, so the plain
  // ascending default a fresh click starts at is the useful direction as-is.
  { key: 'priority',  label: 'Wishlist Rank', type: 'number', groupable: false, format: fmt.num },
  // Same "last modified"-style reasoning as the owned-library's Last Played/Released columns
  // above — a fresh click (and the filter's date tree) should lead with what was added most
  // recently, not the oldest wishlist entry.
  { key: 'dateAdded', label: 'Added',         type: 'date',   groupable: true,  format: fmt.str, compare: compareDateMissingLast,
    defaultSortDir: 'desc', defaultValueSort: { by: 'alpha', dir: 'desc' } },
];

const WISHLIST_DEFAULT_VISIBLE = [
  'capsule', 'name', 'dateAdded', 'steamdbRating', 'hltbAll', 'releaseDate', 'genres',
];

const playerInput   = document.getElementById('player-input');
const loadBtn       = document.getElementById('load-btn');
const statusEl      = document.getElementById('status');
const accountsBarEl = document.getElementById('accounts-bar');
const recentsBarEl  = document.getElementById('recents-bar');
const recentGamesBarEl = document.getElementById('recent-games-bar');
const tableContainer = document.getElementById('table-container');
const resetViewBtn  = document.getElementById('reset-view-btn');
const tabLibraryBtn  = document.getElementById('tab-library');
const tabWishlistBtn = document.getElementById('tab-wishlist');

let table         = null;
let unsyncView    = null;
let rows          = [];
let rowMap        = new Map();
let total         = 0;
let loaded        = 0;
let flushTimer    = null;
let activeColumns = COLUMNS;   // COLUMNS or WISHLIST_COLUMNS, whichever tab is active
let activeTab     = 'library'; // 'library' | 'wishlist'
let currentPlayerStr = '';     // last player string actually loaded (not just typed)

// Separate shuffle history per tab, so picking randomly in one doesn't affect the other.
const randomQueueKey = () => activeTab;
const viewParamName  = () => (activeTab === 'wishlist' ? 'wview' : 'view');

initPanel({
  inertSelector: '.lib-page',
  onRefresh: async (row) => {
    try {
      const res = await fetch(`/api/game-details/${row.appid}?refresh=1`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Refresh failed');
      applyDetailsEvent(row, data);
      if (table) table.setData(visibleRows());
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
  onClose: () => setPanelParam(null),
});
initLightbox({ onParamChange: setLightboxParam });

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
function visibleRows() {
  return rows.filter(r => !r.loading);
}

// Stable order for prev/next nav — independent of the table's own live
// sort/filter/group state, which isn't exposed by @vates/data-table-vanilla.
// The table's current search/filter/sort order — same pipeline @vates/data-table-vanilla
// applies internally (searchData then processData), minus its grouping/pagination, which are
// display-only concerns with no single well-defined linear order (a grouped multi-value column
// like Genres fans a game out into more than one group).
function getGameList() {
  const view = table.getViewState();
  const filters = Object.fromEntries(
    Object.entries(view.filters ?? {}).map(([key, values]) => [key, new Set(values)])
  );
  const searched = searchData(visibleRows(), view.searchQuery ?? '', activeColumns);
  return processData(searched, filters, view.rangeFilters ?? {}, view.sorts ?? [], activeColumns, DEFAULT_LABELS.emptyValue);
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

function openGame(game, { isRandom = false } = {}) {
  if (!isRandom) clearRandomQueue(randomQueueKey());
  panelOpen(game);
  renderPanelNav(game);
  setPanelParam(game.appid);
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
function openStandaloneLookup(appid, name) {
  const existing = rowMap.get(appid);
  if (existing) {
    openGame(existing);
    addRecentGame(existing.appid, existing.name, existing.capsule || null);
    renderRecentGamesBar(recentGamesBarEl);
    return;
  }
  const game = { appid, name: name || `App ${appid}`, loading: true, details: null, standalone: true };
  openGame(game);
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
    if (getPanelGame() === game) { renderPanelBody(game); setPanelParam(game.appid); }
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
// `u`, `tab`, `view`/`wview` — are handled by updateUrlParams/syncViewToUrl already). The name
// deliberately never rides along in this URL (see openStandaloneLookup) — only the appid is
// trusted, and the panel just shows a placeholder title until the fetch resolves it.
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
    if (isLightboxOpen()) {
      if (document.fullscreenElement || document.webkitFullscreenElement) return; // browser exits FS; keep lightbox open
      closeLightbox();
      return;
    }
    if (document.getElementById('shortcuts-modal').classList.contains('open')) { closeShortcuts(); return; }
    panelClose(); // onClose (see initPanel above) handles the URL cleanup
    return;
  }
  if (e.key === '?') { e.preventDefault(); toggleShortcuts(); return; }
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.key === '/') {
    e.preventDefault();
    playerInput.focus();
    return;
  }
  if (!isPanelOpen()) return;
  if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !isLightboxOpen()) {
    if (panelStepHero(e.key === 'ArrowRight' ? 1 : -1, { wrap: true })) e.preventDefault();
    return;
  }
  if ((e.key === 'r' || e.key === 'R') && !isLightboxOpen()) {
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
    if (table) table.setData(visibleRows());
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

function updateUrlParams(patch) {
  const url = new URL(location.href);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === '') url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  history.pushState(null, '', url);
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
  row.loading           = false;
  row.details           = { rating: event.rating, hltb: event.hltb, meta: event.meta, tags: event.tags, protondb: event.protondb };
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
      if (isPanelOpen() && getPanelGame().appid === row.appid) { renderPanelBody(row); renderPanelNav(row); }

      loaded++;
      scheduleFlush();
    }
  }

  if (flushTimer !== null) { clearTimeout(flushTimer); flushTimer = null; }
  if (table) table.setData(visibleRows());
  updateLastPlayedTooltip();
  updateStatus();
}

function resetTableState() {
  if (isPanelOpen()) panelClose();
  clearRandomQueue(randomQueueKey());
  if (unsyncView) { unsyncView(); unsyncView = null; }
  if (table) { table.destroy(); table = null; }
  rows = []; rowMap = new Map(); total = 0; loaded = 0;
  tableContainer.innerHTML = '';
  resetViewBtn.hidden = true;
  accountsBarEl.hidden = true;
  accountsBarEl.innerHTML = '';
}

async function loadLibrary(playerStr, { refreshIds, preserveGameParam = false, restoreShot = null } = {}) {
  // A genuine new load drops any `game`/`shot` left in the URL from a previous player/tab —
  // it may not even exist in the new list. The initial page-load path (bottom of this file)
  // passes preserveGameParam so it can restore the deep link once the new data is in. This
  // doesn't need to wait on the fetch below — unlike the `u` param (see further down), it's
  // not derived from anything the server resolves.
  if (!preserveGameParam) updateUrlParams({ game: null, shot: null });
  currentPlayerStr = playerStr;

  const members = playerStr.split(',').map(s => normalizeInput(s.trim())).filter(Boolean);

  statusEl.textContent = refreshIds ? 'Refreshing account…' : 'Fetching library…';
  resetTableState();

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
  updateUrlParams({ u: idStr });
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
      loading:            true,
      details:            null, // { rating, hltb, meta, tags, protondb } — same shape the side panel expects
    };
  });

  rowMap = new Map(rows.map(r => [r.appid, r]));
  total = rows.length;
  activeColumns = COLUMNS;

  table = createDataTable(tableContainer, {
    data: visibleRows(), // empty at this point — every row starts out loading:true, see below
    columns: COLUMNS,
    rowKey: 'appid',
    defaultPageSize: 50,
    defaultVisibleColumns: DEFAULT_VISIBLE,
    onRowClick: row => openGame(row),
  });
  table.setViewState({ sorts: DEFAULT_SORT });
  unsyncView = syncViewToUrl(table);
  resetViewBtn.hidden = false;

  updateStatus();
  if (preserveGameParam) restorePanelFromUrl(restoreShot); // early attempt — lightbox needs details, tried again below

  await streamGameDetails(allGames);
  if (preserveGameParam) restorePanelFromUrl(restoreShot);
}

async function loadWishlist(playerStr, { refreshIds, preserveGameParam = false, restoreShot = null } = {}) {
  // See the matching comment in loadLibrary above — game/shot clearing doesn't need the
  // fetch below, but the `u` param does (it's written further down from resolved steamids).
  if (!preserveGameParam) updateUrlParams({ game: null, shot: null });
  currentPlayerStr = playerStr;

  const members = playerStr.split(',').map(s => normalizeInput(s.trim())).filter(Boolean);

  statusEl.textContent = refreshIds ? 'Refreshing account…' : 'Fetching wishlist…';
  resetTableState();

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
  updateUrlParams({ u: idStr });
  renderAccountsBar(result.players, 'wishlisted');
  addRecent(RECENTS_KEY, idStr, [result.players], idStr);
  renderRecentsBar(recentsBarEl, RECENTS_KEY);

  rows = result.items.map(item => ({
    appid:              item.appid,
    name:               undefined, // unknown until store metadata streams in
    priority:           item.priority,
    dateAdded:          item.dateAdded,
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
    defaultPageSize: 50,
    defaultVisibleColumns: WISHLIST_DEFAULT_VISIBLE,
    onRowClick: row => openGame(row),
  });
  table.setViewState({ sorts: DEFAULT_SORT });
  unsyncView = syncViewToUrl(table, { paramName: 'wview' });
  resetViewBtn.hidden = false;

  updateStatus();
  if (preserveGameParam) restorePanelFromUrl(restoreShot); // early attempt — lightbox needs details, tried again below

  await streamGameDetails(result.items);
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
  updateUrlParams({ tab: tab === 'wishlist' ? 'wishlist' : null });
  if (shouldFetch && currentPlayerStr) loadCurrentTab(currentPlayerStr);
}

tabLibraryBtn.addEventListener('click', () => setActiveTab('library'));
tabWishlistBtn.addEventListener('click', () => setActiveTab('wishlist'));

loadBtn.addEventListener('click', () => {
  const val = playerInput.value.trim();
  if (val) loadCurrentTab(val);
});

resetViewBtn.addEventListener('click', () => {
  resetView(table, { paramName: viewParamName() });
  // resetView() clears sorts to none along with everything else — reapply our own default
  // sort on top, since there's no construction-time option for it (see DEFAULT_SORT above).
  table.setViewState({ sorts: DEFAULT_SORT });
});

playerInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const val = playerInput.value.trim();
    if (val) loadCurrentTab(val);
  }
});

const initParams = new URLSearchParams(location.search);
const initPlayer = initParams.get('u');
if (initParams.get('tab') === 'wishlist') setActiveTab('wishlist', { fetch: false });
if (initPlayer) {
  playerInput.value = initPlayer;
  currentPlayerStr = initPlayer;
  // preserveGameParam: a `?game=<appid>` (and `&shot=<idx>`) present in the URL on page
  // load should reopen that game/media once its row is in — see restorePanelFromUrl().
  // `shot` is captured here (not re-read later) since opening the panel deletes it from
  // the live URL — see the comment on restorePanelFromUrl().
  loadCurrentTab(initPlayer, { preserveGameParam: true, restoreShot: initParams.get('shot') });
} else {
  // No player loaded at all — still honor a bare `?game=` standalone-lookup deep link
  // (loadLibrary/loadWishlist would otherwise be the only callers of restorePanelFromUrl).
  restorePanelFromUrl(initParams.get('shot'));
}
