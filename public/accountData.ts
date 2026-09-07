// Account-scoped game data — owned games and wishlist, for a resolved AccountSlot. Clean,
// minimal fetch functions against the existing /api/common-games and /api/wishlist endpoints
// (see docs/list-centric-redesign.md's implementation plan, Phase 4 step 1) rather than a
// mechanical copy of library.tsx's loadLibrary/loadWishlist, which are large UI-orchestration
// functions (row-building, table wiring, URL/history updates, accounts-bar rendering) — none of
// that belongs here; ListRoute.tsx owns the equivalent orchestration generically, for any list
// kind, not just account-scoped ones.
//
// An AccountSlot.id is itself the sorted-joined resolved member steam64 ids (see
// accountsStore.ts's accountIdFor) — so resolving an id back to its members is just splitting
// on '+', no lookup needed.
export function membersFromAccountId(accountId: string): string[] {
  return accountId.split('+').filter(Boolean);
}

export interface AccountLibraryGame {
  appid: number;
  name: string;
  playtimeMinutes: number; // summed across every member of the slot
  lastPlayedUnix: number;  // max across members; 0 = never played
}

export interface AccountWishlistItem {
  appid: number;
  priority: number;
  dateAdded: string | null;
}

// One member account of a slot, as /api/common-games returns it (a raw Steam
// GetPlayerSummaries player object plus the server's own `gameCount`) — only the fields this
// module reads. Everything is optional: a profile the API knows nothing about still comes back
// as a bare `{ steamid, personaname, profileurl: '' }` placeholder (see getPlayerSummaries in
// lib/steam.js).
export interface RawAccountPlayer {
  steamid: string;
  personaname?: string;
  profileurl?: string;
  avatarmedium?: string;
  communityvisibilitystate?: number;
  personastate?: number;
  gameextrainfo?: string;
  gameCount?: number;
}

// The shape of /api/common-games' success response, as read below — only the fields this
// module touches (it always resolves a single slot, so `slots[0]`).
interface CommonGamesResponse {
  groups: { games: { appid: number; name: string }[] }[];
  slots: RawAccountPlayer[][];
  playtime: Record<number, Record<string, number>>;
  lastPlayed: Record<number, Record<string, number>>;
}

// personastate values per Steam's docs: 0 Offline, 1 Online, 2 Busy, 3 Away, 4 Snooze,
// 5 Looking to trade, 6 Looking to play. `gameextrainfo` (present while in-game) takes
// priority over all of them.
export const ACCOUNT_STATE_LABELS = ['Offline', 'Online', 'Busy', 'Away', 'Snooze', 'Looking to trade', 'Looking to play'];

// One member account's worth of display-ready data — everything Home's Account card renders,
// derived once here so the component itself stays plain JSX with no branching of its own to
// keep in sync with what's unit-tested.
export interface AccountPlayer {
  steamid: string;
  name: string;
  profileUrl: string;   // '' when Steam returned no (or a non-http) profile URL — don't render a link
  avatarUrl: string;    // '' likewise
  isPrivate: boolean;   // communityvisibilitystate !== 3 — a private/friends-only profile
  gameCount: number | null;
  statusClass: 'ingame' | 'online' | 'offline';
  statusLabel: string;
}

// `personastate`/`gameextrainfo` ride on the same `player:` cache entry as everything else here,
// which sits on the library cache tier (LIBRARY_CACHE_TTL_MINUTES, default 6h — see CLAUDE.md) —
// a TTL sized for library/wishlist contents, not second-to-second presence. So the status is real
// data, just not live; the Account card's own tooltip says "as of the last refresh" rather than
// implying a real-time presence a 6h-old cache can't back up.
export function toAccountPlayer(p: RawAccountPlayer): AccountPlayer {
  const httpOnly = (url: string | undefined): string => (/^https?:\/\//i.test(url || '') ? url! : '');
  return {
    steamid: p.steamid,
    name: p.personaname || p.steamid,
    profileUrl: httpOnly(p.profileurl),
    avatarUrl: httpOnly(p.avatarmedium),
    isPrivate: p.communityvisibilitystate !== undefined && p.communityvisibilitystate !== 3,
    gameCount: typeof p.gameCount === 'number' ? p.gameCount : null,
    statusClass: p.gameextrainfo ? 'ingame' : p.personastate ? 'online' : 'offline',
    statusLabel: p.gameextrainfo
      ? `Playing ${p.gameextrainfo}`
      : (p.personastate != null ? (ACCOUNT_STATE_LABELS[p.personastate] || 'Offline') : 'Offline'),
  };
}

// The shape of /api/wishlist's success response, as read below.
interface WishlistResponse {
  items: { appid: number; priority: number; dateAdded: string | null }[];
}

// One /api/common-games call's worth of everything this module reads from it: the slot's unioned
// library *and* its member accounts' own display data. They come back in the same response, so a
// caller that needs both (Home's Account card — owned count plus a per-member profile link/status/
// game count) gets them for one request rather than two identical POSTs.
export interface AccountOverview {
  games: AccountLibraryGame[];
  players: AccountPlayer[];
}

// Fetches one account's owned games (its members' libraries unioned, same Family-simulation
// /api/common-games already does server-side for a single slot) with per-game playtime/last-
// played summed/maxed across members, plus its member accounts' display data.
export async function fetchAccountOverview(members: string[], { refresh = false }: { refresh?: boolean } = {}): Promise<AccountOverview> {
  const res = await fetch('/api/common-games', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slots: [members], refresh }),
  });
  const data: CommonGamesResponse & { error?: string } = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to fetch owned games');

  const allGames = data.groups.flatMap(g => g.games);
  const slotSteamIds = data.slots[0].map(p => p.steamid);
  const games = allGames.map(game => {
    const pt = data.playtime?.[game.appid] ?? {};
    const lp = data.lastPlayed?.[game.appid] ?? {};
    return {
      appid: game.appid,
      name: game.name,
      playtimeMinutes: slotSteamIds.reduce((sum, id) => sum + (pt[id] || 0), 0),
      lastPlayedUnix: Math.max(0, ...slotSteamIds.map(id => lp[id] || 0)),
    };
  });
  return { games, players: data.slots[0].map(toAccountPlayer) };
}

