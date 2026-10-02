'use strict';

// Fanatical's own storefront feed — only for the quantity-priced tiers of its "Build your own"
// (pick-and-mix) bundles, which ITAD lists with a null tier price. Undocumented and key-less (same
// trust tier as HLTB/the Steam store endpoints, see docs/dev/integrations.md): one cached call to
// /api/all/en serves every bundle, so volume stays flat however many people browse.

const { getCached, getCachedAt, setCache } = require('./cache');
const { createDedup } = require('./dedup');
const { trackedFetch } = require('./metrics');

const withDedup = createDedup('fanatical');

const FEED_URL = 'https://www.fanatical.com/api/all/en';
const CACHE_KEY = 'fanatical-pnm:all';
// Short: the bundle list waits on this call when it isn't cached, and the feed normally answers in ~150ms.
const TIMEOUT_MS = 3000;
const FAILURE_TTL_MS = 60 * 60 * 1000;
// A slug missing from a cached map this old is worth one re-fetch: the bundle likely went live after it.
const REFETCH_FOR_MISSING_MS = 60 * 60 * 1000;

// ITAD's purchase link for a Fanatical bundle is an affiliate redirect wrapping the store URL
// (`…cread.php?…&ued=https%3A%2F%2Fwww.fanatical.com%2Fen%2Fpick-and-mix%2F<slug>`).
function pickAndMixSlug(url) {
  if (typeof url !== 'string') return null;
  let decoded;
  try {
    decoded = decodeURIComponent(url);
  } catch {
    return null;
  }
  const m = /fanatical\.com\/[a-z]{2}(?:-[a-z]{2})?\/pick-and-mix\/([a-z0-9-]+)/i.exec(decoded);
  return m ? m[1].toLowerCase() : null;
}

// slug -> [{ quantity, prices: { CUR: amount } }], quantity-ascending. Fanatical prices in minor
// units, with float noise (CAD 1789.9999999999998).
function parsePickAndMix(feed) {
  const out = {};
  for (const b of Array.isArray(feed?.pickandmix) ? feed.pickandmix : []) {
    if (typeof b?.slug !== 'string' || !Array.isArray(b.tiers)) continue;
    const tiers = b.tiers
      .filter((t) => Number.isInteger(t?.quantity) && t.quantity > 0 && t.price && typeof t.price === 'object')
      .map((t) => ({
        quantity: t.quantity,
        prices: Object.fromEntries(
          Object.entries(t.price)
            .filter(([, v]) => typeof v === 'number' && v >= 0)
            .map(([cur, v]) => [cur, Math.round(v) / 100]),
        ),
      }))
      .sort((a, b) => a.quantity - b.quantity);
    if (tiers.length) out[b.slug.toLowerCase()] = tiers;
  }
  return out;
}

// `stale` is the map already cached, kept on failure rather than replaced by an empty one.
async function fetchPickAndMix(stale) {
  return withDedup(CACHE_KEY, async () => {
    try {
      const res = await trackedFetch('fanatical', 'getPickAndMix', FEED_URL, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`Fanatical feed error ${res.status}`);
      const map = parsePickAndMix(await res.json());
      setCache(CACHE_KEY, map);
      return map;
    } catch (err) {
      // Best-effort: a blocked or broken feed only means "Varies" stays, so back off rather than retry per request.
      console.warn(`[fanatical] ${err.message}`);
      setCache(CACHE_KEY, stale ?? {}, { ttlMs: FAILURE_TTL_MS });
      return stale ?? {};
    }
  });
}

async function getPickAndMix(slugs = []) {
  const hit = getCached(CACHE_KEY);
  if (hit === undefined) return fetchPickAndMix();
  const age = Date.now() - (getCachedAt(CACHE_KEY) ?? 0);
  if (age > REFETCH_FOR_MISSING_MS && slugs.some((s) => !hit[s])) return fetchPickAndMix(hit);
  return hit;
}

// Adds `pickAndMix` tiers to each Fanatical bundle ITAD gives no tier price for; others pass through untouched.
async function withPickAndMix(bundles) {
  const wanted = new Map();
  for (const b of bundles) {
    if (b?.page?.name !== 'Fanatical' || !(b.tiers || []).some((t) => !t.price)) continue;
    const slug = pickAndMixSlug(b.url);
    if (slug) wanted.set(b, slug);
  }
  if (!wanted.size) return bundles;
  const map = await getPickAndMix([...wanted.values()]);
  return bundles.map((b) => (wanted.has(b) && map[wanted.get(b)] ? { ...b, pickAndMix: map[wanted.get(b)] } : b));
}

module.exports = { pickAndMixSlug, parsePickAndMix, getPickAndMix, withPickAndMix };
