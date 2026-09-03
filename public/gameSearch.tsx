// Shared by the comparison page (app.tsx) and the Library Explorer (library.tsx): the actual
// rendering/wiring of the "look up any game" search box and its own "recently looked up" games
// row — the pure derived-data logic (`gameSearch.ts`) is imported from here rather than
// duplicated. Real Solid components now, replacing the old `innerHTML`-rebuild-per-call
// functions, same conversion `panelNav.ts`/`accountsBar.ts` already went through.

import { createSignal, createEffect, createMemo, For, Show, type JSX } from 'solid-js';
import { render } from 'solid-js/web';
import {
  computeGameSearchResultView, computeRecentGameChipView, parseDirectAppid,
  loadRecentGames, saveRecentGames, removeRecentGame,
  GAME_SEARCH_DEBOUNCE_MS, GAME_SEARCH_MIN_CHARS,
} from './gameSearch.ts';
import type { GameSearchResult, RecentGame } from './gameSearch.ts';

// `id` + `role="option"` back `inputEl`'s `aria-activedescendant` in `initGameSearch` below;
// `tabindex="-1"` keeps real DOM focus on the input the whole time, same combobox pattern
// as a native `<select>`'s listbox — arrow keys move the highlight, not focus itself.
function GameSearchResultBtn(props: { result: GameSearchResult; active: boolean; onPick: (r: GameSearchResult) => void }): JSX.Element {
  const v = createMemo(() => computeGameSearchResultView(props.result, props.active));
  return (
    <button
      type="button" id={`game-search-opt-${props.result.appid}`} role="option"
      aria-selected={props.active} tabindex="-1"
      class={`game-search-result${props.active ? ' active' : ''}`}
      onClick={() => props.onPick(props.result)}
    >
      <Show when={v().safeThumb} fallback={<span class="game-search-thumb game-search-thumb--empty" />}>
        <img class="game-search-thumb" src={v().safeThumb} alt="" loading="lazy" />
      </Show>
      <span class="game-search-name">{v().name}</span>
    </button>
  );
}

export function initGameSearch({ inputEl, resultsEl, onSelect }: {
  inputEl: HTMLInputElement;
  resultsEl: HTMLElement;
  onSelect: (game: GameSearchResult) => void;
}) {
  const [results, setResults] = createSignal<GameSearchResult[]>([]);
  const [activeIdx, setActiveIdx] = createSignal(-1); // -1 = none yet (Enter falls back to the top match)
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let activeFetch = 0; // guards against a slower earlier request clobbering a faster later one

  resultsEl.setAttribute('role', 'listbox');
  inputEl.setAttribute('aria-autocomplete', 'list');
  inputEl.setAttribute('aria-expanded', 'false');
  if (resultsEl.id) inputEl.setAttribute('aria-controls', resultsEl.id);

  render(() => {
    // `createEffect` deliberately lives inside this `render()` callback, not above it — see
    // accountsBar.tsx's own `ensureBarMount` comment for why a computation created outside the
    // root `render()` establishes logs Solid's "will never be disposed" warning.
    createEffect(() => {
      const list = results();
      const idx = activeIdx();
      resultsEl.hidden = list.length === 0;
      inputEl.setAttribute('aria-expanded', list.length > 0 ? 'true' : 'false');
      if (idx >= 0 && list[idx]) inputEl.setAttribute('aria-activedescendant', `game-search-opt-${list[idx].appid}`);
      else inputEl.removeAttribute('aria-activedescendant');
    });
    return (
      <For each={results()}>{(r, i) => (
        <GameSearchResultBtn result={r} active={i() === activeIdx()} onPick={pick} />
      )}</For>
    );
  }, resultsEl);

  function showResults(list: GameSearchResult[]) {
    setActiveIdx(-1);
    setResults(list);
  }
  function hideResults() {
    setActiveIdx(-1);
    setResults([]);
  }

  // dir: 1 (ArrowDown) or -1 (ArrowUp). Wraps at both ends, same `(idx + dir + len) % len`
  // convention panel.tsx/library.tsx use for prev/next game paging — except the very first
  // press, which has no current index to offset from: ArrowDown starts at the top result,
  // ArrowUp starts at the bottom one, matching most native combobox widgets.
  function moveActive(dir: number) {
    const list = results();
    if (!list.length) return;
    setActiveIdx(idx => idx === -1 ? (dir > 0 ? 0 : list.length - 1) : (idx + dir + list.length) % list.length);
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
    if (e.key === 'ArrowDown') { if (results().length) e.preventDefault(); moveActive(1); return; }
    if (e.key === 'ArrowUp')   { if (results().length) e.preventDefault(); moveActive(-1); return; }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const term = inputEl.value.trim();
    if (!term) return;
    const directAppid = parseDirectAppid(term);
    if (directAppid != null) { pick({ appid: directAppid, name: '', tinyImage: null }); return; }
    const idx = activeIdx();
    const list = results();
    if (idx >= 0 && list[idx]) { pick(list[idx]); return; }
    if (list.length) pick(list[0]); // no arrow-key highlight yet — same as clicking the top match
  });

  // Dismiss the dropdown on outside click, same convention as accountsBar.tsx-style widgets.
  document.addEventListener('click', e => {
    if (e.target !== inputEl && !resultsEl.contains(e.target as Node)) hideResults();
  });
}

