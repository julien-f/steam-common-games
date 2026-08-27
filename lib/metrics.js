'use strict';

// In-memory counters for outbound requests to third-party services (Steam, HLTB, ITAD,
// ProtonDB), grouped by trust-tier/routing boundary — the same boundaries lib/steam.js's own
// semaphores (storeLimit/tagLimit/protonLimit) and the lib/hltb.js/lib/itad.js module split
// already draw — and then by the specific function making the call, so a stall in one
// specific operation (e.g. resolveItadIds succeeding while getPrices doesn't) is visible
// rather than folded into one flat per-service count. See CLAUDE.md's Monitoring section.
//
// Deliberately in-memory only, not persisted to db.sqlite: resets on restart, same trade-off
// the process-local dedup map / rate-limit semaphores already make elsewhere in this app.
const startedAt = Date.now();
const groups = Object.create(null);

// The one rolling window tracked alongside the lifetime-since-restart totals — "is this
// happening right now" is the question a window answers that a lifetime count can't; a single
// hour-long window covers that without the bookkeeping of several windows at once (5 min/day/
// week were considered and dropped in favor of just this one — see CLAUDE.md).
const WINDOW_MS = 60 * 60 * 1000;

function counterFor(group, label) {
  if (!groups[group]) groups[group] = Object.create(null);
  // `requests`/`statusCounts`/`networkErrors`/`latencySum`/`latencyMax` are lifetime-since-
  // restart totals, never trimmed. `recent` is the same information at per-request granularity
  // ({ts, status, durationMs} or {ts, networkError:true, durationMs}), trimmed to the last hour
  // on every push, so `lastHour`'s full status/error/latency breakdown (see summarizeWindow) can
  // be recomputed from it on every read. latencySum/latencyMax cover every request regardless of
  // outcome — a timeout's duration is itself a signal, not just a successful response's.
  if (!groups[group][label]) groups[group][label] = { requests: 0, statusCounts: {}, networkErrors: 0, latencySum: 0, latencyMax: 0, recent: [] };
  return groups[group][label];
}

function pushRecent(counter, entry) {
  counter.recent.push(entry);
  const cutoff = Date.now() - WINDOW_MS;
  while (counter.recent.length && counter.recent[0].ts < cutoff) counter.recent.shift();
}

// Drop-in replacement for a bare `fetch(url, opts)` call — same signature/return value (a
// Response, or a rethrown error), just counted first. `group`/`label` are metrics-only, never
// sent upstream.
//
// Outcomes are bucketed by raw HTTP status code (`statusCounts`), not collapsed into a single
// "errors" count — plenty of non-2xx responses in this app are expected business outcomes for
// one specific label (e.g. a 403 from getPlayerAchievements means "private profile", not a
// failure), so a blanket error count would conflate those with a genuine problem like a
// 429/403 storm on steam-store. `networkErrors` (fetch() itself throwing — timeout, DNS,
// abort) is unambiguous everywhere, so it does get its own counter. See CLAUDE.md's
// Monitoring section for how to read a given label's status codes.
async function trackedFetch(group, label, url, opts) {
  const counter = counterFor(group, label);
  counter.requests++;
  const start = Date.now();
  try {
    const res = await fetch(url, opts);
    const durationMs = Date.now() - start;
    counter.statusCounts[res.status] = (counter.statusCounts[res.status] || 0) + 1;
    counter.latencySum += durationMs;
    if (durationMs > counter.latencyMax) counter.latencyMax = durationMs;
    pushRecent(counter, { ts: Date.now(), status: res.status, durationMs });
    return res;
  } catch (err) {
    const durationMs = Date.now() - start;
    counter.networkErrors++;
    counter.latencySum += durationMs;
    if (durationMs > counter.latencyMax) counter.latencyMax = durationMs;
    pushRecent(counter, { ts: Date.now(), networkError: true, durationMs });
    throw err;
  }
}