// The owned-games half of fetchAccountOverview on its own — what every caller that doesn't care
// about the member accounts themselves (listResolve.ts's fetchers, ListRoute's owned list) uses.
export async function fetchAccountOwnedGames(members: string[], opts: { refresh?: boolean } = {}): Promise<AccountLibraryGame[]> {
  return (await fetchAccountOverview(members, opts)).games;
}

// Fetches one account's wishlist (its members' wishlists unioned, same as /api/wishlist does
// server-side).
export async function fetchAccountWishlistItems(members: string[], { refresh = false }: { refresh?: boolean } = {}): Promise<AccountWishlistItem[]> {
  const res = await fetch('/api/wishlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ members, refresh }),
  });
  const data: WishlistResponse & { error?: string } = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to fetch wishlist');
  return data.items;
}

// listResolve.ts's ListResolveFetchers.accountOwned/accountWishlist — just the flat appid set,
// resolving accountId back to members via membersFromAccountId above.
export async function fetchAccountOwnedAppids(accountId: string): Promise<Set<number>> {
  const games = await fetchAccountOwnedGames(membersFromAccountId(accountId));
  return new Set(games.map(g => g.appid));
}

export interface ResolvedAccountSummary {
  members: string[];        // resolved steam64 ids, sorted — becomes AccountSlot.members
  label: string;            // joined persona name(s) ("PersonaName" or "A + B" for a Family)
  avatarUrl: string | null; // a single account's avatar; null for a Family (no one avatar to show)
  ownedCount: number;
  wishlistCount: number;    // 0 if the wishlist call fails (e.g. private profile) — owned
                            // resolving is enough to consider the account itself resolved
}

// Home's "pick an account" resolve step — there's no standalone "just resolve an identifier"
// endpoint (see CLAUDE.md's Request-flow section), so this is the one place a raw typed
// identifier (vanity name/URL/steamid) actually becomes a resolved AccountSlot, via the same
// /api/common-games call every owned-games fetch already makes. Runs the wishlist count
// alongside it (Promise.all) rather than lazily, so the account header can show both counts as
// soon as an account is picked, per docs/list-centric-redesign.md.
export async function resolveAccountSummary(rawInputs: string[]): Promise<ResolvedAccountSummary> {
  const [ownedRes, wishlistRes] = await Promise.all([
    fetch('/api/common-games', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slots: [rawInputs] }),
    }),
    fetch('/api/wishlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ members: rawInputs }),
    }).catch(() => null),
  ]);
  const ownedData = await ownedRes.json();
  if (!ownedRes.ok) throw new Error(ownedData.error || 'Failed to resolve account');

  const players: { steamid: string; personaname?: string; avatarmedium?: string }[] = ownedData.slots[0];
  const members = players.map(p => p.steamid).sort();
  const label = players.map(p => p.personaname || p.steamid).join(' + ');
  const avatarUrl = players.length === 1 ? (players[0].avatarmedium || null) : null;
  const ownedCount = ownedData.groups.flatMap((g: { games: unknown[] }) => g.games).length;

  let wishlistCount = 0;
  if (wishlistRes && wishlistRes.ok) {
    const wishlistData = await wishlistRes.json();
    wishlistCount = wishlistData.items?.length ?? 0;
  }

  return { members, label, avatarUrl, ownedCount, wishlistCount };
}

export async function fetchAccountWishlistAppids(accountId: string): Promise<Set<number>> {
  const items = await fetchAccountWishlistItems(membersFromAccountId(accountId));
  return new Set(items.map(i => i.appid));
}
