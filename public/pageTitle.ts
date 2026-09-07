// Shared document.title management. Two independent layers, composed here rather than by
// whichever caller happens to run last:
//
// - `setBaseTitle(label)` — the current route's own context (an account's Library, a bundle's
//   title, a user list's name, …). Called by each route (HomeRoute/ListRoute/BundlesBrowseRoute/
//   AboutRoute) as its own data resolves, and with `null` on unmount.
// - `setGameTitle(label)` — whether the shared side panel has a game open, and its name. Called
//   only from panel.tsx, the one place that already tracks this across every route.
//
// A game, when one is open, takes over the title entirely — the same "open game name wins,
// otherwise the loaded context, otherwise the bare app name" convention the old app.tsx/
// library.tsx pages used (see CLAUDE.md's git history), just split across two setters now that
// one shared panel serves every route instead of each page owning its own updateTitle().
const APP_NAME = 'steam.isonoe.net';

let baseTitle: string | null = null;
let gameTitle: string | null = null;

function apply(): void {
  const label = gameTitle ?? baseTitle;
  document.title = label ? `${label} — ${APP_NAME}` : APP_NAME;
}

export function setBaseTitle(label: string | null): void {
  baseTitle = label;
  apply();
}

export function setGameTitle(label: string | null): void {
  gameTitle = label;
  apply();
}
