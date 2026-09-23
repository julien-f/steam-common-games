// Generic, per-key user-preference store — the single localStorage-backed mechanism every
// global preference (region.js's own region choice, and any future one) and every persisted
// table view (library.js/bundles.js — see their own comments) reads and writes through, so
// there's one place a future Steam-auth-backed server sync attaches to rather than a rewrite at
// every call site. An ES module, importing getPref/setPref directly wherever needed.
//
// One JSON blob under one key (rather than one localStorage key per preference) so the whole
// set can be enumerated at once later (e.g. a settings page, or the initial payload a synced
// account pulls down) without needing to know every individual key up front. This is purely a
// local-storage convenience, though — it does NOT mean sync itself works on the whole blob (see
// setPref below).
import { TABLE_VIEW_PREF_KEYS } from './tableViewKeys.ts';

export const PREFS_STORAGE_KEY = 'steam.isonoe.net:prefs';

export interface PrefEntry {
  value: unknown;
  updatedAt: number; // ms epoch — this device's clock, used for last-write-wins merges (authStore.ts)
}

// Bumped once, moving from "raw value per key" (v1) to "{value, updatedAt} per key" (v2) — the
// timestamp is what lets a signed-in device merge its local prefs against the server's per key
// (authStore.ts) instead of only ever comparing "does either side have anything at all". See
// migrateEntries below for the one-time upgrade of an existing v1 blob.
const SCHEMA_VERSION = 2;

function readRawBlob(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed as Record<string, unknown> : {};
  } catch { return {}; } // unavailable storage, or a corrupted/foreign value
}

function isPrefEntry(value: unknown): value is PrefEntry {
  return !!value && typeof value === 'object' && 'value' in (value as object) && 'updatedAt' in (value as object);
}

// A v1 blob's values are never {value, updatedAt}-shaped themselves (none of this app's actual
// pref values happen to have both those keys), so schemaVersion alone is enough to tell the two
// formats apart. `updatedAt: 0` for everything migrated this way — v1 never tracked write times,
// so it's treated as older than literally anything with a real one, local or server-side.
function readEntries(): Record<string, PrefEntry> {
  const raw = readRawBlob();
  const { schemaVersion, ...rest } = raw;
  const entries: Record<string, PrefEntry> = {};
  for (const [key, value] of Object.entries(rest)) {
    entries[key] = schemaVersion === SCHEMA_VERSION && isPrefEntry(value) ? value : { value, updatedAt: 0 };
  }
  return entries;
}

function writeEntries(entries: Record<string, PrefEntry>): void {
  try {
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify({ schemaVersion: SCHEMA_VERSION, ...entries }));
  } catch { /* not persisted this session — private browsing, quota, storage unavailable */ }
}

// Returns `fallback` when the key was never set, storage is unavailable (private browsing,
// cleared site data), or the stored blob itself is corrupted — never throws.
export function getPref<T = unknown>(key: string): T | undefined;
export function getPref<T>(key: string, fallback: T): T;
export function getPref<T = unknown>(key: string, fallback?: T): T | undefined {
  const entries = readEntries();
  return key in entries ? (entries[key].value as T) : (fallback as T);
}

export function setPref(key: string, value: unknown): void {
  const entries = readEntries();
  const updatedAt = Date.now();
  entries[key] = { value, updatedAt };
  writeEntries(entries);
  // Per-key push to the server once signed in (authStore.ts calls setSignedInSteamid on
  // sign-in/out) — deliberately never a whole-blob PUT, so two preferences changing around the
  // same time (different tabs/devices) can't race each other's writes. A table-view key is the
  // one exception: it's never auto-pushed at all, local-only until the user explicitly hits Save
  // on the "unsaved changes" banner (tableViewSync.ts) — every edit to a table would otherwise
  // silently overwrite whatever's saved to the account before the user ever saw a diff.
  if (!signedInSteamid || TABLE_VIEW_PREF_KEYS.includes(key)) return;
  if (DEBOUNCED_PUSH_PREFIXES.some(p => key.startsWith(p))) schedulePush(key);
  else pushPrefToServer(key, value, updatedAt);
}

// Written once per answer on the compare screen (ranking.ts) — pushing each write would trip the
// server's per-minute limit on PUT /api/me/prefs/:key, so the push waits for a pause instead.
const DEBOUNCED_PUSH_PREFIXES = ['ranking:'];
const PUSH_DEBOUNCE_MS = 3000;
const pendingPushes = new Map<string, ReturnType<typeof setTimeout>>();

function schedulePush(key: string): void {
  clearTimeout(pendingPushes.get(key));
  pendingPushes.set(key, setTimeout(() => flushPush(key), PUSH_DEBOUNCE_MS));
}

function flushPush(key: string, keepalive = false): void {
  clearTimeout(pendingPushes.get(key));
  pendingPushes.delete(key);
  const entry = readEntries()[key];
  if (entry && signedInSteamid) pushPrefToServer(key, entry.value, entry.updatedAt, { keepalive });
}

// keepalive so a push flushed as the tab is hidden/closed still completes.
export function flushPendingPushes(): void {
  for (const key of [...pendingPushes.keys()]) flushPush(key, true);
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPendingPushes();
  });
}

// Set by authStore.ts once GET /api/me resolves (and cleared on sign-out) — kept here, rather
// than importing authStore.ts, so this module doesn't need to know about auth beyond "should
// setPref also sync". authStore.ts is the one importing from this file (for the prefs merge),
// not the other way around.
let signedInSteamid: string | null = null;
export function setSignedInSteamid(steamid: string | null): void {
  signedInSteamid = steamid;
}

// Test-only (see test/prefs.test.js) — this repo's usual "delete require.cache between tests"
// reset doesn't reach a module-level `let` in a TS-stripped ESM file (confirmed live; same
// caveat myOwnership.ts/accountOverride.ts document for their own module state), and unlike
// those this one variable didn't seem worth a whole factory-function rewrite for. Same `_reset`
// naming convention as lib/cache.js/lib/metrics.js's own test-only resets.
export function _resetSignedInSteamid(): void {
  signedInSteamid = null;
}

// Fire-and-forget — a failed sync leaves the change on this device only, in localStorage, exactly
// as it worked before server sync existed at all. Not retried here: authStore.ts's merge, which
// runs on every sign-in check (not just the first), pushes any key whose local `updatedAt` still
// beats the server's, so a failed push is naturally retried the next time this device checks in.
export function pushPrefToServer(key: string, value: unknown, updatedAt: number, { keepalive = false } = {}): Promise<void> {
  return fetch(`/api/me/prefs/${encodeURIComponent(key)}`, {
    method: 'PUT',
    keepalive,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value, updatedAt }),
  })
    .then(() => undefined)
    .catch(err => console.error(`[prefs] failed to sync "${key}" to the server`, err));
}

// Every locally stored key, with its value and last-write time — authStore.ts's merge diffs this
// against the server's own per-key map to decide, key by key, which side is newer.
export function getAllPrefEntries(): Record<string, PrefEntry> {
  return readEntries();
}

// Writes one key's value locally without pushing it back to the server — used when a merge finds
// the server's copy of that key is newer than this device's own. Bypasses setPref specifically to
// avoid that echo.
export function adoptPrefEntry(key: string, value: unknown, updatedAt: number): void {
  const entries = readEntries();
  entries[key] = { value, updatedAt };
  writeEntries(entries);
}
