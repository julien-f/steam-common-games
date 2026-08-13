'use strict';

// Shared "look up any game" widget — used by both the comparison page (app.js) and the
// Library Explorer (library.js) to open the shared game detail side panel (panel.js) for an
// arbitrary Steam game, independent of anyone's library or wishlist. Loaded as a plain global
// script (like accountsBar.js), not a module — depends on the global `esc()` from utils.js,
// so it must load after it.
//
// initGameSearch({ inputEl, resultsEl, onSelect }):
//  - inputEl:   the text input the user types a name, appid, or store URL into
//  - resultsEl: container the dropdown of name-search matches renders into (hidden when empty)
//  - onSelect({ appid, name }): called when the user picks a result, or presses Enter with a
//    raw appid/store URL typed in (name is '' in that case — the caller derives it from store
//    metadata once /api/game-details resolves, same as it already does for wishlist rows with
//    no name of their own)

const GAME_SEARCH_DEBOUNCE_MS = 300;
const GAME_SEARCH_MIN_CHARS = 2;

// Recognizes a bare appid ("1245620") or a Steam store URL containing "/app/<id>" — either
// way, no name search is needed; the appid alone is enough to open the panel.
function parseDirectAppid(raw) {
  const text = raw.trim();
  if (/^\d+$/.test(text)) return Number(text);
  const m = text.match(/\/app\/(\d+)/);
  return m ? Number(m[1]) : null;
}

function gameSearchResultHtml(r) {
  const thumb = r.tinyImage
    ? `<img class="game-search-thumb" src="${esc(r.tinyImage)}" alt="" loading="lazy">`
    : '<span class="game-search-thumb game-search-thumb--empty"></span>';
  return `
    <button type="button" class="game-search-result" data-appid="${r.appid}" data-name="${esc(r.name)}">
      ${thumb}
      <span class="game-search-name">${esc(r.name)}</span>
    </button>
  `;
}

function initGameSearch({ inputEl, resultsEl, onSelect }) {
  let debounceTimer = null;
  let lastResults = [];
  let activeFetch = 0; // guards against a slower earlier request clobbering a faster later one

  function showResults(results) {
    lastResults = results;
    if (!results.length) { hideResults(); return; }
    resultsEl.innerHTML = results.map(gameSearchResultHtml).join('');
    resultsEl.hidden = false;
  }

  function hideResults() {
    lastResults = [];
    resultsEl.hidden = true;
    resultsEl.innerHTML = '';
  }

  async function runSearch(term) {
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

  function pick(game) {
    hideResults();
    inputEl.value = game.name || '';
    onSelect(game);
  }

  inputEl.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const term = inputEl.value.trim();
    // A raw appid/URL doesn't need a name search — hide any stale dropdown instead.
    if (term.length < GAME_SEARCH_MIN_CHARS || parseDirectAppid(term) != null) { hideResults(); return; }
    debounceTimer = setTimeout(() => runSearch(term), GAME_SEARCH_DEBOUNCE_MS);
  });

  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Escape') { hideResults(); return; }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const term = inputEl.value.trim();
    if (!term) return;
    const directAppid = parseDirectAppid(term);
    if (directAppid != null) { pick({ appid: directAppid, name: '' }); return; }
    if (lastResults.length) pick(lastResults[0]); // Enter picks the top match, same as clicking it
  });

  resultsEl.addEventListener('click', e => {
    const btn = e.target.closest('.game-search-result');
    if (!btn) return;
    pick({ appid: Number(btn.dataset.appid), name: btn.dataset.name });
  });

  // Dismiss the dropdown on outside click, same convention as recentsBar-style widgets.
  document.addEventListener('click', e => {
    if (e.target !== inputEl && !resultsEl.contains(e.target)) hideResults();
  });
}
