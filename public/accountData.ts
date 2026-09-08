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

// One member account's stake in one game, for the panel's "Owned by" card. Derived from the
// per-member playtime/lastPlayed maps /api/common-games already returns alongside the games
// themselves — the summed/maxed numbers on AccountLibraryGame above are all a table row needs,
// but they flatten away exactly the per-member breakdown a merged Steam Family wants to see.
export interface GameOwner {
  name: string;         // persona name, or the steamid when Steam knows no name for it
  minutes: number;      // this member's own playtime
  lastPlayedSec: number; // 0 = owns it, never launched it
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
  gameCount?: number;
}

// The shape of /api/common-games' success response, as read below — only the fields this
// module touches (it always resolves a single slot, so `slots[0]`).
interface CommonGamesResponse {
  groups: { games: { appid: number; name: string }[] }[];
  slots: RawAccountPlayer[][];
  fetchedAt: number | null;
  playtime: Record<number, Record<string, number>>;
  lastPlayed: Record<number, Record<string, number>>;
}

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
}

// Presence (`personastate`/`gameextrainfo`) is deliberately NOT mapped here, even though Steam
// returns it on the same response: it rides the `player:` cache entry, which sits on the library
// tier whose TTL is now measured in weeks (see default.env), so anything this app could say about
// "who's online" would be an assertion about a moment long past. The Account card shows how old
// its data is instead, with a ↻ to refresh it — an honest, actionable fact where presence was a
// dishonest one.
export function toAccountPlayer(p: RawAccountPlayer): AccountPlayer {
  const httpOnly = (url: string | undefined): string => (/^https?:\/\//i.test(url || '') ? url! : '');
  return {
    steamid: p.steamid,
    name: p.personaname || p.steamid,
    profileUrl: httpOnly(p.profileurl),
    avatarUrl: httpOnly(p.avatarmedium),
    isPrivate: p.communityvisibilitystate !== undefined && p.communityvisibilitystate !== 3,
    gameCount: typeof p.gameCount === 'number' ? p.gameCount : null,
  };
}

// The shape of /api/wishlist's success response, as read below.
interface WishlistResponse {
  items: { appid: number; priority: number; dateAdded: string | null }[];
  fetchedAt: number | null;
}

// One /api/common-games call's worth of everything this module reads from it: the slot's unioned
// library *and* its member accounts' own display data. They come back in the same response, so a
// caller that needs both (Home's Account card — owned count plus a per-member profile link/status/
// game count) gets them for one request rather than two identical POSTs.
export interface AccountOverview {
  games: AccountLibraryGame[];
  players: AccountPlayer[];
  // appid → which members of this slot own it, and how much each has played. Only ever more
  // than one entry for a Steam Family; a single-account slot still gets its own entry, which is
  // what makes "never played" visible on a game you own.
  owners: Map<number, GameOwner[]>;
  // When the server's cached copy of this account's owned games was written (epoch ms), or null
  // when it was fetched fresh for this very request. Surfaced as the Account card's "Updated
  // <when>" readout — see lib/cache.js's getCachedAt.
  fetchedAt: number | null;
}

// Same for a wishlist fetch: the items plus how old the server's copy of them is.
export interface AccountWishlist {
  items: AccountWishlistItem[];
  fetchedAt: number | null;
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
  const nameById = new Map(data.slots[0].map(p => [p.steamid, p.personaname || p.steamid]));
  const owners = new Map<number, GameOwner[]>();
  for (const game of allGames) {
    const pt = data.playtime?.[game.appid] ?? {};
    const lp = data.lastPlayed?.[game.appid] ?? {};
    // Membership comes from the playtime map rather than the slot's full member list: the
    // response only carries an entry for a member who actually owns the game, which is exactly
    // the distinction this card exists to show for a Family.
    const entries = slotSteamIds
      .filter(id => id in pt || id in lp)
      .map(id => ({ name: nameById.get(id) ?? id, minutes: pt[id] || 0, lastPlayedSec: lp[id] || 0 }));
    if (entries.length) owners.set(game.appid, entries);
  }
  return { games, players: data.slots[0].map(toAccountPlayer), owners, fetchedAt: data.fetchedAt ?? null };
}

// The owned-games half of fetchAccountOverview on its own — what every caller that doesn't care
// about the member accounts themselves (listResolve.ts's fetchers, ListRoute's owned list) uses.
export async function fetchAccountOwnedGames(members: string[], opts: { refresh?: boolean } = {}): Promise<AccountLibraryGame[]> {
  return (await fetchAccountOverview(members, opts)).games;
}

// Fetches one account's wishlist (its members' wishlists unioned, same as /api/wishlist does
// server-side).
export async function fetchAccountWishlist(members: string[], { refresh = false }: { refresh?: boolean } = {}): Promise<AccountWishlist> {
  const res = await fetch('/api/wishlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ members, refresh }),
  });
  const data: WishlistResponse & { error?: string } = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to fetch wishlist');
  return { items: data.items, fetchedAt: data.fetchedAt ?? null };
}

// The items half of fetchAccountWishlist on its own — for callers with no "Updated <when>"
// readout to feed (listResolve.ts's fetchers, Home's counts).
export async function fetchAccountWishlistItems(members: string[], opts: { refresh?: boolean } = {}): Promise<AccountWishlistItem[]> {
  return (await fetchAccountWishlist(members, opts)).items;
}

// listResolve.ts's ListResolveFetchers.accountOwned/accountWishlist — just the flat appid set,
// resolving accountId back to members via membersFromAccountId above.
export async function fetchAccountOwnedAppids(accountId: string): Promise<Set<number>> {
  return (await fetchAccountOwnedData(accountId)).appids;
}

// Both halves of what myOwnership.ts keeps per account — the owned-appid set behind the ✓/☆
// markers, and the per-member breakdown behind the panel's "Owned by" card — from one request,
// since /api/common-games returns both in the same response.
export async function fetchAccountOwnedData(accountId: string): Promise<{ appids: Set<number>; owners: Map<number, GameOwner[]> }> {
  const { games, owners } = await fetchAccountOverview(membersFromAccountId(accountId));
  return { appids: new Set(games.map(g => g.appid)), owners };
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