// Recomputes the last-hour breakdown from `recent` at read time — not just relying on
// pushRecent's own trim-on-write, since a read can happen well after the last write (a quiet
// label) and `recent`'s front entries could otherwise be stale by however long it's been idle.
function summarizeWindow(recent) {
  const cutoff = Date.now() - WINDOW_MS;
  const summary = { requests: 0, statusCounts: {}, networkErrors: 0, latencySum: 0, latencyMax: 0 };
  for (const entry of recent) {
    if (entry.ts < cutoff) continue;
    summary.requests++;
    if (entry.networkError) summary.networkErrors++;
    else summary.statusCounts[entry.status] = (summary.statusCounts[entry.status] || 0) + 1;
    const durationMs = entry.durationMs || 0;
    summary.latencySum += durationMs;
    if (durationMs > summary.latencyMax) summary.latencyMax = durationMs;
  }
  return {
    requests: summary.requests,
    statusCounts: summary.statusCounts,
    networkErrors: summary.networkErrors,
    avgLatencyMs: summary.requests ? Math.round(summary.latencySum / summary.requests) : 0,
    maxLatencyMs: summary.latencyMax,
  };
}

// Builds one bucket's worth of the response (`sinceRestart` or `lastHour`) — `groups` nested
// under it, each label sitting directly under its group (no intermediate wrapper — a group-
// level total was tried and dropped as too verbose for what it added; sum a group's labels
// client-side if that's needed). `toLabelEntry` picks which granularity a given counter
// contributes (the lifetime totals, or summarizeWindow(recent)).
function buildBucket(toLabelEntry) {
  const bucket = { groups: {} };
  for (const group of Object.keys(groups)) {
    bucket.groups[group] = {};
    for (const label of Object.keys(groups[group])) {
      bucket.groups[group][label] = toLabelEntry(groups[group][label]);
    }
  }
  return bucket;
}

// Shared shape for a simple "count events per name, windowed the same sinceRestart/lastHour
// way as everything else here" counter — backs both rateLimiters and dedupHits below, which
// are otherwise identical bookkeeping (a lifetime count + a recent[] trimmed by pushRecent)
// over two different event types. A third near-identical copy for either would just be
// duplication; a genuinely different shape (cacheEvents' multi-outcome hits/misses/forced
// below) still doesn't fit this and stays separate rather than being forced in.
//
// `summarizeSinceRestart`/`summarizeLastHour` are two separate flat `{name: count}` maps
// (not one `{name: {sinceRestart, lastHour}}` map) so getMetrics() can slot each straight
// into the top-level sinceRestart/lastHour bucket alongside `groups` — see getMetrics()'s
// own comment for why every windowed signal in this response lives under those two root
// buckets rather than each metric family nesting its own sinceRestart/lastHour internally.
function createNamedCounter() {
  const counters = Object.create(null);
  function record(name) {
    if (!name) return; // an unnamed instance (e.g. createDedup() with no name) opts out
    if (!counters[name]) counters[name] = { count: 0, recent: [] };
    const c = counters[name];
    c.count++;
    pushRecent(c, { ts: Date.now() });
  }
  function summarizeSinceRestart() {
    return Object.fromEntries(Object.keys(counters).map(name => [name, counters[name].count]));
  }
  function summarizeLastHour() {
    const cutoff = Date.now() - WINDOW_MS;
    return Object.fromEntries(Object.keys(counters).map(name =>
      [name, counters[name].recent.filter(e => e.ts >= cutoff).length]
    ));
  }
  function reset() {
    for (const key of Object.keys(counters)) delete counters[key];
  }
  return { record, summarizeSinceRestart, summarizeLastHour, reset };
}

// Inbound counterpart to trackedFetch's outbound statusCounts — how often our OWN
// express-rate-limit instances (server.js) actually rejected a client request, not how often
// a third party rejected us. Kept separate from `groups`/`counterFor`: this is a different axis
// (self-imposed inbound limits vs. outbound calls to a specific service), so mixing it into the
// group/label tree would make e.g. "steam-store" ambiguous between "calls we made to Steam"
// and "requests we rejected". `name` is the limiter's own name (server.js's namedRateLimit),
// one entry per distinct limiter instance.
const limiterCounter = createNamedCounter();
const recordLimiterTrip = name => limiterCounter.record(name);

// How often lib/dedup.js's createDedup() actually coalesced a concurrent call into an
// already-in-flight one, per named dedup instance (lib/steam.js's 'steam', lib/itad.js's
// 'itad'). Windowed the same sinceRestart/lastHour way as rateLimiters above: an unusual burst
// of coalescing (many concurrent duplicate calls for the same key — a retry loop or a buggy
// polling client) is itself a "is this happening right now" signal, not just background
// context a lifetime total would still convey just as well.
const dedupCounter = createNamedCounter();
const recordDedupHit = name => dedupCounter.record(name);

