'use strict';

// ── State ──────────────────────────────────────────────────────────────────

let games = [];     // flat: { appid, name, groupKey, loading, details }
let groups = [];    // [{ userIndices, games }] — ordered, from server
let slots = [];     // [[{steamid, personaname, profileurl}, ...], ...] — one entry per logical player
let playtime = {};  // { [appid]: { [steamId]: minutes } } — per-account playtime for common games
let lastPlayed = {}; // { [appid]: { [steamId]: unix seconds } } — per-account last-played timestamp
let sortCol = 'score';
let sortDir = -1;
let runId = 0;           // increments on each search to cancel stale updates
let streamController = null; // AbortController for the active detail stream
let refreshDebounceTimer = null;
let activeGame = null;
let randomGroupKey = null;      // groupKey of the active random session, or null (queues themselves live in panel.js)

const RECENTS_KEY = 'comparison:recent-searches'; // see public/accountsBar.js


// Filter state — reset on each new search
const activeFilters = Object.fromEntries(FILTER_DIMS.map(d => [d.key, new Set()]));
const allOpts       = Object.fromEntries(FILTER_DIMS.map(d => [d.key, new Set()]));
const filterSearch  = Object.fromEntries(FILTER_DIMS.map(d => [d.key, '']));
let nameFilter = '';

// ── Init ───────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('add-btn').addEventListener('click', () => addPlayerSlot());
  document.getElementById('search-btn').addEventListener('click', findCommonGames);

  // Per-account refresh (accounts bar) and recent-searches (see public/accountsBar.js,
  // shared with the Library Explorer) — re-run the current search bypassing the cache for
  // just one account, or replaying a remembered slot combo, while keeping the URL, sort,
  // filters, and open panel exactly as they are for the refresh case (not a new search).
  bindAccountRefresh(document.getElementById('accounts-bar'), steamid => {
    findCommonGames({
      pushState: false,
      refreshIds: [steamid],
      restoreFilters: Object.fromEntries(Object.entries(activeFilters).map(([k, s]) => [k, [...s]])),
      restoreSort: { col: sortCol, dir: sortDir },
      restoreNameFilter: nameFilter,
    });
  });

  bindRecentsBar(document.getElementById('recents-bar'), RECENTS_KEY, inputSlots => {
    const container = document.getElementById('user-inputs');
    container.innerHTML = '';
    inputSlots.forEach(accounts => addPlayerSlot(accounts));
    findCommonGames();
  });
  renderRecentsBar(document.getElementById('recents-bar'), RECENTS_KEY);

  document.getElementById('results').addEventListener('click', e => {
    const randomBtn = e.target.closest('.group-random-btn');
    if (randomBtn) { pickRandom(randomBtn.dataset.group); return; }
    const row = e.target.closest('tr.game-row');
    if (!row || e.target.closest('a')) return;
    const appid = Number(row.dataset.appid);
    const game = games.find(g => g.appid === appid);
    if (game) openPanel(game);
  });

  document.getElementById('shortcuts-backdrop').addEventListener('click', closeShortcuts);
  document.querySelector('.shortcuts-close').addEventListener('click', closeShortcuts);

  initPanel({
    inertSelector: '.container',
    enableTagFilters: true,
    getOwnersHtml: buildOwnersHtml,
    isTagActive: (dim, val) => activeFilters[dim].has(val),
    onTagClick: (dim, val) => {
      if (activeFilters[dim].has(val)) activeFilters[dim].delete(val);
      else activeFilters[dim].add(val);
      refreshTable();
      updateFilterUrl();
      renderFilterPanel();
      renderPanel();
    },
    onRefresh: refreshGameDetails,
    // Runs on every close path, not just the Escape-key one below — see the comment on
    // `onClose` in panel.js. Mirrors what the old closePanel() wrapper did, but now also
    // covers the backdrop click / × button / swipe-to-close, which used to leave
    // `activeGame` and `?game=` stale until something else (e.g. a later Escape press)
    // happened to clean them up. `preserveUrl` is set by findCommonGames when it closes the
    // panel only to immediately reopen the same game once a refresh/restore completes —
    // see its own `panelClose({ preserveUrl: true })` call.
    onClose: ({ preserveUrl } = {}) => {
      activeGame = null;
      randomGroupKey = null;
      refreshTable(); // remove active row highlight
      if (!preserveUrl) setPanelParam(null);
    },
  });

  initGameSearch({
    inputEl: document.getElementById('game-lookup-input'),
    resultsEl: document.getElementById('game-lookup-results'),
    onSelect: ({ appid, name }) => openStandaloneGame(appid, name),
  });

  // Shared, un-namespaced across both pages — see gameSearch.js.
  bindRecentGamesBar(document.getElementById('recent-games-bar'), (appid, name) => openStandaloneGame(appid, name));
  renderRecentGamesBar(document.getElementById('recent-games-bar'));

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (isLightboxOpen()) {
        if (document.fullscreenElement || document.webkitFullscreenElement) return; // browser exits FS; keep lightbox open
        closeLightbox();
        return;
      }
      if (document.getElementById('shortcuts-modal').classList.contains('open')) { closeShortcuts(); return; }
      panelClose(); return; // onClose (see initPanel above) handles the URL/state cleanup
    }
    if (e.key === '?') { e.preventDefault(); toggleShortcuts(); return; }
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === '/') {
      e.preventDefault();
      document.querySelector('#user-inputs input[type="text"]')?.focus();
      return;
    }
    if (e.key === 'Enter') {
      const row = document.activeElement?.closest('tr.game-row');
      if (row) {
        const game = games.find(g => g.appid === Number(row.dataset.appid));
        if (game) { openPanel(game); return; }
      }
    }
    if (!activeGame) return;
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !isLightboxOpen()) {
      if (panelStepHero(e.key === 'ArrowRight' ? 1 : -1, { wrap: true })) e.preventDefault();
      return;
    }
    if (activeGame.standalone) return; // no group to page through or randomize within — see renderPanelNav
    if ((e.key === 'r' || e.key === 'R') && !isLightboxOpen()) {
      e.preventDefault();
      pickRandom(activeGame.groupKey);
      return;
    }
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const list = sortedGames(activeGame.groupKey);
    const idx = list.findIndex(g => g.appid === activeGame.appid);
    const next = (idx + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
    const lightboxWasOpen = isLightboxOpen();
    openPanel(list[next]);
    if (lightboxWasOpen) openLightbox(activeGame, 0);
  });

  fetch('/api/health').then(r => r.json()).then(d => {
    if (!d.configured) {
      showAlert(
        'STEAM_API_KEY is not configured. ' +
        'Get one at steamcommunity.com/dev/apikey, then restart: STEAM_API_KEY=yourkey node server.js',
        'warn'
      );
    }
  }).catch(() => {});

  initLightbox({ onParamChange: setLightboxParam });
  loadFromUrl();
});

