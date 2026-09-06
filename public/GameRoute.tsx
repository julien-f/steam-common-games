// /game/:appid — the canonical, single, shareable link for any game (see
// docs/list-centric-redesign.md and the implementation plan's Phase 5 step 3). Opens the shared
// panel directly, standalone (no table/list beside it, no prev/next/random — panelNav.ts's own
// renderPanelNav already no-ops for `game.standalone`). Ported from library.tsx's
// openStandaloneLookup/fetchStandaloneDetails, simplified: there's no "already a loaded row?"
// check to make here (this route never has any rows loaded at all), and no host-specific
// onClose/URL cleanup to wire since panelClose()'s default behavior (clear ?game=/&shot=) is
// exactly right for a route whose entire reason to exist is showing that one game.
import { onCleanup, createSignal, createEffect } from 'solid-js';
import { useParams } from '@solidjs/router';
import { panelOpen, panelClose, isPanelOpen, getPanelGame, renderPanelBody } from './panel.tsx';
import { setPanelParam } from './urlState.ts';
import { addRecentGame } from './recentGames.ts';
import type { Game } from './types.ts';

export default function GameRoute() {
  const params = useParams();
  const [statusText, setStatusText] = createSignal('');
  let currentToken = 0; // guards against a slower earlier lookup clobbering a faster later one

  async function load(appid: number): Promise<void> {
    const token = ++currentToken;
    if (!Number.isInteger(appid) || appid <= 0) {
      setStatusText('Invalid game id.');
      return;
    }
    setStatusText('');

    // Placeholder title until store metadata resolves it — the name is never trusted from the
    // URL, only the appid (see CLAUDE.md's "Looking up an arbitrary game" section).
    const game = { appid, name: `App ${appid}`, loading: true, details: null, standalone: true } as Game;
    panelOpen(game);
    setPanelParam(appid);

    try {
      const res = await fetch(`/api/game-details/${appid}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Lookup failed');
      if (token !== currentToken) return; // a newer appid param has since taken over
      game.details = data;
      game.loading = false;
      if (data.meta?.name) game.name = data.meta.name;
      if (getPanelGame() === game) renderPanelBody(game);
      addRecentGame(game.appid, game.name, data.meta?.capsule || null);
    } catch (err) {
      if (token !== currentToken) return;
      if (getPanelGame() === game) setStatusText(`Lookup failed: ${(err as Error).message}`);
    }
  }

  // A plain createEffect, not onMount — /game/:appid is one route *definition* shared across
  // every appid, so navigating from /game/440 to /game/620 reuses this same component instance
  // (solid-router doesn't remount on a param-only change) rather than unmounting and remounting
  // it; params.appid is read reactively here so a new appid re-runs load() in place.
  createEffect(() => { load(Number(params.appid)); });

  // Leaving this route closes the panel it opened — there's nothing else on this route for it
  // to stay docked next to, and the next route (Home, another list, …) starts from a clean
  // slate rather than an orphaned panel showing whatever game this one was.
  onCleanup(() => { if (isPanelOpen()) panelClose(); });

  return (
    <div class="game-route">
      {statusText() && <div class="status">{statusText()}</div>}
    </div>
  );
}
