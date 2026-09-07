// "Is this game owned/wishlisted by whichever account is currently loaded" — used by panel.tsx
// (the ownership badge under a game's title, which links back to /lists/owned or
// /lists/wishlist) and gameSearch.ts (a small owned/wishlisted marker on each dropdown result),
// so both show the same status regardless of which route/list opened the game (see
// docs/list-centric-redesign.md — this was one of the "genuine follow-up polish" items left
// open when the redesign first went functionally complete).
//
// Keyed off `currentAccount` (accountsStore.ts), not `myAccount` — this used to be the other way
// around (a badge answering "do *I* own this" no matter which account's list was on screen), but
// that made the panel's own "In library"/"On wishlist" badge unlinkable to anything: `myAccount`
// and `currentAccount` can be two different accounts entirely (e.g. checking a friend's
// wishlist), so a badge based on `myAccount` had no single correct `/lists/owned`/
// `/lists/wishlist` destination to send a click to. `currentAccount` is exactly "whichever
// account's list is actually on screen" — the same account those two routes themselves read —
// so a status based on it always has one unambiguous place to link to, and it's shown at all
// only when it's actually true for what's currently loaded, matching the plain (no "your"/"my")
// wording those routes and this badge already use. `myAccount`/"★ star as mine" (accountsStore.ts
// /HomeRoute.tsx) is no longer read by this file — left in place unused rather than removed,
// in case it's wanted for something else later.
// Returns `null` throughout when no `currentAccount` is loaded yet — same as the legacy page's
// own "no badge at all" behavior.
import { getCurrentAccount } from './accountsStore.ts';
import { fetchAccountOwnedAppids, fetchAccountWishlistAppids } from './accountData.ts';

export interface OwnershipStatus {
  inLibrary: boolean;
  onWishlist: boolean;
}

// A factory, not a bare module-level singleton — same "testable cache" shape as
// `staleGuard.ts`'s `createStaleGuard`/`streamBatcher.ts`'s `createStreamBatcher`/
// `lib/dedup.js`'s `createDedup`, for the same reason: this file's real state (the cached
// owned/wishlist appid sets, keyed by whichever `currentAccount` they were fetched for) needs a
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

  // Starts (or reuses) the two fetches for whatever `currentAccount` currently is. Returns false
  // with no fetch at all when nothing is loaded — the "no badge" case throughout this module.
  function ensureLoading(): boolean {
    const account = getCurrentAccount();
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
  // `currentAccount` loaded; otherwise always resolves, even if one/both fetches failed
  // (owned-empty rather than blocking the whole status on e.g. a private wishlist).
  async function getMyOwnershipStatus(appid: number): Promise<OwnershipStatus | null> {
    if (!ensureLoading()) return null;
    const [owned, wishlist] = await Promise.all([ownedPromise!, wishlistPromise!]);
    return { inLibrary: owned.has(appid), onWishlist: wishlist.has(appid) };
  }

  // Sync, non-blocking peek — for gameSearch.ts's dropdown, which re-renders many result rows
  // per keystroke and can't await per row. Starts loading as a side effect if not already in
  // flight; returns `null` for "no currentAccount loaded" *or* "still loading" (indistinguishable
  // to a caller that can't await — see onMyOwnershipReady below for the way to tell "still
  // loading" apart and re-render once it lands).
  function peekMyOwnershipStatus(appid: number): OwnershipStatus | null {
    if (!ensureLoading()) return null;
    if (!ownedSet || !wishlistSet) return null;
    return { inLibrary: ownedSet.has(appid), onWishlist: wishlistSet.has(appid) };
  }

  // One-shot "both sets just became available" notification — fires once (then forgets every
  // registered listener) the next time both halves of the *current* currentAccount's fetch land.
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
