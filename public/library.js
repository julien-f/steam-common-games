'use strict';

import { createDataTable, syncViewToUrl, resetView } from '@vates/data-table-vanilla';
import { processData, searchData, DEFAULT_LABELS } from '@vates/data-table-core';

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

const COLUMNS = [
  { key: 'capsule', label: '', width: 128, sortable: false, filterable: false, groupable: false,
    value: () => null, render: renderThumb },
  { key: 'name',             label: 'Name',            filterable: false },
  // The default-visible score: SteamDB's current formula (see computeSteamdbRating in utils.js)
  // — shown first because it's the number most people recognize from SteamDB itself. Stored
  // unrounded so sort/default-sort operate on full precision (two games both displaying "97"
  // still order deterministically); not groupable for the same reason — grouping keys off the
  // raw value, and a near-unique float per game would produce a useless one-row-per-group split.
  { key: 'steamdbRating',    label: 'SteamDB Rating',  type: 'number', groupable: false, format: fmt.numRound, render: renderScoreNum },
  // Wilson score lower bound — statistically rigorous but harder to explain than SteamDB's
  // current formula (which is why it isn't the default-visible score anymore); kept available
  // for anyone who wants the more conservative, confidence-bound number instead.
  { key: 'score',            label: 'Wilson Score',    type: 'number', groupable: true, format: fmt.num, render: renderScoreNum },
  // Raw positive/total ratio — the plain percentage Steam's own store page shows, as opposed to
  // the two adjusted scores above. No "%" in the cell (the column header already says so) —
  // same bare colored number treatment as the other three score columns for consistency.
  { key: 'positivePct',      label: 'Steam %',         type: 'number', groupable: true, format: fmt.num, render: renderScoreNum },
  // Grouped with the other user-review scores above rather than off near HLTB/playtime — it's a
  // critic (not player) score, but it's still one of the four "how good is this game" numbers,
  // and keeping all of them contiguous makes them easier to compare at a glance.
  { key: 'metacritic',       label: 'Metacritic Score',type: 'number', groupable: true, format: fmt.num, render: renderScoreNum },
  { key: 'reviewsTotal',     label: 'Review Count',    type: 'number', groupable: true, format: fmt.ct },
  // "All PlayStyles" listed first among the HLTB columns — same convention as the side panel,
  // which shows it leftmost precisely because it's a single representative number rather than
  // one specific playstyle (see the comment on `all` in lib/hltb.js). Keeping it first here too
  // means toggling on Main/+Extra/100% doesn't push it out of its default-visible position.
  { key: 'hltbAll',          label: 'All (h)',         type: 'number', groupable: true, format: fmt.dec1 },
  { key: 'hltbMain',         label: 'Main (h)',        type: 'number', groupable: true, format: fmt.dec1 },
  { key: 'hltbExtra',        label: '+Extra (h)',      type: 'number', groupable: true, format: fmt.dec1 },
  { key: 'hltbCompletionist',label: '100% (h)',        type: 'number', groupable: true, format: fmt.dec1 },
  { key: 'playtime',         label: 'Played (h)',      type: 'number', groupable: true,
    format: v => v > 0 ? Number(v).toFixed(1) : '—' },
  { key: 'releaseDate',      label: 'Released',     type: 'date', groupable: true, format: fmt.str },
  { key: 'genres',           label: 'Genres',       groupable: true, format: fmt.arr },
  { key: 'developers',       label: 'Developer',    groupable: true, format: fmt.arr },
  { key: 'publishers',       label: 'Publisher',    groupable: true, format: fmt.arr },
  { key: 'tags',             label: 'Tags',         groupable: true, format: fmt.arr },
  { key: 'categories',       label: 'Categories',   groupable: true, format: fmt.arr },
];

const DEFAULT_VISIBLE = [
  'capsule', 'name', 'steamdbRating', 'hltbAll', 'playtime', 'releaseDate', 'genres',
];

// Applied via setViewState() after table creation and after "Reset view" — there's no
// construction-time default-sort option, only defaultVisibleColumns (see README).
const DEFAULT_SORT = [{ key: 'steamdbRating', dir: 'desc' }];

// Same as COLUMNS minus playtime (wishlist games aren't owned, so there's no
// playtime to show), plus two wishlist-specific columns. Unlike owned games —
// whose name is known upfront from Steam's library API — a wishlist row's name
// only arrives once its store metadata streams in, so it needs a loading state.
const WISHLIST_COLUMNS = [
  ...COLUMNS.filter(c => c.key !== 'playtime').map(c => (c.key === 'name' ? { ...c, format: fmt.str } : c)),
  { key: 'priority',  label: 'Wishlist Rank', type: 'number', groupable: false, format: fmt.num },
  { key: 'dateAdded', label: 'Added',         type: 'date',   groupable: true,  format: fmt.str },
];

const WISHLIST_DEFAULT_VISIBLE = [
  'capsule', 'name', 'priority', 'dateAdded', 'steamdbRating', 'hltbAll', 'releaseDate', 'genres',
];

const playerInput   = document.getElementById('player-input');
const loadBtn       = document.getElementById('load-btn');
const refreshBtn    = document.getElementById('refresh-btn');
const statusEl      = document.getElementById('status');
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
      const res = await fetch(`/api/game-details/${row.appid}?name=${encodeURIComponent(row.name || '')}&refresh=1`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Refresh failed');
      applyDetailsEvent(row, data);
      if (table) table.setData([...rows]);
    } catch (err) {
      statusEl.textContent = `Refresh failed: ${err.message}`;
    }
  },
});
initLightbox();

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
  const searched = searchData(rows, view.searchQuery ?? '', activeColumns);
  return processData(searched, filters, view.rangeFilters ?? {}, view.sorts ?? [], activeColumns, DEFAULT_LABELS.emptyValue);
}

