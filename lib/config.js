'use strict';

const path = require('node:path');
// Priority: shell env > .env > default.env
require('dotenv').config({ quiet: true });
require('dotenv').config({ path: path.join(__dirname, '..', 'default.env'), quiet: true });

const LIBRARY_CACHE_TTL_MS = Number(process.env.LIBRARY_CACHE_TTL_MINUTES) * 60 * 1000;
const RESOLVE_CACHE_TTL_MS = Number(process.env.RESOLVE_CACHE_TTL_MINUTES) * 60 * 1000;
const RATING_CACHE_TTL_MS  = Number(process.env.RATING_CACHE_TTL_MINUTES)  * 60 * 1000;
const META_CACHE_TTL_MS    = Number(process.env.META_CACHE_TTL_MINUTES)    * 60 * 1000;
const SEARCH_CACHE_TTL_MS  = Number(process.env.SEARCH_CACHE_TTL_MINUTES)  * 60 * 1000;
const NEWS_CACHE_TTL_MS    = Number(process.env.NEWS_CACHE_TTL_MINUTES)    * 60 * 1000;
const BUNDLES_CACHE_TTL_MS = Number(process.env.BUNDLES_CACHE_TTL_MINUTES) * 60 * 1000;
const ITAD_ID_CACHE_TTL_MS = Number(process.env.ITAD_ID_CACHE_TTL_MINUTES) * 60 * 1000;
// Global outbound budgets — see lib/metrics.js's chargeBudget and default.env. Read here, with
// every other env-backed setting, rather than in lib/metrics.js directly: this module is what
// loads .env/default.env, and metrics.js can be required before it otherwise.
const OUTBOUND_HOURLY_MAX = Number(process.env.OUTBOUND_HOURLY_MAX);
const OUTBOUND_DAILY_MAX = Number(process.env.OUTBOUND_DAILY_MAX);
// Per-entry overrides for cached misses — see setCache's `ttlMs` in lib/cache.js.
const MISS_CACHE_TTL_MS = Number(process.env.MISS_CACHE_TTL_MINUTES) * 60 * 1000;
const RESOLVE_MISS_CACHE_TTL_MS = Number(process.env.RESOLVE_MISS_CACHE_TTL_MINUTES) * 60 * 1000;

module.exports = { LIBRARY_CACHE_TTL_MS, RESOLVE_CACHE_TTL_MS, RATING_CACHE_TTL_MS, META_CACHE_TTL_MS, SEARCH_CACHE_TTL_MS, NEWS_CACHE_TTL_MS, BUNDLES_CACHE_TTL_MS, ITAD_ID_CACHE_TTL_MS, MISS_CACHE_TTL_MS, RESOLVE_MISS_CACHE_TTL_MS, OUTBOUND_HOURLY_MAX, OUTBOUND_DAILY_MAX };
