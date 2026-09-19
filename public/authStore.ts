// Steam sign-in status — plain module + window event, subscriber owns the signal, same shape
// accountsStore.ts/region.ts already use. Backed by lib/auth.js's cookie-session endpoints
// (GET /api/me, POST /auth/logout); "signing in" itself is a plain page navigation to
// /auth/steam/login (AccountChip.tsx), not something this module drives.
import { getAllPrefs, adoptServerPrefs, pushAllPrefsToServer, setSignedInSteamid } from './prefs.ts';
import { getMyAccount, setMyAccount, getCurrentAccount, setCurrentAccount } from './accountsStore.ts';
import { resolveAccountSummary } from './accountData.ts';
import type { AccountSlot } from './types.ts';

export const AUTH_CHANGED_EVENT = 'steam-auth-changed';
// Fires when the first-login "whose data do we keep" prompt opens or closes — see
// DataChoiceModal.tsx, the only subscriber.
export const DATA_CHOICE_EVENT = 'steam-data-choice-changed';

export interface AuthUser {
  steamid: string;
}

export interface DataChoicePrompt {
  localCount: number;
  serverCount: number;
}

let currentUser: AuthUser | null = null;
let pendingChoice: DataChoicePrompt | null = null;
let resolveChoice: ((useServer: boolean) => void) | null = null;

export function getAuthUser(): AuthUser | null {
  return currentUser;
}

export function getPendingDataChoice(): DataChoicePrompt | null {
  return pendingChoice;
}

// Resolved by DataChoiceModal.tsx once the person picks a side.
function askDataSourceChoice(localCount: number, serverCount: number): Promise<boolean> {
  return new Promise(resolve => {
    pendingChoice = { localCount, serverCount };
    resolveChoice = resolve;
    window.dispatchEvent(new Event(DATA_CHOICE_EVENT));
  });
}

export function chooseDataSource(useServer: boolean): void {
  resolveChoice?.(useServer);
  resolveChoice = null;
  pendingChoice = null;
  window.dispatchEvent(new Event(DATA_CHOICE_EVENT));
}

// One-time per (browser, Steam account) pair, so this never re-prompts on every page load —
// only the first time this browser sees this steamid signed in. Deliberately its own localStorage
// key, outside prefs.ts's synced blob: it must never itself be synced or overwritten by
// adoptServerPrefs below, or a fresh browser adopting server prefs would inherit "already
// resolved" from the account that set it and skip its own first-run prompt.
const SYNCED_FLAG_PREFIX = 'steam.isonoe.net:prefs-synced:';

function alreadyReconciled(steamid: string): boolean {
  try { return localStorage.getItem(SYNCED_FLAG_PREFIX + steamid) === '1'; } catch { return true; }
}

function markReconciled(steamid: string): void {
  try { localStorage.setItem(SYNCED_FLAG_PREFIX + steamid, '1'); } catch { /* unavailable storage */ }
}

// Runs once, the first time this browser observes a sign-in for `steamid`. Reconciles this
// browser's localStorage prefs against the account's server-side prefs:
//   - server empty, browser has data  → push this browser's data up (import)
//   - server has data, browser empty  → adopt the server's data (new device/browser)
//   - both empty                      → nothing to do
//   - both have data                  → ask (DataChoiceModal), then do one of the above
// Adopting the server's data reloads the page — every store (accountsStore, listsStore, ...)
// seeds its in-memory state from localStorage once, so a live in-place patch would need each of
// them to notice; a reload is simpler and this only ever happens once per (browser, account).
// Returns whether it triggered a reload — the caller must not do anything further with local
// state in that case, since this page instance is about to be torn down.
async function reconcilePrefsOnFirstLogin(steamid: string, serverPrefs: Record<string, unknown>): Promise<boolean> {
  if (alreadyReconciled(steamid)) return false;

  const localPrefs = getAllPrefs();
  const localCount = Object.keys(localPrefs).length;
  const serverCount = Object.keys(serverPrefs).length;

  let useServer = serverCount > 0 && localCount === 0;
  if (serverCount > 0 && localCount > 0) useServer = await askDataSourceChoice(localCount, serverCount);

  if (useServer) {
    adoptServerPrefs(serverPrefs);
    markReconciled(steamid);
    location.reload();
    return true;
  }

  if (localCount > 0) await pushAllPrefsToServer();
  markReconciled(steamid);
  return false;
}

// A verified Steam login already IS a resolved identity — nobody should have to retype their own
// steamid into Home's picker right after signing in with it. Only fills in whichever of
// myAccount/currentAccount is still unset, same "never overwrites the stored preference"
// philosophy as the `?u=` override (see accountsStore.ts's own comment on that) — an existing
// pick, from an earlier manual resolve or a prefs-adopt above, is left alone. Runs on every
// sign-in check but is a no-op once both are set, so a failed resolve (e.g. a transient network
// error) just retries on the next page load rather than needing its own one-time flag.
// Exported for unit testing (see test/authStore.test.js) — same reasoning as lib/hltb.js's own
// exported stringSimilarity/levenshtein: worth exercising directly rather than only through
// initAuth's full fetch('/api/me') + reconcile + this call chain.
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
// reconciles prefs on the first sign-in this browser sees.
export async function initAuth(): Promise<void> {
  try {
    const res = await fetch('/api/me');
    const { steamid, prefs } = await res.json() as { steamid: string | null; prefs: Record<string, unknown> | null };
    if (!steamid) { currentUser = null; setSignedInSteamid(null); return; }
    currentUser = { steamid };
    const reloaded = await reconcilePrefsOnFirstLogin(steamid, prefs ?? {});
    setSignedInSteamid(steamid);
    if (!reloaded) await autoPopulateAccountFromLogin(steamid);
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
