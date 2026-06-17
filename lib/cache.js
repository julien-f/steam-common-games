'use strict';

const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, '..', 'cache.json');

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
    fs.writeFileSync(CACHE_FILE, JSON.stringify(Object.fromEntries(cache)));
  } catch (err) {
    console.warn('[cache] Failed to save:', err.message);
  }
}

process.on('exit', saveCacheToDisk);
process.on('SIGINT',  () => { saveCacheToDisk(); process.exit(0); });
process.on('SIGTERM', () => { saveCacheToDisk(); process.exit(0); });

module.exports = { getCached, setCache };
