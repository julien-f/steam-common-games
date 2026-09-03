'use strict';

import { createSignal, createRoot, createEffect, For, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import { render } from 'solid-js/web';
import { esc, foldStr, renderScoreCell, renderMainCell, renderExtraCell, normalizeInput } from '/utils.ts';
import { renderOwnersHtml } from '/ownerListHtml.ts';
import { FILTER_DIMS, parseUrlState, reorderUrlParams, setPanelParam, setLightboxParam } from '/urlState.ts';
import { updateNavLink } from '/nav.tsx';
import { stepGameList } from '/panelNav.ts';
import { bindPanelKeyboardShortcuts } from '/panelKeyboard.ts';
import { renderAccountChipsGrouped, bindAccountRefresh, addRecent, renderRecentsBar, bindRecentsBar } from '/accountsBar.ts';
import { initGameSearch, addRecentGame, renderRecentGamesBar, bindRecentGamesBar } from '/gameSearch.ts';
import { openLightbox, isLightboxOpen } from '/lightbox.tsx';
import { createRowStore } from '/rowStore.ts';
import {
  panelOpen, panelClose, isPanelOpen, getPanelGame, panelStepHero,
  pickRandomFrom, clearAllRandomQueues, panelHandleEscape,
  renderPanelBody, bumpPanelNav,
} from '/panel.tsx';
import { initPageShell } from '/pageShell.ts';
import type { PanelOptions } from '/panel.tsx';
import type { Game, GameDetails, Achievements, GameMeta } from '/types.ts';

// ── State ──────────────────────────────────────────────────────────────────

interface GroupGame { appid: number; name: string; }
interface ServerGroup { userIndices: number[]; games: GroupGame[]; }
type Account = { steamid: string; personaname?: string; profileurl?: string };
// A loaded comparison row — the shared Game plus the groupKey this page stamps on it
// (a comma-joined list of slot indices; standalone lookups never get one).
type GameRow = Game & { groupKey?: string | null };

// `games`/`setGames` — a real Solid store, replacing the plain
// mutated-in-place array `rowCache.ts` used to paper over for `<For>`'s own reference-keying (see
// `bundles.tsx`'s own conversion for the full "why a store, why produce()" story). Kept the same
// name `games` rather than renaming to `gamesStore` — a store array reads exactly like a plain
// array everywhere in this file that only ever *reads* it (`.find`/`.filter`/`.length`/etc.), so
// the only real edits are at the handful of sites that used to *reassign* (`games = ...`) or
// *index-mutate* (`games[idx].field = x`) it — those now go through `setGames`/`mutateRow` below.
// `rowStore` (see rowStore.ts) is the O(1) appid -> array index lookup `mutateRow` needs, plus
// the same deliberately plain, never-store-linked per-appid map bundles.tsx/library.tsx both
// needed once panel.tsx turned out to mutate whatever `Game` object it's given directly
// (news/DLC/price loaders) — `getRow`/`openPanel` are this page's own "one normalization point"
// pair, mirroring `bundles.tsx`'s `getRow`/`openGame`.
const [games, setGames] = createStore<GameRow[]>([]);     // flat: { appid, name, groupKey, loading, details }
const rowStore = createRowStore<GameRow>((idx, updater) => setGames(idx, updater));
function getRow(appid: number): GameRow | undefined {
  return rowStore.getRow(appid);
}
function mutateRow(appid: number, fn: (draft: GameRow) => void): GameRow | undefined {
  return rowStore.mutateRow(appid, fn);
}
let groups: ServerGroup[] = [];    // [{ userIndices, games }] — ordered, from server
let slots: Account[][] = [];     // [[{steamid, personaname, profileurl}, ...], ...] — one entry per logical player
let playtime: Record<string, Record<string, number>> = {};  // { [appid]: { [steamId]: minutes } } — per-account playtime for common games
let lastPlayed: Record<string, Record<string, number>> = {}; // { [appid]: { [steamId]: unix seconds } } — per-account last-played timestamp
const DEFAULT_SORT_COL = 'score';
const DEFAULT_SORT_DIR = -1;
let sortCol: string = DEFAULT_SORT_COL;
let sortDir: number = DEFAULT_SORT_DIR;
// `sortCol`/`sortDir` stay plain mutable data, same "a signal only drives rendering" convention
// `activeFilters`/`allOpts`/etc. below already use — they're read from `sortedGames` (called from
// plenty of non-JSX places too) which has no reason to become reactive itself. `sortRev` is the
// one dedicated bump signal; every JSX read that depends on it (`SortableTh` below) calls
// `sortRev()` directly within its own accessor, same idiom `filterRev()`'s own callers use.
const [sortRev, bumpSortRev] = createSignal(0);

// null at the default sort — omitted from the URL entirely rather than writing out `-score`
// on every search, since that's what a bare search already sorts by.
function sortUrlParam(): string | null {
  if (sortCol === DEFAULT_SORT_COL && sortDir === DEFAULT_SORT_DIR) return null;
  return (sortDir < 0 ? '-' : '') + sortCol;
}
let runId = 0;           // increments on each search to cancel stale updates
let streamController: AbortController | null = null; // AbortController for the active detail stream
let refreshDebounceTimer: ReturnType<typeof setTimeout> | undefined;
// Drive the progress bar/text in ResultsView below — replaces `updateProgress`'s old direct
// `#prog-bar`/`#prog-text` DOM writes now that this page's results view is real JSX.
const [progressLoaded, setProgressLoaded] = createSignal(0);
const [progressTotal, setProgressTotal] = createSignal(0);
// A signal, not a plain variable, because GameTableRow (below) reads it directly inside its own
// JSX (the row's `active` class) — every other read/write in this file is plain imperative code,
// where a signal getter/setter behaves exactly like the old bare variable did.
const [activeGameSig, setActiveGameSig] = createSignal<GameRow | null>(null);
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
// user preference for the rest of the session. A real signal (unlike `activeFilters`/
// `allOpts`/etc. below) since it's read directly inside FilterPanelView's own JSX in three
// places (`hidden`, the button label, `aria-expanded`) with no other non-JSX consumer —
// there's no reason to route it through the `filterRev` bump signal below instead. The toggle
// button that flips this is itself only shown on mobile via CSS (see .filter-toggle-btn in
// style.css), so the signal has no effect on desktop.
const [filterPanelCollapsed, setFilterPanelCollapsed] = createSignal(
  typeof matchMedia === 'function' && matchMedia('(max-width: 768px)').matches
);

// A bump signal, not the filter state itself (see FilterPanelView/FilterDim below, near the
// rest of the filtering code, for the full reasoning) — every mutation of `activeFilters`/
// `allOpts`/`filterSearch`/`nameFilter` above calls this right after.
const [filterRev, bumpFilterRev] = createSignal(0);
function markFiltersChanged() { bumpFilterRev(v => v + 1); }

// Keyboard shortcuts modal — same signal + createEffect shape as library.tsx's own conversion.
const shortcutsModalEl = document.getElementById('shortcuts-modal')!;
const shortcutsBackdropEl = document.getElementById('shortcuts-backdrop')!;
const [shortcutsOpen, setShortcutsOpen] = createSignal(false);
createRoot(() => {
  createEffect(() => {
    shortcutsModalEl.classList.toggle('open', shortcutsOpen());
    shortcutsBackdropEl.classList.toggle('open', shortcutsOpen());
  });
});

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
    // This page has no `@vates/data-table-*` instance at all (see panelNav.ts's own comment on
    // why `hasTable` is a plain boolean rather than a real table check), and `getGameList`/
    // `onReroll` both need the *currently open* game, not a page-wide list — a comparison can
    // span several groups, and paging/rerolling only ever makes sense within whichever group the
    // open game itself belongs to.
    nav: {
      hasTable: () => true,
      getGameList: game => sortedGames((game as GameRow).groupKey!),
      onOpen: openPanel,
      onReroll: game => pickRandom((game as GameRow).groupKey!),
    },
    isTagActive: (dim, val) => activeFilters[dim as FilterDimKey].has(val),
    onTagClick: (dim, val) => {
      const k = dim as FilterDimKey;
      if (activeFilters[k].has(val)) activeFilters[k].delete(val);
      else activeFilters[k].add(val);
      refreshTable();
      updateFilterUrl();
      markFiltersChanged();
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
      setActiveGameSig(null);
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

  mountFilterPanel();
  render(() => <AlertsView />, document.getElementById('alerts')!);

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

  // Row clicks and each group's 🎲 button are now bound directly in GameTableRow/GameGroupSection
  // (below) — no delegated `#results` click listener needed anymore now that both are real JSX.

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

  bindPanelKeyboardShortcuts({
    isLightboxOpen,
    isPanelOpen: () => !!activeGameSig(),
    panelClose,
    panelStepHero,
    shortcuts: { isOpen: shortcutsOpen, toggle: toggleShortcuts, close: closeShortcuts },
    focusSearchInput: () => (document.querySelector('#user-inputs input[type="text"]') as HTMLInputElement | null)?.focus(),
    onEnterOnFocusedRow: () => {
      const row = (document.activeElement as HTMLElement | null)?.closest('tr.game-row') as HTMLElement | null;
      const game = row && games.find(g => g.appid === Number(row.dataset.appid));
      if (!game) return false;
      openPanel(game);
      return true;
    },
    // No group to page through or randomize within for a standalone lookup — see PanelNav (panel.tsx).
    pickRandom: () => {
      const ag = activeGameSig();
      if (ag && !ag.standalone) pickRandom(ag.groupKey!);
    },
    stepGame: dir => {
      const ag = activeGameSig();
      if (!ag || ag.standalone) return false;
      const next = stepGameList(true, () => sortedGames(ag.groupKey!), ag, dir);
      if (!next) return false;
      openPanel(next);
      return true;
    },
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
    setGames([]);
    rowStore.reset();
    slots = [];
    for (const s of Object.values(activeFilters)) s.clear();
    for (const s of Object.values(allOpts)) s.clear();
    for (const k of Object.keys(filterSearch)) filterSearch[k as FilterDimKey] = '';
    nameFilter = '';
    markFiltersChanged(); // FilterPanelView (mounted once, see below) hides itself once allOpts is empty
    clearResults();
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

const [alertState, setAlertState] = createSignal<{ msg: string; type: string } | null>(null);

function clearAlerts() { setAlertState(null); }

function showAlert(msg: string, type = 'error') { setAlertState({ msg, type }); }

function AlertsView() {
  return (
    <Show when={alertState()}>
      {a => <div class={`alert alert-${a().type}`}>{a().msg}</div>}
    </Show>
  );
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
    bumpSortRev(v => v + 1);
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
  markFiltersChanged(); // reflect the clears/restores above — FilterPanelView is mounted once, see below
  const accountsBarEl = document.getElementById('accounts-bar')!;
  accountsBarEl.hidden = true;
  accountsBarEl.innerHTML = '';
  document.getElementById('how-it-works')!.hidden = true;
  (document.getElementById('search-btn') as HTMLButtonElement).disabled = true;
  clearResults(`<div style="padding:16px 0;color:var(--text1)"><span class="spinner"></span>${refreshIds ? 'Refreshing' : 'Fetching'} Steam libraries…</div>`);

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
    const initialGames = groups.flatMap(g => {
      const key = g.userIndices.join(',');
      return g.games.map(game => ({ ...game, groupKey: key, loading: true, details: null })) as GameRow[];
    });
    setGames(initialGames);
    rowStore.load(initialGames);
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
    clearResults();
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
    const details = { rating: data.rating, hltb: data.hltb, meta: data.meta, tags: data.tags, demo: data.demo, protondb: data.protondb };
    // `game` may not be one of this comparison's own store-backed rows (a standalone lookup
    // isn't) — mutateRow returns undefined for those, so fall back to mutating the plain
    // standalone object directly, same as before this row data was store-backed.
    const updated = mutateRow(game.appid, draft => { draft.details = details; });
    if (!updated) game.details = details;
    const g = updated ?? game;
    // Standalone lookups (see openStandaloneGame) aren't part of the loaded comparison table —
    // feeding their tags/genres/categories into the table's filter option pool would make the
    // filter card spuriously appear (or gain new options) with no comparison ever having run.
    if (!g.standalone && (g.details?.meta || g.details?.tags)) updateFilterOptions(g.details.meta, g.details.tags);
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

        const g = mutateRow(data.appid, draft => {
          draft.details = { rating: data.rating, hltb: data.hltb, meta: data.meta, tags: data.tags, demo: data.demo, protondb: data.protondb };
          draft.loading = false;
        });
        if (!g) continue;
        loaded++;
        updateProgress(loaded, games.length);
        if (g.details?.meta || g.details?.tags) updateFilterOptions(g.details.meta, g.details.tags);
        if (activeGameSig()?.appid === g.appid) renderPanel();
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
  const ag = activeGameSig();
  if (ag) {
    document.title = `${ag.name} — Steam Common Games`;
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

// The one place `#results`' innerHTML is ever set — always disposes the previous search's
// mounted `ResultsView` root first, so "never clear/replace #results without disposing" is
// structural (every call site funnels through here) rather than a comment convention each
// direct `innerHTML =` site had to remember on its own (which is exactly how two of them ended
// up leaking group mounts before this — see CHANGELOG).
let disposeResultsView: (() => void) | null = null;
function disposeGroupMounts() {
  disposeResultsView?.();
  disposeResultsView = null;
  groupMounts.clear();
}
function clearResults(html = ''): void {
  disposeGroupMounts();
  document.getElementById('results')!.innerHTML = html;
}

function renderPage() {
  updateTitle();
  updateLibraryExplorerLink();
  // Reset before the fresh mount below reads them — without this, a new search would
  // momentarily render with whatever progress values the *previous* search left behind, until
  // loadAllDetails' own updateProgress(0, ...) call catches up a moment later.
  setProgressLoaded(0);
  setProgressTotal(games.length);
  clearResults();
  disposeResultsView = render(() => <ResultsView />, document.getElementById('results')!);
}

// ── Results view — one real Solid root per search (mounted/disposed by renderPage/clearResults
// above), replacing what used to be a hand-built HTML template string rebuilt from scratch on
// every search plus a manual `querySelectorAll('thead th[data-col]')` sort-header rebind. `<For>`
// is reference-keyed on `groups` (a plain array, snapshotted once per mount, same "games/groups
// stay plain" convention `filterRev`'s own comment above describes) — group membership/order
// only ever changes via a brand-new search, which already gets a brand-new mount.
function ResultsView() {
  const sortedSlotIndices = [...slots.keys()].sort((a, b) =>
    slotDisplayName(a).toLowerCase().localeCompare(slotDisplayName(b).toLowerCase())
  );
  const playerList = sortedSlotIndices.map(i => slotHtml(i)).join(', ');
  // filterRev()-gated, same idiom FilterPanelView's own accessors above use — the raw counts
  // this reads (`games`/`activeFilters`/`nameFilter`) are all plain data with no signal of their
  // own.
  const resultsCountText = () => {
    filterRev();
    const filtersActive = hasActiveFilters();
    const filtered = filtersActive ? games.filter(g => gameMatchesFilters(g, filtersActive)).length : games.length;
    const gameLabel = slots.length === 1 ? 'games' : 'shared games';
    return filtersActive ? `${filtered} / ${games.length} ${gameLabel}` : `${games.length} ${gameLabel}`;
  };
  return (
    <>
      <div class="results-header">
        <h2 id="results-count">{resultsCountText()}</h2>
        <Show when={playerList}>
          <div class="results-meta" innerHTML={`${slots.length === 1 ? 'library of' : 'across'} ${playerList}`} />
        </Show>
      </div>
      <div class="progress-wrap">
        <div class="progress-text" id="prog-text">
          {progressLoaded() >= progressTotal() ? `All ${progressTotal()} details loaded` : `Loading details… ${progressLoaded()} / ${progressTotal()}`}
        </div>
        <div class="progress-bar-bg">
          <div
            class="progress-bar"
            id="prog-bar"
            style={{
              width: `${progressTotal() ? Math.round(progressLoaded() / progressTotal() * 100) : 0}%`,
              background: progressLoaded() >= progressTotal() ? '#a3cf4e' : undefined,
            }}
          />
        </div>
      </div>
      <For each={groups}>{group => <GameGroupSection group={group} />}</For>
    </>
  );
}

// One table per ownership group. Owns its own row-list signal (`rows`/`setRows`), registered
// into `groupMounts` on mount so `refreshTable` (debounced during the SSE detail stream — see
// its own comment) can push a freshly sorted/filtered list into just this group without
// re-sorting/re-filtering every group on every single streamed event. `count`/`usersHtml` are
// the group's raw membership — static for this mount, unaffected by filters — unlike `rows`'
// own length, which does reflect the current filters and drives this group's visibility.
function GameGroupSection(props: { group: ServerGroup }) {
  const key = props.group.userIndices.join(',');
  const count = props.group.games.length;
  const usersHtml = groupSlotsHtml(props.group.userIndices);
  const [rows, setRows] = createSignal<GameRow[]>(sortedGames(key));
  groupMounts.set(key, { setRows });
  return (
    <div class="game-group" id={`group-${key}`} style={{ display: rows().length === 0 ? 'none' : undefined }}>
      <div class="group-header">
        <span class="group-title" innerHTML={usersHtml} />
        <span class="group-meta">{count} game{count !== 1 ? 's' : ''}</span>
        <button
          type="button"
          class="group-random-btn"
          aria-label="Pick a random game from this group"
          title="Pick a random game"
          onClick={() => pickRandom(key)}
        >🎲</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th class="td-thumb" />
            <SortableTh col="name" label="Game" />
            <SortableTh col="score" label="Score" />
            <SortableTh col="main" label="Main Story" />
            <SortableTh col="extra" label="Main + Extra" />
          </tr></thead>
          <tbody>
            <For each={rows()}>{game => <GameTableRow game={game} />}</For>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Replaces the old `thHtml` string-builder + the manual `querySelectorAll('thead th[data-col]')`
// click-rebind `renderPage` used to redo on every search. `sortCol`/`sortDir` stay the plain
// module-level variables `sortedGames` already reads (see `sortRev`'s own comment above) —
// `isActive`/`icon` are `sortRev()`-gated accessors, same idiom `FilterDim`'s own `isChecked`
// above uses for `activeFilters`.
function SortableTh(props: { col: string; label: string }) {
  const isActive = () => { sortRev(); return sortCol === props.col; };
  const icon = () => { sortRev(); return sortCol === props.col ? (sortDir > 0 ? '↑' : '↓') : '↕'; };
  return (
    <th
      classList={{ sortable: true, active: isActive() }}
      onClick={() => {
        if (sortCol === props.col) sortDir = -sortDir;
        else { sortCol = props.col; sortDir = props.col === 'name' ? 1 : -1; }
        bumpSortRev(v => v + 1);
        updateFilterUrl();
      }}
    >
      <div class="th-inner">{props.label}<span class="sort-icon">{icon()}</span></div>
    </th>
  );
}

// Row identity/reference discipline is the `games` store itself (see its own comment above) —
// `<For>` is reference-keyed, but since each array item is a store-proxied object, this
// component's own per-cell JSX reads update independently of whether `<For>` re-invokes the row
// at all, the same mechanism `@vates/data-table-solid`'s per-cell rendering uses (confirmed by
// reading its source — see bundles.tsx's own comment). No rowCache.ts-style reference-copy
// trick needed; this page no longer imports that file.
function GameTableRow(props: { game: GameRow }) {
  const g = () => props.game;
  return (
    <tr
      class="game-row"
      classList={{ active: activeGameSig()?.appid === g().appid }}
      tabIndex={0}
      data-appid={g().appid}
      onClick={e => { if ((e.target as Element).closest('a')) return; openPanel(g()); }}
    >
      <td class="td-thumb">
        <img
          class="game-thumb"
          src={g().details?.meta?.capsule ?? ''}
          alt=""
          loading="lazy"
          width={120}
          height={45}
          onError={e => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }}
        />
      </td>
      <td class="td-name">{g().name}</td>
      <td class="td-score" innerHTML={renderScoreCell(g())} />
      <td class="td-hltb" innerHTML={renderMainCell(g())} />
      <td class="td-hltb" innerHTML={renderExtraCell(g())} />
    </tr>
  );
}

interface GroupMount { setRows: (rows: GameRow[]) => void; }
let groupMounts = new Map<string, GroupMount>();

function updateProgress(loaded: number, total: number) {
  setProgressLoaded(loaded);
  setProgressTotal(total);
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
    if (cached) { game.achievements = cached; if (activeGameSig() === game) renderPanelBody(game); return; }
  }
  game.achievementsLoading = true;
  if (activeGameSig() === game) renderPanelBody(game);
  try {
    const res = await fetch(`/api/achievements/${game.appid}${force ? '?refresh=1' : ''}`);
    const data = await res.json();
    if (res.ok) achievementsCache.set(game.appid, data);
    game.achievements = res.ok ? data : null;
  } catch {
    game.achievements = null;
  } finally {
    game.achievementsLoading = false;
    if (activeGameSig() === game) renderPanelBody(game); // no-op if the user moved on mid-fetch
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
    if (activeGameSig() === game) { renderPanelBody(game); updateTitle(); } // no-op if the user moved on mid-fetch
    addRecentGame(game.appid, game.name, game.details.meta?.capsule || null);
    renderRecentGamesBar(document.getElementById('recent-games-bar')!);
  } catch (err) {
    if (activeGameSig() === game) showAlert(err instanceof Error ? err.message : String(err));
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
  const pick = pickRandomFrom(list, groupKey, activeGameSig()?.appid ?? -1);
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
  // Always open against the plain panelRows copy, never a `games` store proxy — see that store's
  // own comment for why (panel.tsx's lazy loaders mutate whatever object they're given directly,
  // which a Solid store blocks). A `game` not in panelRows (a standalone lookup) falls through to
  // whatever was actually passed, unchanged from before.
  const resolved = getRow(game.appid) ?? game;
  setActiveGameSig(resolved);
  panelOpen(resolved, { keepHistory }); // shared: renders hero+body, opens the panel, focuses it
  updateTitle();
  bumpPanelNav();
  refreshTable(); // re-render rows so the active highlight appears
  document.getElementById(`tbody-${resolved.groupKey}`)?.querySelector(`tr.game-row[data-appid="${resolved.appid}"]`)?.scrollIntoView({ block: 'nearest' });
  // Standalone lookups are restorable too (see restorePanelFromUrl's fallback to
  // openStandaloneGame below), so `?game=` is set unconditionally.
  setPanelParam(resolved.appid);
}

// Lightbox's own ↑/↓ handler (see initLightbox below) — same game-list step the
// document keydown handler above does when the lightbox is closed, but also jumps
// straight into the new game's lightbox at shot 0 rather than leaving the lightbox
// closed behind it. No-ops with no group to page through, same guard as above. `stepGameList`
// (panelNav.ts, shared with library.tsx/bundles.tsx) does the "current index, wrap around"
// arithmetic; `table: true` since this page has no @vates table instance to guard against —
// see panelNav.ts's own comment on why that param is only ever checked for truthiness.
function navigateLightboxGame(dir: number) {
  const ag = activeGameSig();
  const next = stepGameList(true, () => sortedGames(ag!.groupKey!), ag, dir as 1 | -1);
  if (!next) return;
  openPanel(next);
  // sortedGames() reads off the `games` store, so `next` may be a store proxy — resolve to the
  // same plain panelRows copy openPanel just opened the panel with, same reasoning as its own
  // comment above.
  openLightbox(getRow(next.appid) ?? next, 0);
}

function openShortcuts() { setShortcutsOpen(true); }
function closeShortcuts() { setShortcutsOpen(false); }
function toggleShortcuts() { setShortcutsOpen(!shortcutsOpen()); }

function restorePanelFromUrl(restoreShot: string | null = null) {
  const params = new URLSearchParams(location.search);
  const appid = Number(params.get('game'));
  if (!appid) return;
  const game = games.find(g => g.appid === appid);
  if (game) {
    if (activeGameSig()?.appid !== appid) openPanel(game);
    const shotParam = restoreShot ?? params.get('shot');
    if (shotParam !== null && !game.loading) openLightbox(getRow(appid) ?? game, shotParam);
    return;
  }
  // Not (yet) part of the loaded comparison — e.g. a game nobody in it owns, or no
  // comparison loaded at all. Fetch it directly instead of silently giving up, same as
  // library.js's equivalent fallback — its name isn't known yet (see openStandaloneGame),
  // so the panel opens with a placeholder title until the fetch resolves it.
  if (activeGameSig()?.appid === appid) return; // already open / fetch already in flight
  openStandaloneGame(appid);
}

function renderPanel() {
  const ag = activeGameSig();
  if (!ag) return;
  bumpPanelNav(); // panel.tsx's own PanelNav recomputes off sortedGames(ag.groupKey!) via the `nav` option
  renderPanelBody(ag); // shared: rebuilds hero + body from panel.js
}

// Pushes a freshly sorted/filtered row list into each group's own signal (see GameGroupSection
// above) — the sort-header active/icon state and the results-count text don't need any
// handling here anymore, both being real reactive JSX now (`SortableTh`'s `sortRev()`,
// `ResultsView`'s `resultsCountText()`), and neither does a group's own show/hide-when-empty
// toggle, which now falls straight out of its `style` binding once `setRows` updates `rows()`.
function refreshTable() {
  const filtersActive = hasActiveFilters();
  for (const group of groups) {
    const key = group.userIndices.join(',');
    const gm = groupMounts.get(key);
    if (!gm) continue;
    gm.setRows(sortedGames(key, filtersActive));
  }
  if (activeGameSig()) bumpPanelNav();
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

// `activeFilters`/`allOpts`/`filterSearch`/`nameFilter` all stay plain
// mutable data — same "games/groups stay plain, a signal only drives rendering" convention step 1
// used for the comparison tables — since they're read from plenty of non-JSX places
// (gameMatchesFilters, updateFilterUrl, the panel's isTagActive/onTagClick options) that have no
// reason to become reactive. `filterRev` is the one dedicated signal, bumped by
// `markFiltersChanged()` right after any of that plain data is mutated — every read inside
// FilterPanelView/FilterDim below that depends on it calls `filterRev()` directly within its own
// JSX (not hoisted into a top-level `const` first), per the pilot's retrospective.
function updateFilterOptions(meta: GameMeta | null | undefined, tags: string[] | null | undefined) {
  const KEYS = FILTER_DIMS.map(d => d.key);
  let changed = false;
  for (const key of KEYS) {
    const vals = key === 'tags' ? (tags || []) : (meta?.[key] || []);
    for (const v of vals) {
      if (!allOpts[key].has(v)) { allOpts[key].add(v); changed = true; }
    }
  }
  // A real Solid <For> re-renders only the dimension(s) that actually gained new options (or a
  // brand-new dimension's whole subtree, on its first option) without touching any other
  // dimension's DOM — the old "surgical append vs. full rebuild, plus manually save/restore
  // search-input focus" dance existed purely to fake that same behavior by hand over raw
  // `innerHTML` rebuilds, and isn't needed anymore.
  if (changed) markFiltersChanged();
}

function FilterDim(props: { dim: typeof FILTER_DIMS[number] }) {
  const options = () => {
    filterRev();
    const key = props.dim.key;
    const q = foldStr(filterSearch[key]);
    return [...allOpts[key]].sort().filter(v => !q || foldStr(v).includes(q));
  };
  const isChecked = (v: string) => { filterRev(); return activeFilters[props.dim.key].has(v); };
  return (
    <div class="filter-dim">
      <div class="filter-dim-title">{props.dim.label}</div>
      <input
        class="filter-search"
        type="search"
        placeholder="Search…"
        data-search-dim={props.dim.key}
        // Deliberately not read through filterRev() the way nameFilterValue() (FilterPanelView)
        // is — unlike nameFilter, nothing ever mutates `filterSearch[key]` except this same
        // input's own onInput below (the DOM's own value already reflects that), and the one
        // thing that does clear it (a fresh search) also clears `allOpts` to empty first, which
        // tears down and recreates this whole FilterDim once options exist again — so this value
        // is always fresh at the point a new instance actually reads it.
        value={filterSearch[props.dim.key]}
        onInput={e => {
          filterSearch[props.dim.key] = e.currentTarget.value;
          markFiltersChanged();
        }}
      />
      <div class="filter-opts">
        <For each={options()}>
          {v => (
            <label class="filter-opt">
              <input
                type="checkbox"
                data-dim={props.dim.key}
                value={v}
                checked={isChecked(v)}
                onChange={e => {
                  if (e.currentTarget.checked) activeFilters[props.dim.key].add(v);
                  else activeFilters[props.dim.key].delete(v);
                  refreshTable();
                  updateFilterUrl();
                  markFiltersChanged();
                }}
              />
              {' ' + v}
            </label>
          )}
        </For>
      </div>
    </div>
  );
}

function FilterPanelView() {
  const activeDims = () => { filterRev(); return FILTER_DIMS.filter(d => allOpts[d.key].size > 0); };
  const totalActive = () => {
    filterRev();
    return FILTER_DIMS.reduce((n, d) => n + activeFilters[d.key].size, 0) + (nameFilter ? 1 : 0);
  };
  const chips = () => {
    filterRev();
    return FILTER_DIMS.flatMap(d => [...activeFilters[d.key]].sort().map(v => ({ dim: d, val: v })));
  };
  // `nameFilter` itself is plain data (see the comment above `updateFilterOptions`) — this is the
  // one place that needs a `filterRev()`-gated read of it, so the input's own `value` resets when
  // "Clear all" sets `nameFilter = ''` elsewhere. Without it, this binding has no signal
  // dependency at all and only ever applies once, at mount (same class of bug as `checked`/
  // `hidden` below and in FilterDim — a JSX attribute only re-runs when something it reads
  // during evaluation is itself a signal).
  const nameFilterValue = () => { filterRev(); return nameFilter; };
  return (
    <Show when={activeDims().length > 0}>
      <div class="card">
        <div class="filter-header">
          <h2>Filter<Show when={totalActive() > 0}><span class="filter-badge">{totalActive()}</span></Show></h2>
          <div class="filter-header-actions">
            <Show when={totalActive() > 0}>
              <button
                class="btn btn-ghost btn-sm"
                onClick={() => {
                  for (const s of Object.values(activeFilters)) s.clear();
                  nameFilter = '';
                  refreshTable();
                  updateFilterUrl();
                  markFiltersChanged();
                }}
              >Clear all</button>
            </Show>
            <button
              class="btn btn-ghost btn-sm filter-toggle-btn"
              aria-expanded={!filterPanelCollapsed()}
              onClick={() => setFilterPanelCollapsed(v => !v)}
            >{filterPanelCollapsed() ? 'Filters ▾' : 'Filters ▴'}</button>
          </div>
        </div>
        <Show when={chips().length > 0}>
          <div class="filter-chips">
            <For each={chips()}>
              {chip => (
                <span class="filter-chip">
                  <span class="filter-chip-label">{chip.dim.label}: {chip.val}</span>
                  <span
                    class="filter-chip-x"
                    onClick={() => {
                      activeFilters[chip.dim.key].delete(chip.val);
                      refreshTable();
                      updateFilterUrl();
                      markFiltersChanged();
                    }}
                  >×</span>
                </span>
              )}
            </For>
          </div>
        </Show>
        <div class="filter-body" hidden={filterPanelCollapsed()}>
          <div class="filter-name-row">
            <input
              class="filter-search filter-name-input"
              type="search"
              placeholder="Search by name…"
              value={nameFilterValue()}
              onInput={e => {
                nameFilter = e.currentTarget.value;
                refreshTable();
                updateFilterUrl();
                markFiltersChanged();
              }}
            />
          </div>
          <div class="filter-dims">
            <For each={activeDims()}>{d => <FilterDim dim={d} />}</For>
          </div>
        </div>
      </div>
    </Show>
  );
}

// Mounted once (see the DOMContentLoaded handler above) rather than rebuilt per search — every
// search/reset/tag-click/checkbox path above just mutates the plain filter data and calls
// `markFiltersChanged()`; the `<Show>`s inside FilterPanelView already hide the whole card once
// `allOpts` goes back to empty, so there's nothing left for those callers to clear by hand.
function mountFilterPanel() {
  render(() => <FilterPanelView />, document.getElementById('filter-panel')!);
}
