import { esc } from './utils.ts';
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

export function recentGameChipHtml(entry: RecentGame): string {
  const label = esc(entry.name || `App ${entry.appid}`);
  const safeThumb = /^https?:\/\//i.test(entry.tinyImage || '') ? entry.tinyImage : '';
  return `
    <span class="recent-chip">
      <button type="button" class="recent-chip-btn" data-appid="${entry.appid}" title="Look up ${label}">
        ${safeThumb ? `<img class="recent-chip-avatar" src="${esc(safeThumb)}" alt="">` : ''}
        ${label}
      </button>
      <button type="button" class="recent-chip-remove" data-appid="${entry.appid}" title="Remove from recent">×</button>
    </span>
  `;
}

export function renderRecentGamesBar(containerEl: HTMLElement): void {
  const recents = loadRecentGames();
  if (recents.length === 0) { containerEl.hidden = true; containerEl.innerHTML = ''; return; }
  containerEl.innerHTML = `
    <span class="recents-label">Recently looked up:</span>
    ${recents.map(recentGameChipHtml).join('')}
    <button type="button" class="recents-clear">Clear</button>
  `;
  containerEl.hidden = false;
}

// `onLoad(appid, name)` opens the remembered game — same shape as bindRecentsBar in
// accountsBar.ts, but keyed directly on the appid rather than an opaque id/data pair since a
// game is always just its appid.
export function bindRecentGamesBar(containerEl: HTMLElement, onLoad: (appid: number, name: string) => void): void {
  containerEl.addEventListener('click', e => {
    const loadBtn = (e.target as Element).closest('.recent-chip-btn') as HTMLElement | null;
    if (loadBtn) {
      const appid = Number(loadBtn.dataset.appid);
      const entry = loadRecentGames().find(g => g.appid === appid);
      if (entry) onLoad(entry.appid, entry.name);
      return;
    }
    const removeBtn = (e.target as Element).closest('.recent-chip-remove') as HTMLElement | null;
    if (removeBtn) { removeRecentGame(Number(removeBtn.dataset.appid)); renderRecentGamesBar(containerEl); return; }
    if ((e.target as Element).closest('.recents-clear')) { saveRecentGames([]); renderRecentGamesBar(containerEl); }
  });
}