// ── Recently looked-up games ─────────────────────────────────────────────────

function RecentGameChip(props: { entry: RecentGame; onLoad: (appid: number, name: string) => void; onRemove: (appid: number) => void }): JSX.Element {
  const v = createMemo(() => computeRecentGameChipView(props.entry));
  return (
    <span class="recent-chip">
      <button type="button" class="recent-chip-btn" title={`Look up ${v().label}`} onClick={() => props.onLoad(props.entry.appid, props.entry.name)}>
        <Show when={v().safeThumb}><img class="recent-chip-avatar" src={v().safeThumb} alt="" /></Show>
        {v().label}
      </button>
      <button type="button" class="recent-chip-remove" title="Remove from recent" onClick={() => props.onRemove(props.entry.appid)}>×</button>
    </span>
  );
}

interface RecentGamesMount {
  refreshEntries: () => void;
  onLoadRef: { current: (appid: number, name: string) => void };
}
const recentGamesMounts = new WeakMap<HTMLElement, RecentGamesMount>();

function ensureRecentGamesMount(containerEl: HTMLElement): RecentGamesMount {
  const existing = recentGamesMounts.get(containerEl);
  if (existing) return existing;

  const [entries, setEntries] = createSignal<RecentGame[]>(loadRecentGames());
  const onLoadRef = { current: (_appid: number, _name: string) => {} };
  const refreshEntries = () => setEntries(loadRecentGames());
  const mount: RecentGamesMount = { refreshEntries, onLoadRef };
  recentGamesMounts.set(containerEl, mount);

  render(() => {
    createEffect(() => { containerEl.hidden = entries().length === 0; });
    return (
      <Show when={entries().length > 0}>
        <>
          <span class="recents-label">Recently looked up:</span>
          <For each={entries()}>{entry => (
            <RecentGameChip
              entry={entry}
              onLoad={(appid, name) => onLoadRef.current(appid, name)}
              onRemove={appid => { removeRecentGame(appid); refreshEntries(); }}
            />
          )}</For>
          <button type="button" class="recents-clear" onClick={() => { saveRecentGames([]); refreshEntries(); }}>Clear</button>
        </>
      </Show>
    );
  }, containerEl);

  return mount;
}

export function renderRecentGamesBar(containerEl: HTMLElement) {
  ensureRecentGamesMount(containerEl).refreshEntries();
}

// `onLoad(appid, name)` opens the remembered game — same shape as bindRecentsBar in
// accountsBar.tsx, but keyed directly on the appid rather than an opaque id/data pair since
// a game is always just its appid.
export function bindRecentGamesBar(containerEl: HTMLElement, onLoad: (appid: number, name: string) => void) {
  ensureRecentGamesMount(containerEl).onLoadRef.current = onLoad;
}
