'use strict';

import { esc, foldStr, renderScoreCell, renderMainCell, renderExtraCell, normalizeInput } from '/utils.ts';
import { renderOwnersHtml } from '/ownerListHtml.ts';
import { FILTER_DIMS, parseUrlState, reorderUrlParams } from '/urlState.ts';
import { updateNavLink } from '/nav.ts';
import { renderAccountChipsGrouped, bindAccountRefresh, addRecent, renderRecentsBar, bindRecentsBar } from '/accountsBar.ts';
import { initGameSearch, addRecentGame, renderRecentGamesBar, bindRecentGamesBar } from '/gameSearch.ts';
import { openLightbox, isLightboxOpen } from '/lightbox.ts';
import {
  panelOpen, panelClose, isPanelOpen, getPanelGame, panelStepHero,
  pickRandomFrom, clearAllRandomQueues, panelHandleEscape,
  renderPanelBody,
} from '/panel.ts';
import { initPageShell } from '/pageShell.ts';
import type { PanelOptions } from '/panel.ts';
import type { Game, GameDetails, Achievements, GameMeta } from '/types.ts';

// ── State ──────────────────────────────────────────────────────────────────

interface GroupGame { appid: number; name: string; }
interface ServerGroup { userIndices: number[]; games: GroupGame[]; }
type Account = { steamid: string; personaname?: string; profileurl?: string };
// A loaded comparison row — the shared Game plus the groupKey this page stamps on it
// (a comma-joined list of slot indices; standalone lookups never get one).
type GameRow = Game & { groupKey?: string | null };

let games: GameRow[] = [];     // flat: { appid, name, groupKey, loading, details }
let groups: ServerGroup[] = [];    // [{ userIndices, games }] — ordered, from server
let slots: Account[][] = [];     // [[{steamid, personaname, profileurl}, ...], ...] — one entry per logical player
let playtime: Record<string, Record<string, number>> = {};  // { [appid]: { [steamId]: minutes } } — per-account playtime for common games
let lastPlayed: Record<string, Record<string, number>> = {}; // { [appid]: { [steamId]: unix seconds } } — per-account last-played timestamp
const DEFAULT_SORT_COL = 'score';
const DEFAULT_SORT_DIR = -1;
let sortCol: string = DEFAULT_SORT_COL;
let sortDir: number = DEFAULT_SORT_DIR;

// null at the default sort — omitted from the URL entirely rather than writing out `-score`
// on every search, since that's what a bare search already sorts by.
function sortUrlParam(): string | null {
  if (sortCol === DEFAULT_SORT_COL && sortDir === DEFAULT_SORT_DIR) return null;
  return (sortDir < 0 ? '-' : '') + sortCol;
}
let runId = 0;           // increments on each search to cancel stale updates
let streamController: AbortController | null = null; // AbortController for the active detail stream
let refreshDebounceTimer: ReturnType<typeof setTimeout> | undefined;
let activeGame: GameRow | null = null;
let randomGroupKey: string | null = null;      // groupKey of the active random session, or null (queues themselves live in panel.js)
// Achievement list cache for standalone lookups only (see loadAchievements) — keyed by
// appid, no per-account progress since a standalone game has no steamids at all.
const achievementsCache = new Map<number, Achievements>();

const RECENTS_KEY = 'comparison:recent-searches'; // see public/accountsBar.ts


// Filter state — reset on each new search
type FilterDimKey = typeof FILTER_DIMS[number]['key'];
const activeFilters = Object.fromEntries(FILTER_DIMS.map(d => [d.key, new Set<string>()])) as Record<FilterDimKey, Set<string>>;
const allOpts       = Object.fromEntries(FILTER_DIMS.map(d => [d.key, new Set<string>()])) as Record<FilterDimKey, Set<string>>;
const filterSearch  = Object.fromEntries(FILTER_DIMS.map(d => [d.key, ''])) as Record<FilterDimKey, string>;
let nameFilter = '';
// Mobile-only collapse for the filter body (chips/search/dims) — defaulted from the
// viewport at first render so a phone starts collapsed (results visible immediately
// instead of pushed ~2 screens down by Tag/Genre/Category/etc.) while desktop keeps
// today's always-expanded panel. Once a user actually clicks the toggle it's a plain
// user preference for the rest of the session, surviving renderFilterPanel()'s full
// DOM rebuild on every filter change since it lives here, not in the DOM itself. The
// toggle button that flips this is itself only shown on mobile via CSS (see
// .filter-toggle-btn in style.css), so the variable has no effect on desktop.
let filterPanelCollapsed = typeof matchMedia === 'function' && matchMedia('(max-width: 768px)').matches;

