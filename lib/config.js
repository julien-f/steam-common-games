'use strict';

const CACHE_TTL_MS         = Number(process.env.CACHE_TTL_MINUTES         ||   60) * 60 * 1000;
const RESOLVE_CACHE_TTL_MS = Number(process.env.RESOLVE_CACHE_TTL_MINUTES || 10080) * 60 * 1000;
const RATING_CACHE_TTL_MS  = Number(process.env.RATING_CACHE_TTL_MINUTES  || 20160) * 60 * 1000;
const META_CACHE_TTL_MS    = Number(process.env.META_CACHE_TTL_MINUTES    || 43200) * 60 * 1000;

module.exports = { CACHE_TTL_MS, RESOLVE_CACHE_TTL_MS, RATING_CACHE_TTL_MS, META_CACHE_TTL_MS };
