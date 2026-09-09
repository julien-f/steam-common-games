import { esc } from './utils.ts';
import { peekMyOwnershipStatus, onMyOwnershipReady } from './myOwnership.ts';
import type { OwnershipStatus } from './myOwnership.ts';

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
//  - recents(): optional — recently looked-up games, shown in the same dropdown whenever the box
//    is focused/clicked while empty, so getting back to a game just looked at costs no typing and
//    no separate widget. Picked exactly like a search match (same shape, same onSelect).
//  - onSeeAllRecents(): optional — the "see all" row under that list; the caller decides where
//    that goes (the /game route, for the app shell)

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

// Small "already owned/wishlisted" markers next to a result — same `myOwnership.ts` status
// (checked against `currentAccount`, whichever account's list is actually on screen) the side
// panel's own ownership badge shows, so a lookup reports the same thing whether it's opened from
// this dropdown or already open in the panel. `peekMyOwnershipStatus` never blocks (a search
// result list re-renders on every keystroke) — see its own comment for what `null` means here
// (no `currentAccount` loaded, or the fetch simply hasn't landed yet).
function ownershipMarkersHtml(status: OwnershipStatus | null): string {
  if (!status) return '';
  const marks: string[] = [];
  if (status.inLibrary) marks.push('<span class="game-search-badge owned" title="Owned">✓</span>');
  if (status.onWishlist) marks.push('<span class="game-search-badge wishlisted" title="On wishlist">☆</span>');
  return marks.join('');
}

// `active`: true for the result currently highlighted via ArrowUp/ArrowDown (not hover —
// hover is native `:hover`/`:focus-visible` CSS, this is the keyboard roving selection).
// `id` + `role="option"` back `inputEl`'s `aria-activedescendant` in initGameSearch below;
// `tabindex="-1"` keeps real DOM focus on the input the whole time, same combobox pattern
// as a native `<select>`'s listbox — arrow keys move the highlight, not focus itself.
export function gameSearchResultHtml(r: GameSearchResult, active: boolean, ownership: OwnershipStatus | null = null): string {
  const thumb = r.tinyImage
    ? `<img class="game-search-thumb" src="${esc(r.tinyImage)}" alt="" loading="lazy">`
    : '<span class="game-search-thumb game-search-thumb--empty"></span>';
  return `
    <button type="button" id="game-search-opt-${r.appid}" role="option" aria-selected="${active}" tabindex="-1"
      class="game-search-result${active ? ' active' : ''}" data-appid="${r.appid}" data-name="${esc(r.name)}">
      ${thumb}
      <span class="game-search-name">${esc(r.name)}</span>
      ${ownershipMarkersHtml(ownership)}
    </button>
  `;
}

// The dropdown's non-option chrome, for the recents view below: a section heading, and a
// trailing "see all" row. Both carry `role="presentation"` so they stay out of the listbox's own
// option semantics (`resultsEl` is the listbox; only `.game-search-result` buttons are options,
// and only those take part in the ArrowUp/ArrowDown roving selection), and the "see all" row
// keeps `tabindex="-1"` for the same reason every option does — real DOM focus stays on the input.
export function gameSearchSectionHtml(label: string): string {
  return `<div class="game-search-section" role="presentation">${esc(label)}</div>`;
}

export function gameSearchMoreHtml(label: string): string {
  return `<button type="button" class="game-search-more" role="presentation" tabindex="-1">${esc(label)}</button>`;
}

// Should the dropdown show recently looked-up games rather than search matches? Only for a
// genuinely empty box: one or more characters typed means the user is searching, and a
// half-typed term (below GAME_SEARCH_MIN_CHARS) showing an unrelated recents list instead of
// simply nothing would read as a broken search, not as a shortcut.
export function shouldShowRecents(rawValue: string): boolean {
  return rawValue.trim() === '';
}

