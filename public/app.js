'use strict';

// ── State ──────────────────────────────────────────────────────────────────

let games = [];     // flat: { appid, name, groupKey, loading, details }
let groups = [];    // [{ userIndices, games }] — ordered, from server
let slots = [];     // [[{steamid, personaname, profileurl}, ...], ...] — one entry per logical player
let playtime = {};  // { [appid]: { [steamId]: minutes } } — per-account playtime for common games
let sortCol = 'score';
let sortDir = -1;
let runId = 0;           // increments on each search to cancel stale updates
let streamController = null; // AbortController for the active detail stream
let refreshDebounceTimer = null;
let panelGame = null;
let heroIdx = 0;          // current carousel position in the panel hero
let lightboxShots = [];   // screenshots array for the currently open lightbox
let lightboxIdx   = 0;

const FILTER_DIMS = [
  { key: 'tags',       label: 'Tag',       param: 'tag'   },
  { key: 'genres',     label: 'Genre',     param: 'genre' },
  { key: 'categories', label: 'Category',  param: 'cat'   },
  { key: 'developers', label: 'Developer', param: 'dev'   },
  { key: 'publishers', label: 'Publisher', param: 'pub'   },
];

// Filter state — reset on each new search
const activeFilters = Object.fromEntries(FILTER_DIMS.map(d => [d.key, new Set()]));
const allOpts       = Object.fromEntries(FILTER_DIMS.map(d => [d.key, new Set()]));
const filterSearch  = Object.fromEntries(FILTER_DIMS.map(d => [d.key, '']));
let nameFilter = '';

