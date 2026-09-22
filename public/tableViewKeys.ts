// The shared table-view pref keys — ListRoute.tsx's viewPrefKey (the first five) plus
// BundlesBrowseRoute.tsx's own VIEW_PREF_KEY (the /bundles picker's table, distinct from
// 'bundleListView'/a bundle's own detail table). Its own tiny module, with no dependencies, so
// both prefs.ts and tableViewSync.ts can import it without a runtime import cycle between them
// (prefs.ts needs the key list; tableViewSync.ts only needs prefs.ts's PrefEntry *type*). A user
// list's own view lives on the list itself, never through prefs.ts, so it's never a candidate.
export const TABLE_VIEW_PREF_KEYS: readonly string[] = [
  'ownedListView', 'wishlistListView', 'bundleListView', 'recentListView', 'compareListView', 'bundlesBrowseView',
];