// ── Init ───────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const panelOptions: PanelOptions = {
    inertSelector: '.container',
    enableTagFilters: true,
    // Achievements are opt-in per host page (see panel.ts's achievementsHtml). Unlike the
    // Library Explorer, a comparison group has no single well-defined "player" to fetch
    // unlock progress for (a game can belong to several slots at once, each possibly a
    // merged Family) — so for now this only actually renders anything for a standalone
    // "look up any game" lookup (see loadAchievements below), where the list itself
    // (names/descriptions/icons/rarity, no progress) is store metadata that doesn't
    // depend on any account. A loaded comparison-group game simply never gets
    // `g.achievements` set, so achievementsHtml's `if (!data) return ''` keeps the
    // section hidden for those, same as before this was turned on at all.
    showAchievements: true,
    getOwnersHtml: buildOwnersHtml,
    isTagActive: (dim, val) => activeFilters[dim as FilterDimKey].has(val),
    onTagClick: (dim, val) => {
      const k = dim as FilterDimKey;
      if (activeFilters[k].has(val)) activeFilters[k].delete(val);
      else activeFilters[k].add(val);
      refreshTable();
      updateFilterUrl();
      renderFilterPanel();
      renderPanel();
    },
    onRefresh: async game => {
      await Promise.all([refreshGameDetails(game), loadAchievements(game, { force: true })]);
    },
    // Backs the DLC card's links (public/panel.ts) — a real href so ctrl/cmd/shift/middle
    // click still opens it in a new tab, alongside the current URL's other state (`u=`,
    // filters, etc.), same as setPanelParam builds for the panel's own deep link.
    gameHref: appid => {
      const params = new URLSearchParams(location.search);
      params.delete('shot');
      params.set('game', String(appid));
      return `?${reorderUrlParams(params)}`;
    },
    // Clicking a DLC entry (or the panel's own "← Back" button) — reuses the exact same
    // "open this appid" mechanism as the "look up any game" search box, just telling it to
    // keep panel.ts's own DLC-navigation history stack instead of starting a fresh one.
    onNavigateGame: (appid, name) => openStandaloneGame(appid, name, { keepHistory: true }),
    // Runs on every close path, not just the Escape-key one below — see the comment on
    // `onClose` in panel.ts. Mirrors what the old closePanel() wrapper did, but now also
    // covers the backdrop click / × button / swipe-to-close, which used to leave
    // `activeGame` and `?game=` stale until something else (e.g. a later Escape press)
    // happened to clean them up. `preserveUrl` is set by findCommonGames when it closes the
    // panel only to immediately reopen the same game once a refresh/restore completes —
    // see its own `panelClose({ preserveUrl: true })` call.
    onClose: ({ preserveUrl } = {}) => {
      activeGame = null;
      randomGroupKey = null;
      refreshTable(); // remove active row highlight
      updateTitle();
      if (!preserveUrl) setPanelParam(null);
    },
  };
  initPageShell({
    page: 'compare',
    lightbox: { onParamChange: setLightboxParam, onGameNav: navigateLightboxGame },
    panel: panelOptions,
  });

  document.getElementById('add-btn')!.addEventListener('click', () => addPlayerSlot());
  document.getElementById('search-btn')!.addEventListener('click', () => findCommonGames());

  // Per-account refresh (accounts bar) and recent-searches (see public/accountsBar.ts,
  // shared with the Library Explorer) — re-run the current search bypassing the cache for
  // just one account, or replaying a remembered slot combo, while keeping the URL, sort,
  // filters, and open panel exactly as they are for the refresh case (not a new search).
  bindAccountRefresh(document.getElementById('accounts-bar')!, steamid => {
    findCommonGames({
      pushState: false,
      refreshIds: [steamid],
      restoreFilters: Object.fromEntries(Object.entries(activeFilters).map(([k, s]) => [k, [...s]])),
      restoreSort: { col: sortCol, dir: sortDir },
      restoreNameFilter: nameFilter,
    });
  });

  bindRecentsBar(document.getElementById('recents-bar')!, RECENTS_KEY, rawInputSlots => {
    const container = document.getElementById('user-inputs')!;
    container.innerHTML = '';
    (rawInputSlots as string[][]).forEach(accounts => addPlayerSlot(accounts));
    findCommonGames();
  });
  renderRecentsBar(document.getElementById('recents-bar')!, RECENTS_KEY);

  document.getElementById('results')!.addEventListener('click', e => {
    const randomBtn = (e.target as Element).closest('.group-random-btn') as HTMLElement | null;
    if (randomBtn) { pickRandom(randomBtn.dataset.group!); return; }
    const row = (e.target as Element).closest('tr.game-row') as HTMLElement | null;
    if (!row || (e.target as Element).closest('a')) return;
    const appid = Number(row.dataset.appid);
    const game = games.find(g => g.appid === appid);
    if (game) openPanel(game);
  });

  document.getElementById('shortcuts-backdrop')!.addEventListener('click', closeShortcuts);
  document.querySelector('.shortcuts-close')!.addEventListener('click', closeShortcuts);

  initGameSearch({
    inputEl: document.getElementById('game-lookup-input') as HTMLInputElement,
    resultsEl: document.getElementById('game-lookup-results')!,
    onSelect: ({ appid, name }) => openStandaloneGame(appid, name),
  });

  // Shared, un-namespaced across both pages — see gameSearch.ts.
  bindRecentGamesBar(document.getElementById('recent-games-bar')!, (appid, name) => openStandaloneGame(appid, name));
  renderRecentGamesBar(document.getElementById('recent-games-bar')!);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      // panelHandleEscape (panel.js) owns the lightbox-close/fullscreen-guard logic shared by
      // all three pages — delegate to it whenever the lightbox is open so this page can't drift
      // from the other two the way bundles.js once did (see its own comment).
      if (isLightboxOpen()) { panelHandleEscape(); return; }
      if (document.getElementById('shortcuts-modal')!.classList.contains('open')) { closeShortcuts(); return; }
      panelClose(); return; // onClose (see initPanel above) handles the URL/state cleanup
    }
    // The lightbox owns the keyboard while open (its own arrows/Home/End/f/space/m,
    // wired in lightbox.js's own listener) — every other page-level shortcut below is
    // blocked rather than firing invisibly behind it. This used to let ↑/↓ page games
    // while the lightbox stayed open on the new game's first shot, with no visible sign
    // the game had actually changed (see the lightbox's own caption for that fix).
    if (isLightboxOpen()) return;
    if (e.key === '?') { e.preventDefault(); toggleShortcuts(); return; }
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === '/') {
      e.preventDefault();
      (document.querySelector('#user-inputs input[type="text"]') as HTMLInputElement | null)?.focus();
      return;
    }
    if (e.key === 'Enter') {
      const row = (document.activeElement as HTMLElement | null)?.closest('tr.game-row') as HTMLElement | null;
      if (row) {
        const game = games.find(g => g.appid === Number(row.dataset.appid));
        if (game) { openPanel(game); return; }
      }
    }
    if (!activeGame) return;
    const ag = activeGame;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      if (panelStepHero(e.key === 'ArrowRight' ? 1 : -1, { wrap: true })) e.preventDefault();
      return;
    }
    if (ag.standalone) return; // no group to page through or randomize within — see renderPanelNav
    if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      pickRandom(ag.groupKey!);
      return;
    }
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const list = sortedGames(ag.groupKey!);
    const idx = list.findIndex(g => g.appid === ag.appid);
    const next = (idx + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
    openPanel(list[next]);
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

  loadFromUrl();
});

