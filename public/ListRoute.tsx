// The generic list viewer — table + docked panel for any list kind (owned/wishlist/bundle/
// recent-games/user), per docs/list-centric-redesign.md. Registered for /lists/owned,
// /lists/wishlist, /lists/bundle/:bundleId, /lists/recent, and the generic /lists/:listId (see
// AppRoot.tsx — the four fixed paths are registered before this generic one so a reserved word can
// never be shadowed by a user list id). Stub for now — built out in Phase 4 (accountData.ts/
// bundleData.ts extraction + the real table/panel/rowStore/tableViewPrefs wiring) and Phase 5
// (route-by-route, starting with /lists/owned).
import { useParams, useLocation } from '@solidjs/router';

export default function ListRoute() {
  const params = useParams();
  const location = useLocation();

  return (
    <div class="route-placeholder">
      <h2>List route (stub)</h2>
      <p>path: {location.pathname}</p>
      {params.bundleId && <p>bundleId: {params.bundleId}</p>}
      {params.listId && <p>listId: {params.listId}</p>}
      <p>Table + docked panel land here (implementation plan, Phase 4 + Phase 5).</p>
    </div>
  );
}