// Restore state when the user navigates back/forward
window.addEventListener('popstate', loadFromUrl);

function loadFromUrl() {
  // Each u= param is a comma-joined list of accounts for one logical player slot.
  // Old single-account URLs (?u=alice&u=bob) parse naturally as single-member slots.
  const { slots: urlSlots, sort: restoreSort, filters: restoreFilters, nameFilter: restoreNameFilter, shot: restoreShot } = parseUrlState(location.search);
  const container = document.getElementById('user-inputs');
  container.innerHTML = '';
  if (urlSlots.length >= 1 && urlSlots.every(s => s.length > 0)) {
    urlSlots.forEach(accounts => addPlayerSlot(accounts));
    findCommonGames({ pushState: false, restoreFilters, restoreSort, restoreNameFilter, restoreShot });
  } else {
    addPlayerSlot();
    addPlayerSlot();
    games = [];
    slots = [];
    for (const s of Object.values(activeFilters)) s.clear();
    for (const s of Object.values(allOpts)) s.clear();
    for (const k of Object.keys(filterSearch)) filterSearch[k] = '';
    nameFilter = '';
    document.getElementById('filter-panel').innerHTML = '';
    document.getElementById('results').innerHTML = '';
    document.getElementById('how-it-works').hidden = false;
    const accountsBarEl = document.getElementById('accounts-bar');
    accountsBarEl.hidden = true;
    accountsBarEl.innerHTML = '';
    document.title = 'Steam Common Games';
    // No comparison loaded at all — still honor a bare `?game=` standalone-lookup deep
    // link (findCommonGames would otherwise be the only caller of restorePanelFromUrl).
    restorePanelFromUrl(restoreShot);
  }
}

// Sorts members within each slot, then sorts slots by their first member — the
// canonical order used both for building a shareable/reproducible `?u=` URL and for
// deduping recent searches (so "alice+bob vs. charlie" and "bob+alice vs. charlie" are
// treated as the same search).
function normalizedSlots(inputSlots) {
  const cmp = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' });
  return [...inputSlots]
    .map(slot => [...slot].sort(cmp))
    .sort((a, b) => cmp(a[0], b[0]));
}

// ── Player slot input rows ─────────────────────────────────────────────────

function updateSearchBtn() {
  const multi = document.querySelectorAll('.player-slot').length > 1;
  document.getElementById('search-btn').textContent = multi ? 'Find Common Games' : 'Show Library';
}

function addPlayerSlot(accounts = ['']) {
  const container = document.getElementById('user-inputs');
  const slot = document.createElement('div');
  slot.className = 'player-slot';

  const primaryRow = document.createElement('div');
  primaryRow.className = 'user-row';

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Steam username, profile URL, or 64-bit ID';
  input.value = accounts[0] || '';
  input.addEventListener('keydown', e => { if (e.key === 'Enter') findCommonGames(); });

  const addFamilyBtn = document.createElement('button');
  addFamilyBtn.className = 'btn-add-family';
  addFamilyBtn.title = 'Add a Steam Family Sharing account — their library will be merged into this player\'s slot';
  addFamilyBtn.textContent = '+ Steam Family';
  addFamilyBtn.addEventListener('click', () => addFamilyMember(slot));

  const removeSlotBtn = document.createElement('button');
  removeSlotBtn.className = 'btn-remove';
  removeSlotBtn.title = 'Remove player';
  removeSlotBtn.textContent = '×';
  removeSlotBtn.addEventListener('click', () => {
    if (document.querySelectorAll('.player-slot').length > 1) { slot.remove(); updateSearchBtn(); }
  });

  primaryRow.appendChild(input);
  primaryRow.appendChild(addFamilyBtn);
  primaryRow.appendChild(removeSlotBtn);
  slot.appendChild(primaryRow);

  const familyHint = document.createElement('p');
  familyHint.className = 'family-hint';
  familyHint.textContent = 'Their library will be merged into this slot before comparing.';
  slot.appendChild(familyHint);

  for (let i = 1; i < accounts.length; i++) addFamilyMember(slot, accounts[i]);

  container.appendChild(slot);
  updateSearchBtn();
  if (!accounts[0]) input.focus();
}

