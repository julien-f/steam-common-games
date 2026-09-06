// /bundles — browse/discover current Steam bundles via IsThereAnyDeal (see
// docs/list-centric-redesign.md). Named distinctly from the legacy bundles.tsx (still alive
// until Phase 7) to avoid confusion between the two during the transition; opening a bundle
// here will navigate to /lists/bundle/:bundleId (ListRoute.tsx) instead of rendering the table
// inline, unlike the legacy page. Stub for now — built out in Phase 5 step 5, close to today's
// bundles.tsx browsing screen (region/sort/"include expired" filters, the scrollable bundle
// list), reusing bundleData.ts's fetch layer once Phase 4 extracts it.
export default function BundlesBrowseRoute() {
  return (
    <div class="route-placeholder">
      <h2>Bundles (stub)</h2>
      <p>Bundle browsing/discovery lands here (implementation plan, Phase 5 step 5).</p>
    </div>
  );
}