// lib/cache.js's getCached() hit/miss/forced outcomes — kept here rather than tracked locally
// in lib/cache.js, so every append-only "counter, windowed via this same recent[]/pushRecent
// machinery" lives in one place (outbound requests, rate-limiter trips, dedup hits, and this).
// A cache hit-rate collapse IS a "detect it while it's happening" signal on the same footing
// as rateLimiters/outbound statusCounts: without a window, a regression that started an hour
// ago stays invisible under a lifetime average diluted by however long (up to the 90-day
// `resolve:` TTL) the process has been running — the exact problem sinceRestart/lastHour
// exists to solve everywhere else in this file. Doesn't reuse createNamedCounter above since
// it needs three sub-outcomes (hits/misses/forced) per group, not one bare count per name.
const cacheEvents = Object.create(null);

// `outcome` is one of 'hits'/'misses'/'forced' — see lib/cache.js's getCached().
function recordCacheEvent(group, outcome) {
  if (!cacheEvents[group]) cacheEvents[group] = { hits: 0, misses: 0, forced: 0, recent: [] };
  const c = cacheEvents[group];
  c[outcome]++;
  pushRecent(c, { ts: Date.now(), outcome });
}

function cacheHitsSinceRestart() {
  return Object.fromEntries(Object.keys(cacheEvents).map(group => {
    const c = cacheEvents[group];
    return [group, { hits: c.hits, misses: c.misses, forced: c.forced }];
  }));
}

function cacheHitsLastHour() {
  const cutoff = Date.now() - WINDOW_MS;
  return Object.fromEntries(Object.keys(cacheEvents).map(group => {
    const lastHour = { hits: 0, misses: 0, forced: 0 };
    for (const e of cacheEvents[group].recent) if (e.ts >= cutoff) lastHour[e.outcome]++;
    return [group, lastHour];
  }));
}

// Time buckets live at the root (sinceRestart/lastHour) and ONLY at the root — every windowed
// signal this endpoint exposes (outbound requests, rate-limiter trips, dedup hits, cache
// hit/miss/forced) nests under one or the other, rather than some signals putting the window
// at the root (groups) and others nesting sinceRestart/lastHour inside each named entry
// (rateLimiters/dedupHits/cacheHits used to). One convention throughout makes "what happened
// in the last hour" a single object to read for any of these, not a digging pattern that
// differs per metric family. `cacheEntries`/`circuitBreakers`/`semaphores`, composed in by
// server.js, are live snapshots rather than windowed counters and so deliberately sit outside
// both buckets — there's no "since restart" vs. "last hour" version of a current queue depth.
function getMetrics() {
  return {
    since: startedAt,
    sinceRestart: {
      groups: buildBucket(c => ({
        requests: c.requests,
        statusCounts: { ...c.statusCounts },
        networkErrors: c.networkErrors,
        avgLatencyMs: c.requests ? Math.round(c.latencySum / c.requests) : 0,
        maxLatencyMs: c.latencyMax,
      })).groups,
      rateLimiters: limiterCounter.summarizeSinceRestart(),
      dedupHits: dedupCounter.summarizeSinceRestart(),
      cacheHits: cacheHitsSinceRestart(),
    },
    lastHour: {
      groups: buildBucket(c => summarizeWindow(c.recent)).groups,
      rateLimiters: limiterCounter.summarizeLastHour(),
      dedupHits: dedupCounter.summarizeLastHour(),
      cacheHits: cacheHitsLastHour(),
    },
  };
}

// Test-only: clears all counters so test files don't see counts left over from an earlier
// test in the same process (this module is a singleton, same "why _reset exists" reasoning
// as lib/cache.js's own `_reset`).
function _reset() {
  for (const key of Object.keys(groups)) delete groups[key];
  limiterCounter.reset();
  dedupCounter.reset();
  for (const key of Object.keys(cacheEvents)) delete cacheEvents[key];
}

module.exports = { trackedFetch, recordLimiterTrip, recordDedupHit, recordCacheEvent, getMetrics, _reset };