// Restore state when the user navigates back/forward
window.addEventListener('popstate', loadFromUrl);

function loadFromUrl() {
  // Each u= param is a comma-joined list of accounts for one logical player slot.
  // Old single-account URLs (?u=alice&u=bob) parse naturally as single-member slots.
  const { slots: urlSlots, sort: restoreSort, filters: restoreFilters, nameFilter: restoreNameFilter, shot: restoreShot } = parseUrlState(location.search);
  const container = document.getElementById('user-inputs')!;
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
    for (const k of Object.keys(filterSearch)) filterSearch[k as FilterDimKey] = '';
    nameFilter = '';
    document.getElementById('filter-panel')!.innerHTML = '';
    document.getElementById('results')!.innerHTML = '';
    document.getElementById('how-it-works')!.hidden = false;
    const accountsBarEl = document.getElementById('accounts-bar')!;
    accountsBarEl.hidden = true;
    accountsBarEl.innerHTML = '';
    updateTitle();
    updateLibraryExplorerLink();
    // No comparison loaded at all — still honor a bare `?game=` standalone-lookup deep
    // link (findCommonGames would otherwise be the only caller of restorePanelFromUrl).
    restorePanelFromUrl(restoreShot);
  }
}

// Sorts members within each slot, then sorts slots by their first member — the
// canonical order used both for building a shareable/reproducible `?u=` URL and for
// deduping recent searches (so "alice+bob vs. charlie" and "bob+alice vs. charlie" are
// treated as the same search).
function normalizedSlots(inputSlots: string[][]): string[][] {
  const cmp = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });
  return [...inputSlots]
    .map(slot => [...slot].sort(cmp))
    .sort((a, b) => cmp(a[0], b[0]));
}

// ── Player slot input rows ─────────────────────────────────────────────────

function updateSearchBtn() {
  const multi = document.querySelectorAll('.player-slot').length > 1;
  document.getElementById('search-btn')!.textContent = multi ? 'Find Common Games' : 'Show Library';
}

function addPlayerSlot(accounts: string[] = ['']) {
  const container = document.getElementById('user-inputs')!;
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

  for (let i = 1; i < accounts.length; i++) addFamilyMember(slot, accounts[i] ?? '');

  container.appendChild(slot);
  updateSearchBtn();
  if (!accounts[0]) input.focus();
}

