// "Is this game owned/wishlisted by *me*" — used by panel.tsx (the ownership badge under a
// game's title) and gameSearch.ts (a small owned/wishlisted marker on each dropdown result), so
// both show the same status regardless of which route/list opened the game (see
// docs/list-centric-redesign.md — this was one of the "genuine follow-up polish" items left
// open when the redesign first went functionally complete).
//
// Deliberately keyed off `myAccount` (accountsStore.ts), not `currentAccount` — the same
// distinction the legacy library.tsx page's own ownership badge already drew ("your" would
// misattribute whoever's actually loaded, since this app can browse any Steam account's
// library/wishlist, not just the person using the app's own). `currentAccount` can be a friend's
// account being browsed; `myAccount` is the one pinned "this is me" identity, so it's the only
// one that answers "do *I* own this" correctly no matter which account's list is on screen.
// Returns `null` throughout when no `myAccount` is pinned yet — same as the legacy page's own
// "no badge at all" behavior, rather than guessing off `currentAccount`.
import { getMyAccount } from './accountsStore.ts';
import { fetchAccountOwnedAppids, fetchAccountWishlistAppids } from './accountData.ts';

export interface OwnershipStatus {
  inLibrary: boolean;
  onWishlist: boolean;
}

// A factory, not a bare module-level singleton — same "testable cache" shape as
// `staleGuard.ts`'s `createStaleGuard`/`streamBatcher.ts`'s `createStreamBatcher`/
// `lib/dedup.js`'s `createDedup`, for the same reason: this file's real state (the cached
// owned/wishlist appid sets, keyed by whichever `myAccount` they were fetched for) needs a
// clean instance per test, and this repo's usual "delete require.cache between tests" pattern
// only resets a *stateless* module (one with no top-level mutable state at all, like
// accountsStore.ts/prefs.ts) — confirmed live not to reset a module-level `let` here, since
// Node's CJS-require-of-an-ESM-file caches the module namespace outside `require.cache`
// entirely. The app itself uses exactly one instance (exported as the bare functions below);
// tests create their own via `createMyOwnershipCache()` instead.
export function createMyOwnershipCache() {
  let cachedAccountId: string | null = null;
  let ownedPromise: Promise<Set<number>> | null = null;
  let wishlistPromise: Promise<Set<number>> | null = null;
  let ownedSet: Set<number> | null = null;
  let wishlistSet: Set<number> | null = null;
  let readyListeners: (() => void)[] = [];

  function notifyReady(): void {
    if (!ownedSet || !wishlistSet) return; // only once both halves have landed
    const listeners = readyListeners;
    readyListeners = [];
    listeners.forEach(fn => fn());
  }

  // Starts (or reuses) the two fetches for whatever `myAccount` currently is. Returns false
  // with no fetch at all when nothing is pinned — the "no badge" case throughout this module.
  function ensureLoading(): boolean {
    const account = getMyAccount();
    if (!account) {
      cachedAccountId = null;
      ownedPromise = wishlistPromise = null;
      ownedSet = wishlistSet = null;
      return false;
    }
    if (account.id === cachedAccountId) return true;
    cachedAccountId = account.id;
    ownedSet = null;
    wishlistSet = null;
    ownedPromise = fetchAccountOwnedAppids(account.id)
      .catch(() => new Set<number>())
      .then(s => { ownedSet = s; notifyReady(); return s; });
    wishlistPromise = fetchAccountWishlistAppids(account.id)
      .catch(() => new Set<number>())
      .then(s => { wishlistSet = s; notifyReady(); return s; });
    return true;
  }

  // Async — waits for both sets to resolve (a fresh session's first check). `null` = no
  // `myAccount` pinned; otherwise always resolves, even if one/both fetches failed
  // (owned-empty rather than blocking the whole status on e.g. a private wishlist).
  async function getMyOwnershipStatus(appid: number): Promise<OwnershipStatus | null> {
    if (!ensureLoading()) return null;
    const [owned, wishlist] = await Promise.all([ownedPromise!, wishlistPromise!]);
    return { inLibrary: owned.has(appid), onWishlist: wishlist.has(appid) };
  }

  // Sync, non-blocking peek — for gameSearch.ts's dropdown, which re-renders many result rows
  // per keystroke and can't await per row. Starts loading as a side effect if not already in
  // flight; returns `null` for "no myAccount pinned" *or* "still loading" (indistinguishable to
  // a caller that can't await — see onMyOwnershipReady below for the way to tell "still
  // loading" apart and re-render once it lands).
  function peekMyOwnershipStatus(appid: number): OwnershipStatus | null {
    if (!ensureLoading()) return null;
    if (!ownedSet || !wishlistSet) return null;
    return { inLibrary: ownedSet.has(appid), onWishlist: wishlistSet.has(appid) };
  }

  // One-shot "both sets just became available" notification — fires once (then forgets every
  // registered listener) the next time both halves of the *current* myAccount's fetch land.
  // Lets gameSearch.ts's dropdown, which rendered a peek of `null` (still loading) for its
  // currently-shown results, re-render once real data exists instead of just leaving the
  // dropdown's ownership markers permanently blank for whatever was on screen at load time.
  function onMyOwnershipReady(cb: () => void): () => void {
    readyListeners.push(cb);
    return () => { readyListeners = readyListeners.filter(fn => fn !== cb); };
  }

  return { getMyOwnershipStatus, peekMyOwnershipStatus, onMyOwnershipReady };
}

const defaultCache = createMyOwnershipCache();
export const getMyOwnershipStatus = defaultCache.getMyOwnershipStatus;
export const peekMyOwnershipStatus = defaultCache.peekMyOwnershipStatus;
export const onMyOwnershipReady = defaultCache.onMyOwnershipReady;