// ── Init ───────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('add-btn').addEventListener('click', () => addPlayerSlot());
  document.getElementById('search-btn').addEventListener('click', findCommonGames);

  document.getElementById('results').addEventListener('click', e => {
    const row = e.target.closest('tr.game-row');
    if (!row || e.target.closest('a')) return;
    const appid = Number(row.dataset.appid);
    const game = games.find(g => g.appid === appid);
    if (game) openPanel(game);
  });

  document.getElementById('panel-backdrop').addEventListener('click', closePanel);
  document.getElementById('panel-close').addEventListener('click', closePanel);
  document.getElementById('panel-hero').addEventListener('click', e => {
    if (e.target.closest('.panel-hero-prev')) { heroIdx = Math.max(0, heroIdx - 1); renderPanelHero(); return; }
    if (e.target.closest('.panel-hero-next')) { heroIdx++; renderPanelHero(); return; }
    const dot = e.target.closest('.panel-hero-dot');
    if (dot) { heroIdx = [...dot.parentElement.children].indexOf(dot); renderPanelHero(); return; }
    if (e.target.closest('.panel-hero-img') && heroIdx > 0) openLightbox(heroIdx - 1);
  });

  document.getElementById('game-panel').addEventListener('click', e => {
    const btn = e.target.closest('.panel-tag-btn');
    if (!btn) return;
    const { dim, val } = btn.dataset;
    if (activeFilters[dim].has(val)) activeFilters[dim].delete(val);
    else activeFilters[dim].add(val);
    refreshTable();
    updateFilterUrl();
    renderFilterPanel();
    renderPanel();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { if (lightboxShots.length) { closeLightbox(); return; } closePanel(); return; }
    if (!panelGame || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    e.preventDefault();
    const list = sortedGames(panelGame.groupKey);
    const idx = list.findIndex(g => g.appid === panelGame.appid);
    const next = e.key === 'ArrowDown' ? idx + 1 : idx - 1;
    if (next >= 0 && next < list.length) openPanel(list[next]);
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

  initPanelSwipe();
  loadFromUrl();
});

// Restore state when the user navigates back/forward
window.addEventListener('popstate', loadFromUrl);

function loadFromUrl() {
  // Each u= param is a comma-joined list of accounts for one logical player slot.
  // Old single-account URLs (?u=alice&u=bob) parse naturally as single-member slots.
  const params = new URLSearchParams(location.search);
  const urlSlots = params.getAll('u')
    .map(s => s.split(',').map(v => v.trim()).filter(Boolean));
  const container = document.getElementById('user-inputs');
  container.innerHTML = '';
  if (urlSlots.length >= 1 && urlSlots.every(s => s.length > 0)) {
    urlSlots.forEach(accounts => addPlayerSlot(accounts));
    const restoreFilters = Object.fromEntries(
      FILTER_DIMS.map(d => [d.key, params.getAll(d.param)])
    );
    const sortParam = params.get('sort');
    const restoreSort = sortParam ? {
      col: sortParam.startsWith('-') ? sortParam.slice(1) : sortParam,
      dir: sortParam.startsWith('-') ? -1 : 1,
    } : null;
    const restoreNameFilter = params.get('name') ?? '';
    findCommonGames({ pushState: false, restoreFilters, restoreSort, restoreNameFilter });
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
    document.title = 'Steam Common Games';
  }
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

async function findCommonGames({ pushState = true, restoreFilters = null, restoreSort = null, restoreNameFilter = '' } = {}) {
  const inputSlots = getSlots();
  if (inputSlots.length < 1) { showAlert('Enter at least 1 Steam user.'); return; }

  clearAlerts();

  if (restoreSort) {
    sortCol = restoreSort.col;
    sortDir = restoreSort.dir;
  }

  if (pushState) {
    const params = new URLSearchParams();
    const cmp = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' });
    [...inputSlots]
      .map(slot => [...slot].sort(cmp))           // sort members within each slot
      .sort((a, b) => cmp(a[0], b[0]))            // sort slots by their first member
      .forEach(slot => params.append('u', slot.join(',')));
    params.set('sort', (sortDir < 0 ? '-' : '') + sortCol);
    history.pushState(null, '', `?${params}`);
  }

  const thisRun = ++runId;
  closePanel();
  for (const s of Object.values(activeFilters)) s.clear();
  for (const s of Object.values(allOpts)) s.clear();
  for (const k of Object.keys(filterSearch)) filterSearch[k] = '';
  nameFilter = restoreNameFilter;
  if (restoreFilters) {
    for (const [k, vals] of Object.entries(restoreFilters)) {
      for (const v of vals) activeFilters[k].add(v);
    }
  }
  document.getElementById('how-it-works').hidden = true;
  document.getElementById('filter-panel').innerHTML = '';
  document.getElementById('search-btn').disabled = true;
  document.getElementById('results').innerHTML =
    '<div style="padding:16px 0;color:var(--text1)"><span class="spinner"></span>Fetching Steam libraries…</div>';

  try {
    const res = await fetch('/api/common-games', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slots: inputSlots }),
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

    renderPage();
    restorePanelFromUrl();
    await loadAllDetails(thisRun);
    if (thisRun === runId) { refreshTable(); restorePanelFromUrl(); }
  } catch (err) {
    if (thisRun !== runId) return;
    showAlert(err.message);
    document.getElementById('results').innerHTML = '';
  } finally {
    document.getElementById('search-btn').disabled = false;
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
      body: JSON.stringify({ games: games.map(g => ({ appid: g.appid, name: g.name })) }),
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

        games[idx].details = { rating: data.rating, hltb: data.hltb, meta: data.meta, tags: data.tags };
        games[idx].loading = false;
        loaded++;
        updateProgress(loaded, games.length);
        if (games[idx].details?.meta || games[idx].details?.tags) updateFilterOptions(games[idx].details.meta, games[idx].details.tags);
        if (panelGame?.appid === games[idx].appid) renderPanel();
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
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr>
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
  return `<tr class="game-row" data-appid="${game.appid}">${rowCells(game)}</tr>`;
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

// ── Screenshot lightbox ────────────────────────────────────────────────────

function getLightbox() {
  let lb = document.getElementById('screenshot-lightbox');
  if (lb) return lb;
  lb = document.createElement('div');
  lb.id = 'screenshot-lightbox';
  lb.innerHTML = `
    <div class="lb-backdrop"></div>
    <button class="lb-btn lb-prev" aria-label="Previous screenshot">&#8249;</button>
    <img class="lb-img" src="" alt="Screenshot">
    <button class="lb-btn lb-next" aria-label="Next screenshot">&#8250;</button>
    <button class="lb-close" aria-label="Close lightbox">&#215;</button>
    <div class="lb-counter"></div>`;
  document.body.appendChild(lb);
  lb.querySelector('.lb-backdrop').addEventListener('click', closeLightbox);
  lb.querySelector('.lb-close').addEventListener('click', closeLightbox);
  lb.querySelector('.lb-prev').addEventListener('click', () => stepLightbox(-1));
  lb.querySelector('.lb-next').addEventListener('click', () => stepLightbox(1));
  document.addEventListener('keydown', e => {
    if (!lightboxShots.length) return;
    if (e.key === 'ArrowLeft')  { e.preventDefault(); stepLightbox(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); stepLightbox(1); }
  });
  return lb;
}

function openLightbox(idx) {
  lightboxShots = panelGame?.details?.meta?.screenshots || [];
  if (!lightboxShots.length) return;
  lightboxIdx = idx;
  renderLightbox();
  getLightbox().classList.add('open');
  document.body.classList.add('lb-open');
}

function closeLightbox() {
  lightboxShots = [];
  getLightbox().classList.remove('open');
  document.body.classList.remove('lb-open');
}

function stepLightbox(dir) {
  lightboxIdx = (lightboxIdx + dir + lightboxShots.length) % lightboxShots.length;
  renderLightbox();
}

function renderLightbox() {
  const lb = getLightbox();
  const shot = lightboxShots[lightboxIdx];
  lb.querySelector('.lb-img').src = shot.full;
  lb.querySelector('.lb-counter').textContent = `${lightboxIdx + 1} / ${lightboxShots.length}`;
  lb.querySelector('.lb-prev').disabled = lightboxShots.length <= 1;
  lb.querySelector('.lb-next').disabled = lightboxShots.length <= 1;
}

// ── Side panel ─────────────────────────────────────────────────────────────

function renderPanelHero() {
  if (!panelGame) return;
  const hero = document.getElementById('panel-hero');
  const bannerUrl = `https://cdn.akamai.steamstatic.com/steam/apps/${panelGame.appid}/header.jpg`;
  const shots = panelGame.details?.meta?.screenshots || [];
  const images = [bannerUrl, ...shots.map(s => s.full)];
  heroIdx = Math.max(0, Math.min(heroIdx, images.length - 1));
  const src = images[heroIdx];
  const hasMany = images.length > 1;
  const isShot = heroIdx > 0;

  hero.innerHTML = `
    <img class="panel-hero-img${isShot ? ' panel-hero-img--shot' : ''}" src="${esc(src)}" alt="${esc(panelGame.name)}">
    ${hasMany ? `
      <button class="panel-hero-btn panel-hero-prev"${heroIdx <= 0 ? ' disabled' : ''} aria-label="Previous">&#8249;</button>
      <button class="panel-hero-btn panel-hero-next"${heroIdx >= images.length - 1 ? ' disabled' : ''} aria-label="Next">&#8250;</button>
      <div class="panel-hero-dots">${images.map((_, i) =>
        `<span class="panel-hero-dot${i === heroIdx ? ' active' : ''}"></span>`
      ).join('')}</div>
    ` : ''}`;

  const img = hero.querySelector('.panel-hero-img');
  img.classList.add('loading');
  img.onload  = () => img.classList.remove('loading');
  img.onerror = () => { hero.style.display = 'none'; };
}

function openPanel(game) {
  panelGame = game;
  heroIdx = 0;
  document.getElementById('panel-body').scrollTop = 0;
  renderPanelHero();
  renderPanel();
  document.getElementById('game-panel').classList.add('open');
  document.getElementById('panel-backdrop').classList.add('open');
  refreshTable(); // re-render rows so the active highlight appears
  setPanelParam(game.appid);
}

function closePanel() {
  if (!panelGame) return;
  panelGame = null;
  document.getElementById('game-panel').classList.remove('open');
  document.getElementById('panel-backdrop').classList.remove('open');
  document.getElementById('panel-nav').innerHTML = '';
  refreshTable(); // remove active highlight
  setPanelParam(null);
}

function setPanelParam(appid) {
  const params = new URLSearchParams(location.search);
  if (appid == null) {
    params.delete('game');
  } else {
    params.set('game', appid);
  }
  history.replaceState(null, '', `?${params}`);
}

function restorePanelFromUrl() {
  const appid = Number(new URLSearchParams(location.search).get('game'));
  if (!appid) return;
  const game = games.find(g => g.appid === appid);
  if (game && panelGame?.appid !== appid) openPanel(game);
}

function renderPanelNav() {
  const nav = document.getElementById('panel-nav');
  if (!nav || !panelGame) return;
  const list = sortedGames(panelGame.groupKey);
  const idx = list.findIndex(g => g.appid === panelGame.appid);
  nav.innerHTML = `
    <button class="panel-nav-btn" id="panel-prev"${idx <= 0 ? ' disabled' : ''} aria-label="Previous game">↑</button>
    <span class="panel-nav-pos">${idx + 1} / ${list.length}</span>
    <button class="panel-nav-btn" id="panel-next"${idx >= list.length - 1 ? ' disabled' : ''} aria-label="Next game">↓</button>
  `;
  document.getElementById('panel-prev').addEventListener('click', () => {
    if (idx > 0) openPanel(list[idx - 1]);
  });
  document.getElementById('panel-next').addEventListener('click', () => {
    if (idx < list.length - 1) openPanel(list[idx + 1]);
  });
}

function initPanelSwipe() {
  const panel = document.getElementById('game-panel');
  let startX = 0, startY = 0, tracking = false, decided = false, horiz = false;

  panel.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    tracking = true;
    decided = false;
    horiz = false;
    panel.style.transition = 'none';
  }, { passive: true });

  panel.addEventListener('touchmove', e => {
    if (!tracking || e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    if (!decided) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      horiz = Math.abs(dx) > Math.abs(dy) * 1.2;
      decided = true;
    }
    if (!horiz || dx <= 0) return;
    e.preventDefault();
    panel.style.transform = `translateX(${dx}px)`;
  }, { passive: false });

  function finish(clientX) {
    if (!tracking) return;
    tracking = false;
    const dx = clientX - startX;
    if (horiz && dx > 80) {
      panel.style.transition = 'transform 0.2s ease';
      panel.style.transform = 'translateX(100%)';
      setTimeout(() => {
        closePanel();
        panel.style.transition = '';
        panel.style.transform = '';
      }, 200);
    } else {
      if (panel.style.transform) {
        panel.style.transition = 'transform 0.25s ease';
        panel.style.transform = '';
        setTimeout(() => { panel.style.transition = ''; }, 250);
      } else {
        panel.style.transition = '';
      }
    }
  }

  panel.addEventListener('touchend', e => finish(e.changedTouches[0].clientX), { passive: true });
  panel.addEventListener('touchcancel', () => {
    tracking = false;
    panel.style.transition = 'transform 0.25s ease';
    panel.style.transform = '';
    setTimeout(() => { panel.style.transition = ''; }, 250);
  }, { passive: true });
}

function renderPanel() {
  if (!panelGame) return;
  renderPanelNav();
  const g = panelGame;
  const r = g.details?.rating;
  const h = g.details?.hltb;
  const meta = g.details?.meta;

  const storeUrl   = `https://store.steampowered.com/app/${g.appid}`;
  const steamdbUrl = `https://www.steamdb.info/app/${g.appid}/`;
  const protondbUrl = `https://www.protondb.com/app/${g.appid}`;
  const releaseDate = g.details?.meta?.releaseDate;
  const description = g.details?.meta?.description;

  const ownerIndices = g.groupKey.split(',').map(Number);
  const gamePt = playtime[g.appid] || {};
  const ownersHtml = `<div class="panel-section">
    <div class="panel-section-title">Owned by</div>
    <div class="panel-tags">${ownerIndices.map(slotIdx => {
      const accounts = slots[slotIdx] || [];
      const parts = accounts.map(p => {
        const pt = fmtPlaytime(gamePt[p.steamid]);
        return esc(p.personaname || '?') + (pt ? `<span class="panel-tag-playtime"> · ${esc(pt)}</span>` : '');
      });
      return `<span class="panel-tag">${parts.join(' + ')}</span>`;
    }).join('')}</div>
  </div>`;

  const mc = meta?.metacritic;
  let scoreHtml = '';
  if (g.loading) {
    scoreHtml = `<div class="panel-section">
      <div class="panel-section-title">Score</div>
      <span class="sk" style="width:64px;height:32px;border-radius:4px"></span>
    </div>`;
  } else if (r || mc) {
    const pct = r?.total ? Math.round(r.positive / r.total * 100) : 0;
    const wilsonHtml = r ? `
      <div class="panel-score-row">
        <div class="panel-score-num" style="color:${scoreColor(r.score)}">${r.score}</div>
        <div class="panel-score-desc">${esc(r.desc)}</div>
      </div>
      <div class="panel-reviews">${r.positive.toLocaleString()} of ${r.total.toLocaleString()} reviews positive (${pct}%)</div>` : '';
    const mcHtml = mc ? `
      <div class="panel-score-row panel-score-row--mc">
        <div class="panel-score-num panel-score-num--mc">${mc.score}</div>
        <div class="panel-score-desc">${mc.url ? `<a href="${esc(mc.url)}" target="_blank" rel="noopener">Metacritic ↗</a>` : 'Metacritic'}</div>
      </div>` : '';
    scoreHtml = `<div class="panel-section">
      <div class="panel-section-title">Score</div>
      ${wilsonHtml}
      ${mcHtml}
    </div>`;
  }

  let hltbHtml = '';
  if (g.loading) {
    hltbHtml = `<div class="panel-section">
      <div class="panel-section-title">How Long To Beat</div>
      <span class="sk" style="width:140px"></span>
    </div>`;
  } else if (h) {
    const hltbUrl = h.id ? `https://howlongtobeat.com/game/${h.id}` : null;
    hltbHtml = `<div class="panel-section">
      <div class="panel-section-title">${hltbUrl ? `<a href="${esc(hltbUrl)}" target="_blank" rel="noopener">How Long To Beat ↗</a>` : 'How Long To Beat'}</div>
      <div class="panel-hltb">
        <div class="panel-hltb-item">
          <div class="panel-hltb-label">Main Story</div>
          <div class="panel-hltb-val">${fmtH(h.main)}</div>
        </div>
        <div class="panel-hltb-item">
          <div class="panel-hltb-label">Main + Extra</div>
          <div class="panel-hltb-val">${fmtH(h.extra)}</div>
        </div>
        ${h.completionist ? `<div class="panel-hltb-item">
          <div class="panel-hltb-label">Completionist</div>
          <div class="panel-hltb-val">${fmtH(h.completionist)}</div>
        </div>` : ''}
      </div>
    </div>`;
  } else if (g.details) {
    const searchUrl = `https://howlongtobeat.com/?q=${encodeURIComponent(g.name)}`;
    hltbHtml = `<div class="panel-section">
      <div class="panel-section-title">How Long To Beat</div>
      <div class="panel-no-data"><a href="${esc(searchUrl)}" target="_blank" rel="noopener">Search on HowLongToBeat ↗</a></div>
    </div>`;
  }

  const tagSection = (title, items, dim) => items?.length ? `
    <div class="panel-section">
      <div class="panel-section-title">${title}</div>
      <div class="panel-tags">${(dim === 'tags' ? [...items] : [...items].sort((a, b) => a.localeCompare(b))).map(v => {
        if (dim) {
          const active = activeFilters[dim].has(v) ? ' active' : '';
          return `<button class="panel-tag panel-tag-btn${active}" data-dim="${dim}" data-val="${esc(v)}">${esc(v)}</button>`;
        }
        return `<span class="panel-tag">${esc(v)}</span>`;
      }).join('')}</div>
    </div>` : '';

  const tags = g.details?.tags;
  const metaHtml = g.loading ? '' : [
    tagSection('Tags', tags, 'tags'),
    tagSection('Genres', meta?.genres, 'genres'),
    tagSection('Categories', meta?.categories, 'categories'),
    tagSection('Developer', meta?.developers, 'developers'),
    tagSection('Publisher', meta?.publishers, 'publishers'),
  ].join('');

  document.getElementById('panel-body').innerHTML = `
    <div class="panel-title">${esc(g.name)}</div>
    ${releaseDate ? `<div class="panel-release">${esc(releaseDate)}</div>` : ''}
    ${ownersHtml}
    ${description ? `<div class="panel-desc">${description}</div>` : ''}
    ${scoreHtml}
    ${hltbHtml}
    ${metaHtml}
    <div class="panel-section">
      <div class="panel-section-title">Links</div>
      <div class="panel-links">
        <a class="panel-link" href="${esc(storeUrl)}" target="_blank" rel="noopener">Steam Store</a>
        <a class="panel-link" href="${esc(steamdbUrl)}" target="_blank" rel="noopener">SteamDB</a>
        <a class="panel-link" href="${esc(protondbUrl)}" target="_blank" rel="noopener">ProtonDB</a>
      </div>
    </div>`;

  renderPanelHero();
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
  if (panelGame) renderPanelNav();
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

// Render the four <td> cells for a new <tr> (active class is set by syncRow).
function rowCells(game) {
  return `<td class="td-name">${esc(game.name)}</td>
    <td class="td-score">${renderScoreCell(game)}</td>
    <td class="td-hltb">${renderMainCell(game)}</td>
    <td class="td-hltb">${renderExtraCell(game)}</td>`;
}

// Update an existing <tr>'s cells and active state in place.
function syncRow(tr, game) {
  tr.classList.toggle('active', panelGame?.appid === game.appid);
  const cells = tr.cells;
  if (!cells.length) { tr.innerHTML = rowCells(game); return; }

  cells[0].innerHTML = esc(game.name);
  cells[1].innerHTML = renderScoreCell(game);
  cells[2].innerHTML = renderMainCell(game);
  cells[3].innerHTML = renderExtraCell(game);
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
  if (nameFilter && !game.name.toLowerCase().includes(nameFilter.toLowerCase())) return false;
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

      if (filterSearch[key] && !v.toLowerCase().includes(filterSearch[key].toLowerCase())) {
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
  const q = query.toLowerCase();
  const inp = document.querySelector(`input[data-search-dim="${dim}"]`);
  if (!inp) return;
  inp.closest('.filter-dim').querySelectorAll('.filter-opt').forEach(label => {
    const val = label.querySelector('input')?.value ?? '';
    label.style.display = !q || val.toLowerCase().includes(q) ? '' : 'none';
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
