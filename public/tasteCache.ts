// Device-local cache of each account's Taste (tagTaste.ts), recomputed on each Owned visit, never synced;
// its own keys, not prefs. Bounded, and the first thing to go when storage is full (lists-and-accounts.md).
import type { Taste } from './tagTaste.ts';

const TASTE_STORAGE_PREFIX = 'steam.isonoe.net:taste:';
export const TASTE_CACHE_MAX = 5;

export function loadTaste(accountId: string): Taste | null {
  try {
    const taste = JSON.parse(localStorage.getItem(TASTE_STORAGE_PREFIX + accountId) ?? 'null');
    return taste?.idf && taste.games ? taste : null;
  } catch {
    return null;
  }
}

function tasteKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(TASTE_STORAGE_PREFIX)) keys.push(key);
  }
  return keys;
}

// The stored tastes but those of `keep` (account ids), oldest `at` first; an unreadable `at` counts as oldest.
function evictableByAge(keys: readonly string[], keep: readonly string[]): string[] {
  const kept = new Set(keep.map((id) => TASTE_STORAGE_PREFIX + id));
  // A regex on the raw string: parsing a large library's taste to read one number would be wasteful.
  const at = (key: string) => Number(/^\{"at":(\d+)/.exec(localStorage.getItem(key) ?? '')?.[1] ?? 0);
  return keys
    .filter((key) => !kept.has(key))
    .map((key) => ({ key, at: at(key) }))
    .sort((a, b) => a.at - b.at)
    .map((e) => e.key);
}

const isQuotaError = (err: unknown) => err instanceof DOMException && err.name === 'QuotaExceededError';

// Writes `key`, evicting the oldest tastes not in `keep` while storage is full; false if it still doesn't fit.
export function setItemMakingRoom(key: string, value: string, keep: readonly string[] = []): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (err) {
    if (!isQuotaError(err)) return false;
  }
  try {
    for (const victim of evictableByAge(tasteKeys(), keep)) {
      localStorage.removeItem(victim);
      try {
        localStorage.setItem(key, value);
        return true;
      } catch (err) {
        if (!isQuotaError(err)) return false;
      }
    }
  } catch {
    /* storage unavailable */
  }
  return false;
}

// `keep`: accounts whose taste is never evicted for this one (the ★ and current accounts).
export function saveTaste(accountId: string, taste: Taste, keep: readonly string[]): void {
  const kept = [accountId, ...keep];
  if (!setItemMakingRoom(TASTE_STORAGE_PREFIX + accountId, JSON.stringify(taste), kept)) return;
  try {
    const keys = tasteKeys();
    if (keys.length <= TASTE_CACHE_MAX) return;
    const excess = evictableByAge(keys, kept).slice(0, keys.length - TASTE_CACHE_MAX);
    for (const key of excess) localStorage.removeItem(key);
  } catch {
    /* storage unavailable */
  }
}
