'use strict';

// One breaker per blocking-prone upstream: 2 consecutive 403s read as a blanket block (a single
// one can be a per-game block: removed or region-locked), so the upstream is left alone for 5
// minutes instead of every queued request walking into the block. Any non-403 resets the streak.
const TRIP_AFTER = 2;
const BLOCK_MS = 5 * 60 * 1000;

const breakers = new Map(); // name -> state, for GET /api/metrics
const closed = () => ({ consecutive403s: 0, blockedUntil: 0, tripCount: 0 });

function createCircuitBreaker(name, label) {
  const state = closed();
  breakers.set(name, state);
  return {
    // `isCircuitOpen` lets callers skip logging it: the trip itself already warned once.
    assertClosed() {
      if (Date.now() < state.blockedUntil)
        throw Object.assign(new Error(`${label}: rate limited (circuit open)`), {
          isUpstream: true,
          isCircuitOpen: true,
        });
    },
    record(status) {
      if (status !== 403) {
        state.consecutive403s = 0;
        return;
      }
      if (++state.consecutive403s < TRIP_AFTER) return;
      state.consecutive403s = 0;
      state.blockedUntil = Date.now() + BLOCK_MS;
      state.tripCount++;
      console.warn(
        `[circuit-breaker] ${name} tripped after repeated 403s — blocked until ${new Date(state.blockedUntil).toISOString()} (${BLOCK_MS / 1000}s)`,
      );
    },
    _reset() {
      Object.assign(state, closed());
    },
  };
}

// `blockedUntil` is the current state (0 = never tripped), `tripCount` the lifetime count that
// tells "tripped once, long ago" from "tripping every 20 minutes", and `consecutive403s` the
// early warning before a trip.
function getCircuitBreakers() {
  return Object.fromEntries([...breakers].map(([name, state]) => [name, { ...state }]));
}

function _resetCircuitBreakers() {
  for (const state of breakers.values()) Object.assign(state, closed());
}

module.exports = { createCircuitBreaker, getCircuitBreakers, _resetCircuitBreakers };
