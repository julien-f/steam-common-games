// Shared prev/next/random nav-bar rendering for the game detail side panel (`#panel-nav`) —
// extracted from library.js's and bundles.js's own near-identical copies (same markup/CSS/keys,
// see docs/dev/frontend.md's side-panel section). Each page keeps its own `getGameList()` (its table's current
// search/filter/sort order — the data shape differs enough per page that the list itself stays
// local) and passes it in here.

import type { Game } from './types.ts';

// `game.standalone` (a "look up any game" result not part of any loaded table) and no list yet
// (`hasList` false: ListRoute before its table exists) both mean there's nothing to page through.
export function renderPanelNav({
  hasList,
  game,
  getGameList,
  onOpen,
  onReroll,
}: {
  hasList: boolean;
  game: Game;
  getGameList: () => Game[];
  onOpen: (g: Game) => void;
  onReroll: () => void;
}): void {
  const nav = document.getElementById('panel-nav')!;
  if (!hasList || game.standalone) {
    nav.innerHTML = '';
    return;
  }
  const list = getGameList();
  const idx = list.findIndex((g) => g.appid === game.appid);
  nav.innerHTML = `
    <button class="panel-nav-btn" id="panel-prev" aria-label="Previous game" title="Previous game (↑)">↑</button>
    <span class="panel-nav-pos" aria-live="polite">${idx + 1} / ${list.length}</span>
    <button class="panel-nav-btn" id="panel-next" aria-label="Next game" title="Next game (↓)">↓</button>
    <button class="panel-nav-btn panel-nav-reroll" id="panel-reroll" aria-label="Pick a random game" title="Pick a random game (R)">🎲<span class="panel-nav-kbd">R</span></button>
  `;
  document
    .getElementById('panel-prev')!
    .addEventListener('click', () => onOpen(list[(idx - 1 + list.length) % list.length]));
  document.getElementById('panel-next')!.addEventListener('click', () => onOpen(list[(idx + 1) % list.length]));
  document.getElementById('panel-reroll')!.addEventListener('click', onReroll);
}

// The step `getGameList()` itself does for ArrowLeft/Right-in-the-lightbox nav (see
// navigateLightboxGame in library.js/bundles.js) — pulled out so both pages' lightbox handler
// and the nav-bar buttons above share the exact same "current index, wrap around" arithmetic.
// Returns null when there's nothing to step to (a standalone lookup, or the current game
// somehow isn't in the list).
export function stepGameList(list: Game[], currentGame: Game | null, dir: 1 | -1): Game | null {
  if (!currentGame || currentGame.standalone) return null;
  const idx = list.findIndex((g) => g.appid === currentGame.appid);
  if (idx === -1) return null;
  return list[(idx + dir + list.length) % list.length];
}
