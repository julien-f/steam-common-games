'use strict';

const path = require('node:path');
// Priority: shell env > .env > default.env
require('dotenv').config({ quiet: true });
require('dotenv').config({ path: path.join(__dirname, '..', 'default.env'), quiet: true });

const LIBRARY_CACHE_TTL_MS = Number(process.env.LIBRARY_CACHE_TTL_MINUTES) * 60 * 1000;
const RESOLVE_CACHE_TTL_MS = Number(process.env.RESOLVE_CACHE_TTL_MINUTES) * 60 * 1000;
const RATING_CACHE_TTL_MS  = Number(process.env.RATING_CACHE_TTL_MINUTES)  * 60 * 1000;
const META_CACHE_TTL_MS    = Number(process.env.META_CACHE_TTL_MINUTES)    * 60 * 1000;

module.exports = { LIBRARY_CACHE_TTL_MS, RESOLVE_CACHE_TTL_MS, RATING_CACHE_TTL_MS, META_CACHE_TTL_MS };
