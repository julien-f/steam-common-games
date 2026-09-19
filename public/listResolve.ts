// ListRef resolution — given a ListRef (or a whole GameList), resolves it to a set of appids
// (see docs/dev/lists-and-accounts.md). This is the integration seam between the pure
// listsStore.ts/combine.ts modules and real data: every "impure" dependency (fetching an
// account's owned/wishlist games, a bundle's games, the recent-games list, and looking up
// another GameList by id) is injected via ListResolveFetchers rather than imported directly, so
// this module — and its tests — never need a real network/localStorage. createDefaultFetchers
// below wires the real implementations in (accountData.ts/bundleData.ts/recentGames.ts/
// listsStore.ts's own getList) for actual routes to use.
//
// listsStore.ts already rejects a cycle at save/edit time (wouldCreateCycle) — the visited-set
// check below is a defensive backstop in case that's ever bypassed (a hand-edited localStorage
// blob, a future write path that forgets to validate), not a replacement for it: it throws
// rather than silently truncating, same "never let a cycle produce a wrong-but-plausible
// answer" principle.
import type { GameList, ListRef, CombineOp } from './types.ts';
import { combine, type LabeledSet, type CombineResult } from './combine.ts';
import { fetchAccountOwnedAppids, fetchAccountWishlistAppids } from './accountData.ts';
import { fetchBundleAppids } from './bundleData.ts';
import { loadRecentGames } from './recentGames.ts';
import { getList } from './listsStore.ts';

export interface ListResolveFetchers {
  accountOwned(accountId: string): Promise<Set<number>>;
  accountWishlist(accountId: string): Promise<Set<number>>;
  bundle(bundleId: string): Promise<Set<number>>;
  recentGames(): Promise<Set<number>>;
  getList(listId: string): GameList | undefined;
}

const MAX_DEPTH = 50;

export class ListCycleError extends Error {
  constructor() {
    super('List resolution hit a cycle');
    this.name = 'ListCycleError';
  }
}

function labelForRef(ref: ListRef, index: number): string {
  switch (ref.kind) {
    case 'account-owned': return `account-owned:${ref.accountId ?? index}`;
    case 'account-wishlist': return `account-wishlist:${ref.accountId ?? index}`;
    case 'bundle': return `bundle:${ref.bundleId ?? index}`;
    case 'recent-games': return 'recent-games';
    case 'user': return `list:${ref.listId ?? index}`;
    default: return String(index);
  }
}

// Resolves one ListRef to a flat appid set. `visited` carries the chain of user-list ids
// already being resolved on this path (for the cycle backstop); `depth` is a pure safety valve
// against a pathologically deep chain even without a literal cycle.
export async function resolveRef(
  ref: ListRef,
  fetchers: ListResolveFetchers,
  visited: Set<string> = new Set(),
  depth = 0,
): Promise<Set<number>> {
  if (depth > MAX_DEPTH) throw new ListCycleError();

  switch (ref.kind) {
    case 'account-owned':
      return ref.accountId ? fetchers.accountOwned(ref.accountId) : new Set();
    case 'account-wishlist':
      return ref.accountId ? fetchers.accountWishlist(ref.accountId) : new Set();
    case 'bundle':
      return ref.bundleId ? fetchers.bundle(ref.bundleId) : new Set();
    case 'recent-games':
      return fetchers.recentGames();
    case 'user': {
      if (!ref.listId) return new Set();
      if (visited.has(ref.listId)) throw new ListCycleError();
      const list = fetchers.getList(ref.listId);
      if (!list) return new Set(); // dangling reference — caller renders "list no longer exists"
      const nextVisited = new Set(visited);
      nextVisited.add(ref.listId);
      const result = await resolveGameList(list, fetchers, nextVisited, depth + 1);
      return flattenCombineResult(result);
    }
    default:
      return new Set();
  }
}

// What each of a dynamic list's own sources contributed, in `sources[]` order — its combine.ts
// key (so a MembershipGroup's keys can be mapped back to the ref that produced them) and how
// many appids it resolved to. Computed by every resolve anyway; it used to be thrown away with
// the intermediate LabeledSet[], so "63 ∩ 41 → 12" cost nothing to report but was unavailable
// to anything but the combine itself. Empty for a manual list.
export interface ResolvedSource {
  key: string;
  count: number;
}

export interface ResolvedList {
  result: CombineResult;
  sources: ResolvedSource[];
}

// Resolves a whole GameList. A manual list is just its stored appids; a dynamic list resolves
// every source (recursing through resolveRef) and combines them per its own op — returning a
// flat Set for union/intersect/subtract, or MembershipGroup[] for group-by-membership (see
// combine.ts). Used both for the top-level list a route is displaying (where group structure
// matters) and, via flattenCombineResult below, for a dynamic list nested as someone else's
// source (where it doesn't).
export async function resolveGameList(
  list: GameList,
  fetchers: ListResolveFetchers,
  visited: Set<string> = new Set(),
  depth = 0,
): Promise<CombineResult> {
  return (await resolveListWithSources(list, fetchers, visited, depth)).result;
}

// The same resolve, keeping what each source contributed (see ResolvedSource) — what a route
// displaying the list at the top level calls, since that's the only place a formula is shown.
// A nested source's own resolve goes through resolveGameList/resolveRef above and drops this:
// how *its* sources divided up is irrelevant to the list depending on it, the same reasoning
// flattenCombineResult applies to its group structure.
export async function resolveListWithSources(
  list: GameList,
  fetchers: ListResolveFetchers,
  visited: Set<string> = new Set(),
  depth = 0,
): Promise<ResolvedList> {
  if (list.kind === 'manual') return { result: new Set(list.appids ?? []), sources: [] };

  const sources = list.sources ?? [];
  const labeled: LabeledSet[] = await Promise.all(sources.map(async (ref, i) => ({
    key: labelForRef(ref, i),
    appids: await resolveRef(ref, fetchers, visited, depth + 1),
  })));
  const op: CombineOp = list.op ?? 'union';
  return {
    result: combine(op, labeled),
    sources: labeled.map(l => ({ key: l.key, count: l.appids.size })),
  };
}

// Flattens either shape a combine can produce into one plain union set — used whenever a
// dynamic list is resolved as someone else's *source*, where its own internal grouping (if it
// has any, i.e. group-by-membership) is irrelevant to the list depending on it.
export function flattenCombineResult(result: CombineResult): Set<number> {
  if (result instanceof Set) return result;
  const flat = new Set<number>();
  for (const group of result) for (const id of group.appids) flat.add(id);
  return flat;
}

// The real ListResolveFetchers, wiring the injectable seam above to actual network calls
// (accountData.ts/bundleData.ts), localStorage (recentGames.ts), and listsStore.ts's own
// synchronous getList — what real routes construct and pass to resolveRef/
// resolveGameList. Tests keep using their own mocked fetchers (see listResolve.test.js), so
// this module itself never needs a real network/localStorage.
export function createDefaultFetchers(): ListResolveFetchers {
  return {
    accountOwned: fetchAccountOwnedAppids,
    accountWishlist: fetchAccountWishlistAppids,
    bundle: fetchBundleAppids,
    recentGames: async () => new Set(loadRecentGames().map(g => g.appid)),
    getList,
  };
}
