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
  // `requests`/`statusCounts`/`networkErrors` are lifetime-since-restart totals, never trimmed.
  // `recent` is the same information at per-request granularity ({ts, status} or {ts,
  // networkError:true}), trimmed to the last hour on every push, so `lastHour`'s full
  // status/error breakdown (see summarizeWindow) can be recomputed from it on every read.
  if (!groups[group][label]) groups[group][label] = { requests: 0, statusCounts: {}, networkErrors: 0, recent: [] };
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
  try {
    const res = await fetch(url, opts);
    counter.statusCounts[res.status] = (counter.statusCounts[res.status] || 0) + 1;
    pushRecent(counter, { ts: Date.now(), status: res.status });
    return res;
  } catch (err) {
    counter.networkErrors++;
    pushRecent(counter, { ts: Date.now(), networkError: true });
    throw err;
  }
}

// Recomputes the last-hour breakdown from `recent` at read time — not just relying on
// pushRecent's own trim-on-write, since a read can happen well after the last write (a quiet
// label) and `recent`'s front entries could otherwise be stale by however long it's been idle.
function summarizeWindow(recent) {
  const cutoff = Date.now() - WINDOW_MS;
  const summary = { requests: 0, statusCounts: {}, networkErrors: 0 };
  for (const entry of recent) {
    if (entry.ts < cutoff) continue;
    summary.requests++;
    if (entry.networkError) summary.networkErrors++;
    else summary.statusCounts[entry.status] = (summary.statusCounts[entry.status] || 0) + 1;
  }
  return summary;
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

// Time buckets live at the root (sinceRestart/lastHour), each holding the same groups/labels
// shape underneath — makes it easy to review one bucket in isolation (e.g. "what happened in
// the last hour") rather than digging into every label to piece both granularities together.
function getMetrics() {
  return {
    since: startedAt,
    sinceRestart: buildBucket(c => ({ requests: c.requests, statusCounts: { ...c.statusCounts }, networkErrors: c.networkErrors })),
    lastHour: buildBucket(c => summarizeWindow(c.recent)),
  };
}

// Test-only: clears all counters so test files don't see counts left over from an earlier
// test in the same process (this module is a singleton, same "why _reset exists" reasoning
// as lib/cache.js's own `_reset`).
function _reset() {
  for (const key of Object.keys(groups)) delete groups[key];
}

module.exports = { trackedFetch, getMetrics, _reset };
