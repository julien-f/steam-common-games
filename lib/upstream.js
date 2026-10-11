'use strict';

// Shared by every upstream client (lib/steam.js, lib/hltb.js, lib/itad.js).

function upstreamError(msg) {
  return Object.assign(new Error(msg), { isUpstream: true });
}

// Generous relative to any single request's realistic fan-out (server.js's STREAM_MAX_GAMES
// caps that directly) — this only guards against queue depth growing genuinely unbounded, see
// createSemaphore's comment below.
const SEMAPHORE_MAX_QUEUE = 20000;

const semaphores = new Map(); // name -> semaphore, for GET /api/metrics

// Limit concurrent requests and enforce a minimum interval between them.
// minIntervalMs delays slot release after each request so throughput stays under the rate limit
// even when many requests are queued (concurrency alone isn't enough — Steam limits by req/s).
// maxQueue is a coarse safety valve, not a normal operating limit — this queue is shared
// process-wide across every caller/client, and a single legitimate large-library first load
// can easily enqueue thousands of jobs on its own (fetchGameDetails fans out per appid, and
// server.js's STREAM_MAX_GAMES/detailsLimit already bound how much any one request/IP can
// enqueue per minute — see server.js). This just stops queue depth from growing without
// bound if those upstream bounds are ever misconfigured, rather than rejecting realistic use.
// `name` keys it in getSemaphoreStats() and labels its log lines.
function createSemaphore(limit, minIntervalMs, maxQueue, name) {
  let active = 0;
  const queue = [];
  // Lifetime high-water mark on queue depth — see getSemaphoreStats() below. Distinct from
  // `active`/`queue.length`, which are live snapshots: this is the one number that shows
  // whether contention has ever gotten bad, even if the queue happens to be empty right now
  // when /api/metrics is read.
  let maxQueueSeen = 0;
  // Lifetime count of calls actually turned away by the `maxQueue` safety valve below — as
  // opposed to `queued`/`maxQueueSeen`, which describe healthy-but-busy contention, this is
  // the queue having been completely saturated and a caller getting a hard rejection instead
  // of just waiting its turn. `maxQueue` is deliberately generous (see this function's own
  // call sites) precisely so this should stay at 0 in practice — a nonzero value here means
  // that safety valve actually fired, which had no visibility in GET /api/metrics at all
  // before this counter existed.
  let rejected = 0;
  function release() {
    active--;
    next();
  }
  function next() {
    if (active < limit && queue.length > 0) {
      active++;
      const { fn, resolve, reject } = queue.shift();
      fn().then(
        (val) => {
          resolve(val);
          minIntervalMs > 0 ? setTimeout(release, minIntervalMs) : release();
        },
        (err) => {
          reject(err);
          minIntervalMs > 0 ? setTimeout(release, minIntervalMs) : release();
        },
      );
    }
  }
  const semaphore = (fn) =>
    new Promise((resolve, reject) => {
      if (queue.length >= maxQueue) {
        rejected++;
        // Not throttled/deduped like the circuit-breaker trip warning — maxQueue is generous
        // enough (SEMAPHORE_MAX_QUEUE) that this is expected to fire essentially never, so
        // unlike a genuine outage's worth of near-identical per-request errors, each
        // occurrence here is itself individually noteworthy rather than repetitive noise.
        console.warn(`[semaphore:${name}] queue saturated (${queue.length}/${maxQueue}) — rejecting request`);
        reject(upstreamError('Too many queued upstream requests — try again shortly'));
        return;
      }
      queue.push({ fn, resolve, reject });
      if (queue.length > maxQueueSeen) maxQueueSeen = queue.length;
      next();
    });
  semaphore.getStats = () => ({ active, queued: queue.length, maxQueueSeen, rejected });
  semaphores.set(name, semaphore);
  return semaphore;
}

// Every semaphore's live + lifetime-high-water-mark stats for GET /api/metrics. Lets a
// slow-upstream problem be told apart from a self-inflicted concurrency-cap bottleneck: high
// latency (lib/metrics.js) with a consistently near-zero queue means the upstream itself is just
// slow; a queue that's regularly deep means requests are piling up behind these limits instead.
function getSemaphoreStats() {
  return Object.fromEntries([...semaphores].map(([name, semaphore]) => [name, semaphore.getStats()]));
}

module.exports = { upstreamError, SEMAPHORE_MAX_QUEUE, createSemaphore, getSemaphoreStats };
