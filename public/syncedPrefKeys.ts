// The pref keys a signed-in account syncs; the server refuses any other (lib/auth.js keeps its own
// copy, which test/server.test.js checks against this one).
import { TABLE_VIEW_PREF_KEYS } from './tableViewKeys.ts';

export const SYNCED_PREF_KEYS: readonly string[] = [
  'myAccount',
  'currentAccount',
  'recentAccounts',
  'recentGames',
  'bundleSnapshots',
  'region',
  'lists',
  'folders',
  ...TABLE_VIEW_PREF_KEYS,
];
const RANKING_KEY_RE = /^ranking:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const isSyncedPrefKey = (key: string) => SYNCED_PREF_KEYS.includes(key) || RANKING_KEY_RE.test(key);
