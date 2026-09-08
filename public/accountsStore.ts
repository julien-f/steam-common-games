// AccountSlot CRUD — myAccount/currentAccount/recentAccounts (see docs/list-centric-redesign.md).
// Backed by prefs.ts's 'myAccount'/'currentAccount'/'recentAccounts' keys, same one-blob
// convention every other preference here uses. myAccount/currentAccount are stored as full
// AccountSlot objects, not id references into recentAccounts, so clearing/removing recents can
// never orphan either of them.
//
// Soft-remove for recentAccounts mirrors listsStore.ts's soft-delete for GameList exactly (same
// "still referenced by a dynamic list → hide, don't destroy" rule) — isAccountReferenced() is
// listsStore.ts's own source-scanning logic, reused rather than duplicated here.
import { getPref, setPref } from './prefs.ts';
import { isAccountReferenced } from './listsStore.ts';
import type { AccountSlot } from './types.ts';

const MY_ACCOUNT_KEY = 'myAccount';
const CURRENT_ACCOUNT_KEY = 'currentAccount';
const RECENT_ACCOUNTS_KEY = 'recentAccounts';

// The canonical AccountSlot.id for a set of resolved member steam64 ids — sorted so the same
// Family always produces the same id regardless of the order its accounts were entered in.
export function accountIdFor(members: string[]): string {
  return [...members].sort().join('+');
}

function readRecents(): AccountSlot[] {
  return getPref<AccountSlot[]>(RECENT_ACCOUNTS_KEY, []);
}
function writeRecents(list: AccountSlot[]): void {
  setPref(RECENT_ACCOUNTS_KEY, list);
}

// ── myAccount / currentAccount ───────────────────────────────────────────────────────────────

export function getMyAccount(): AccountSlot | null {
  return getPref<AccountSlot | null>(MY_ACCOUNT_KEY, null);
}

// Setting myAccount also upserts it into recentAccounts — starring an account is itself a use
// of it, and it should show up there the same as any other resolve/pick would.
export function setMyAccount(account: AccountSlot | null): void {
  setPref(MY_ACCOUNT_KEY, account);
  if (account) upsertRecentAccount(account);
}

export function getCurrentAccount(): AccountSlot | null {
  return getPref<AccountSlot | null>(CURRENT_ACCOUNT_KEY, null);
}

export function setCurrentAccount(account: AccountSlot | null): void {
  setPref(CURRENT_ACCOUNT_KEY, account);
  if (account) upsertRecentAccount(account);
  notifyAccountChanged();
}

// ── The `?u=` override ───────────────────────────────────────────────────────────────────────

// `?u=` is a URL *override*, not a "consume and adopt" param (unlike the `?tv=` table-view one):
// present in the URL, it takes precedence over the stored `currentAccount` everywhere the
// current account is read, but it never overwrites the stored preference — opening someone
// else's shared link shouldn't silently change your own default account. See
// docs/list-centric-redesign.md's own `?u=` section, and accountOverride.ts for the URL-parsing/
// resolving half of this (kept out of here so this file stays plain AccountSlot state with no
// fetching of its own).
//
// Deliberately in-memory only, never through prefs.ts: it's per-load display state belonging to
// one shared link, and persisting it would be exactly the silent adoption the override exists to
// avoid. It's also deliberately kept out of `recentAccounts` for the same reason — browsing
// someone's library from a link isn't the same act as picking an account for yourself.
let accountOverride: AccountSlot | null = null;

export function getAccountOverride(): AccountSlot | null {
  return accountOverride;
}

export function setAccountOverride(account: AccountSlot | null): void {
  if (accountOverride?.id === account?.id) return; // no real change — don't wake every listener
  accountOverride = account;
  notifyAccountChanged();
}