function addFamilyMember(slot, value = '') {
  const row = document.createElement('div');
  row.className = 'family-row';

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Steam username, profile URL, or 64-bit ID';
  input.value = value;
  input.addEventListener('keydown', e => { if (e.key === 'Enter') findCommonGames(); });

  const rm = document.createElement('button');
  rm.className = 'btn-remove';
  rm.title = 'Remove family member';
  rm.textContent = '−';
  rm.addEventListener('click', () => row.remove());

  row.appendChild(input);
  row.appendChild(rm);
  slot.appendChild(row);
  if (!value) input.focus();
}

function getSlots() {
  return [...document.querySelectorAll('.player-slot')].map(slot =>
    [...slot.querySelectorAll('input')]
      .map(i => normalizeInput(i.value.trim()))
      .filter(Boolean)
  ).filter(s => s.length > 0);
}

// ── Alerts ─────────────────────────────────────────────────────────────────

function clearAlerts() { document.getElementById('alerts').innerHTML = ''; }

function showAlert(msg, type = 'error') {
  const el = document.createElement('div');
  el.className = `alert alert-${type}`;
  el.textContent = msg;
  const box = document.getElementById('alerts');
  box.innerHTML = '';
  box.appendChild(el);
}

// ── Main search flow ───────────────────────────────────────────────────────

async function findCommonGames({ pushState = true, restoreFilters = null, restoreSort = null, restoreNameFilter = '', restoreShot = null, refreshIds = null } = {}) {
  const inputSlots = getSlots();
  if (inputSlots.length < 1) { showAlert('Enter at least 1 Steam user.'); return; }

  clearAlerts();

  if (restoreSort) {
    sortCol = restoreSort.col;
    sortDir = restoreSort.dir;
  }

  const thisRun = ++runId;
  // preserveUrl: this may be a refresh/restore of the same search rather than a brand new
  // one (pushState: false) — restorePanelFromUrl() below re-reads `?game=`/`&shot=` from
  // the URL once the data's back in, so they mustn't be wiped out by closing the panel here.
  panelClose({ preserveUrl: true });
  for (const s of Object.values(activeFilters)) s.clear();
  for (const s of Object.values(allOpts)) s.clear();
  for (const k of Object.keys(filterSearch)) filterSearch[k] = '';
  nameFilter = restoreNameFilter;
  if (restoreFilters) {
    for (const [k, vals] of Object.entries(restoreFilters)) {
      for (const v of vals) activeFilters[k].add(v);
    }
  }
  const accountsBarEl = document.getElementById('accounts-bar');
  accountsBarEl.hidden = true;
  accountsBarEl.innerHTML = '';
  document.getElementById('how-it-works').hidden = true;
  document.getElementById('filter-panel').innerHTML = '';
  document.getElementById('search-btn').disabled = true;
  document.getElementById('results').innerHTML =
    `<div style="padding:16px 0;color:var(--text1)"><span class="spinner"></span>${refreshIds ? 'Refreshing' : 'Fetching'} Steam libraries…</div>`;

  try {
    const res = await fetch('/api/common-games', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slots: inputSlots, refreshIds }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    if (thisRun !== runId) return;
    groups = data.groups || [];
    games = groups.flatMap(g => {
      const key = g.userIndices.join(',');
      return g.games.map(game => ({ ...game, groupKey: key, loading: true, details: null }));
    });
    slots = data.slots || [];
    playtime = data.playtime || {};
    lastPlayed = data.lastPlayed || {};

    // Written from the server-resolved `steamid`s, not the raw typed/normalized input — a
    // vanity name (or an account whose vanity name changes later) always canonicalizes to the
    // same shareable URL and recent-search entry, rather than one keyed on whatever string
    // happened to be typed this time. Deliberately deferred until the fetch actually resolves
    // them, rather than optimistically written with the typed input before the round-trip —
    // simpler (one write, not a write-then-correct pair), at the cost of the URL/recents not
    // reflecting a search that's still in flight or that failed outright.
    const idSlots = normalizedSlots(slots.map(group => group.map(p => p.steamid)));

    if (pushState) {
      const params = new URLSearchParams();
      idSlots.forEach(slot => params.append('u', slot.join(',')));
      params.set('sort', (sortDir < 0 ? '-' : '') + sortCol);
      history.pushState(null, '', `?${params}`);
    }

    renderPage();
    // One labelled, boxed cluster of chips per slot (see the .slot-accounts border in
    // style.css) — "Player N" is only useful once there's more than one slot to tell apart
    // (a single-slot search is just "the library"), but the "· N accounts merged" suffix is
    // shown whenever a slot itself unions more than one account, on a single-slot search
    // too — otherwise a Steam Family search (several accounts, one slot) and a plain
    // multi-player comparison (one account per slot) render as the same flat row of chips
    // and there's no way to tell "merged into one library" from "compared side by side".
    renderAccountChipsGrouped(accountsBarEl, slots.map((players, i) => {
      const parts = [];
      if (slots.length > 1) parts.push(`Player ${i + 1}`);
      if (players.length > 1) parts.push(`${players.length} accounts merged`);
      return { label: parts.length ? parts.join(' · ') : null, players };
    }), 'games');
    addRecent(RECENTS_KEY, idSlots.map(s => s.join(',')).join('|'), slots, idSlots);
    renderRecentsBar(document.getElementById('recents-bar'), RECENTS_KEY);
    restorePanelFromUrl(restoreShot);
    await loadAllDetails(thisRun);
    if (thisRun === runId) { refreshTable(); restorePanelFromUrl(restoreShot); }
  } catch (err) {
    if (thisRun !== runId) return;
    showAlert(err.message);
    document.getElementById('results').innerHTML = '';
  } finally {
    document.getElementById('search-btn').disabled = false;
  }
}

