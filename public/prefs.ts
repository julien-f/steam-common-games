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
export const PREFS_STORAGE_KEY = 'steam.isonoe.net:prefs';

function readPrefsBlob(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed as Record<string, unknown> : {};
  } catch { return {}; } // unavailable storage, or a corrupted/foreign value
}

// Returns `fallback` when the key was never set, storage is unavailable (private browsing,
// cleared site data), or the stored blob itself is corrupted — never throws.
export function getPref<T = unknown>(key: string): T | undefined;
export function getPref<T>(key: string, fallback: T): T;
export function getPref<T = unknown>(key: string, fallback?: T): T | undefined {
  const blob = readPrefsBlob();
  return key in blob ? (blob[key] as T) : (fallback as T);
}

export function setPref(key: string, value: unknown): void {
  try {
    const blob = readPrefsBlob();
    blob[key] = value;
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(blob));
  } catch { /* not persisted this session — private browsing, quota, storage unavailable */ }
  // Per-key push to the server once signed in (authStore.ts calls setSignedInSteamid on
  // sign-in/out) — deliberately never a whole-blob PUT, so two preferences changing around the
  // same time (different tabs/devices) can't race each other's writes.
  if (signedInSteamid) pushPrefToServer(key, value);
}

// Set by authStore.ts once GET /api/me resolves (and cleared on sign-out) — kept here, rather
// than importing authStore.ts, so this module doesn't need to know about auth beyond "should
// setPref also sync". authStore.ts is the one importing from this file (for the first-login
// import/merge), not the other way around.
let signedInSteamid: string | null = null;
export function setSignedInSteamid(steamid: string | null): void {
  signedInSteamid = steamid;
}

// Fire-and-forget — a failed sync leaves the change on this device only, in localStorage,
// exactly as it worked before server sync existed at all; nothing here is retried, since the
// next setPref for the same key (or a page reload's own catch-up push) is a fine enough retry
// for a preference that isn't behind any correctness-critical logic.
function pushPrefToServer(key: string, value: unknown): Promise<void> {
  return fetch(`/api/me/prefs/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  })
    .then(() => undefined)
    .catch(err => console.error(`[prefs] failed to sync "${key}" to the server`, err));
}

// Every locally stored key/value — used by authStore.ts's first-login import to decide whether
// this browser or the signed-in account already has data, and to push it all up at once.
export function getAllPrefs(): Record<string, unknown> {
  return readPrefsBlob();
}

// Replaces the whole local blob with the server's — only ever called once, right after signing
// in, when the account's server-side prefs are adopted in place of (rather than merged with)
// whatever was in this browser. Never goes through setPref, since there's nothing to push back.
export function adoptServerPrefs(serverPrefs: Record<string, unknown>): void {
  try { localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(serverPrefs)); } catch { /* unavailable storage */ }
}

// The mirror of adoptServerPrefs: pushes every key already in this browser up to the server,
// for first-login import when the account has nothing saved yet.
export async function pushAllPrefsToServer(): Promise<void> {
  await Promise.all(Object.entries(readPrefsBlob()).map(([key, value]) => pushPrefToServer(key, value)));
}
