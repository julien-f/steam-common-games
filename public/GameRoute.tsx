// /game/:appid — the canonical, single, shareable link for any game (see
// docs/list-centric-redesign.md). Renders the same shared panel as its main content, no
// docking/table beside it since there's no list context. Stub for now — built out in Phase 5
// step 3, early (right after /lists/owned and /lists/wishlist prove out the docked panel),
// since the shell's global search needs somewhere real to resolve a pick to.
import { useParams } from '@solidjs/router';

export default function GameRoute() {
  const params = useParams();
  return (
    <div class="route-placeholder">
      <h2>Game (stub)</h2>
      <p>appid: {params.appid}</p>
      <p>Opens the shared panel directly (implementation plan, Phase 5 step 3).</p>
    </div>
  );
}
