import { esc } from './utils.ts';

export interface GameSearchResult {
  appid: number;
  name: string;
  tinyImage: string | null;
}

// Shared "look up any game" widget — used by both the comparison page (app.js) and the
// Library Explorer (library.js) to open the shared game detail side panel (panel.js) for an
// arbitrary Steam game, independent of anyone's library or wishlist. An ES module, importing
// `esc()` from utils.js, same as accountsBar.js.
//
// initGameSearch({ inputEl, resultsEl, onSelect }):
//  - inputEl:   the text input the user types a name, appid, or store URL into
//  - resultsEl: container the dropdown of name-search matches renders into (hidden when empty)
//  - onSelect({ appid, name }): called when the user picks a result, or presses Enter with a
//    raw appid/store URL typed in (name is '' in that case — the caller derives it from store
//    metadata once /api/game-details resolves, same as it already does for wishlist rows with
//    no name of their own)

export const GAME_SEARCH_DEBOUNCE_MS = 300;
export const GAME_SEARCH_MIN_CHARS = 2;

// Recognizes a bare appid ("1245620") or a Steam store URL containing "/app/<id>" — either
// way, no name search is needed; the appid alone is enough to open the panel.
export function parseDirectAppid(raw: string): number | null {
  const text = raw.trim();
  if (/^\d+$/.test(text)) return Number(text);
  const m = text.match(/\/app\/(\d+)/);
  return m ? Number(m[1]) : null;
}

// `active`: true for the result currently highlighted via ArrowUp/ArrowDown (not hover —
// hover is native `:hover`/`:focus-visible` CSS, this is the keyboard roving selection).
// `id` + `role="option"` back `inputEl`'s `aria-activedescendant` in initGameSearch below;
// `tabindex="-1"` keeps real DOM focus on the input the whole time, same combobox pattern
// as a native `<select>`'s listbox — arrow keys move the highlight, not focus itself.
export function gameSearchResultHtml(r: GameSearchResult, active: boolean): string {
  const thumb = r.tinyImage
    ? `<img class="game-search-thumb" src="${esc(r.tinyImage)}" alt="" loading="lazy">`
    : '<span class="game-search-thumb game-search-thumb--empty"></span>';
  return `
    <button type="button" id="game-search-opt-${r.appid}" role="option" aria-selected="${active}" tabindex="-1"
      class="game-search-result${active ? ' active' : ''}" data-appid="${r.appid}" data-name="${esc(r.name)}">
      ${thumb}
      <span class="game-search-name">${esc(r.name)}</span>
    </button>
  `;
}

export function initGameSearch({ inputEl, resultsEl, onSelect }: {
  inputEl: HTMLInputElement;
  resultsEl: HTMLElement;
  onSelect: (game: GameSearchResult) => void;
}) {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let lastResults: GameSearchResult[] = [];
  let activeFetch = 0; // guards against a slower earlier request clobbering a faster later one
  let activeIdx = -1;  // ArrowUp/ArrowDown highlight; -1 = none yet (Enter falls back to the top match)

  resultsEl.setAttribute('role', 'listbox');
  inputEl.setAttribute('aria-autocomplete', 'list');
  inputEl.setAttribute('aria-expanded', 'false');
  if (resultsEl.id) inputEl.setAttribute('aria-controls', resultsEl.id);

  function renderResults() {
    resultsEl.innerHTML = lastResults.map((r, i) => gameSearchResultHtml(r, i === activeIdx)).join('');
    if (activeIdx >= 0) inputEl.setAttribute('aria-activedescendant', `game-search-opt-${lastResults[activeIdx].appid}`);
    else inputEl.removeAttribute('aria-activedescendant');
  }

  function showResults(results: GameSearchResult[]) {
    lastResults = results;
    activeIdx = -1;
    if (!results.length) { hideResults(); return; }
    renderResults();
    resultsEl.hidden = false;
    inputEl.setAttribute('aria-expanded', 'true');
  }

  function hideResults() {
    lastResults = [];
    activeIdx = -1;
    resultsEl.hidden = true;
    resultsEl.innerHTML = '';
    inputEl.setAttribute('aria-expanded', 'false');
    inputEl.removeAttribute('aria-activedescendant');
  }

  // dir: 1 (ArrowDown) or -1 (ArrowUp). Wraps at both ends, same `(idx + dir + len) % len`
  // convention panel.js/library.js use for prev/next game paging — except the very first
  // press, which has no current index to offset from: ArrowDown starts at the top result,
  // ArrowUp starts at the bottom one, matching most native combobox widgets.
  function moveActive(dir: number) {
    if (!lastResults.length) return;
    activeIdx = activeIdx === -1
      ? (dir > 0 ? 0 : lastResults.length - 1)
      : (activeIdx + dir + lastResults.length) % lastResults.length;
    renderResults();
    resultsEl.querySelector('.game-search-result.active')?.scrollIntoView({ block: 'nearest' });
  }

  async function runSearch(term: string) {
    const fetchId = ++activeFetch;
    try {
      const res = await fetch(`/api/search-games?q=${encodeURIComponent(term)}`);
      const data = await res.json();
      if (fetchId !== activeFetch) return; // a newer keystroke's request already landed
      showResults(res.ok ? (data.results || []) : []);
    } catch {
      if (fetchId === activeFetch) hideResults();
    }
  }

  function pick(game: GameSearchResult) {
    hideResults();
    inputEl.value = game.name || '';
    onSelect(game);
  }

  inputEl.addEventListener('input', () => {
    if (debounceTimer != null) clearTimeout(debounceTimer);
    const term = inputEl.value.trim();
    // A raw appid/URL doesn't need a name search — hide any stale dropdown instead.
    if (term.length < GAME_SEARCH_MIN_CHARS || parseDirectAppid(term) != null) { hideResults(); return; }
    debounceTimer = setTimeout(() => runSearch(term), GAME_SEARCH_DEBOUNCE_MS);
  });

  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Escape') { hideResults(); return; }
    if (e.key === 'ArrowDown') { if (lastResults.length) e.preventDefault(); moveActive(1); return; }
    if (e.key === 'ArrowUp')   { if (lastResults.length) e.preventDefault(); moveActive(-1); return; }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const term = inputEl.value.trim();
    if (!term) return;
    const directAppid = parseDirectAppid(term);
    if (directAppid != null) { pick({ appid: directAppid, name: '', tinyImage: null }); return; }
    if (activeIdx >= 0 && lastResults[activeIdx]) { pick(lastResults[activeIdx]); return; }
    if (lastResults.length) pick(lastResults[0]); // no arrow-key highlight yet — same as clicking the top match
  });

  resultsEl.addEventListener('click', e => {
    const btn = (e.target as Element).closest('.game-search-result') as HTMLElement | null;
    if (!btn) return;
    pick({ appid: Number(btn.dataset.appid), name: btn.dataset.name ?? '', tinyImage: null });
  });

  // Dismiss the dropdown on outside click, same convention as recentsBar-style widgets.
  document.addEventListener('click', e => {
    if (e.target !== inputEl && !resultsEl.contains(e.target as Node)) hideResults();
  });
}

