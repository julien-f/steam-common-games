'use strict';

function createDedup() {
  const inFlight = new Map();
  return function withDedup(key, fn) {
    if (inFlight.has(key)) return inFlight.get(key);
    const p = fn().finally(() => inFlight.delete(key));
    inFlight.set(key, p);
    return p;
  };
}

module.exports = { createDedup };