function addFamilyMember(slot: HTMLElement, value = '') {
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

function getSlots(): string[][] {
  return [...document.querySelectorAll('.player-slot')].map(slot =>
    [...slot.querySelectorAll<HTMLInputElement>('input')]
      .map(i => normalizeInput(i.value.trim()))
      .filter(Boolean)
  ).filter(s => s.length > 0);
}

// ── Alerts ─────────────────────────────────────────────────────────────────

function clearAlerts() { document.getElementById('alerts')!.innerHTML = ''; }

function showAlert(msg: string, type = 'error') {
  const el = document.createElement('div');
  el.className = `alert alert-${type}`;
  el.textContent = msg;
  const box = document.getElementById('alerts')!;
  box.innerHTML = '';
  box.appendChild(el);
}

// ── Main search flow ───────────────────────────────────────────────────────

interface FindCommonGamesOpts {
  pushState?: boolean;
  restoreFilters?: Record<string, string[]> | null;
  restoreSort?: { col: string; dir: number } | null;
  restoreNameFilter?: string;
  restoreShot?: string | null;
  refreshIds?: string[] | null;
}
async function findCommonGames({ pushState = true, restoreFilters = null, restoreSort = null, restoreNameFilter = '', restoreShot = null, refreshIds = null }: FindCommonGamesOpts = {}) {
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
  for (const k of Object.keys(filterSearch)) filterSearch[k as FilterDimKey] = '';
  nameFilter = restoreNameFilter;
  if (restoreFilters) {
    for (const [k, vals] of Object.entries(restoreFilters)) {
      for (const v of vals) activeFilters[k as FilterDimKey].add(v);
    }
  }
  const accountsBarEl = document.getElementById('accounts-bar')!;
  accountsBarEl.hidden = true;
  accountsBarEl.innerHTML = '';
  document.getElementById('how-it-works')!.hidden = true;
  document.getElementById('filter-panel')!.innerHTML = '';
  (document.getElementById('search-btn') as HTMLButtonElement).disabled = true;
  document.getElementById('results')!.innerHTML =
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
      return g.games.map(game => ({ ...game, groupKey: key, loading: true, details: null })) as GameRow[];
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
      const sp = sortUrlParam();
      if (sp) params.set('sort', sp);
      history.pushState(null, '', `?${reorderUrlParams(params)}`);
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
      const parts: string[] = [];
      if (slots.length > 1) parts.push(`Player ${i + 1}`);
      if (players.length > 1) parts.push(`${players.length} accounts merged`);
      return { label: parts.length ? parts.join(' · ') : undefined, players };
    }), 'games');
    addRecent(RECENTS_KEY, idSlots.map(s => s.join(',')).join('|'), slots, idSlots);
    renderRecentsBar(document.getElementById('recents-bar')!, RECENTS_KEY);
    restorePanelFromUrl(restoreShot);
    await loadAllDetails(thisRun);
    if (thisRun === runId) { refreshTable(); restorePanelFromUrl(restoreShot); }
  } catch (err) {
    if (thisRun !== runId) return;
    showAlert(err instanceof Error ? err.message : String(err));
    document.getElementById('results')!.innerHTML = '';
  } finally {
    (document.getElementById('search-btn') as HTMLButtonElement).disabled = false;
  }
}

// Forces a fresh rating/HLTB/store-metadata/tags fetch for one game, bypassing its
// cache TTL — used by the side panel's "↻ Refresh" button (panel.js's onRefresh).
async function refreshGameDetails(game: Game) {
  try {
    const res = await fetch(`/api/game-details/${game.appid}?refresh=1`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Refresh failed');
    game.details = { rating: data.rating, hltb: data.hltb, meta: data.meta, tags: data.tags, demo: data.demo, protondb: data.protondb };
    // Standalone lookups (see openStandaloneGame) aren't part of the loaded comparison table —
    // feeding their tags/genres/categories into the table's filter option pool would make the
    // filter card spuriously appear (or gain new options) with no comparison ever having run.
    if (!game.standalone && (game.details.meta || game.details.tags)) updateFilterOptions(game.details.meta, game.details.tags);
    const tr = document.querySelector<HTMLTableRowElement>(`tr.game-row[data-appid="${game.appid}"]`);
    if (tr) syncRow(tr, game);
    refreshTable();
  } catch (err) {
    showAlert(err instanceof Error ? err.message : String(err));
  }
}

// ── Progressive detail loading ─────────────────────────────────────────────

async function loadAllDetails(thisRun: number) {
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
  if (!res.body) return;

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
      buffer = chunks.pop() ?? ''; // keep any incomplete trailing chunk

      for (const chunk of chunks) {
        if (!chunk.startsWith('data: ')) continue;
        let data;
        try { data = JSON.parse(chunk.slice(6)); } catch { continue; }

        if (data.done) return;
        if (thisRun !== runId) { reader.cancel(); return; }

        const idx = idxByAppid.get(data.appid);
        if (idx === undefined) continue;

        const g = games[idx];
        g.details = { rating: data.rating, hltb: data.hltb, meta: data.meta, tags: data.tags, demo: data.demo, protondb: data.protondb };
        g.loading = false;
        loaded++;
        updateProgress(loaded, games.length);
        if (g.details?.meta || g.details?.tags) updateFilterOptions(g.details.meta, g.details.tags);
        if (activeGame?.appid === g.appid) renderPanel();
        const tr = document.querySelector<HTMLTableRowElement>(`tr.game-row[data-appid="${data.appid}"]`);
        if (tr) syncRow(tr, g);
        clearTimeout(refreshDebounceTimer);
        refreshDebounceTimer = setTimeout(refreshTable, 150);
      }
    }
  } catch {
    // stream ended or aborted
  }
}

