// Shared by the comparison page (app.tsx) and the Library Explorer (library.tsx): the pure,
// JSX-free logic behind the "accounts bar" of resolved-account chips under a search form, plus
// a locally remembered "recent searches" row above it. The actual rendering/mounting is
// `accountsBar.tsx` (a real Solid component now — see its own header comment); this file stays
// plain `.ts` specifically so Node's test runner (no JSX transform) can still cover it directly,
// same reasoning as `lightboxTime.ts`'s split from `lightbox.tsx`/`panelNav.ts`'s split from
// `panel.tsx`'s `PanelNav`. Nothing here builds an HTML string or touches the DOM — a chip's
// safe-URL/status/count fields used to be interpolated into an HTML string by hand (needing
// `esc()` everywhere), now they're just plain data a JSX component reads directly, since JSX
// escapes text/attribute values on its own.

// personastate values per Steam's docs: 0 Offline, 1 Online, 2 Busy, 3 Away, 4 Snooze,
// 5 Looking to trade, 6 Looking to play. `gameextrainfo` (present while in-game) takes
// priority over all of these for the status dot/tooltip.
export interface AccountChipPlayer {
  steamid: string;
  personaname?: string;
  avatarmedium?: string;
  profileurl?: string;
  communityvisibilitystate?: number;
  personastate?: number;
  gameextrainfo?: string;
  gameCount?: number;
  itemCount?: number;
}

export const ACCOUNT_STATE_LABELS = ['Offline', 'Online', 'Busy', 'Away', 'Snooze', 'Looking to trade', 'Looking to play'];

// One account chip's worth of derived display data — everything `AccountChip`
// (`accountsBar.tsx`) needs to render, computed once so the component itself stays pure JSX
// with no inline branching logic to keep in sync with what's tested here.
export interface AccountChipView {
  steamid: string;
  name: string;
  safeUrl: string;
  safeAvatar: string;
  isPrivate: boolean;
  count: number | undefined;
  countLabel: string;
  statusClass: 'ingame' | 'online' | 'offline';
  statusTitle: string;
}

export function computeAccountChipView(p: AccountChipPlayer, countLabel: string): AccountChipView {
  const name = p.personaname || p.steamid;
  const safeUrl = /^https?:\/\//i.test(p.profileurl || '') ? p.profileurl! : '';
  const safeAvatar = /^https?:\/\//i.test(p.avatarmedium || '') ? p.avatarmedium! : '';
  const isPrivate = p.communityvisibilitystate !== undefined && p.communityvisibilitystate !== 3;
  const count: number | undefined = typeof p.gameCount === 'number' ? p.gameCount : p.itemCount;

  // `personastate`/`gameextrainfo` come from the same `player:` cache entry as everything
  // else on the chip, which sits on the library cache tier (LIBRARY_CACHE_TTL_MINUTES,
  // default 6h — see CLAUDE.md) — a TTL sized for library/wishlist contents, not
  // second-to-second presence. The dot is real data, just not live, so the tooltip says
  // "as of this search" rather than implying a real-time status a 6h-old cache can't back up.
  const statusClass = p.gameextrainfo ? 'ingame' : p.personastate ? 'online' : 'offline';
  const statusLabel = p.gameextrainfo
    ? `Playing ${p.gameextrainfo}`
    : (p.personastate != null ? (ACCOUNT_STATE_LABELS[p.personastate] || 'Offline') : 'Offline');
  const statusTitle = `${statusLabel} (as of this search)`;

  return { steamid: p.steamid, name, safeUrl, safeAvatar, isPrivate, count, countLabel, statusClass, statusTitle };
}

// ── Recent searches (localStorage) ──────────────────────────────────────────
// Purely a client-side convenience — never sent to the server. `storageKey` namespaces
// the list per page (the two pages' searches aren't interchangeable: a Library Explorer
// search is one Family group, a comparison-page search is a whole set of slots). Each
// entry is `{ id, players, data }` — `id` is a canonicalized identifier used to dedupe/
// remove/reload; `data` is whatever the host page needs to replay the search (a plain
// identifier string for the Library Explorer, a whole slots array for the comparison
// page) and is never inspected here. `players` is a lightweight display snapshot
// (steamid/personaname/avatarmedium) — always **one array per slot/group**, even for a
// single-group search, so computeRecentChipView below always knows slot boundaries: a
// Library Explorer search (or a one-slot comparison-page search) passes a one-element array.
// Without that grouping, a comparison of two 2-account Families and a plain 4-account
// comparison would render as the exact same "A + B + C + D" label.

export const MAX_RECENTS = 10;

// One entry in a "Recent:" row. `players` is an array of groups (see addRecent above);
// pre-grouping entries read from localStorage have a flat array instead, so computeRecentChipView
// normalizes element-by-element. `data` is opaque host-page replay data.
export interface RecentEntry {
  id: string;
  players: (AccountChipPlayer | AccountChipPlayer[])[];
  data: unknown;
}

export function loadRecents(storageKey: string): RecentEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return []; // corrupt/blocked storage — behave as if there's no history
  }
}

export function saveRecents(storageKey: string, list: RecentEntry[]) {
  try { localStorage.setItem(storageKey, JSON.stringify(list)); } catch { /* storage full/blocked — drop silently */ }
}

// Moves this search to the front, refreshing its cached display data, rather than
// appending a duplicate. `groups`: array of slot groups, each an array of player objects.
export function addRecent(storageKey: string, id: string, groups: (AccountChipPlayer[] | null | undefined)[] | null | undefined, data: unknown) {
  const snapshot = (groups || []).map(g => (g || []).map(p => ({
    steamid: p.steamid, personaname: p.personaname, avatarmedium: p.avatarmedium,
  })));
  const rest = loadRecents(storageKey).filter(r => r.id !== id);
  rest.unshift({ id, players: snapshot, data });
  saveRecents(storageKey, rest.slice(0, MAX_RECENTS));
}

export function removeRecent(storageKey: string, id: string) {
  saveRecents(storageKey, loadRecents(storageKey).filter(r => r.id !== id));
}

// One recent-search chip's worth of derived display data (`RecentChip` in accountsBar.tsx).
// "+" joins accounts merged within one slot/group, ", " separates distinct slots/groups —
// same convention as the accounts bar's own "N accounts merged" labeling, so a Family
// merge and a multi-player comparison never look identical here either. Each element of
// `entry.players` is normalized to a group array (`Array.isArray(g) ? g : [g]`) rather than
// assumed to already be one — entries written before this grouping existed have a flat
// array of player objects, not an array of groups, and this is the only thing standing
// between reading one of those out of localStorage and a hard crash on every page load.
export interface RecentChipView {
  label: string;
  safeAvatar: string;
}

export function computeRecentChipView(entry: RecentEntry): RecentChipView {
  const groups = (entry.players || []).map(g => Array.isArray(g) ? g : [g]);
  const label = groups.length
    ? groups.map(g => g.map(p => p.personaname || p.steamid).join(' + ')).join(', ')
    : entry.id;
  const avatarUrl = groups[0]?.[0]?.avatarmedium;
  const safeAvatar = /^https?:\/\//i.test(avatarUrl || '') ? avatarUrl! : '';
  return { label, safeAvatar };
}
