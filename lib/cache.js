'use strict';

const fs = require('fs');
const path = require('path');

const { CACHE_TTL_MS, DETAILS_CACHE_TTL_MS } = require('./config');

const CACHE_FILE = path.join(__dirname, '..', 'cache.json');
const CACHE_FILE_TMP = CACHE_FILE + '.tmp';

function getTtlForKey(key) {
  if (key.startsWith('resolve:') || key.startsWith('rating:') || key.startsWith('hltb:') || key.startsWith('meta:')) return DETAILS_CACHE_TTL_MS;
  return CACHE_TTL_MS;
}

const cache = (() => {
  for (const file of [CACHE_FILE, CACHE_FILE_TMP]) {
    try {
      const entries = Object.entries(JSON.parse(fs.readFileSync(file, 'utf8')));
      if (file === CACHE_FILE_TMP) console.warn(`[cache] Recovered from ${path.basename(file)}`);
      console.log(`[cache] Loaded ${entries.length} entries from disk`);
      return new Map(entries);
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn(`[cache] Failed to read ${path.basename(file)}: ${err.message}`);
    }
  }
  return new Map();
})();

// Evict entries that expired while the server was stopped
evictExpired();

function getCached(key) {
  const e = cache.get(key);
  if (!e) return undefined;
  if (Date.now() - e.ts < getTtlForKey(key)) return e.value;
  cache.delete(key);
  return undefined;
}

let _saveTimer = null;
function setCache(key, value) {
  cache.set(key, { value, ts: Date.now() });
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(saveCacheToDisk, 5000);
  _saveTimer.unref();
}

function evictExpired() {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now - entry.ts > getTtlForKey(key)) cache.delete(key);
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