// ── Rendering ──────────────────────────────────────────────────────────────

function slotDisplayName(i: number): string {
  return (slots[i] || []).map((p, j) => p.personaname || `Player ${i + 1}.${j + 1}`).join(' + ');
}

// Single source of truth for the tab title: an open game (from a table row or a standalone
// lookup) takes over the title entirely rather than being appended to the comparison context —
// once a game is open that's what the user is looking at, and it's what they'll want to find
// again in browser history/tab search. Falls back to the slot names, then the bare app name
// when nothing's loaded at all (see loadFromUrl's empty branch and renderPage below).
function updateTitle() {
  if (activeGame) {
    document.title = `${activeGame.name} — Steam Common Games`;
    return;
  }
  if (slots.length) {
    const sortedSlotIndices = [...slots.keys()].sort((a, b) =>
      slotDisplayName(a).toLowerCase().localeCompare(slotDisplayName(b).toLowerCase())
    );
    document.title = sortedSlotIndices.map(i => slotDisplayName(i)).join(', ') + ' — Steam Common Games';
    return;
  }
  document.title = 'Steam Common Games';
}

// The site nav's Library Explorer link (see public/nav.js) points at that specific player's
// data once exactly one slot is loaded — the Library Explorer has no notion of multiple
// slots/a comparison, so a multi-slot search just falls back to the plain link.
function updateLibraryExplorerLink() {
  const href = slots.length === 1 && slots[0].length
    ? `/library.html?u=${slots[0].map(p => p.steamid).join(',')}`
    : '/library.html';
  updateNavLink('library', href);
}

function slotHtml(i: number): string {
  return (slots[i] || []).map((p, j) => {
    const name = esc(p.personaname || `Player ${i + 1}.${j + 1}`);
    const safeUrl = p.profileurl && /^https?:\/\//i.test(p.profileurl) ? p.profileurl : '';
    return safeUrl
      ? `<a href="${esc(safeUrl)}" target="_blank" rel="noopener" class="slot-link">${name}</a>`
      : name;
  }).join(' + ');
}

function groupSlotsHtml(slotIndices: number[]): string {
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

  updateTitle();
  updateLibraryExplorerLink();

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

  document.getElementById('results')!.innerHTML = `
    <div class="results-header">
      <h2 id="results-count">${games.length} ${slots.length === 1 ? 'games' : 'shared games'}</h2>
      ${playerList ? `<div class="results-meta">${slots.length === 1 ? 'library of' : 'across'} ${playerList}</div>` : ''}
    </div>
    <div class="progress-wrap">
      <div class="progress-text" id="prog-text">Loading details… 0 / ${games.length}</div>
      <div class="progress-bar-bg"><div class="progress-bar" id="prog-bar" style="width:0%"></div></div>
    </div>
    ${groupSections}`;

  document.querySelectorAll<HTMLElement>('thead th[data-col]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (sortCol === col) sortDir = -sortDir;
      else { sortCol = col!; sortDir = col === 'name' ? 1 : -1; }
      refreshTable();
      updateFilterUrl();
    });
  });
}

function thHtml(col: string, label: string): string {
  const active = sortCol === col ? ' active' : '';
  const icon = sortCol === col ? (sortDir > 0 ? '↑' : '↓') : '↕';
  return `<th class="sortable${active}" data-col="${col}">
    <div class="th-inner">${label}<span class="sort-icon">${icon}</span></div>
  </th>`;
}

function rowHtml(game: GameRow): string {
  return `<tr class="game-row" tabindex="0" data-appid="${game.appid}">${rowCells(game)}</tr>`;
}

