'use strict';

import { createFlexiTable } from '@vates/flexi-table-vanilla';

const fmt = {
  loading: v => v === undefined ? '…' : v,
  num:  v => v === undefined ? '…' : v === null ? '—' : String(v),
  dec1: v => v === undefined ? '…' : v === null ? '—' : Number(v).toFixed(1),
  str:  v => v === undefined ? '…' : v || '—',
  ct:   v => v === undefined ? '…' : v === null ? '—' : Number(v).toLocaleString(),
};

const COLUMNS = [
  { key: 'name',             label: 'Name',         filterable: false },
  { key: 'score',            label: 'Score',        type: 'number', format: fmt.num },
  { key: 'reviewDesc',       label: 'Reviews',      groupable: true, filterable: true, format: fmt.str },
  { key: 'reviewsTotal',     label: 'Reviews #',    type: 'number', format: fmt.ct },
  { key: 'hltbMain',         label: 'Main (h)',     type: 'number', format: fmt.dec1 },
  { key: 'hltbExtra',        label: '+Extra (h)',   type: 'number', format: fmt.dec1 },
  { key: 'hltbCompletionist',label: '100% (h)',     type: 'number', format: fmt.dec1 },
  { key: 'playtime',         label: 'Played (h)',   type: 'number',
    format: v => v > 0 ? Number(v).toFixed(1) : '—' },
  { key: 'metacritic',       label: 'Metacritic',   type: 'number', format: fmt.num },
  { key: 'releaseDate',      label: 'Released',     filterable: false, format: fmt.str },
  { key: 'genres',           label: 'Genres',       filterable: false, groupable: true, format: fmt.str },
  { key: 'developers',       label: 'Developer',    filterable: false, groupable: true, format: fmt.str },
  { key: 'publishers',       label: 'Publisher',    filterable: false, groupable: true, format: fmt.str },
  { key: 'tags',             label: 'Tags',         filterable: false, format: fmt.str },
  { key: 'categories',       label: 'Categories',   filterable: false, format: fmt.str },
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
let rows        = [];
let rowMap      = new Map();
let total       = 0;
let loaded      = 0;
let flushTimer  = null;

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
    };
  });

  rowMap = new Map(rows.map(r => [r.appid, r]));
  total = rows.length;

  table = createFlexiTable(tableContainer, {
    data: rows,
    columns: COLUMNS,
    rowKey: 'appid',
    defaultPageSize: 50,
    defaultVisibleColumns: DEFAULT_VISIBLE,
  });

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
      row.genres            = event.meta?.genres?.join(', ')     ?? null;
      row.developers        = event.meta?.developers?.join(', ') ?? null;
      row.publishers        = event.meta?.publishers?.join(', ') ?? null;
      row.categories        = event.meta?.categories?.join(', ') ?? null;
      row.tags              = event.tags?.join(', ') ?? null;

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
