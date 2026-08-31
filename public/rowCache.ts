// Shared fix for @vates/data-table-vanilla's setData(): it only re-renders a row's cells when
// the object at its rowKey is a genuinely *new* reference — mutating an already-visible row in
// place and calling setData() again with an array that still contains that same reference (even
// a brand-new outer array from a fresh .filter()) leaves its rendered cells stale. Confirmed live
// first in bundles.js (a row made visible by streamGameDetails, then re-priced by loadPrices
// before the panel/table ever re-renders it), then hit again by library.js's own Wishlist price
// loading and "↻ Refresh" — see CLAUDE.md's Bundles section for the full story.
//
// createRowCache() gives each page its own cache: visibleRowsForTable() reuses a row's cached
// copy verbatim across renders until markChanged() is called for it, at which point a fresh copy
// is made — so only the row that actually changed gets a new reference and every other row's DOM
// is left alone. EVERY mutation site (including a row's first-time reveal) must call
// markChanged() right after mutating — see CLAUDE.md for why the "no cache entry yet" fallback
// below can't be relied on alone once two async sources can reveal/mutate the same row out of
// order.
export function createRowCache<R extends object>() {
  let cache = new Map<string, R>();
  return {
    // `rows`: the canonical, mutated-in-place row objects (rowMap's own) currently visible.
    // `keyOf`: extracts the cache key (an appid) from a row.
    visibleRowsForTable(rows: R[], keyOf: (r: R) => string): R[] {
      return rows.map(r => {
        const key = keyOf(r);
        if (!cache.has(key)) cache.set(key, { ...r }); // first reveal
        return cache.get(key)!;
      });
    },
    markChanged(key: string) {
      cache.delete(key);
    },
    reset() {
      cache = new Map();
    },
  };
}
