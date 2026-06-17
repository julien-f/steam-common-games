'use strict';

const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, '..', 'cache.json');
const CACHE_FILE_TMP = CACHE_FILE + '.tmp';

const cache = (() => {
  try {
    const entries = Object.entries(JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')));
    console.log(`[cache] Loaded ${entries.length} entries from disk`);
    return new Map(entries);
  } catch {
    return new Map();
  }
})();

function getCached(key, ttlMs) {
  const e = cache.get(key);
  if (!e) return null;
  if (Date.now() - e.ts < ttlMs) return e.value;
  cache.delete(key);
  return null;
}

let _saveTimer = null;
function setCache(key, value, ttlMs) {
  cache.set(key, { value, ts: Date.now(), ttlMs });
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(saveCacheToDisk, 5000);
  _saveTimer.unref();
}

function evictExpired() {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.ttlMs !== undefined && now - entry.ts > entry.ttlMs) cache.delete(key);
  }
}

function saveCacheToDisk() {
  evictExpired();
  try {
    fs.writeFileSync(CACHE_FILE_TMP, JSON.stringify(Object.fromEntries(cache)));
    fs.renameSync(CACHE_FILE_TMP, CACHE_FILE);
  } catch (err) {
    console.warn('[cache] Failed to save:', err.message);
  }
}

process.on('exit', saveCacheToDisk);
process.on('SIGINT',  () => { saveCacheToDisk(); process.exit(0); });
process.on('SIGTERM', () => { saveCacheToDisk(); process.exit(0); });

function getCacheStats() {
  return { entries: cache.size };
}

function _reset(entries = []) {
  cache.clear();
  for (const [k, v] of entries) cache.set(k, v);
}

module.exports = { getCached, setCache, getCacheStats, _reset };
