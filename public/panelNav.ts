// Shared prev/next/random nav-bar rendering for the game detail side panel (`#panel-nav`) —
// extracted from library.js's and bundles.js's own near-identical copies (same markup/CSS/keys,
// see CLAUDE.md's panel.js bullet). Each page keeps its own `getGameList()` (its table's current
// search/filter/sort order — the data shape differs enough per page that the list itself stays
// local) and passes it in here.

import type { Game } from './types.ts';

// `game.standalone` (a "look up any game" result not part of any loaded table) and no `table`
// yet both mean there's no natural list to page through. `table` is only ever checked for
// truthiness (a real table exists yet?), not read for its own properties — typed as `unknown`
// rather than pulling in the @vates instance type for a null-check.
export function renderPanelNav({ table, game, getGameList, onOpen, onReroll }: {
  table: unknown;
  game: Game;
  getGameList: () => Game[];
  onOpen: (g: Game) => void;
  onReroll: () => void;
}): void {
  const nav = document.getElementById('panel-nav')!;
  if (!table || game.standalone) { nav.innerHTML = ''; return; }
  const list = getGameList();
  const idx = list.findIndex(g => g.appid === game.appid);
  nav.innerHTML = `
    <button class="panel-nav-btn" id="panel-prev" aria-label="Previous game" title="Previous game (↑)">↑</button>
    <span class="panel-nav-pos" aria-live="polite">${idx + 1} / ${list.length}</span>
    <button class="panel-nav-btn" id="panel-next" aria-label="Next game" title="Next game (↓)">↓</button>
    <button class="panel-nav-btn panel-nav-reroll" id="panel-reroll" aria-label="Pick a random game" title="Pick a random game (R)">🎲<span class="panel-nav-kbd">R</span></button>
  `;
  document.getElementById('panel-prev')!.addEventListener('click', () => onOpen(list[(idx - 1 + list.length) % list.length]));
  document.getElementById('panel-next')!.addEventListener('click', () => onOpen(list[(idx + 1) % list.length]));
  document.getElementById('panel-reroll')!.addEventListener('click', onReroll);
}

// The step `getGameList()` itself does for ArrowLeft/Right-in-the-lightbox nav (see
// navigateLightboxGame in library.js/bundles.js) — pulled out so both pages' lightbox handler
// and the nav-bar buttons above share the exact same "current index, wrap around" arithmetic.
// Returns null when there's nothing to step to (no table yet, a standalone lookup, or the
// current game somehow isn't in the list).
export function stepGameList(table: unknown, getGameList: () => Game[], currentGame: Game | null, dir: 1 | -1): Game | null {
  if (!table || !currentGame || currentGame.standalone) return null;
  const list = getGameList();
  const idx = list.findIndex(g => g.appid === currentGame.appid);
  if (idx === -1) return null;
  return list[(idx + dir + list.length) % list.length];
}
