// Shared prev/next/random nav-bar *logic* for the game detail side panel (`#panel-nav`) —
// extracted from library.js's and bundles.js's own near-identical copies (same markup/CSS/keys,
// see CLAUDE.md's panel.js bullet). Each page keeps its own `getGameList()` (its table's current
// search/filter/sort order — the data shape differs enough per page that the list itself stays
// local) and passes it in here.
//
// Deliberately kept as plain, JSX-free `.ts` (not `.tsx`) even though the nav bar itself is now
// a real Solid component (`PanelNav` in panel.tsx, which imports `computePanelNavState` below) —
// Node's test runner has no JSX transform (same reason `lightboxTime.ts` was split out of
// `lightbox.tsx`), and both functions here are plain, side-effect-free logic worth keeping
// directly unit-testable rather than folded into the component itself.

import type { Game } from './types.ts';

// `game.standalone` (a "look up any game" result not part of any loaded table) and no table yet
// both mean there's no natural list to page through — `null` either way, which `PanelNav` reads
// as "render nothing". `hasTable` replaces the old bare `table: unknown` truthiness check (the
// DOM-building version this replaced never read `table` for anything but that) now that there's
// no `table` instance to thread through a plain data module — callers already only ever checked
// it for truthiness (app.tsx has no `@vates/data-table-*` instance at all and used to pass a bare
// `true` sentinel for it).
export function computePanelNavState(hasTable: boolean, game: Game | null, getGameList: () => Game[]): {
  idx: number; total: number; prevGame: Game; nextGame: Game;
} | null {
  if (!hasTable || !game || game.standalone) return null;
  const list = getGameList();
  const idx = list.findIndex(g => g.appid === game.appid);
  return { idx, total: list.length, prevGame: list[(idx - 1 + list.length) % list.length], nextGame: list[(idx + 1) % list.length] };
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