// Forces a fresh rating/HLTB/store-metadata/tags fetch for one game, bypassing its
// cache TTL — used by the side panel's "↻ Refresh" button (panel.js's onRefresh).
async function refreshGameDetails(game) {
  try {
    const res = await fetch(`/api/game-details/${game.appid}?refresh=1`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Refresh failed');
    game.details = { rating: data.rating, hltb: data.hltb, meta: data.meta, tags: data.tags, protondb: data.protondb };
    // Standalone lookups (see openStandaloneGame) aren't part of the loaded comparison table —
    // feeding their tags/genres/categories into the table's filter option pool would make the
    // filter card spuriously appear (or gain new options) with no comparison ever having run.
    if (!game.standalone && (game.details.meta || game.details.tags)) updateFilterOptions(game.details.meta, game.details.tags);
    const tr = document.querySelector(`tr.game-row[data-appid="${game.appid}"]`);
    if (tr) syncRow(tr, game);
    refreshTable();
  } catch (err) {
    showAlert(err.message);
  }
}

// ── Progressive detail loading ─────────────────────────────────────────────

async function loadAllDetails(thisRun) {
  if (!games.length) return;

  streamController?.abort();
  const controller = new AbortController();
  streamController = controller;

  updateProgress(0, games.length);
  let loaded = 0;

  const idxByAppid = new Map(games.map((g, i) => [g.appid, i]));

  let res;
  try {
    res = await fetch('/api/game-details/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ games: games.map(g => ({ appid: g.appid })) }),
      signal: controller.signal,
    });
  } catch {
    return; // aborted or network error
  }

  if (!res.ok) return;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      if (thisRun !== runId) { reader.cancel(); return; }
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split('\n\n');
      buffer = chunks.pop(); // keep any incomplete trailing chunk

      for (const chunk of chunks) {
        if (!chunk.startsWith('data: ')) continue;
        let data;
        try { data = JSON.parse(chunk.slice(6)); } catch { continue; }

        if (data.done) return;
        if (thisRun !== runId) { reader.cancel(); return; }

        const idx = idxByAppid.get(data.appid);
        if (idx === undefined) continue;

        games[idx].details = { rating: data.rating, hltb: data.hltb, meta: data.meta, tags: data.tags, protondb: data.protondb };
        games[idx].loading = false;
        loaded++;
        updateProgress(loaded, games.length);
        if (games[idx].details?.meta || games[idx].details?.tags) updateFilterOptions(games[idx].details.meta, games[idx].details.tags);
        if (activeGame?.appid === games[idx].appid) renderPanel();
        const tr = document.querySelector(`tr.game-row[data-appid="${data.appid}"]`);
        if (tr) syncRow(tr, games[idx]);
        clearTimeout(refreshDebounceTimer);
        refreshDebounceTimer = setTimeout(refreshTable, 150);
      }
    }
  } catch {
    // stream ended or aborted
  }
}

// ── Rendering ──────────────────────────────────────────────────────────────

function slotDisplayName(i) {
  return (slots[i] || []).map((p, j) => p.personaname || `Player ${i + 1}.${j + 1}`).join(' + ');
}

function slotHtml(i) {
  return (slots[i] || []).map((p, j) => {
    const name = esc(p.personaname || `Player ${i + 1}.${j + 1}`);
    const safeUrl = /^https?:\/\//i.test(p.profileurl) ? p.profileurl : '';
    return safeUrl
      ? `<a href="${esc(safeUrl)}" target="_blank" rel="noopener" class="slot-link">${name}</a>`
      : name;
  }).join(' + ');
}

function groupSlotsHtml(slotIndices) {
  return [...slotIndices]
    .sort((a, b) => slotDisplayName(a).toLowerCase().localeCompare(slotDisplayName(b).toLowerCase()))
    .map(i => slotHtml(i))
    .join(', ');
}

