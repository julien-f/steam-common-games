// The shared table-view pref keys — ListRoute.tsx's viewPrefKey (all but the last) plus
// BundlesBrowseRoute.tsx's own VIEW_PREF_KEY (the /bundles picker's table, distinct from
// 'bundleListView'/a bundle's own detail table). Synced like any key (syncedPrefKeys.ts), written
// only on Save (tableViewPrefs.ts's layoutDraft). A user list's layout lives on the list itself.
export const TABLE_VIEW_PREF_KEYS: readonly string[] = [
  'ownedListView',
  'wishlistListView',
  'bundleListView',
  'pickBundleListView',
  'recentListView',
  'compareListView',
  'sharedListView',
  'creatorListView',
  'gamePassListView',
  'bundlesBrowseView',
];