// "Whichever account the app is currently showing" — the override when a `?u=` link is being
// explored, the stored preference otherwise. Every read of the current account outside
// HomeRoute's own account *picker* goes through this rather than getCurrentAccount(), so a
// shared link is honored on every route (the Owned/Wishlist lists, the panel's ownership badges,
// Home's own account header) rather than only wherever the param happened to be parsed.
export function getEffectiveCurrentAccount(): AccountSlot | null {
  return accountOverride ?? getCurrentAccount();
}

// Broadcast on any change to what getEffectiveCurrentAccount() returns — a `?u=` override
// resolving/clearing, or an explicit account pick. A plain window CustomEvent, the same
// mechanism region.ts's REGION_CHANGED_EVENT already uses (and for the same reason): this file
// is deliberately a plain module with no Solid reactivity of its own, so a route that needs to
// react subscribes to this and bumps a signal of its own, and nothing here needs to know who's
// listening. Guarded for a `window`-less environment (Node unit tests), same as region.ts.
export const ACCOUNT_CHANGED_EVENT = 'scg:account-changed';

export function notifyAccountChanged(): void {
  try { window.dispatchEvent(new CustomEvent(ACCOUNT_CHANGED_EVENT)); } catch { /* no window (tests) */ }
}

// ── recentAccounts ───────────────────────────────────────────────────────────────────────────

// Most-recently-used first. Excludes soft-removed entries by default — pass includeRemoved for
// a "Trash"/removed-items view.
export function getRecentAccounts({ includeRemoved = false }: { includeRemoved?: boolean } = {}): AccountSlot[] {
  const list = readRecents();
  const filtered = includeRemoved ? list : list.filter(a => !a.removedAt);
  return [...filtered].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
}

// Adds a new recent entry, or bumps an existing one's lastUsedAt (and clears any soft-remove) —
// dedupe key is AccountSlot.id, so re-picking the same Family updates one entry rather than
// piling up duplicates.
export function upsertRecentAccount(account: AccountSlot): AccountSlot {
  const recents = readRecents();
  const idx = recents.findIndex(a => a.id === account.id);
  const entry: AccountSlot = { ...account, lastUsedAt: Date.now(), removedAt: undefined };
  if (idx === -1) recents.push(entry); else recents[idx] = entry;
  writeRecents(recents);
  return entry;
}

// Soft-removes when a dynamic list still references this account, hard-removes otherwise —
// same shape as listsStore.ts's deleteList. Never touches myAccount/currentAccount even if
// they happen to hold the same id, since those are stored independently.
export function removeRecentAccount(id: string): { softRemoved: boolean } {
  const recents = readRecents();
  const idx = recents.findIndex(a => a.id === id);
  if (idx === -1) return { softRemoved: false };
  if (isAccountReferenced(id)) {
    recents[idx] = { ...recents[idx], removedAt: Date.now() };
    writeRecents(recents);
    return { softRemoved: true };
  }
  recents.splice(idx, 1);
  writeRecents(recents);
  return { softRemoved: false };
}

export function restoreRecentAccount(id: string): void {
  const recents = readRecents();
  const idx = recents.findIndex(a => a.id === id);
  if (idx === -1 || !recents[idx].removedAt) return;
  const { removedAt: _removedAt, ...rest } = recents[idx];
  recents[idx] = rest as AccountSlot;
  writeRecents(recents);
}

// "Clear all" — removes every current entry via the same soft-remove-if-referenced rule as a
// single removeRecentAccount call, just applied across the whole list.
export function clearRecentAccounts(): void {
  readRecents().forEach(a => { if (!a.removedAt) removeRecentAccount(a.id); });
}

// Permanently purges any soft-removed account no longer referenced by anything — call after any
// change that could have removed the last reference (e.g. a dynamic list's sources edited).
export function sweepRemovedAccounts(): number {
  const recents = readRecents();
  const kept = recents.filter(a => !a.removedAt || isAccountReferenced(a.id));
  if (kept.length !== recents.length) writeRecents(kept);
  return recents.length - kept.length;
}