function renderPage() {
  const sortedSlotIndices = [...slots.keys()].sort((a, b) =>
    slotDisplayName(a).toLowerCase().localeCompare(slotDisplayName(b).toLowerCase())
  );
  const playerList = sortedSlotIndices.map(i => slotHtml(i)).join(', ');

  if (slots.length) {
    document.title = sortedSlotIndices.map(i => slotDisplayName(i)).join(', ') + ' — Steam Common Games';
  }

  const groupSections = groups.map(group => {
    const key = group.userIndices.join(',');
    const usersHtml = groupSlotsHtml(group.userIndices);
    const count = group.games.length;
    return `
      <div class="game-group" id="group-${key}">
        <div class="group-header">
          <span class="group-title">${usersHtml}</span>
          <span class="group-meta">${count} game${count !== 1 ? 's' : ''}</span>
          <button type="button" class="group-random-btn" data-group="${key}" aria-label="Pick a random game from this group" title="Pick a random game">🎲</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr>
              <th class="td-thumb"></th>
              ${thHtml('name', 'Game')}
              ${thHtml('score', 'Score')}
              ${thHtml('main', 'Main Story')}
              ${thHtml('extra', 'Main + Extra')}
            </tr></thead>
            <tbody id="tbody-${key}">
              ${sortedGames(key).map(rowHtml).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  }).join('');

  document.getElementById('results').innerHTML = `
    <div class="results-header">
      <h2 id="results-count">${games.length} ${slots.length === 1 ? 'games' : 'shared games'}</h2>
      ${playerList ? `<div class="results-meta">${slots.length === 1 ? 'library of' : 'across'} ${playerList}</div>` : ''}
    </div>
    <div class="progress-wrap">
      <div class="progress-text" id="prog-text">Loading details… 0 / ${games.length}</div>
      <div class="progress-bar-bg"><div class="progress-bar" id="prog-bar" style="width:0%"></div></div>
    </div>
    ${groupSections}`;

  document.querySelectorAll('thead th[data-col]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (sortCol === col) sortDir = -sortDir;
      else { sortCol = col; sortDir = col === 'name' ? 1 : -1; }
      refreshTable();
      updateFilterUrl();
    });
  });
}

function thHtml(col, label) {
  const active = sortCol === col ? ' active' : '';
  const icon = sortCol === col ? (sortDir > 0 ? '↑' : '↓') : '↕';
  return `<th class="sortable${active}" data-col="${col}">
    <div class="th-inner">${label}<span class="sort-icon">${icon}</span></div>
  </th>`;
}

function rowHtml(game) {
  return `<tr class="game-row" tabindex="0" data-appid="${game.appid}">${rowCells(game)}</tr>`;
}

function updateProgress(loaded, total) {
  const bar = document.getElementById('prog-bar');
  const txt = document.getElementById('prog-text');
  if (!bar || !txt) return;
  const pct = total ? Math.round((loaded / total) * 100) : 0;
  bar.style.width = `${pct}%`;
  if (loaded >= total) {
    txt.textContent = `All ${total} details loaded`;
    bar.style.background = '#a3cf4e';
  } else {
    txt.textContent = `Loading details… ${loaded} / ${total}`;
  }
}

// ── Side panel ─────────────────────────────────────────────────────────────
// Rendering/hero/swipe logic lives in the shared panel.js; these wrappers add
// the group-navigation, random-pick, table-highlight, and URL-state behavior
// that's specific to this page.

// Opens the panel for a game from the "look up any game" search box (public/gameSearch.js)
// rather than from a table row — it has no `groupKey` (nobody in this comparison necessarily
// owns it), which the rest of this section treats as "not part of any group": no owners
// section, no group nav/random-pick, no table row to highlight. `name` is known client-side
// (picked from the search dropdown) and used only to avoid a title flash while the panel's own
// fetch is in flight — it's never sent to the server; the server always resolves the real name
// itself from store metadata, keyed on the appid, same as it does for a nameless wishlist row.
// If the appid is actually part of the current comparison, open its real row instead — full
// owners/nav/highlight rather than a lesser standalone view of data already in `games`.
function openStandaloneGame(appid, name) {
  const existing = games.find(g => g.appid === appid);
  if (existing) {
    openPanel(existing);
    addRecentGame(existing.appid, existing.name, existing.details?.meta?.capsule || null);
    renderRecentGamesBar(document.getElementById('recent-games-bar'));
    return;
  }
  const game = { appid, name: name || `App ${appid}`, loading: true, details: null, standalone: true };
  openPanel(game);
  fetchStandaloneDetails(game);
}

async function fetchStandaloneDetails(game) {
  try {
    const res = await fetch(`/api/game-details/${game.appid}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lookup failed');
    game.details = { rating: data.rating, hltb: data.hltb, meta: data.meta, tags: data.tags, protondb: data.protondb };
    game.loading = false;
    if (game.details.meta?.name) game.name = game.details.meta.name;
    if (activeGame === game) renderPanelBody(game); // no-op if the user moved on mid-fetch
    addRecentGame(game.appid, game.name, game.details.meta?.capsule || null);
    renderRecentGamesBar(document.getElementById('recent-games-bar'));
  } catch (err) {
    if (activeGame === game) showAlert(err.message);
  }
}

function buildOwnersHtml(g) {
  if (!g.groupKey) return ''; // standalone lookup — not part of any comparison group
  const ownerIndices = g.groupKey.split(',').map(Number);
  const gamePt = playtime[g.appid] || {};
  const gameLp = lastPlayed[g.appid] || {};
  const owners = ownerIndices.flatMap(slotIdx =>
    (slots[slotIdx] || []).filter(p => p.steamid in gamePt).map(p => ({
      name: p.personaname || '?',
      minutes: gamePt[p.steamid] || 0,
      lastPlayedSec: gameLp[p.steamid] || 0,
    }))
  );
  if (!owners.length) return '';
  // Most recently played first — ties into the Last Played feature itself; someone who's
  // never launched it (lastPlayedSec 0) sorts last, alphabetically among themselves so the
  // order stays deterministic rather than depending on slot iteration order.
  owners.sort((a, b) => b.lastPlayedSec - a.lastPlayedSec || a.name.localeCompare(b.name));
  const maxMinutes = Math.max(...owners.map(o => o.minutes), 1);
  return `<div class="panel-section">
    <div class="panel-section-title">Owned by <span class="panel-section-subtitle">most recently played first</span></div>
    <div class="panel-owners">${owners.map(o => {
      const lp = fmtLastPlayed(o.lastPlayedSec);
      const pt = fmtPlaytime(o.minutes);
      // Playtime also gets a meter (single hue, width proportional to the max among these
      // owners) — a secondary cue for relative investment, never the only signal: the
      // number itself stays the primary, always-visible value.
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

function pickRandom(groupKey) {
  const pick = pickRandomFrom(sortedGames(groupKey), groupKey, activeGame?.appid);
  if (!pick) return;
  randomGroupKey = groupKey;
  openPanel(pick, { isRandom: true });
}

function openPanel(game, { isRandom = false } = {}) {
  if (!isRandom) {
    randomGroupKey = null;
    clearAllRandomQueues();
  }
  activeGame = game;
  panelOpen(game); // shared: renders hero+body, opens the panel, focuses it
  renderPanelNav();
  refreshTable(); // re-render rows so the active highlight appears
  document.getElementById(`tbody-${game.groupKey}`)?.querySelector(`tr.game-row[data-appid="${game.appid}"]`)?.scrollIntoView({ block: 'nearest' });
  // Standalone lookups are restorable too (see restorePanelFromUrl's fallback to
  // openStandaloneGame below), so `?game=` is set unconditionally.
  setPanelParam(game.appid);
}


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

function setPanelParam(appid) {
  const params = new URLSearchParams(location.search);
  params.delete('shot');
  if (appid == null) {
    params.delete('game');
  } else {
    params.set('game', appid);
  }
  history.replaceState(null, '', `?${params}`);
}

function setLightboxParam(idx) {
  const params = new URLSearchParams(location.search);
  if (idx == null) {
    params.delete('shot');
  } else {
    params.set('shot', idx);
  }
  history.replaceState(null, '', `?${params}`);
}

function restorePanelFromUrl(restoreShot = null) {
  const params = new URLSearchParams(location.search);
  const appid = Number(params.get('game'));
  if (!appid) return;
  const game = games.find(g => g.appid === appid);
  if (game) {
    if (activeGame?.appid !== appid) openPanel(game);
    const shotParam = restoreShot ?? params.get('shot');
    if (shotParam !== null && !game.loading) openLightbox(game, shotParam);
    return;
  }
  // Not (yet) part of the loaded comparison — e.g. a game nobody in it owns, or no
  // comparison loaded at all. Fetch it directly instead of silently giving up, same as
  // library.js's equivalent fallback — its name isn't known yet (see openStandaloneGame),
  // so the panel opens with a placeholder title until the fetch resolves it.
  if (activeGame?.appid === appid) return; // already open / fetch already in flight
  openStandaloneGame(appid);
}

function renderPanelNav() {
  const nav = document.getElementById('panel-nav');
  if (!nav || !activeGame) return;
  // A standalone lookup (see openStandaloneGame above) isn't part of any group — there's no
  // natural "next game" to page through, so there's no nav to show.
  if (activeGame.standalone) { nav.innerHTML = ''; return; }
  const list = sortedGames(activeGame.groupKey);
  const idx = list.findIndex(g => g.appid === activeGame.appid);
  nav.innerHTML = `
    <button class="panel-nav-btn" id="panel-prev" aria-label="Previous game" title="Previous game (↑)">↑</button>
    <span class="panel-nav-pos" aria-live="polite">${idx + 1} / ${list.length}</span>
    <button class="panel-nav-btn" id="panel-next" aria-label="Next game" title="Next game (↓)">↓</button>
    <button class="panel-nav-btn panel-nav-reroll" id="panel-reroll" aria-label="Pick a random game" title="Pick a random game (R)">🎲<span class="panel-nav-kbd">R</span></button>
  `;
  document.getElementById('panel-prev').addEventListener('click', () => {
    openPanel(list[(idx - 1 + list.length) % list.length]);
  });
  document.getElementById('panel-next').addEventListener('click', () => {
    openPanel(list[(idx + 1) % list.length]);
  });
  document.getElementById('panel-reroll').addEventListener('click', () => {
    pickRandom(activeGame.groupKey);
  });
}

function renderPanel() {
  if (!activeGame) return;
  renderPanelNav();
  renderPanelBody(activeGame); // shared: rebuilds hero + body from panel.js
}

function refreshTable() {
  document.querySelectorAll('thead th[data-col]').forEach(th => {
    const col = th.dataset.col;
    const active = col === sortCol;
    th.classList.toggle('active', active);
    const icon = th.querySelector('.sort-icon');
    if (icon) icon.textContent = active ? (sortDir > 0 ? '↑' : '↓') : '↕';
  });
  const filtersActive = hasActiveFilters();
  for (const group of groups) {
    const key = group.userIndices.join(',');
    const tbody = document.getElementById(`tbody-${key}`);
    if (!tbody) continue;
    reconcileTbody(tbody, sortedGames(key, filtersActive));
    const groupEl = document.getElementById(`group-${key}`);
    if (groupEl) groupEl.style.display = tbody.childElementCount === 0 ? 'none' : '';
  }

  const countEl = document.getElementById('results-count');
  if (countEl) {
    const filtered = filtersActive ? games.filter(g => gameMatchesFilters(g, filtersActive)).length : games.length;
    const gameLabel = slots.length === 1 ? 'games' : 'shared games';
    countEl.textContent = filtersActive
      ? `${filtered} / ${games.length} ${gameLabel}`
      : `${games.length} ${gameLabel}`;
  }
  if (activeGame) renderPanelNav();
}

// Reconcile a tbody's rows against a desired ordered game list.
// Reuses existing <tr> nodes (moves/updates them) rather than replacing innerHTML,
// so in-flight click events always target a live DOM node.
function reconcileTbody(tbody, desired) {
  // Index existing rows by appid for O(1) lookup.
  const existing = new Map();
  for (const tr of tbody.querySelectorAll('tr.game-row')) {
    existing.set(Number(tr.dataset.appid), tr);
  }

  // Insert/move rows into the correct order.
  for (let i = 0; i < desired.length; i++) {
    const game = desired[i];
    let tr = existing.get(game.appid);
    if (!tr) {
      tr = document.createElement('tr');
      tr.className = 'game-row';
      tr.dataset.appid = game.appid;
    }
    syncRow(tr, game); // always sync content and active state
    // Move to the correct position if needed (insertBefore is a no-op when the
    // node is already in the right place in the same parent).
    const current = tbody.children[i];
    if (current !== tr) tbody.insertBefore(tr, current ?? null);
    existing.delete(game.appid);
  }

  // Remove rows that are no longer in the desired list.
  for (const tr of existing.values()) tr.remove();
}

// Render the five <td> cells for a new <tr> (active class is set by syncRow).
function rowCells(game) {
  const thumb = game.details?.meta?.capsule ?? '';
  return `<td class="td-thumb"><img class="game-thumb" src="${esc(thumb)}" alt="" loading="lazy" width="120" height="45" onerror="this.style.visibility='hidden'"></td>
    <td class="td-name">${esc(game.name)}</td>
    <td class="td-score">${renderScoreCell(game)}</td>
    <td class="td-hltb">${renderMainCell(game)}</td>
    <td class="td-hltb">${renderExtraCell(game)}</td>`;
}

// Update an existing <tr>'s cells and active state in place.
function syncRow(tr, game) {
  tr.classList.toggle('active', activeGame?.appid === game.appid);
  const cells = tr.cells;
  if (!cells.length) { tr.innerHTML = rowCells(game); return; }

  const capsule = game.details?.meta?.capsule;
  if (capsule) { const img = cells[0].querySelector('img'); if (img && img.src !== capsule) { img.src = capsule; img.style.visibility = ''; } }
  cells[1].innerHTML = esc(game.name);
  cells[2].innerHTML = renderScoreCell(game);
  cells[3].innerHTML = renderMainCell(game);
  cells[4].innerHTML = renderExtraCell(game);
}

// ── Sorting ────────────────────────────────────────────────────────────────

function sortedGames(groupKey, filtersActive = hasActiveFilters()) {
  const subset = (groupKey != null ? games.filter(g => g.groupKey === groupKey) : games)
    .filter(g => gameMatchesFilters(g, filtersActive));
  return [...subset].sort((a, b) => {
    switch (sortCol) {
      case 'score': {
        const av = a.details?.rating?.score ?? -1;
        const bv = b.details?.rating?.score ?? -1;
        return sortDir * (av - bv);
      }
      case 'main': {
        const av = a.details?.hltb?.main ?? Infinity;
        const bv = b.details?.hltb?.main ?? Infinity;
        return sortDir * (av - bv);
      }
      case 'extra': {
        const av = a.details?.hltb?.extra ?? Infinity;
        const bv = b.details?.hltb?.extra ?? Infinity;
        return sortDir * (av - bv);
      }
      default:
        return sortDir * a.name.localeCompare(b.name);
    }
  });
}

// ── Filtering ──────────────────────────────────────────────────────────────

function updateFilterUrl() {
  const cmp = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' });
  const params = new URLSearchParams();
  // Preserve current player slots as-is — already canonical from the last pushState
  const prev = new URLSearchParams(location.search);
  prev.getAll('u').forEach(u => params.append('u', u));
  params.set('sort', (sortDir < 0 ? '-' : '') + sortCol);
  if (prev.has('game')) params.set('game', prev.get('game'));
  if (nameFilter) params.set('name', nameFilter);
  // Append filter values in fixed dimension order, each sorted alphabetically
  for (const { key, param } of FILTER_DIMS) {
    [...activeFilters[key]].sort(cmp).forEach(v => params.append(param, v));
  }
  history.replaceState(null, '', `?${params}`);
}

function hasActiveFilters() {
  return nameFilter !== '' || FILTER_DIMS.some(d => activeFilters[d.key].size > 0);
}

function gameMatchesFilters(game, filtersActive = hasActiveFilters()) {
  if (!filtersActive) return true;
  if (nameFilter && !foldStr(game.name).includes(foldStr(nameFilter))) return false;
  if (!FILTER_DIMS.some(d => activeFilters[d.key].size > 0)) return true;
  if (game.loading) return false;
  return FILTER_DIMS.every(({ key }) => {
    if (!activeFilters[key].size) return true;
    const vals = key === 'tags' ? game.details?.tags : game.details?.meta?.[key];
    if (!vals) return false;
    return vals.some(v => activeFilters[key].has(v));
  });
}

function updateFilterOptions(meta, tags) {
  const KEYS = FILTER_DIMS.map(d => d.key);
  const newByKey = Object.fromEntries(KEYS.map(k => [k, []]));
  for (const key of KEYS) {
    const vals = key === 'tags' ? (tags || []) : (meta?.[key] || []);
    for (const v of vals) {
      if (!allOpts[key].has(v)) { allOpts[key].add(v); newByKey[key].push(v); }
    }
  }
  if (KEYS.every(k => !newByKey[k].length)) return;

  const panelEl = document.getElementById('filter-panel');
  const needsNewDim = KEYS.some(k =>
    newByKey[k].length > 0 && !panelEl.querySelector(`input[data-search-dim="${k}"]`)
  );

  if (needsNewDim || !panelEl.querySelector('.card')) {
    // Full rebuild needed — preserve focus in search inputs
    const focused = document.activeElement;
    const focusedDim = focused?.dataset?.searchDim;
    const selStart = focused?.selectionStart;
    const selEnd = focused?.selectionEnd;
    renderFilterPanel();
    if (focusedDim) {
      const el = panelEl.querySelector(`input[data-search-dim="${focusedDim}"]`);
      if (el) { el.focus(); try { el.setSelectionRange(selStart, selEnd); } catch {} }
    }
    return;
  }

  // Surgical: append new options into existing dimension containers
  for (const key of KEYS) {
    if (!newByKey[key].length) continue;
    const optsContainer = panelEl
      .querySelector(`input[data-search-dim="${key}"]`)
      ?.closest('.filter-dim')
      ?.querySelector('.filter-opts');
    if (!optsContainer) continue;

    for (const v of newByKey[key]) {
      const label = document.createElement('label');
      label.className = 'filter-opt';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.dataset.dim = key;
      cb.value = v;
      label.appendChild(cb);
      label.appendChild(document.createTextNode(' ' + v));

      if (filterSearch[key] && !foldStr(v).includes(foldStr(filterSearch[key]))) {
        label.style.display = 'none';
      }

      // Insert in sorted position
      const existing = [...optsContainer.querySelectorAll('.filter-opt')];
      const after = existing.find(el => (el.querySelector('input')?.value ?? '').localeCompare(v) > 0);
      if (after) optsContainer.insertBefore(label, after);
      else optsContainer.appendChild(label);

      cb.addEventListener('change', () => {
        if (cb.checked) activeFilters[key].add(v);
        else activeFilters[key].delete(v);
        refreshTable();
        updateFilterUrl();
        renderFilterPanel();
      });
    }
  }
}

function applySearch(dim, query) {
  const q = foldStr(query);
  const inp = document.querySelector(`input[data-search-dim="${dim}"]`);
  if (!inp) return;
  inp.closest('.filter-dim').querySelectorAll('.filter-opt').forEach(label => {
    const val = label.querySelector('input')?.value ?? '';
    label.style.display = !q || foldStr(val).includes(q) ? '' : 'none';
  });
}

function renderFilterPanel() {
  const activeDims = FILTER_DIMS.filter(d => allOpts[d.key].size > 0);
  if (!activeDims.length) return;

  const totalActive = FILTER_DIMS.reduce((n, d) => n + activeFilters[d.key].size, 0) + (nameFilter ? 1 : 0);

  const chips = FILTER_DIMS.flatMap(d =>
    [...activeFilters[d.key]].sort().map(v => `
      <span class="filter-chip" data-chip-dim="${d.key}" data-chip-val="${esc(v)}">
        <span class="filter-chip-label">${esc(d.label)}: ${esc(v)}</span>
        <span class="filter-chip-x">×</span>
      </span>`)
  ).join('');

  document.getElementById('filter-panel').innerHTML = `
    <div class="card">
      <div class="filter-header">
        <h2>Filter${totalActive ? `<span class="filter-badge">${totalActive}</span>` : ''}</h2>
        ${totalActive ? '<button class="btn btn-ghost btn-sm" id="clear-filters-btn">Clear all</button>' : ''}
      </div>
      ${chips ? `<div class="filter-chips">${chips}</div>` : ''}
      <div class="filter-name-row">
        <input class="filter-search filter-name-input" type="search" id="name-filter-input" placeholder="Search by name…" value="${esc(nameFilter)}">
      </div>
      <div class="filter-dims">
        ${activeDims.map(d => `
          <div class="filter-dim">
            <div class="filter-dim-title">${d.label}</div>
            <input class="filter-search" type="search" placeholder="Search…" data-search-dim="${d.key}" value="${esc(filterSearch[d.key])}">
            <div class="filter-opts">
              ${[...allOpts[d.key]].sort().map(v => `
                <label class="filter-opt">
                  <input type="checkbox" data-dim="${d.key}" value="${esc(v)}"${activeFilters[d.key].has(v) ? ' checked' : ''}>
                  ${esc(v)}
                </label>
              `).join('')}
            </div>
          </div>`).join('')}
      </div>
    </div>`;

  const nameInput = document.getElementById('name-filter-input');
  if (nameInput) {
    nameInput.addEventListener('input', () => {
      nameFilter = nameInput.value;
      refreshTable();
      updateFilterUrl();
    });
  }

  document.getElementById('filter-panel').querySelectorAll('input[data-dim]').forEach(cb => {
    cb.addEventListener('change', () => {
      const dim = cb.dataset.dim;
      if (cb.checked) activeFilters[dim].add(cb.value);
      else activeFilters[dim].delete(cb.value);
      refreshTable();
      updateFilterUrl();
      renderFilterPanel();
    });
  });

  document.getElementById('filter-panel').querySelectorAll('input[data-search-dim]').forEach(inp => {
    const dim = inp.dataset.searchDim;
    applySearch(dim, filterSearch[dim]);
    inp.addEventListener('input', () => {
      filterSearch[dim] = inp.value;
      applySearch(dim, inp.value);
    });
  });

  document.getElementById('filter-panel').querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      activeFilters[chip.dataset.chipDim].delete(chip.dataset.chipVal);
      refreshTable();
      updateFilterUrl();
      renderFilterPanel();
    });
  });

  const clearBtn = document.getElementById('clear-filters-btn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      for (const s of Object.values(activeFilters)) s.clear();
      nameFilter = '';
      refreshTable();
      updateFilterUrl();
      renderFilterPanel();
    });
  }
}
