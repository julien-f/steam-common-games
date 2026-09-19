// /search?q=<term> — search for a game straight from a URL, e.g. as a Firefox keyword bookmark
// (docs/user/features.md). Not one of ListRoute's kinds — no ratings/HLTB/price of its own — but
// its results render through the same `@vates/data-table-solid` table every other list route
// uses (a minimal two-column config, not `gameColumns.ts`'s `CORE_COLUMNS`), which is what gets
// this page its keyboard row navigation for free; opening a result uses the same shared side
// panel every other route uses, and participates in its usual step/random/lightbox nav.
import { createSignal, createEffect, on, onMount, onCleanup, Show } from 'solid-js';
import { useLocation } from '@solidjs/router';
import { createTableState, DataTableView } from '@vates/data-table-solid';
import type { ColumnDef } from '@vates/data-table-solid';
import { setBaseTitle } from './pageTitle.ts';
import { registerRouteHandlers } from './AppShell.tsx';
import { panelOpen, getPanelGame, pickRandomFrom } from './panel.tsx';
import { renderPanelNav, stepGameList } from './panelNav.ts';
import { setPanelParam, setSearchQueryParam, parseUrlState } from './urlState.ts';
import { addRecentGame } from './recentGames.ts';
import { peekMyOwnershipStatus, onMyOwnershipReady } from './myOwnership.ts';
import { GAME_SEARCH_DEBOUNCE_MS, GAME_SEARCH_MIN_CHARS } from './gameSearch.ts';
import type { GameSearchResult } from './gameSearch.ts';
import type { Game } from './types.ts';

// Mirrors CORE_COLUMNS' own identity pair (gameColumns.ts) — a fixed-width thumb column plus a
// Name column with inline ownership badges — but over GameSearchResult's bare {appid, name,
// tinyImage} rather than a full Game row, and with no sort/filter/group (this is a one-off result
// set, not a durable list worth those controls). `render` returns a plain DOM Node, the same
// convention CORE_COLUMNS' own renderThumb/renderNameCell use, not tracked JSX — see the
// ownership-badge effect below for how a badge arriving late still reaches the screen.
function renderThumb(_value: unknown, row: GameSearchResult): Node {
  if (!row.tinyImage) {
    const span = document.createElement('span');
    span.className = 'game-search-thumb game-search-thumb--empty';
    return span;
  }
  const img = document.createElement('img');
  img.className = 'game-search-thumb';
  img.alt = '';
  img.loading = 'lazy';
  img.src = row.tinyImage;
  return img;
}

function renderName(_value: unknown, row: GameSearchResult): Node {
  const wrap = document.createElement('span');
  wrap.className = 'game-search-name';
  wrap.appendChild(document.createTextNode(row.name));
  const status = peekMyOwnershipStatus(row.appid);
  if (status?.inLibrary) {
    const b = document.createElement('span');
    b.className = 'game-search-badge owned';
    b.title = 'Owned';
    b.textContent = '✓';
    wrap.appendChild(b);
  }
  if (status?.onWishlist) {
    const b = document.createElement('span');
    b.className = 'game-search-badge wishlisted';
    b.title = 'On wishlist';
    b.textContent = '☆';
    wrap.appendChild(b);
  }
  return wrap;
}

const SEARCH_COLUMNS: ColumnDef<GameSearchResult>[] = [
  { key: 'thumb', label: '', width: 90, sortable: false, filterable: false, groupable: false, searchable: false,
    value: () => null, render: renderThumb },
  { key: 'name', label: 'Name', sortable: false, filterable: false, groupable: false, render: renderName },
];

// A fixed queue key: pickRandomFrom (panel.tsx) already self-heals when the underlying list
// changes (it validates its queue against the current appid set), so there's no need for a
// per-query key the way ListRoute.tsx's randomQueueKey is scoped per list/account/group.
const RANDOM_QUEUE_KEY = 'search-route';