function updateProgress(loaded: number, total: number) {
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
function openStandaloneGame(appid: number, name?: string, { keepHistory = false }: { keepHistory?: boolean } = {}) {
  const existing = games.find(g => g.appid === appid);
  if (existing) {
    openPanel(existing, { keepHistory });
    addRecentGame(existing.appid, existing.name, existing.details?.meta?.capsule || null);
    renderRecentGamesBar(document.getElementById('recent-games-bar')!);
    return;
  }
  // Fresh standalone row — no price fields yet (a standalone lookup never touches ITAD),
  // so this is cast rather than annotated against the full Game shape.
  const game = { appid, name: name || `App ${appid}`, loading: true, details: null, standalone: true } as Game;
  openPanel(game, { keepHistory });
  fetchStandaloneDetails(game);
  loadAchievements(game);
}

// Achievement list for a standalone lookup — see the showAchievements comment on initPanel
// above for why this is standalone-only. No `steamids` param at all (there's no account to
// ask about), which server.js's `/api/achievements/:appid` already treats as a valid
// request: it returns the achievement schema/rarity with `playerCount: 0` and everything
// achieved:false, which achievementsHtml (panel.js) renders as "Load a player above to see
// who's unlocked what" instead of implying 0% progress. Mirrors library.js's
// loadAchievements (same shape, same guards against a stale re-render after the user moved
// on), just without any steamids/cache-key-per-player concept to thread through.
async function loadAchievements(game: Game, { force = false }: { force?: boolean } = {}) {
  if (!game.standalone) return;
  if (!force) {
    const cached = achievementsCache.get(game.appid);
    if (cached) { game.achievements = cached; if (activeGame === game) renderPanelBody(game); return; }
  }
  game.achievementsLoading = true;
  if (activeGame === game) renderPanelBody(game);
  try {
    const res = await fetch(`/api/achievements/${game.appid}${force ? '?refresh=1' : ''}`);
    const data = await res.json();
    if (res.ok) achievementsCache.set(game.appid, data);
    game.achievements = res.ok ? data : null;
  } catch {
    game.achievements = null;
  } finally {
    game.achievementsLoading = false;
    if (activeGame === game) renderPanelBody(game); // no-op if the user moved on mid-fetch
  }
}

async function fetchStandaloneDetails(game: Game) {
  try {
    const res = await fetch(`/api/game-details/${game.appid}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lookup failed');
    game.details = { rating: data.rating, hltb: data.hltb, meta: data.meta, tags: data.tags, demo: data.demo, protondb: data.protondb };
    game.loading = false;
    if (game.details.meta?.name) game.name = game.details.meta.name;
    if (activeGame === game) { renderPanelBody(game); updateTitle(); } // no-op if the user moved on mid-fetch
    addRecentGame(game.appid, game.name, game.details.meta?.capsule || null);
    renderRecentGamesBar(document.getElementById('recent-games-bar')!);
  } catch (err) {
    if (activeGame === game) showAlert(err instanceof Error ? err.message : String(err));
  }
}

// Resolves this group's owners for renderOwnersHtml (ownerListHtml.js), which owns the actual
// markup/sort/meter logic shared with library.js's own buildLibraryOwnersHtml — the two only
// ever differed in this resolution step (a comparison group's multiple slots vs. a Library
// Explorer search's one flat player list).
function buildOwnersHtml(g: Game): string {
  const groupKey = g.groupKey as string | undefined;
  if (!groupKey) return ''; // standalone lookup — not part of any comparison group
  const ownerIndices = groupKey.split(',').map(Number);
  const gamePt = playtime[g.appid] || {};
  const gameLp = lastPlayed[g.appid] || {};
  const owners = ownerIndices.flatMap(slotIdx =>
    (slots[slotIdx] || []).filter(p => p.steamid in gamePt).map(p => ({
      name: p.personaname || '?',
      minutes: gamePt[p.steamid] || 0,
      lastPlayedSec: gameLp[p.steamid] || 0,
    }))
  );
  return renderOwnersHtml(owners);
}

function pickRandom(groupKey: string) {
  const list = sortedGames(groupKey);
  const pick = pickRandomFrom(list, groupKey, activeGame?.appid ?? -1);
  if (!pick) return;
  const game = list.find(g => g.appid === pick.appid);
  if (!game) return;
  randomGroupKey = groupKey;
  openPanel(game, { isRandom: true });
}

function openPanel(game: GameRow, { isRandom = false, keepHistory = false }: { isRandom?: boolean; keepHistory?: boolean } = {}) {
  if (!isRandom) {
    randomGroupKey = null;
    clearAllRandomQueues();
  }
  activeGame = game;
  panelOpen(game, { keepHistory }); // shared: renders hero+body, opens the panel, focuses it
  updateTitle();
  renderPanelNav();
  refreshTable(); // re-render rows so the active highlight appears
  document.getElementById(`tbody-${game.groupKey}`)?.querySelector(`tr.game-row[data-appid="${game.appid}"]`)?.scrollIntoView({ block: 'nearest' });
  // Standalone lookups are restorable too (see restorePanelFromUrl's fallback to
  // openStandaloneGame below), so `?game=` is set unconditionally.
  setPanelParam(game.appid);
}

// Lightbox's own ↑/↓ handler (see initLightbox below) — same game-list step the
// document keydown handler above does when the lightbox is closed, but also jumps
// straight into the new game's lightbox at shot 0 rather than leaving the lightbox
// closed behind it. No-ops with no group to page through, same guard as above.
function navigateLightboxGame(dir: number) {
  if (!activeGame || activeGame.standalone) return;
  const ag = activeGame;
  const list = sortedGames(ag.groupKey!);
  const idx = list.findIndex(g => g.appid === ag.appid);
  const next = list[(idx + dir + list.length) % list.length];
  openPanel(next);
  openLightbox(next, 0);
}

function openShortcuts() {
  document.getElementById('shortcuts-modal')!.classList.add('open');
  document.getElementById('shortcuts-backdrop')!.classList.add('open');
}

function closeShortcuts() {
  document.getElementById('shortcuts-modal')!.classList.remove('open');
  document.getElementById('shortcuts-backdrop')!.classList.remove('open');
}

function toggleShortcuts() {
  if (document.getElementById('shortcuts-modal')!.classList.contains('open')) closeShortcuts();
  else openShortcuts();
}

function setPanelParam(appid: number | string | null) {
  const params = new URLSearchParams(location.search);
  params.delete('shot');
  if (appid == null) {
    params.delete('game');
  } else {
    params.set('game', String(appid));
  }
  history.replaceState(null, '', `?${reorderUrlParams(params)}`);
}

function setLightboxParam(idx: string | null) {
  const params = new URLSearchParams(location.search);
  if (idx == null) {
    params.delete('shot');
  } else {
    params.set('shot', idx);
  }
  history.replaceState(null, '', `?${reorderUrlParams(params)}`);
}

function restorePanelFromUrl(restoreShot: string | null = null) {
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
  const ag = activeGame;
  const groupKey = ag.groupKey!;
  const list = sortedGames(groupKey);
  const idx = list.findIndex(g => g.appid === ag.appid);
  nav.innerHTML = `
    <button class="panel-nav-btn" id="panel-prev" aria-label="Previous game" title="Previous game (↑)">↑</button>
    <span class="panel-nav-pos" aria-live="polite">${idx + 1} / ${list.length}</span>
    <button class="panel-nav-btn" id="panel-next" aria-label="Next game" title="Next game (↓)">↓</button>
    <button class="panel-nav-btn panel-nav-reroll" id="panel-reroll" aria-label="Pick a random game" title="Pick a random game (R)">🎲<span class="panel-nav-kbd">R</span></button>
  `;
  document.getElementById('panel-prev')!.addEventListener('click', () => {
    openPanel(list[(idx - 1 + list.length) % list.length]);
  });
  document.getElementById('panel-next')!.addEventListener('click', () => {
    openPanel(list[(idx + 1) % list.length]);
  });
  document.getElementById('panel-reroll')!.addEventListener('click', () => {
    pickRandom(groupKey);
  });
}

function renderPanel() {
  if (!activeGame) return;
  renderPanelNav();
  renderPanelBody(activeGame); // shared: rebuilds hero + body from panel.js
}

function refreshTable() {
  document.querySelectorAll<HTMLElement>('thead th[data-col]').forEach(th => {
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
function reconcileTbody(tbody: HTMLElement, desired: GameRow[]) {
  // Index existing rows by appid for O(1) lookup.
  const existing = new Map<number, HTMLTableRowElement>();
  for (const tr of tbody.querySelectorAll<HTMLTableRowElement>('tr.game-row')) {
    existing.set(Number(tr.dataset.appid), tr);
  }

  // Insert/move rows into the correct order.
  for (let i = 0; i < desired.length; i++) {
    const game = desired[i];
    let tr = existing.get(game.appid);
    if (!tr) {
      tr = document.createElement('tr');
      tr.className = 'game-row';
      tr.dataset.appid = String(game.appid);
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
function rowCells(game: Game) {
  const thumb = game.details?.meta?.capsule ?? '';
  return `<td class="td-thumb"><img class="game-thumb" src="${esc(thumb)}" alt="" loading="lazy" width="120" height="45" onerror="this.style.visibility='hidden'"></td>
    <td class="td-name">${esc(game.name)}</td>
    <td class="td-score">${renderScoreCell(game)}</td>
    <td class="td-hltb">${renderMainCell(game)}</td>
    <td class="td-hltb">${renderExtraCell(game)}</td>`;
}

// Update an existing <tr>'s cells and active state in place.
function syncRow(tr: HTMLTableRowElement, game: Game) {
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

function sortedGames(groupKey: string | null, filtersActive = hasActiveFilters()) {
  const subset = (groupKey != null ? games.filter(g => g.groupKey === groupKey) : games)
    .filter(g => gameMatchesFilters(g, filtersActive));
  return [...subset].sort((a: GameRow, b: GameRow) => {
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
  const cmp = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });
  const params = new URLSearchParams();
  // Preserve current player slots as-is — already canonical from the last pushState
  const prev = new URLSearchParams(location.search);
  prev.getAll('u').forEach(u => params.append('u', u));
  const sp = sortUrlParam();
  if (sp) params.set('sort', sp);
  const prevGame = prev.get('game');
  if (prevGame) params.set('game', prevGame);
  if (nameFilter) params.set('name', nameFilter);
  // Append filter values in fixed dimension order, each sorted alphabetically
  for (const { key, param } of FILTER_DIMS) {
    [...activeFilters[key]].sort(cmp).forEach(v => params.append(param, v));
  }
  history.replaceState(null, '', `?${reorderUrlParams(params)}`);
}

function hasActiveFilters() {
  return nameFilter !== '' || FILTER_DIMS.some(d => activeFilters[d.key].size > 0);
}

function gameMatchesFilters(game: Game, filtersActive = hasActiveFilters()) {
  if (!filtersActive) return true;
  if (nameFilter && !foldStr(game.name).includes(foldStr(nameFilter))) return false;
  if (!FILTER_DIMS.some(d => activeFilters[d.key].size > 0)) return true;
  if (game.loading) return false;
  return FILTER_DIMS.every(({ key }) => {
    if (!activeFilters[key].size) return true;
    const vals = key === 'tags' ? game.details?.tags : game.details?.meta?.[key];
    if (!vals) return false;
    return vals.some((v: string) => activeFilters[key].has(v));
  });
}

function updateFilterOptions(meta: GameMeta | null | undefined, tags: string[] | null | undefined) {
  const KEYS = FILTER_DIMS.map(d => d.key);
  const newByKey: Record<string, string[]> = Object.fromEntries(KEYS.map(k => [k, []]));
  for (const key of KEYS) {
    const vals = key === 'tags' ? (tags || []) : (meta?.[key] || []);
    for (const v of vals) {
      if (!allOpts[key].has(v)) { allOpts[key].add(v); newByKey[key].push(v); }
    }
  }
  if (KEYS.every(k => !newByKey[k].length)) return;

  const panelEl = document.getElementById('filter-panel')!;
  const needsNewDim = KEYS.some(k =>
    newByKey[k].length > 0 && !panelEl.querySelector(`input[data-search-dim="${k}"]`)
  );

  if (needsNewDim || !panelEl.querySelector('.card')) {
    // Full rebuild needed — preserve focus in search inputs
    const focused = document.activeElement as HTMLInputElement | null;
    const focusedDim = focused?.dataset?.searchDim;
    const selStart = focused?.selectionStart;
    const selEnd = focused?.selectionEnd;
    renderFilterPanel();
    if (focusedDim) {
      const el = panelEl.querySelector<HTMLInputElement>(`input[data-search-dim="${focusedDim}"]`);
      if (el) { el.focus(); try { el.setSelectionRange(selStart ?? null, selEnd ?? null); } catch {} }
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

function applySearch(dim: string, query: string) {
  const q = foldStr(query);
  const inp = document.querySelector(`input[data-search-dim="${dim}"]`);
  if (!inp) return;
  inp.closest('.filter-dim')!.querySelectorAll<HTMLElement>('.filter-opt').forEach(label => {
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

  document.getElementById('filter-panel')!.innerHTML = `
    <div class="card">
      <div class="filter-header">
        <h2>Filter${totalActive ? `<span class="filter-badge">${totalActive}</span>` : ''}</h2>
        <div class="filter-header-actions">
          ${totalActive ? '<button class="btn btn-ghost btn-sm" id="clear-filters-btn">Clear all</button>' : ''}
          <button class="btn btn-ghost btn-sm filter-toggle-btn" id="filter-toggle-btn" aria-expanded="${!filterPanelCollapsed}">${filterPanelCollapsed ? 'Filters ▾' : 'Filters ▴'}</button>
        </div>
      </div>
      ${chips ? `<div class="filter-chips">${chips}</div>` : ''}
      <div class="filter-body"${filterPanelCollapsed ? ' hidden' : ''}>
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
      </div>
    </div>`;

  document.getElementById('filter-toggle-btn')!.addEventListener('click', () => {
    filterPanelCollapsed = !filterPanelCollapsed;
    renderFilterPanel();
  });

  const nameInput = document.getElementById('name-filter-input') as HTMLInputElement | null;
  if (nameInput) {
    nameInput.addEventListener('input', () => {
      nameFilter = nameInput.value;
      refreshTable();
      updateFilterUrl();
    });
  }

  document.getElementById('filter-panel')!.querySelectorAll<HTMLInputElement>('input[data-dim]').forEach(cb => {
    cb.addEventListener('change', () => {
      const dim = cb.dataset.dim as FilterDimKey;
      if (cb.checked) activeFilters[dim].add(cb.value);
      else activeFilters[dim].delete(cb.value);
      refreshTable();
      updateFilterUrl();
      renderFilterPanel();
    });
  });

  document.getElementById('filter-panel')!.querySelectorAll<HTMLInputElement>('input[data-search-dim]').forEach(inp => {
    const dim = inp.dataset.searchDim as FilterDimKey;
    applySearch(dim, filterSearch[dim]);
    inp.addEventListener('input', () => {
      filterSearch[dim] = inp.value;
      applySearch(dim, inp.value);
    });
  });

  document.getElementById('filter-panel')!.querySelectorAll<HTMLElement>('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      activeFilters[chip.dataset.chipDim as FilterDimKey].delete(chip.dataset.chipVal!);
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
