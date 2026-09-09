// The `?u=` half of "which account is the app showing" — parsing the param out of the URL,
// resolving its identifiers to a real AccountSlot, and handing that to accountsStore.ts as an
// override of the stored `currentAccount` (see that file's own `?u=` section for the "override,
// never adopt" rule itself, and docs/dev/lists-and-accounts.md for the design).
//
// Kept separate from accountsStore.ts on purpose: that file is plain AccountSlot state over
// prefs.ts with no fetching of its own, while resolving an identifier means a real
// /api/common-games round trip (accountData.ts's resolveAccountSummary — there's no standalone
// "just resolve this identifier" endpoint, see docs/dev/architecture.md's Request flow section). This module is
// the policy layer between the two, and it's the one place the param is read; every consumer
// asks accountsStore.ts's getEffectiveCurrentAccount() instead of parsing the URL itself.
//
// AppShell.tsx drives this once for the whole app (a createEffect on the router's own
// `location.search`), rather than each route doing it — the shell outlives every navigation, and
// a `?u=` link is honored identically on all of them.
import { parseAccountParam } from './urlState.ts';
import { resolveAccountSummary } from './accountData.ts';
import { accountIdFor, setAccountOverride, notifyAccountChanged } from './accountsStore.ts';
import { createStaleGuard } from './staleGuard.ts';
import type { AccountSlot } from './types.ts';

export interface AccountOverrideState {
  // 'none'      — no `?u=` in the URL; the stored currentAccount is what's showing.
  // 'resolving' — identifiers found, the resolve is in flight (nothing to show yet).
  // 'ready'     — resolved; accountsStore.ts's override is set.
  // 'error'     — the identifiers couldn't be resolved (bad vanity name, private/unknown
  //               profile, upstream failure); the override is left cleared, so the stored
  //               account shows instead and `message` explains why the link didn't take.
  state: 'none' | 'resolving' | 'ready' | 'error';
  identifiers: string[];
  // How many *further* slots the link carried beyond the one being honored — always 0 for a
  // link this app itself produces; nonzero only for an old Comparison-page URL
  // (`?u=alice&u=bob`), which has no single-route equivalent anymore. See urlState.ts's
  // AccountParam.extraSlots for why those are surfaced rather than silently unioned or dropped.
  extraSlots: number;
  message?: string;
}

const NONE: AccountOverrideState = { state: 'none', identifiers: [], extraSlots: 0 };

// A factory rather than bare module-level state, same reason myOwnership.ts's
// createMyOwnershipCache() is one: this module's real content is mutable state (the last
// synced param, the in-flight resolve), and this repo's usual "delete require.cache between
// tests" reset doesn't reach a module-level `let` in a TS-stripped ESM file. The app uses the
// single instance exported below; tests build their own.
export function createAccountOverrideSync() {
  let state: AccountOverrideState = NONE;
  // The identifier set the current state was computed for — `syncFromUrl` is called on *every*
  // URL change (a panel `?game=` write, a lightbox step, a shared table view), so without this
  // key an unrelated param write would re-resolve the same account over and over.
  let syncedKey: string | null = null;
  const guard = createStaleGuard();

  function setState(next: AccountOverrideState): void {
    state = next;
    // The override itself may not have changed (a resolve starting, or failing), but what the
    // UI should say about it has — so this notifies regardless, and setAccountOverride's own
    // no-real-change guard keeps a redundant one from double-firing anything expensive.
    notifyAccountChanged();
  }

  function getState(): AccountOverrideState {
    return state;
  }

  // Drops the override and forgets the synced param, so a subsequent syncFromUrl for a URL the
  // `u=` has just been stripped from is a no-op rather than a second clear. Called when the user
  // explicitly picks an account (HomeRoute) — at which point the param is redundant and gets
  // stripped from the URL via replaceState, per docs/dev/lists-and-accounts.md.
  function clear(): void {
    guard.next(); // any in-flight resolve is now irrelevant
    syncedKey = '';
    setAccountOverride(null);
    setState(NONE);
  }

  function syncFromUrl(search: string): void {
    const { identifiers, extraSlots } = parseAccountParam(search);
    const key = identifiers.join(',');
    if (key === syncedKey) return;
    syncedKey = key;
    if (identifiers.length === 0) {
      guard.next();
      setAccountOverride(null);
      setState(NONE);
      return;
    }
    const gen = guard.next();
    setAccountOverride(null); // don't leave a previous link's account showing while this resolves
    setState({ state: 'resolving', identifiers, extraSlots: extraSlots.length });
    resolveAccountSummary(identifiers).then(
      summary => {
        if (guard.isStale(gen)) return;
        const account: AccountSlot = {
          id: accountIdFor(summary.members),
          members: summary.members,
          rawInputs: identifiers,
          label: summary.label,
          avatarUrl: summary.avatarUrl ?? undefined,
          lastUsedAt: Date.now(),
        };
        setAccountOverride(account);
        setState({ state: 'ready', identifiers, extraSlots: extraSlots.length });
      },
      (err: Error) => {
        if (guard.isStale(gen)) return;
        setAccountOverride(null);
        setState({ state: 'error', identifiers, extraSlots: extraSlots.length, message: err.message });
      },
    );
  }

  return { getState, syncFromUrl, clear };
}

const defaultSync = createAccountOverrideSync();
export const getAccountOverrideState = defaultSync.getState;
export const syncAccountOverrideFromUrl = defaultSync.syncFromUrl;
export const clearAccountOverride = defaultSync.clear;

// The one-line status a route shows in place of its own content while a `?u=` link is being
// resolved or has failed — shared by HomeRoute and ListRoute so both explain a link that didn't
// take the same way, rather than each falling back to its own "no account selected" message and
// leaving the user to guess that the link was the problem.
export function accountOverrideStatusText(state: AccountOverrideState): string | null {
  if (state.state === 'resolving') return `Resolving ${state.identifiers.join(' + ')} from this link…`;
  if (state.state === 'error') return `Couldn't resolve ${state.identifiers.join(' + ')} from this link: ${state.message}`;
  return null;
}
