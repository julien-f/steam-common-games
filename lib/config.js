'use strict';

const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MINUTES || 60) * 60 * 1000;
const DETAILS_CACHE_TTL_MS = Number(process.env.DETAILS_CACHE_TTL_MINUTES || 10080) * 60 * 1000;

module.exports = { CACHE_TTL_MS, DETAILS_CACHE_TTL_MS };
