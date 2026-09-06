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

// The shape of /api/common-games' success response, as read below — only the fields this
// module touches (it always resolves a single slot, so `slots[0]`).
interface CommonGamesResponse {
  groups: { games: { appid: number; name: string }[] }[];
  slots: { steamid: string }[][];
  playtime: Record<number, Record<string, number>>;
  lastPlayed: Record<number, Record<string, number>>;
}

// The shape of /api/wishlist's success response, as read below.
interface WishlistResponse {
  items: { appid: number; priority: number; dateAdded: string | null }[];
}

// Fetches one account's owned games (its members' libraries unioned, same Family-simulation
// /api/common-games already does server-side for a single slot) with per-game playtime/last-
// played summed/maxed across members.
export async function fetchAccountOwnedGames(members: string[], { refresh = false }: { refresh?: boolean } = {}): Promise<AccountLibraryGame[]> {
  const res = await fetch('/api/common-games', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slots: [members], refresh }),
  });
  const data: CommonGamesResponse & { error?: string } = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to fetch owned games');

  const allGames = data.groups.flatMap(g => g.games);
  const slotSteamIds = data.slots[0].map(p => p.steamid);
  return allGames.map(game => {
    const pt = data.playtime?.[game.appid] ?? {};
    const lp = data.lastPlayed?.[game.appid] ?? {};
    return {
      appid: game.appid,
      name: game.name,
      playtimeMinutes: slotSteamIds.reduce((sum, id) => sum + (pt[id] || 0), 0),
      lastPlayedUnix: Math.max(0, ...slotSteamIds.map(id => lp[id] || 0)),
    };
  });
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

export async function fetchAccountWishlistAppids(accountId: string): Promise<Set<number>> {
  const items = await fetchAccountWishlistItems(membersFromAccountId(accountId));
  return new Set(items.map(i => i.appid));
}
