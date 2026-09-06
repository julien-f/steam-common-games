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