function renderPanelNav(game) {
  const nav = document.getElementById('panel-nav');
  const list = getGameList();
  const idx = list.findIndex(g => g.appid === game.appid);
  nav.innerHTML = `
    <button class="panel-nav-btn" id="panel-prev" aria-label="Previous game">↑</button>
    <span class="panel-nav-pos">${idx + 1} / ${list.length}</span>
    <button class="panel-nav-btn" id="panel-next" aria-label="Next game">↓</button>
    <button class="panel-nav-btn panel-nav-reroll" id="panel-reroll" aria-label="Pick a random game" title="Pick a random game">🎲</button>
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
}

function pickRandomGame() {
  const pick = pickRandomFrom(getGameList(), randomQueueKey(), getPanelGame()?.appid);
  if (pick) openGame(pick, { isRandom: true });
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (isLightboxOpen()) {
      if (document.fullscreenElement || document.webkitFullscreenElement) return; // browser exits FS; keep lightbox open
      closeLightbox();
      return;
    }
    if (document.getElementById('shortcuts-modal').classList.contains('open')) { closeShortcuts(); return; }
    panelClose();
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
    if (table) table.setData([...rows]);
    updateStatus();
  }, 150);
}

function updateStatus() {
  if (total === 0) { statusEl.textContent = ''; return; }
  if (loaded >= total) {
    statusEl.textContent = `${total} games`;
  } else {
    statusEl.textContent = `${loaded} / ${total} games loaded…`;
  }
}

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
  row.genres            = event.meta?.genres     ?? [];
  row.developers        = event.meta?.developers ?? [];
  row.publishers        = event.meta?.publishers ?? [];
  row.categories        = event.meta?.categories ?? [];
  row.tags              = event.tags ?? [];
  row.loading           = false;
  row.details           = { rating: event.rating, hltb: event.hltb, meta: event.meta, tags: event.tags };
}

// Streams rating/hltb/meta/tags for `games` ({appid, name}[]) over SSE and applies
// each event to its row in `rowMap` as it arrives. Shared by loadLibrary and loadWishlist.
async function streamGameDetails(games) {
  let detailsResp;
  try {
    detailsResp = await fetch('/api/game-details/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ games }),
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
  if (table) table.setData([...rows]);
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
  refreshBtn.hidden = true;
}

async function loadLibrary(playerStr, { refresh = false } = {}) {
  updateUrlParams({ u: playerStr });
  currentPlayerStr = playerStr;

  const members = playerStr.split(',').map(s => s.trim()).filter(Boolean);

  statusEl.textContent = refresh ? 'Refreshing library…' : 'Fetching library…';
  resetTableState();

  let result;
  try {
    const resp = await fetch('/api/common-games', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slots: [members], refresh }),
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

  rows = allGames.map(game => {
    const ptByAccount = (result.playtime && result.playtime[game.appid]) || {};
    const totalMin = slotSteamIds.reduce((s, id) => s + (ptByAccount[id] || 0), 0);
    return {
      appid:              game.appid,
      name:               game.name,
      playtime:           totalMin / 60,
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
      loading:            true,
      details:            null, // { rating, hltb, meta, tags } — same shape the side panel expects
    };
  });

  rowMap = new Map(rows.map(r => [r.appid, r]));
  total = rows.length;
  activeColumns = COLUMNS;

  table = createDataTable(tableContainer, {
    data: rows,
    columns: COLUMNS,
    rowKey: 'appid',
    defaultPageSize: 50,
    defaultVisibleColumns: DEFAULT_VISIBLE,
    onRowClick: row => openGame(row),
  });
  table.setViewState({ sorts: DEFAULT_SORT });
  unsyncView = syncViewToUrl(table);
  resetViewBtn.hidden = false;
  refreshBtn.hidden = false;

  updateStatus();

  await streamGameDetails(allGames);
}

async function loadWishlist(playerStr, { refresh = false } = {}) {
  updateUrlParams({ u: playerStr });
  currentPlayerStr = playerStr;

  const members = playerStr.split(',').map(s => s.trim()).filter(Boolean);

  statusEl.textContent = refresh ? 'Refreshing wishlist…' : 'Fetching wishlist…';
  resetTableState();

  let result;
  try {
    const resp = await fetch('/api/wishlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ members, refresh }),
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
    loading:            true,
    details:            null,
  }));

  rowMap = new Map(rows.map(r => [r.appid, r]));
  total = rows.length;
  activeColumns = WISHLIST_COLUMNS;

  table = createDataTable(tableContainer, {
    data: rows,
    columns: WISHLIST_COLUMNS,
    rowKey: 'appid',
    defaultPageSize: 50,
    defaultVisibleColumns: WISHLIST_DEFAULT_VISIBLE,
    onRowClick: row => openGame(row),
  });
  table.setViewState({ sorts: DEFAULT_SORT });
  unsyncView = syncViewToUrl(table, { paramName: 'wview' });
  resetViewBtn.hidden = false;
  refreshBtn.hidden = false;

  updateStatus();

  await streamGameDetails(result.items.map(item => ({ appid: item.appid, name: '' })));
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

refreshBtn.addEventListener('click', () => {
  if (currentPlayerStr) loadCurrentTab(currentPlayerStr, { refresh: true });
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
  loadCurrentTab(initPlayer);
}