export function initGameSearch({ inputEl, resultsEl, onSelect, recents, onSeeAllRecents }: {
  inputEl: HTMLInputElement;
  resultsEl: HTMLElement;
  onSelect: (game: GameSearchResult) => void;
  // Recently looked-up games, shown when the box is focused but empty — the storage behind them
  // (recentGames.ts) is injected rather than imported so this file stays the combobox/debounce UI
  // it was carved down to, and so the caller owns what "see all" means (a route to navigate to,
  // which this module knows nothing about).
  recents?: () => GameSearchResult[];
  onSeeAllRecents?: () => void;
}) {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let lastResults: GameSearchResult[] = [];
  let activeFetch = 0; // guards against a slower earlier request clobbering a faster later one
  let activeIdx = -1;  // ArrowUp/ArrowDown highlight; -1 = none yet (Enter falls back to the top match)
  let unsubOwnershipReady: (() => void) | null = null;
  // Whether what's currently in the dropdown is the recents list rather than search matches —
  // the results themselves are the same `GameSearchResult` shape either way (and pick the same
  // way), so this only drives the heading/"see all" chrome around them.
  let showingRecents = false;

  resultsEl.setAttribute('role', 'listbox');
  inputEl.setAttribute('aria-autocomplete', 'list');
  inputEl.setAttribute('aria-expanded', 'false');
  if (resultsEl.id) inputEl.setAttribute('aria-controls', resultsEl.id);

  function renderResults() {
    const options = lastResults.map((r, i) => gameSearchResultHtml(r, i === activeIdx, peekMyOwnershipStatus(r.appid))).join('');
    resultsEl.innerHTML = showingRecents
      ? gameSearchSectionHtml('Recently looked up') + options + gameSearchMoreHtml('See all recently looked up →')
      : options;
    if (activeIdx >= 0) inputEl.setAttribute('aria-activedescendant', `game-search-opt-${lastResults[activeIdx].appid}`);
    else inputEl.removeAttribute('aria-activedescendant');
    // A peek above returning null for any shown result means either "no currentAccount loaded"
    // or "still loading" — onMyOwnershipReady fires once (only) when the latter resolves, so the
    // still-showing dropdown picks up real ownership markers instead of staying blank for
    // whatever was on screen when the fetch kicked off. Re-subscribing on every render (rather
    // than once) means a fresh search that landed before the previous one's fetch resolved
    // isn't left watching a stale listener for a dropdown it no longer owns.
    unsubOwnershipReady?.();
    unsubOwnershipReady = lastResults.some(r => peekMyOwnershipStatus(r.appid) === null)
      ? onMyOwnershipReady(() => { if (!resultsEl.hidden) renderResults(); })
      : null;
  }

  function showResults(results: GameSearchResult[], { recent = false }: { recent?: boolean } = {}) {
    lastResults = results;
    activeIdx = -1;
    showingRecents = recent;
    if (!results.length) { hideResults(); return; }
    renderResults();
    resultsEl.hidden = false;
    inputEl.setAttribute('aria-expanded', 'true');
  }

  function hideResults() {
    lastResults = [];
    activeIdx = -1;
    showingRecents = false;
    resultsEl.hidden = true;
    resultsEl.innerHTML = '';
    inputEl.setAttribute('aria-expanded', 'false');
    inputEl.removeAttribute('aria-activedescendant');
    unsubOwnershipReady?.();
    unsubOwnershipReady = null;
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

  // Recently looked-up games in the same dropdown, on an empty box — the convention every store
  // and browser search bar already uses, so it costs no nav-bar space of its own and needs no
  // second widget. Returns whether there was anything to show.
  function showRecents(): boolean {
    const list = recents?.() ?? [];
    if (!list.length) return false;
    showResults(list, { recent: true });
    return true;
  }

  // Both events, not just focus: clicking an already-focused box (after Escape closed the
  // dropdown, say) fires no focus event, and "click the search box, see my recents" is exactly
  // the gesture this is for.
  const openRecentsIfEmpty = () => { if (shouldShowRecents(inputEl.value)) showRecents(); };
  inputEl.addEventListener('focus', openRecentsIfEmpty);
  inputEl.addEventListener('click', openRecentsIfEmpty);

  inputEl.addEventListener('input', () => {
    if (debounceTimer != null) clearTimeout(debounceTimer);
    const term = inputEl.value.trim();
    // Cleared back to empty — that's the recents view again, not just an empty dropdown.
    if (shouldShowRecents(inputEl.value)) { if (!showRecents()) hideResults(); return; }
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
    if ((e.target as Element).closest('.game-search-more')) {
      hideResults();
      onSeeAllRecents?.();
      return;
    }
    const btn = (e.target as Element).closest('.game-search-result') as HTMLElement | null;
    if (!btn) return;
    pick({ appid: Number(btn.dataset.appid), name: btn.dataset.name ?? '', tinyImage: null });
  });

  // Dismiss the dropdown on outside click, same convention as recentsBar-style widgets.
  document.addEventListener('click', e => {
    if (e.target !== inputEl && !resultsEl.contains(e.target as Node)) hideResults();
  });
}

// The "recently looked up games" storage/widget that used to live here moved to
// recentGames.ts (see docs/dev/frontend.md) — it's not combobox/debounce UI,
// and needed to be repointed at a new pref key to back the "Recently Looked Up" system list.
// This file shows that list again (the `recents` option above), but only ever as data handed in
// by the caller — the storage still isn't this module's, and neither is the route its "see all"
// row leads to.