// ── Recently looked-up games (localStorage) ─────────────────────────────────
// Unlike accountsBar.js's "Recent:" row (namespaced per page — a Library Explorer player
// search and a comparison-page search aren't interchangeable), a game looked up via this
// box means the same thing regardless of which page it was looked up from, so both pages
// read/write one shared, un-namespaced list. Purely a client-side convenience — never sent
// to the server. Callers (see openStandaloneGame in app.js, openStandaloneLookup in
// library.js) call `addRecentGame` once a game's real name/thumbnail is known (resolved
// from store metadata, or already on hand for a game that turned out to already be loaded)
// — never with the `App <appid>` placeholder a fetch-in-flight game opens with.

export const RECENT_GAMES_KEY = 'recent-games';
export const MAX_RECENT_GAMES = 10;

export interface RecentGame {
  appid: number;
  name: string;
  tinyImage: string | null;
}

export function loadRecentGames(): RecentGame[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_GAMES_KEY) ?? 'null');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return []; // corrupt/blocked storage — behave as if there's no history
  }
}

export function saveRecentGames(list: RecentGame[]) {
  try { localStorage.setItem(RECENT_GAMES_KEY, JSON.stringify(list)); } catch { /* storage full/blocked — drop silently */ }
}

// Moves this game to the front, refreshing its cached name/thumbnail, rather than
// appending a duplicate.
export function addRecentGame(appid: number, name: string, tinyImage?: string | null) {
  const rest = loadRecentGames().filter(g => g.appid !== appid);
  rest.unshift({ appid, name, tinyImage: tinyImage || null });
  saveRecentGames(rest.slice(0, MAX_RECENT_GAMES));
}

export function removeRecentGame(appid: number) {
  saveRecentGames(loadRecentGames().filter(g => g.appid !== appid));
}

export function recentGameChipHtml(entry: RecentGame): string {
  const label = esc(entry.name || `App ${entry.appid}`);
  const safeThumb = /^https?:\/\//i.test(entry.tinyImage || '') ? entry.tinyImage : '';
  return `
    <span class="recent-chip">
      <button type="button" class="recent-chip-btn" data-appid="${entry.appid}" title="Look up ${label}">
        ${safeThumb ? `<img class="recent-chip-avatar" src="${esc(safeThumb)}" alt="">` : ''}
        ${label}
      </button>
      <button type="button" class="recent-chip-remove" data-appid="${entry.appid}" title="Remove from recent">×</button>
    </span>
  `;
}

export function renderRecentGamesBar(containerEl: HTMLElement) {
  const recents = loadRecentGames();
  if (recents.length === 0) { containerEl.hidden = true; containerEl.innerHTML = ''; return; }
  containerEl.innerHTML = `
    <span class="recents-label">Recently looked up:</span>
    ${recents.map(recentGameChipHtml).join('')}
    <button type="button" class="recents-clear">Clear</button>
  `;
  containerEl.hidden = false;
}

// `onLoad(appid, name)` opens the remembered game — same shape as bindRecentsBar in
// accountsBar.js, but keyed directly on the appid rather than an opaque id/data pair since
// a game is always just its appid.
export function bindRecentGamesBar(containerEl: HTMLElement, onLoad: (appid: number, name: string) => void) {
  containerEl.addEventListener('click', e => {
    const loadBtn = (e.target as Element).closest('.recent-chip-btn') as HTMLElement | null;
    if (loadBtn) {
      const appid = Number(loadBtn.dataset.appid);
      const entry = loadRecentGames().find(g => g.appid === appid);
      if (entry) onLoad(entry.appid, entry.name);
      return;
    }
    const removeBtn = (e.target as Element).closest('.recent-chip-remove') as HTMLElement | null;
    if (removeBtn) { removeRecentGame(Number(removeBtn.dataset.appid)); renderRecentGamesBar(containerEl); return; }
    if ((e.target as Element).closest('.recents-clear')) { saveRecentGames([]); renderRecentGamesBar(containerEl); }
  });
}
