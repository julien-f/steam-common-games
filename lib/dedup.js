'use strict';

const { recordDedupHit } = require('./metrics');

// `name` is optional and metrics-only (see lib/metrics.js's dedupHits) — identifies which
// module's dedup instance this is (lib/steam.js's 'steam', lib/itad.js's 'itad') so a
// coalesce burst is attributable. Omitted by most test call sites, which just don't get
// tracked.
function createDedup(name) {
  const inFlight = new Map();
  return function withDedup(key, fn) {
    if (inFlight.has(key)) {
      recordDedupHit(name);
      return inFlight.get(key);
    }
    const p = fn().finally(() => inFlight.delete(key));
    inFlight.set(key, p);
    return p;
  };
}

module.exports = { createDedup };
