import { getPref, setPref } from './prefs.ts';

// Recently looked-up games — carved out of gameSearch.ts (see docs/list-centric-redesign.md's
// Phase 1) so this storage layer is separate from that file's combobox/debounce UI, and so it
// can back a new first-class, browsable "Recently Looked Up" system list (/lists/recent) rather
// than only ever being a dropdown convenience feed. Repointed at prefs.ts's shared blob (the
// 'recentGames' key) instead of its own standalone localStorage key — one more preference the
// same future per-key server sync (see prefs.ts) can reach, same reasoning every other
// preference here already follows. No migration from the old standalone key: this whole feature
// is part of a full frontend replacement (see docs/list-centric-redesign.md's own "no migration"
// decision) — an existing user's recent-games history just resets once.
//
// Unlike accountsStore.ts's recentAccounts (namespaced per account, uncapped, soft-removable
// while referenced by a dynamic list), a game looked up via search means the same thing
// regardless of which page/list it was looked up from, so this stays one flat, capped,
// hard-removable list — nothing here can be a dynamic-list *source's own dependency* the way an
// account or another user list can (a "recent-games" ListRef just reads this list directly, see
// listResolve.ts), so there's no soft-delete concern to carry over.

export const RECENT_GAMES_PREF_KEY = 'recentGames';
export const MAX_RECENT_GAMES = 10;

export interface RecentGame {
  appid: number;
  name: string;
  tinyImage: string | null;
}

export function loadRecentGames(): RecentGame[] {
  return getPref<RecentGame[]>(RECENT_GAMES_PREF_KEY, []);
}

export function saveRecentGames(list: RecentGame[]): void {
  setPref(RECENT_GAMES_PREF_KEY, list);
}

// Moves this game to the front, refreshing its cached name/thumbnail, rather than appending a
// duplicate.
export function addRecentGame(appid: number, name: string, tinyImage?: string | null): void {
  const rest = loadRecentGames().filter(g => g.appid !== appid);
  rest.unshift({ appid, name, tinyImage: tinyImage || null });
  saveRecentGames(rest.slice(0, MAX_RECENT_GAMES));
}

export function removeRecentGame(appid: number): void {
  saveRecentGames(loadRecentGames().filter(g => g.appid !== appid));
}
