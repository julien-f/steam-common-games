// Steam sign-in status — plain module + window event, subscriber owns the signal, same shape
// accountsStore.ts/region.ts already use. Backed by lib/auth.js's cookie-session endpoints
// (GET /api/me, POST /auth/logout); "signing in" itself is a plain page navigation to
// /auth/steam/login (AccountChip.tsx), not something this module drives.
import { getAllPrefEntries, adoptPrefEntry, pushPrefToServer, setSignedInSteamid, type PrefEntry } from './prefs.ts';
import { getMyAccount, setMyAccount, getCurrentAccount, setCurrentAccount } from './accountsStore.ts';
import { resolveAccountSummary } from './accountData.ts';
import type { AccountSlot } from './types.ts';

export const AUTH_CHANGED_EVENT = 'steam-auth-changed';

export interface AuthUser {
  steamid: string;
}

let currentUser: AuthUser | null = null;

export function getAuthUser(): AuthUser | null {
  return currentUser;
}

// Whether this browser has ever completed a prefs sync with this steamid before — gates the one
// asymmetry in the merge below. Deliberately its own localStorage key, outside prefs.ts's synced
// blob: it must never itself be synced (or adopted from the server), or a fresh browser adopting
// another device's prefs would inherit "already trusted" and skip its own first-sync guard.
const SYNCED_FLAG_PREFIX = 'steam.isonoe.net:prefs-synced:';

function hasSyncedBefore(steamid: string): boolean {
  try { return localStorage.getItem(SYNCED_FLAG_PREFIX + steamid) === '1'; } catch { return true; }
}

function markSyncedBefore(steamid: string): void {
  try { localStorage.setItem(SYNCED_FLAG_PREFIX + steamid, '1'); } catch { /* unavailable storage */ }
}

// Merges this device's local prefs against the account's server-side ones. Run on every sign-in
// check, not just the first, so two devices signed into the same account converge instead of
// drifting apart after their one and only sync — but a device's *first ever* sync with a given
// account is treated differently from every sync after it:
//
//   - First sync: local never overrides a key the server already has, no matter its timestamp —
//     only server → local for anything both sides have, since a brand-new device's local
//     `updatedAt` might just be leftover anonymous-browsing clutter with a coincidentally recent
//     timestamp, not a considered edit competing with whatever's already configured on the
//     account. A key the server has never seen at all still pushes up — that's contributing new
//     data, not overriding existing configuration, so nothing is lost.
//   - Every sync after that: plain last-write-wins, per key, both ways — by then this device has
//     proven itself a real sync participant, so its timestamps are trustworthy signals of actual
//     edits (including retrying a push that failed on a previous attempt).
//
// Equal timestamps are left alone — indistinguishable from "already in sync".
//
// Returns whether anything was adopted from the server — the caller reloads in that case, since
// every store (accountsStore, listsStore, ...) seeds its in-memory state from localStorage once
// at load; live-patching each of them to notice an external write isn't worth it for something
// that, once merged, won't differ again until the next real edit on either side.
//
// Exported for unit testing (see test/authStore.test.js) — same reasoning as
// autoPopulateAccountFromLogin's own comment below.
export async function syncPrefsWithServer(steamid: string, serverEntries: Record<string, PrefEntry>): Promise<boolean> {
  const firstSync = !hasSyncedBefore(steamid);
  const localEntries = getAllPrefEntries();
  const keys = new Set([...Object.keys(localEntries), ...Object.keys(serverEntries)]);
  let adopted = false;
  const pushes: Promise<void>[] = [];

  for (const key of keys) {
    const local = localEntries[key];
    const server = serverEntries[key];
    if (server && (!local || firstSync || server.updatedAt > local.updatedAt)) {
      adoptPrefEntry(key, server.value, server.updatedAt);
      adopted = true;
    } else if (local && (!server || local.updatedAt > server.updatedAt)) {
      pushes.push(pushPrefToServer(key, local.value, local.updatedAt));
    }
  }

  await Promise.all(pushes);
  markSyncedBefore(steamid);
  return adopted;
}

// A verified Steam login already IS a resolved identity — nobody should have to retype their own
// steamid into Home's picker right after signing in with it. Only fills in whichever of
// myAccount/currentAccount is still unset, same "never overwrites the stored preference"
// philosophy as the `?u=` override (see accountsStore.ts's own comment on that) — an existing
// pick, from an earlier manual resolve or a prefs merge above, is left alone. Runs on every
// sign-in check but is a no-op once both are set, so a failed resolve (e.g. a transient network
// error) just retries on the next page load rather than needing its own one-time flag.
// Exported for unit testing (see test/authStore.test.js) — same reasoning as lib/hltb.js's own
// exported stringSimilarity/levenshtein: worth exercising directly rather than only through
// initAuth's full fetch('/api/me') + merge + this call chain.
export async function autoPopulateAccountFromLogin(steamid: string): Promise<void> {
  if (getMyAccount() && getCurrentAccount()) return;
  try {
    const summary = await resolveAccountSummary([steamid]);
    const account: AccountSlot = {
      id: [...summary.members].sort().join('+'),
      members: summary.members,
      rawInputs: [steamid],
      label: summary.label,
      avatarUrl: summary.avatarUrl ?? undefined,
      vanities: summary.vanities,
      lastUsedAt: Date.now(),
    };
    if (!getMyAccount()) setMyAccount(account);
    if (!getCurrentAccount()) setCurrentAccount(account);
  } catch (err) {
    console.error('[auth] failed to resolve your account after Steam sign-in', err);
  }
}

// Fire-and-forget from AppShell's onMount — checks whether a session cookie is already signed
// in (e.g. returning from /auth/steam/callback, or just a normal page load while signed in) and
// merges prefs with the server every time, not just the first.
export async function initAuth(): Promise<void> {
  try {
    const res = await fetch('/api/me');
    const { steamid, prefs } = await res.json() as { steamid: string | null; prefs: Record<string, PrefEntry> | null };
    if (!steamid) { currentUser = null; setSignedInSteamid(null); return; }
    currentUser = { steamid };
    const adopted = await syncPrefsWithServer(steamid, prefs ?? {});
    setSignedInSteamid(steamid);
    if (adopted) { location.reload(); return; }
    await autoPopulateAccountFromLogin(steamid);
  } catch (err) {
    console.error('[auth] failed to check sign-in status', err);
    currentUser = null;
  } finally {
    window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
  }
}

export async function signOut(): Promise<void> {
  try {
    await fetch('/auth/logout', { method: 'POST' });
  } catch (err) {
    console.error('[auth] sign-out request failed', err);
  }
  currentUser = null;
  setSignedInSteamid(null);
  window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
}
