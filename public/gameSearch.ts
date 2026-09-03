// Shared "look up any game" widget — used by both the comparison page (app.tsx) and the
// Library Explorer (library.tsx) to open the shared game detail side panel (panel.tsx) for an
// arbitrary Steam game, independent of anyone's library or wishlist. The pure, JSX-free logic
// lives here; the actual rendering/mounting (`initGameSearch`, the recent-games bar) is
// `gameSearch.tsx` — same split as `panelNav.ts`/`accountsBar.ts` and their own `.tsx`
// counterparts, kept plain `.ts` specifically so Node's test runner (no JSX transform) can still
// cover it directly.
//
// initGameSearch({ inputEl, resultsEl, onSelect }) (gameSearch.tsx):
//  - inputEl:   the text input the user types a name, appid, or store URL into
//  - resultsEl: container the dropdown of name-search matches renders into (hidden when empty)
//  - onSelect({ appid, name }): called when the user picks a result, or presses Enter with a
//    raw appid/store URL typed in (name is '' in that case — the caller derives it from store
//    metadata once /api/game-details resolves, same as it already does for wishlist rows with
//    no name of their own)

export interface GameSearchResult {
  appid: number;
  name: string;
  tinyImage: string | null;
}

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

// One search-result row's worth of derived display data (`GameSearchResultBtn` in
// gameSearch.tsx). `active`: true for the result currently highlighted via ArrowUp/ArrowDown
// (not hover — hover is native `:hover`/`:focus-visible` CSS, this is the keyboard roving
// selection) — passed straight through rather than recomputed, since only the caller
// (`initGameSearch`) knows the current `activeIdx`.
export interface GameSearchResultView {
  appid: number;
  name: string;
  safeThumb: string;
  active: boolean;
}

export function computeGameSearchResultView(r: GameSearchResult, active: boolean): GameSearchResultView {
  const safeThumb = /^https?:\/\//i.test(r.tinyImage || '') ? r.tinyImage! : '';
  return { appid: r.appid, name: r.name, safeThumb, active };
}

// ── Recently looked-up games (localStorage) ─────────────────────────────────
// Unlike accountsBar.ts's "Recent:" row (namespaced per page — a Library Explorer player
// search and a comparison-page search aren't interchangeable), a game looked up via this
// box means the same thing regardless of which page it was looked up from, so both pages
// read/write one shared, un-namespaced list. Purely a client-side convenience — never sent
// to the server. Callers (see openStandaloneGame in app.tsx, openStandaloneLookup in
// library.tsx) call `addRecentGame` once a game's real name/thumbnail is known (resolved
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

// One recent-game chip's worth of derived display data (`RecentGameChip` in gameSearch.tsx).
export interface RecentGameChipView {
  label: string;
  safeThumb: string;
}

export function computeRecentGameChipView(entry: RecentGame): RecentGameChipView {
  const label = entry.name || `App ${entry.appid}`;
  const safeThumb = /^https?:\/\//i.test(entry.tinyImage || '') ? entry.tinyImage! : '';
  return { label, safeThumb };
}
