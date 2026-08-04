'use strict';

import { createDataTable, syncViewToUrl, createScoreBar } from '@vates/data-table-vanilla';
import { processData, searchData, DEFAULT_LABELS } from '@vates/data-table-core';

const fmt = {
  loading: v => v === undefined ? '…' : v,
  num:  v => v === undefined ? '…' : v === null ? '—' : String(v),
  dec1: v => v === undefined ? '…' : v === null ? '—' : Number(v).toFixed(1),
  str:  v => v === undefined ? '…' : v || '—',
  ct:   v => v === undefined ? '…' : v === null ? '—' : Number(v).toLocaleString(),
  arr:  v => v === undefined ? '…' : Array.isArray(v) ? (v.length ? v.join(', ') : '—') : (v || '—'),
};

// Same palette as scoreColor() in utils.js, kept in sync so a score reads the same
// color on the comparison page and here.
const SCORE_THRESHOLDS = [[80, '#57cbde'], [65, '#a3cf4e'], [50, '#e4a82e'], [0, '#cc5050']];

function renderScoreBar(v) {
  if (v === undefined) return document.createTextNode('…');
  if (v === null) return document.createTextNode('—');
  return createScoreBar(v, { thresholds: SCORE_THRESHOLDS });
}

const COLUMNS = [
  { key: 'name',             label: 'Name',         filterable: false },
  { key: 'score',            label: 'Score',        type: 'number', groupable: true, format: fmt.num, render: renderScoreBar },
  { key: 'reviewDesc',       label: 'Reviews',      groupable: true, filterable: true, format: fmt.str },
  { key: 'reviewsTotal',     label: 'Reviews #',    type: 'number', groupable: true, format: fmt.ct },
  { key: 'hltbMain',         label: 'Main (h)',     type: 'number', groupable: true, format: fmt.dec1 },
  { key: 'hltbExtra',        label: '+Extra (h)',   type: 'number', groupable: true, format: fmt.dec1 },
  { key: 'hltbCompletionist',label: '100% (h)',     type: 'number', groupable: true, format: fmt.dec1 },
  { key: 'playtime',         label: 'Played (h)',   type: 'number', groupable: true,
    format: v => v > 0 ? Number(v).toFixed(1) : '—' },
  { key: 'metacritic',       label: 'Metacritic',   type: 'number', groupable: true, format: fmt.num, render: renderScoreBar },
  { key: 'releaseDate',      label: 'Released',     type: 'date', groupable: true, format: fmt.str },
  { key: 'genres',           label: 'Genres',       groupable: true, format: fmt.arr },
  { key: 'developers',       label: 'Developer',    groupable: true, format: fmt.arr },
  { key: 'publishers',       label: 'Publisher',    groupable: true, format: fmt.arr },
  { key: 'tags',             label: 'Tags',         groupable: true, format: fmt.arr },
  { key: 'categories',       label: 'Categories',   groupable: true, format: fmt.arr },
];

const DEFAULT_VISIBLE = [
  'name', 'score', 'reviewDesc', 'hltbMain', 'hltbExtra', 'playtime',
  'metacritic', 'releaseDate', 'genres', 'developers', 'tags',
];

const playerInput = document.getElementById('player-input');
const loadBtn     = document.getElementById('load-btn');
const statusEl    = document.getElementById('status');
const tableContainer = document.getElementById('table-container');

let table       = null;
let unsyncView  = null;
let rows        = [];
let rowMap      = new Map();
let total       = 0;
let loaded      = 0;
let flushTimer  = null;

const RANDOM_QUEUE_KEY = 'library'; // single fixed key — this page only ever has one list

initPanel({ inertSelector: '.lib-page' });
initLightbox();

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
  const searched = searchData(rows, view.searchQuery ?? '', COLUMNS);
  return processData(searched, filters, view.rangeFilters ?? {}, view.sorts ?? [], COLUMNS, DEFAULT_LABELS.emptyValue);
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
  if (!isRandom) clearRandomQueue(RANDOM_QUEUE_KEY);
  panelOpen(game);
  renderPanelNav(game);
}

function pickRandomGame() {
  const pick = pickRandomFrom(getGameList(), RANDOM_QUEUE_KEY, getPanelGame()?.appid);
  if (pick) openGame(pick, { isRandom: true });
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (isLightboxOpen()) {
      if (document.fullscreenElement || document.webkitFullscreenElement) return; // browser exits FS; keep lightbox open
      closeLightbox();
      return;
    }
    panelClose();
    return;
  }
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
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

async function loadLibrary(playerStr) {
  const url = new URL(location.href);
  url.searchParams.set('u', playerStr);
  history.pushState(null, '', url);

  const members = playerStr.split(',').map(s => s.trim()).filter(Boolean);

  statusEl.textContent = 'Fetching library…';
  if (isPanelOpen()) panelClose();
  clearRandomQueue(RANDOM_QUEUE_KEY);
  if (unsyncView) { unsyncView(); unsyncView = null; }
  if (table) { table.destroy(); table = null; }
  rows = []; rowMap = new Map(); total = 0; loaded = 0;
  tableContainer.innerHTML = '';

  let result;
  try {
    const resp = await fetch('/api/common-games', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slots: [members] }),
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
      score:              undefined,
      reviewDesc:         undefined,
      reviewsTotal:       undefined,
      hltbMain:           undefined,
      hltbExtra:          undefined,
      hltbCompletionist:  undefined,
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

  table = createDataTable(tableContainer, {
    data: rows,
    columns: COLUMNS,
    rowKey: 'appid',
    defaultPageSize: 50,
    defaultVisibleColumns: DEFAULT_VISIBLE,
    onRowClick: row => openGame(row),
  });
  unsyncView = syncViewToUrl(table);

  updateStatus();

  // Stream details over SSE
  let detailsResp;
  try {
    detailsResp = await fetch('/api/game-details/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ games: allGames }),
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

      row.score             = event.rating?.score ?? null;
      row.reviewDesc        = event.rating?.desc  ?? null;
      row.reviewsTotal      = event.rating?.total ?? null;
      row.hltbMain          = event.hltb?.main           ?? null;
      row.hltbExtra         = event.hltb?.extra          ?? null;
      row.hltbCompletionist = event.hltb?.completionist  ?? null;
      row.metacritic        = event.meta?.metacritic?.score ?? null;
      row.releaseDate       = event.meta?.releaseDate    ?? null;
      row.genres            = event.meta?.genres     ?? [];
      row.developers        = event.meta?.developers ?? [];
      row.publishers        = event.meta?.publishers ?? [];
      row.categories        = event.meta?.categories ?? [];
      row.tags              = event.tags ?? [];
      row.loading           = false;
      row.details           = { rating: event.rating, hltb: event.hltb, meta: event.meta, tags: event.tags };

      if (isPanelOpen() && getPanelGame().appid === row.appid) { renderPanelBody(row); renderPanelNav(row); }

      loaded++;
      scheduleFlush();
    }
  }

  if (flushTimer !== null) { clearTimeout(flushTimer); flushTimer = null; }
  if (table) table.setData([...rows]);
  updateStatus();
}

loadBtn.addEventListener('click', () => {
  const val = playerInput.value.trim();
  if (val) loadLibrary(val);
});

playerInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const val = playerInput.value.trim();
    if (val) loadLibrary(val);
  }
});

const initPlayer = new URLSearchParams(location.search).get('u');
if (initPlayer) {
  playerInput.value = initPlayer;
  loadLibrary(initPlayer);
}