export default function SearchRoute() {
  const location = useLocation();
  // A local signal, not a `location.search` memo: the on-page box below writes `?q=` via
  // `history.replaceState` (setSearchQueryParam), which — like every other raw replaceState in
  // this app (see urlState.ts's own comment on this) — never touches @solidjs/router's reactive
  // location, so this route has to track its own query text and sync the URL as a side effect.
  const [query, setQuery] = createSignal(new URLSearchParams(location.search).get('q')?.trim() ?? '');

  const [results, setResults] = createSignal<GameSearchResult[]>([]);
  const [searching, setSearching] = createSignal(false);

  // For the keyboard bridges between the search box and the table's first row — see their
  // own onKeyDown handlers below.
  let inputEl: HTMLInputElement | undefined;
  let tableWrapEl: HTMLDivElement | undefined;

  onMount(() => setBaseTitle('Search'));
  onCleanup(() => setBaseTitle(null));

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  function handleInput(raw: string): void {
    if (debounceTimer != null) clearTimeout(debounceTimer);
    const term = raw.trim();
    debounceTimer = setTimeout(() => { setSearchQueryParam(term); setQuery(term); }, GAME_SEARCH_DEBOUNCE_MS);
  }
  onCleanup(() => { if (debounceTimer != null) clearTimeout(debounceTimer); });

  let searchToken = 0;
  createEffect(on(query, term => {
    const token = ++searchToken;
    // Same floor as the nav-bar box (gameSearch.ts) — a 1-character query is expensive and
    // near-meaningless against an unofficial, unpaginated store-search endpoint.
    if (term.length < GAME_SEARCH_MIN_CHARS) { setResults([]); setSearching(false); return; }
    setSearching(true);
    fetch(`/api/search-games?q=${encodeURIComponent(term)}`)
      .then(res => res.json())
      .then(data => { if (token === searchToken) setResults(data.results || []); })
      .catch(() => { if (token === searchToken) setResults([]); })
      .finally(() => { if (token === searchToken) setSearching(false); });
  }));

  // renderName reads ownership at render time, not through a tracked signal (render returns a
  // plain Node) — so a badge arriving after the table already drew its rows needs the table to
  // actually redraw them. Replacing `results()` with a fresh array reference is what triggers
  // that, the same "force a redraw" role gameSearch.ts's own re-run of renderResults() plays for
  // its dropdown.
  createEffect(() => {
    if (!results().some(r => peekMyOwnershipStatus(r.appid) === null)) return;
    const unsub = onMyOwnershipReady(() => setResults(list => [...list]));
    onCleanup(unsub);
  });

  const table = createTableState<GameSearchResult>(results, SEARCH_COLUMNS);

  // The minimal Game[] shape panelNav.ts's stepGameList/renderPanelNav and panel.tsx's
  // pickRandomFrom need — unrelated to what backs the visible table (GameSearchResult is enough
  // for that). `true` stands in for stepGameList/renderPanelNav's `table` param, which both only
  // ever check for truthiness.
  function getGameList(): Game[] {
    return results().map(r => ({ appid: r.appid, name: r.name, loading: true, details: null }) as Game);
  }

  // The table's roving-tabindex "current row" is driven entirely by real `focus` events on a
  // `<tr>` (no separate reactive/imperative API for it — @vates/data-table-solid tracks it
  // module-internally), so keeping the table in sync with whichever game the panel/lightbox just
  // stepped to means literally focusing that row, not just adding a CSS class. `preventScroll` +
  // a separate `scrollIntoView` (rather than letting focus scroll on its own) matches the same
  // idiom panel.tsx's own filmstrip already uses. A rAF, not a plain call: the row may not exist
  // in the DOM yet the instant a fresh search's rows first render.
  //
  // Filed as vatesfr/data-table#24, and *mostly* fixed by 0.14.0's `table.focus.moveTo(row)` —
  // but not for this: `moveTo` deliberately never moves real DOM focus (so an external nav never
  // steals focus away from itself), only the internal tabindex target + scroll — no visible ring
  // without a real `.focus()` behind it. This route wants exactly that visible ring even while
  // the panel holds real focus, so it still has to reach into the DOM directly, still relying on
  // `dt-tr`/`data-row-key`, undocumented internals #24 itself flagged as such (0.14.0 didn't
  // change or document either). `ListRoute.tsx`'s `openGame` uses `moveTo` instead — it doesn't
  // need a visible ring since the row it opens was just clicked, and does benefit from `moveTo`'s
  // free group-expand/page-jump, which this route's single-page, ungrouped table never needed.
  function focusRow(appid: number): void {
    requestAnimationFrame(() => {
      const row = tableWrapEl?.querySelector<HTMLElement>(`tr.dt-tr[data-row-key="${appid}"]`);
      if (!row) return; // not on screen (or not one of this search's own rows) — nothing to do
      row.focus({ preventScroll: true });
      row.scrollIntoView({ block: 'nearest' });
    });
  }

  let lookupToken = 0;
  async function openResult(appid: number, name: string, tinyImage: string | null): Promise<void> {
    const token = ++lookupToken;
    const placeholder: Game = { appid, name, loading: true, details: null } as Game;
    panelOpen(placeholder);
    setPanelParam(appid);
    renderPanelNav({ table: true, game: placeholder, getGameList, onOpen: g => openResult(g.appid, g.name, null), onReroll: pickRandomGame });
    focusRow(appid);
    try {
      const res = await fetch(`/api/game-details/${appid}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Lookup failed');
      if (token !== lookupToken) return; // a newer pick has since taken over
      const resolved: Game = { ...placeholder, details: data, loading: false, name: data.meta?.name || name };
      panelOpen(resolved);
      // panelOpen moves focus into the panel itself (its hero image) each time it's called —
      // this second call, once the game's details actually land, would otherwise silently
      // re-steal focus back out of the row focusRow just placed it on above.
      focusRow(appid);
      addRecentGame(appid, data.meta?.name || name, data.meta?.capsule || tinyImage);
    } catch {
      // Left showing the loading placeholder — same as ListRoute's openStandaloneInPlace, no
      // separate status line here since this route has no status bar of its own.
    }
  }

  function stepGame(dir: 1 | -1): boolean {
    const next = stepGameList(true, getGameList, getPanelGame(), dir);
    if (!next) return false;
    openResult(next.appid, next.name, null);
    return true;
  }

  function pickRandomGame(): boolean {
    const list = getGameList();
    if (!list.length) return false;
    const pick = pickRandomFrom(list, RANDOM_QUEUE_KEY, getPanelGame()?.appid ?? 0) as Game | null;
    if (!pick) return false;
    openResult(pick.appid, pick.name, null);
    return true;
  }

  function gamePosition(): { index: number; total: number } | null {
    const game = getPanelGame();
    if (!game) return null;
    const list = getGameList();
    const index = list.findIndex(g => g.appid === game.appid);
    return index === -1 ? null : { index, total: list.length };
  }

  // Auto-open happens at most once, for the initial `?q=` landing only (a Firefox keyword
  // bookmark's whole point) — never for a later edit to the on-page box, which would otherwise
  // yank the panel open on every pause while the user is still typing/browsing. `?game=` (a
  // reload, or a shared link) reopens that exact game and counts as having already auto-opened;
  // otherwise the first non-empty result list does, opening its top (closest) match.
  let hasAutoOpened = false;
  onMount(() => {
    const restoreAppid = parseUrlState(location.search).game;
    if (restoreAppid) { hasAutoOpened = true; openResult(restoreAppid, '', null); }
  });
  createEffect(() => {
    const list = results();
    if (hasAutoOpened || !list.length) return;
    hasAutoOpened = true;
    openResult(list[0].appid, list[0].name, list[0].tinyImage);
  });

  onMount(() => {
    const unregister = registerRouteHandlers({
      openGame: appid => { openResult(appid, '', null); return true; },
      stepGame,
      pickRandom: pickRandomGame,
      gamePosition,
    });
    onCleanup(unregister);
  });

  return (
    <div class="container">
      <header>
        <h1>Search</h1>
      </header>

      <div class="game-search-wrap search-page-input">
        <input ref={inputEl} type="text" placeholder="Search for a game…" value={query()}
          onInput={e => handleInput(e.currentTarget.value)}
          // `on:keydown`, not `onKeyDown`: Solid delegates onX-style handlers for `keydown`
          // through one listener on `document` — registered lazily, the first time anything in
          // the app uses it, which is here, well after AppShell's own plain
          // `document.addEventListener('keydown', …)` (panelKeyboard.ts) — so a delegated
          // handler's `stopPropagation()` runs too late to preempt it (same-target listeners run
          // in registration order, not DOM order). `on:` attaches a real listener directly on
          // this element instead, which genuinely fires — and can stop the event — before it
          // ever reaches that later, document-level listener.
          on:keydown={e => {
            // ↓ out of the input and into the table's first row — the table itself already has
            // roving-tabindex Up/Down/Home/End (its own README) once focus is inside it; this is
            // just the bridge into that from the search box.
            if (e.key !== 'ArrowDown') return;
            const firstRow = tableWrapEl?.querySelector<HTMLElement>('tr[data-proc-idx]');
            if (!firstRow) return;
            e.preventDefault();
            e.stopPropagation();
            firstRow.focus();
          }} />
      </div>

      <Show when={query()} fallback={<div class="card"><p class="card-subtitle">Type a game name to search.</p></div>}>
        <Show when={query().length >= GAME_SEARCH_MIN_CHARS} fallback={<div class="card"><p class="card-subtitle">Keep typing…</p></div>}>
          <Show when={!searching()} fallback={<div class="card"><p class="card-subtitle">Searching…</p></div>}>
            <Show when={results().length} fallback={<div class="card"><p class="card-subtitle">No games found for "{query()}".</p></div>}>
              {/* search-table: hides the Columns/Sort/Search/Filter toolbar (style.css) — none of
                  it applies to a single, unsortable, unfilterable column, and its own "Search…"
                  box would sit confusingly right under this page's real one. The row-count line
                  above the table stays (`.dt-active-bar`, outside the toolbar). */}
              <div class="table-container search-table" ref={tableWrapEl}
                // `on:keydown`, not `onKeyDown` — see the search input's own comment on why:
                // same reasoning, and this one additionally needs to fire before the table
                // library's own internal row-focus handling can act on ArrowUp at row 0 (e.g.
                // wrap to the last row) — a direct, non-delegated listener on this wrapper still
                // runs after the row's own listener (bubble order: target first, then ancestors),
                // but "after" is what's wanted here: this overrides whatever that did, by moving
                // focus to the input last.
                on:keydown={e => {
                  // ↑ out of the table's first row and back to the input — the mirror of the
                  // bridge above.
                  if (e.key !== 'ArrowUp') return;
                  const row = (e.target as HTMLElement).closest<HTMLElement>('tr[data-proc-idx]');
                  if (row?.dataset.procIdx !== '0') return;
                  e.preventDefault();
                  e.stopPropagation();
                  inputEl?.focus();
                }}>
                <DataTableView<GameSearchResult> table={table} rowKey="appid"
                  onRowClick={r => openResult(r.appid, r.name, r.tinyImage)} />
              </div>
            </Show>
          </Show>
        </Show>
      </Show>
    </div>
  );
}
