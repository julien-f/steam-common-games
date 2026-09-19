// Remembers the most recently browsed /bundles list (id + title only, just enough for prev/next
// stepping) so /lists/bundle/:bundleId's own nav can step to the adjacent bundle without
// re-fetching or duplicating BundlesBrowseRoute's own sort/filter/pagination state. Plain
// module-level state, not a Solid store/signal — BundlesBrowseRoute overwrites it wholesale on
// every load/"Load more" (mirroring bundles.tsx's own `bundlesSig` this steps through); ListRoute
// only ever reads it via a plain function call inside its own JSX/handlers (which Solid already
// re-runs on navigation since params.bundleId itself is reactive), so nothing here needs to be a
// signal of its own. Deliberately volatile (not persisted, unlike accountsStore.ts/listsStore.ts)
// — a page reload always starts this at [] again, same as bundlesSig did.
export interface BrowsedBundle { id: number; title: string }

let browsed: BrowsedBundle[] = [];

export function setBrowsedBundles(bundles: BrowsedBundle[]): void {
  browsed = bundles;
}

export function getBrowsedBundles(): BrowsedBundle[] {
  return browsed;
}
