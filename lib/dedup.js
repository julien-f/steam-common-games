'use strict';

const { recordDedupHit, currentClient } = require('./metrics');

// `name` is optional and metrics-only (see lib/metrics.js's dedupHits) — identifies which
// module's dedup instance this is (lib/steam.js's 'steam', lib/itad.js's 'itad') so a
// coalesce burst is attributable. Omitted by most test call sites, which just don't get
// tracked. `isRefused(value)` marks a resolved value that carries such a refusal.
function createDedup(name, { isRefused = () => false } = {}) {
  const inFlight = new Map(); // key -> { promise, client }
  return function withDedup(key, fn) {
    const shared = inFlight.get(key);
    if (shared) {
      recordDedupHit(name);
      if (shared.client === currentClient()) return shared.promise;
      // Another client's share running out is no answer for this one: it tries once on its own.
      return shared.promise.then(
        (value) => (isRefused(value) ? fn() : value),
        (err) => {
          if (err?.isClientBudgetExhausted) return fn();
          throw err;
        },
      );
    }
    const promise = fn().finally(() => inFlight.delete(key));
    inFlight.set(key, { promise, client: currentClient() });
    return promise;
  };
}

module.exports = { createDedup };
