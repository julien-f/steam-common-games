'use strict';

const { getCached, setCache } = require('./cache');
const { createDedup } = require('./dedup');

const STEAM_KEY = process.env.STEAM_API_KEY;
const withDedup = createDedup();

const TIMEOUT_MS = 10000;
const signal = () => AbortSignal.timeout(TIMEOUT_MS);

// Limit concurrent requests and enforce a minimum interval between them.
// minIntervalMs delays slot release after each request so throughput stays under the rate limit
// even when many requests are queued (concurrency alone isn't enough — Steam limits by req/s).
// maxQueue is a coarse safety valve, not a normal operating limit — this queue is shared
// process-wide across every caller/client, and a single legitimate large-library first load
// can easily enqueue thousands of jobs on its own (fetchGameDetails fans out per appid, and
// server.js's STREAM_MAX_GAMES/detailsLimit already bound how much any one request/IP can
// enqueue per minute — see server.js). This just stops queue depth from growing without
// bound if those upstream bounds are ever misconfigured, rather than rejecting realistic use.
function createSemaphore(limit, minIntervalMs = 0, maxQueue = Infinity) {
  let active = 0;
  const queue = [];
  function release() {
    active--;
    next();
  }
  function next() {
    if (active < limit && queue.length > 0) {
      active++;
      const { fn, resolve, reject } = queue.shift();
      fn().then(
        val => { resolve(val); minIntervalMs > 0 ? setTimeout(release, minIntervalMs) : release(); },
        err => { reject(err);  minIntervalMs > 0 ? setTimeout(release, minIntervalMs) : release(); }
      );
    }
  }
  return fn => new Promise((resolve, reject) => {
    if (queue.length >= maxQueue) {
      reject(upstreamError('Too many queued upstream requests — try again shortly'));
      return;
    }
    queue.push({ fn, resolve, reject });
    next();
  });
}

function upstreamError(msg) {
  return Object.assign(new Error(msg), { isUpstream: true });
}

// Generous relative to any single request's realistic fan-out (server.js's STREAM_MAX_GAMES
// caps that directly) — this only guards against queue depth growing genuinely unbounded, see
// createSemaphore's comment above.
const SEMAPHORE_MAX_QUEUE = 20000;

// 2 in-flight, 500 ms cooldown per slot → ≈ 4 req/s sustained to Steam's unauthenticated store.
const storeLimit  = createSemaphore(2, 500, SEMAPHORE_MAX_QUEUE);
// Per-game tag lookup (IStoreBrowseService/GetItems) — different host from storeLimit's
// store.steampowered.com, so kept on its own semaphore rather than sharing that one's
// circuit breaker/cooldown, which exists specifically for store.steampowered.com's bot
// detection. Same conservative shape SteamSpy's limiter used to have.
const tagLimit    = createSemaphore(3, 0, SEMAPHORE_MAX_QUEUE);
// ProtonDB had no limiter at all, unlike the two above — a library/comparison load fetching
// details for dozens of games at once fired that many concurrent unthrottled connections at
// protondb.com, which started surfacing as network-level "fetch failed" errors (connection
// resets/DNS contention) rather than HTTP-level 403s. Same conservative cap as tagLimit.
const protonLimit = createSemaphore(3, 0, SEMAPHORE_MAX_QUEUE);

// Circuit breaker: trip after 2 consecutive 403s (rate limit storm), reset on any success.
// A single 403 is ignored to avoid false-positives on per-game blocks (removed/region-locked).
let storeConsecutive403s = 0;
let storeBlockedUntil = 0;
const STORE_BLOCK_MS = 5 * 60 * 1000;

// Fetch a Steam store URL through the semaphore, retrying up to twice on 429.
async function fetchStoreApi(url) {
  if (Date.now() < storeBlockedUntil) throw upstreamError('Steam store: rate limited (circuit open)');
  for (let attempt = 0; attempt <= 2; attempt++) {
    const res = await storeLimit(() => fetch(url, { signal: signal() }));
    if (res.status === 403) {
      if (++storeConsecutive403s >= 2) {
        storeBlockedUntil = Date.now() + STORE_BLOCK_MS;
        storeConsecutive403s = 0;
      }
      throw upstreamError('Steam store: rate limited (403)');
    }
    if (res.status !== 429) { storeConsecutive403s = 0; return res; }
    const retryAfter = Number(res.headers.get('retry-after')) || 0;
    const delay = retryAfter > 0 ? retryAfter * 1000 : Math.min(30000, 2000 * (2 ** attempt));
    await new Promise(r => setTimeout(r, delay));
  }
  throw upstreamError('Steam store: rate limited after retries');
}

async function resolveSteamId(raw) {
  const id = raw.trim();
  if (/^7656119\d{10}$/.test(id)) return id;

  const cacheKey = `resolve:${id}`;
  const hit = getCached(cacheKey);
  if (hit !== undefined) return hit;

  return withDedup(cacheKey, async () => {
    const res = await fetch(
      `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${STEAM_KEY}&vanityurl=${encodeURIComponent(id)}`,
      { signal: signal() }
    );
    if (!res.ok) throw upstreamError(`Steam API error ${res.status}`);
    const { response } = await res.json();
    if (response.success !== 1) throw new Error(`Cannot find Steam account: "${id}"`);
    setCache(cacheKey, response.steamid);
    return response.steamid;
  });
}

async function getOwnedGames(steamId, { force = false } = {}) {
  const cacheKey = `games:${steamId}`;
  const hit = getCached(cacheKey, { force });
  if (hit !== undefined) return hit;

  return withDedup(cacheKey, async () => {
    const res = await fetch(
      `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${STEAM_KEY}&steamid=${steamId}&include_appinfo=1&include_played_free_games=1`,
      { signal: signal() }
    );
    if (!res.ok) throw upstreamError(`Steam API error ${res.status}`);
    const { response } = await res.json();
    if (!response.games) {
      throw new Error(`Cannot access library for ${steamId} — profile may be set to private`);
    }
    setCache(cacheKey, response.games);
    return response.games;
  });
}

async function getWishlist(steamId, { force = false } = {}) {
  const cacheKey = `wishlist:${steamId}`;
  const hit = getCached(cacheKey, { force });
  if (hit !== undefined) return hit;

  return withDedup(cacheKey, async () => {
    const res = await fetch(
      `https://api.steampowered.com/IWishlistService/GetWishlist/v1/?key=${STEAM_KEY}&steamid=${steamId}`,
      { signal: signal() }
    );
    if (!res.ok) throw upstreamError(`Steam API error ${res.status}`);
    const { response } = await res.json();
    // A private wishlist, a private profile, and a genuinely empty wishlist are
    // all indistinguishable — each returns `{"response":{}}` with no `items` key.
    // Treat all three as an empty wishlist rather than throwing.
    const items = response.items || [];
    setCache(cacheKey, items);
    return items;
  });
}

// `forceIds` lets a caller bypass the cache for specific accounts within the batch
// (e.g. the Library Explorer's per-account "↻" refresh) without forcing every other
// account in the same GetPlayerSummaries call to also re-fetch — `force` alone would
// bypass the whole batch.
async function getPlayerSummaries(steamIds, { force = false, forceIds } = {}) {
  const result = new Map();
  const uncached = [];
  for (const id of steamIds) {
    const hit = getCached(`player:${id}`, { force: force || forceIds?.has(id) });
    if (hit) result.set(id, hit);
    else uncached.push(id);
  }

  if (uncached.length > 0) {
    const fetched = await withDedup(`players:${[...uncached].sort().join(',')}`, async () => {
      const res = await fetch(
        `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${STEAM_KEY}&steamids=${uncached.join(',')}`,
        { signal: signal() }
      );
      if (!res.ok) return [];
      const { response } = await res.json();
      return response.players || [];
    });

    for (const player of fetched) {
      setCache(`player:${player.steamid}`, player);
      result.set(player.steamid, player);
    }
  }

  return steamIds.map(id => result.get(id) ?? { steamid: id, personaname: id, profileurl: '' });
}

function computeRating(raw) {
  if (!raw) return null;
  const n = raw.total_reviews;
  const pos = raw.total_positive;
  const p = pos / n;
  const z = 1.96;
  const z2 = z * z;
  // Wilson score lower bound (95% confidence) — same formula as SteamDB
  const score =
    (p + z2 / (2 * n) - z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) /
    (1 + z2 / n);
  return {
    score: Math.round(score * 100),
    desc: raw.review_score_desc,
    positive: pos,
    total: n,
  };
}

async function getGameRating(appid, { force = false } = {}) {
  const cacheKey = `rating:${appid}`;
  const hit = getCached(cacheKey, { force });
  if (hit !== undefined) return computeRating(hit);

  return withDedup(cacheKey, async () => {
    const res = await fetchStoreApi(
      `https://store.steampowered.com/appreviews/${appid}?json=1&language=all&purchase_type=all&num_per_page=0`
    );
    if (!res.ok) throw upstreamError(`Steam reviews error ${res.status}`);
    const { query_summary: s } = await res.json();
    if (!s?.total_reviews) {
      setCache(cacheKey, null);
      return null;
    }
    setCache(cacheKey, s);
    return computeRating(s);
  });
}

function extractAppDetails(raw, appid) {
  if (!raw) return null;
  const {
    name = null, genres = [], categories = [], developers = [], publishers = [],
    short_description = '', release_date = {}, metacritic, screenshots = [], movies = [],
    capsule_imagev5 = null, capsule_image = null, header_image = null, dlc = [],
    fullgame = null, website = null,
  } = raw;
  return {
    name,
    // Steam sometimes lists two distinct category/genre ids that happen to share the exact
    // same human-readable label (e.g. app 3357650 has separate ids 55/56 both labeled
    // "DualShock Controller Support", and 57/58 both "DualSense Controller Support" — likely
    // one id per feature tier, controller-vibration vs. full haptics/adaptive-trigger
    // support, that Steam's own store page just doesn't bother distinguishing by text). We
    // only ever display the label, never the id, so showing the same pill twice is never
    // meaningful — dedupe by description, order-preserving, right here at the source rather
    // than in every place that renders this list (the side panel's tag cloud, the Library
    // Explorer's Categories/Genres columns and their grouping).
    genres:      [...new Set(genres.map(g => g.description))],
    categories:  [...new Set(categories.map(c => c.description))],
    developers,
    publishers,
    description: short_description || null,
    // `coming_soon` only tells us whether the game has shipped yet, not whether Steam gave us
    // a usable date — an unreleased game can still have a concrete announced date (e.g.
    // "Oct 14, 2026"), not just a placeholder ("Coming soon"). Always pass through whatever
    // string Steam gives; public/library.js's `endOfReleasePeriod` handles turning fuzzy forms
    // ("2026", "Fall 2026") into a sortable date and treats genuinely unparseable placeholders
    // as missing.
    releaseDate: release_date?.date || null,
    // Steam's own ground truth for release status, kept alongside the date string rather than
    // re-derived client-side from parsing it — a coarse placeholder like "Coming soon" has no
    // parseable date at all, so the flag is the only reliable signal in that case. Used by
    // public/library.js to color-flag still-unreleased games in the Released column.
    comingSoon:  !!release_date?.coming_soon,
    metacritic:  metacritic?.score != null ? { score: metacritic.score, url: metacritic.url || null } : null,
    capsule:     capsule_imagev5 || capsule_image || `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/capsule_sm_120.jpg`,
    // The side panel's hero banner (public/mediaItems.js) — Steam's own header image for
    // this specific game, rather than only ever guessing the conventional `.../header.jpg`
    // CDN path. The guess (kept as a fallback here, and again client-side for the brief
    // window before this metadata has loaded at all) doesn't exist for every appid — some
    // games only ever had newer asset sizes uploaded — and since the guessed path never
    // changes, a game whose guess 404s stays broken no matter how many times the panel is
    // reopened. `header_image` is real store metadata, so it's always the correct asset.
    banner:      header_image || `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/header.jpg`,
    movies:      movies.slice(0, 5).map(m => ({ id: m.id, thumbnail: m.thumbnail, hls: m.hls_h264 || null })),
    screenshots: screenshots.slice(0, 10).map(s => ({ id: s.id, thumbnail: s.path_thumbnail, full: s.path_full })),
    // Bare list of DLC appids Steam's own appdetails payload already includes for the base
    // game — free (no extra upstream call) since it rides along on the same response
    // fetched for everything else here. Just the ids; resolving each one's name/capsule
    // (public/panel.js's DLC card) is one ordinary getAppDetails call per DLC, through the
    // same GET /api/game-details/:appid every other single-game lookup already uses, and
    // only happens lazily once a panel's DLC card is actually expanded.
    dlc:         Array.isArray(dlc) ? dlc : [],
    // The reverse of `dlc` above — present only on a DLC app's own appdetails response,
    // pointing back at the base game it belongs to ({appid, name}, appid as a string on the
    // wire like everywhere else in this payload). Free, same response, no extra call. Lets
    // the side panel (public/panel.js) show a "Part of <Base Game>" link back up when the
    // currently open game is itself a piece of DLC, using the same in-panel navigation
    // (navigateToGame) the DLC list's own links use, just in the other direction.
    fullgame:    (fullgame && fullgame.appid != null) ? { appid: Number(fullgame.appid), name: fullgame.name || null } : null,
    // Official game website, when the developer/publisher listed one — a plain field on the
    // same response, absent for plenty of (esp. smaller) games.
    website:     website || null,
  };
}

async function getAppDetails(appid, { force = false } = {}) {
  const cacheKey = `meta:${appid}`;
  const hit = getCached(cacheKey, { force });
  if (hit !== undefined) return extractAppDetails(hit, appid);

  return withDedup(cacheKey, async () => {
    const res = await fetchStoreApi(
      `https://store.steampowered.com/api/appdetails?appids=${appid}&l=english`
    );
    if (!res.ok) throw upstreamError(`Steam Store API error ${res.status}`);
    const json = await res.json();
    const entry = json?.[String(appid)];
    if (!entry?.success || !entry.data) {
      setCache(cacheKey, null);
      return null;
    }
    setCache(cacheKey, entry.data);
    return extractAppDetails(entry.data, appid);
  });
}

// Trims to the fields the frontend's lookup dropdown actually renders (name + thumbnail),
// capped well below what the endpoint returns since only a short dropdown list is shown.
function extractSearchResults(raw) {
  if (!raw || !Array.isArray(raw.items)) return [];
  return raw.items.slice(0, 8).map(item => ({
    appid: item.id,
    name: item.name,
    tinyImage: item.tiny_image || null,
  }));
}

// Name → appid lookup for games not necessarily owned or wishlisted by anyone — backs the
// "look up any game" search box on both pages. Wraps the same undocumented storefront search
// Steam's own store search box uses (no auth, no key) — same trust tier as the HLTB/wishlist
// endpoints elsewhere in this file; see the compliance note in CLAUDE.md.
async function searchStoreGames(term, { force = false } = {}) {
  const cacheKey = `search:${term.toLowerCase()}`;
  const hit = getCached(cacheKey, { force });
  if (hit !== undefined) return hit;

  return withDedup(cacheKey, async () => {
    const res = await fetchStoreApi(
      `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=english&cc=US`
    );
    if (!res.ok) throw upstreamError(`Steam store search error ${res.status}`);
    const results = extractSearchResults(await res.json());
    setCache(cacheKey, results);
    return results;
  });
}

// Steam's own user tags — the same ones shown on the store page, SteamDB, and
// IsThereAnyDeal — rather than SteamSpy's separate, crowd-voted dataset (which this used to
// pull from). SteamSpy's tag votes are cast on steamspy.com itself and can be sparse or
// entirely empty for a game Steam itself has plenty of tag data for, especially anything
// niche or recent enough that SteamSpy's own community hasn't caught up on it.
//
// Two undocumented-but-official, key-less endpoints (same trust tier as the other
// undocumented endpoints covered by CLAUDE.md's compliance note) stand in for it:
//
// - `IStoreBrowseService/GetItems` (api.steampowered.com) returns a whole per-app "store
//   browse item" — `tagids` (already ordered by relevance weight descending, same order the
//   store page displays them in), plus other fields riding along on the exact same response
//   for free, e.g. `related_items.demo_appid` (see getGameDemo below). One call per game.
//   The raw item is cached whole (`browse:{appid}`) rather than just the extracted tagids,
//   same "cache raw, extract at read time" approach used everywhere else in this file — so
//   adding another field this call already returns (like the demo link) never needs a new
//   upstream request, just a new extractor over the same cached response.
// - `ajaxgetstoretags` (store.steampowered.com) maps every tagid to its human-readable
//   name — a single, near-static ~430-entry list, not per-game, so it's fetched once and
//   cached long-term (`tagnames:all`, in the same 60-day meta TTL group as `browse:`) rather
//   than repeated for every game.
const TAG_NAMES_CACHE_KEY = 'tagnames:all';

async function getTagNameMap() {
  const hit = getCached(TAG_NAMES_CACHE_KEY);
  if (hit !== undefined) return hit;

  return withDedup(TAG_NAMES_CACHE_KEY, async () => {
    const res = await fetchStoreApi('https://store.steampowered.com/actions/ajaxgetstoretags?l=english');
    if (!res.ok) throw upstreamError(`Steam store tags error ${res.status}`);
    // Observed live: a 200 OK with a literal JSON `null` body (rather than the usual
    // `{tags: [...]}` shape) during what looked like an upstream hiccup — destructuring
    // straight off the parsed body would throw an opaque TypeError ("Cannot destructure
    // property 'tags' of ... as it is null") instead of a clear, caller-recognizable
    // upstream error. Treated the same as a fetch-level failure: not cached, so the next
    // call retries rather than being stuck with an empty map.
    const body = await res.json();
    if (!body || typeof body !== 'object') throw upstreamError('Steam store tags error: unexpected response body');
    const { tags } = body;
    const map = Object.fromEntries((tags || []).map(t => [t.tagid, t.name]));
    setCache(TAG_NAMES_CACHE_KEY, map);
    return map;
  });
}

async function fetchStoreBrowseItem(appid) {
  const inputJson = encodeURIComponent(JSON.stringify({
    ids: [{ appid: Number(appid) }],
    context: { language: 'english', country_code: 'US' },
    data_request: { include_tag_count: 30 },
  }));
  const res = await tagLimit(() =>
    fetch(`https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=${inputJson}`, { signal: signal() })
  );
  if (!res.ok) throw upstreamError(`Steam store browse error ${res.status}`);
  const data = await res.json();
  const item = data?.response?.store_items?.[0];
  return item?.success === 1 ? item : null;
}

// Deliberately a new key prefix (`browse:`), not a reuse of the old SteamSpy-era `tags:` key
// (or even the short-lived `tagids:` key that replaced it): those stored a `{tagname:
// voteCount}` object and a bare `tagid[]` respectively, and a game with zero SteamSpy votes
// cached a bare `[]` that was indistinguishable, by shape alone, from a legitimate empty
// result under either later format. A fresh key sidesteps that whole class of ambiguity
// again — old entries under either previous key are simply never read and age out on their
// own after the existing 60-day meta TTL.
async function getStoreBrowseItem(appid, { force = false } = {}) {
  const cacheKey = `browse:${appid}`;
  const hit = getCached(cacheKey, { force });
  if (hit !== undefined) return hit;

  return withDedup(cacheKey, async () => {
    const item = await fetchStoreBrowseItem(appid);
    setCache(cacheKey, item);
    return item;
  });
}

function extractTagIds(item) {
  return Array.isArray(item?.tagids) ? item.tagids : [];
}

async function getSteamTags(appid, { force = false } = {}) {
  const [item, nameMap] = await Promise.all([
    getStoreBrowseItem(appid, { force }),
    getTagNameMap(),
  ]);

  return extractTagIds(item).map(id => nameMap[id]).filter(Boolean);
}

// The appid of this game's free demo, if it has one — `related_items.demo_appid` on the
// same store browse item fetched above for tags, so this never costs an extra upstream call
// beyond whatever getSteamTags/getStoreBrowseItem already made (or will make) for this appid;
// it's just a different extractor over the same cached response. Only the first listed demo
// is used — Steam allows more than one in principle (e.g. a demo per edition) but that's rare
// and the side panel only ever has room for one link.
function extractDemoAppid(item) {
  const demoAppid = item?.related_items?.demo_appid?.[0];
  return Number.isInteger(demoAppid) ? demoAppid : null;
}

async function getGameDemo(appid, { force = false } = {}) {
  const item = await getStoreBrowseItem(appid, { force });
  return extractDemoAppid(item);
}

// Linux/Steam Deck compatibility tier, from the community-run ProtonDB. Wraps its
// undocumented summary endpoint — same trust tier as the HLTB/wishlist endpoints
// elsewhere in this file (see CLAUDE.md's compliance note): no auth/key, low-volume,
// liable to change without notice. A 404 means "no reports for this appid yet",
// which is cached as null the same way an empty Steam review count is.
// "pending" isn't a compatibility outcome — it means ProtonDB has too few reports to
// confidently assign one — so it carries the same actionable information as no rating at
// all. Treated as null here rather than passed through, so neither client (the side panel's
// badge, the Library Explorer's column/sort order) has to special-case a tier that doesn't
// belong on the quality spectrum the other tiers represent. Raw upstream data is still what
// gets cached (see getProtonDbStatus below) — this is purely a display-transform decision,
// so it can change again later without needing to bust anything cached under the old rule.
function extractProtonDb(raw) {
  if (!raw || raw.tier === 'pending') return null;
  return { tier: raw.tier, confidence: raw.confidence, total: raw.total };
}

async function getProtonDbStatus(appid, { force = false } = {}) {
  const cacheKey = `protondb:${appid}`;
  const hit = getCached(cacheKey, { force });
  if (hit !== undefined) return extractProtonDb(hit);

  return withDedup(cacheKey, async () => {
    const res = await protonLimit(() => fetch(
      `https://www.protondb.com/api/v1/reports/summaries/${appid}.json`,
      { signal: signal() }
    ));
    if (res.status === 404) {
      setCache(cacheKey, null);
      return null;
    }
    if (!res.ok) {
      // 403 here has been observed as a blanket bot-block rather than a per-appid failure
      // (this fetch sends no headers, unlike HLTB's spoofed UA/Referer — see CLAUDE.md) — a
      // body snippet distinguishes "app-specific error" from "same block page for every appid".
      const bodySnippet = await Promise.resolve().then(() => res.text()).catch(() => '');
      throw upstreamError(`ProtonDB error ${res.status} for appid ${appid}${bodySnippet ? `: ${bodySnippet.slice(0, 200)}` : ''}`);
    }
    const raw = await res.json();
    setCache(cacheKey, raw);
    return extractProtonDb(raw);
  });
}

// Achievement schema (names, descriptions, icons) for a game — store metadata, not player
// progress, so it lives in the same 60-day `cache_meta` TTL group as rating/HLTB/tags/
// ProtonDB (see the 'schema:' prefix in lib/cache.js). Most games have no achievements at
// all, and Steam represents that as a 200 response with no `achievements` key rather than
// an error — that's cached as an empty array, same non-error treatment as an empty wishlist.
async function getGameSchema(appid, { force = false } = {}) {
  const cacheKey = `schema:${appid}`;
  const hit = getCached(cacheKey, { force });
  if (hit !== undefined) return hit;

  return withDedup(cacheKey, async () => {
    const res = await fetch(
      `https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/?key=${STEAM_KEY}&appid=${appid}&l=english`,
      { signal: signal() }
    );
    if (!res.ok) throw upstreamError(`Steam schema error ${res.status}`);
    const { game } = await res.json();
    const list = game?.availableGameStats?.achievements || [];
    const achievements = list.map(a => ({
      apiname: a.name,
      name: a.displayName,
      description: a.description || null,
      icon: a.icon,
      icongray: a.icongray,
      hidden: !!a.hidden,
    }));
    setCache(cacheKey, achievements);
    return achievements;
  });
}

// One player's unlock state for one game's achievements — player progress, not store
// metadata, so unlike getGameSchema above this lives in the default (6-hour, `cache_library`)
// TTL group: it changes as someone plays, same reasoning as owned-games/player-summary/
// wishlist data. Steam signals both "this game has no stats at all" (most games) and "this
// profile is private" as a non-2xx status (400 and 403 respectively) rather than a 200 with
// an empty body — both are common, expected outcomes rather than failures, so — same as
// getWishlist's private-vs-empty ambiguity — they're cached as null instead of thrown.
async function getPlayerAchievements(steamId, appid, { force = false } = {}) {
  const cacheKey = `playerach:${steamId}:${appid}`;
  const hit = getCached(cacheKey, { force });
  if (hit !== undefined) return hit;

  return withDedup(cacheKey, async () => {
    const res = await fetch(
      `https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/?key=${STEAM_KEY}&steamid=${steamId}&appid=${appid}&l=english`,
      { signal: signal() }
    );
    if (res.status === 400 || res.status === 403) {
      setCache(cacheKey, null);
      return null;
    }
    if (!res.ok) throw upstreamError(`Steam player achievements error ${res.status}`);
    const { playerstats } = await res.json();
    if (!playerstats?.success || !playerstats.achievements) {
      setCache(cacheKey, null);
      return null;
    }
    const achievements = playerstats.achievements.map(a => ({
      apiname: a.apiname,
      achieved: !!a.achieved,
      unlocktime: a.unlocktime || 0,
    }));
    setCache(cacheKey, achievements);
    return achievements;
  });
}

// Community-wide unlock percentage per achievement (e.g. "only 4.2% of players have this")
// — the same rarity stat Steam's own profile pages show next to each achievement. Public
// endpoint, no key needed. It's aggregate community data rather than per-account progress
// (unlike getPlayerAchievements above) but changes about as slowly as the schema does, so it
// shares the same 60-day `cache_meta` TTL group (see the 'achrarity:' prefix in
// lib/cache.js). A game with no achievements/stats — or an unrecognized appid — gets a 403
// with an empty body rather than a 200 with an empty list; both are cached as null the same
// non-error way getPlayerAchievements treats "no stats for this game".
async function getGlobalAchievementPercentages(appid, { force = false } = {}) {
  const cacheKey = `achrarity:${appid}`;
  const hit = getCached(cacheKey, { force });
  if (hit !== undefined) return hit;

  return withDedup(cacheKey, async () => {
    const res = await fetch(
      `https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=${appid}`,
      { signal: signal() }
    );
    // 403 is what's actually observed for both "this game has no achievements" and "this
    // appid doesn't exist" — same non-error treatment as getPlayerAchievements' 400/403.
    // Anything else (5xx, rate limiting) is a real upstream failure, not cached as null.
    if (res.status === 403) {
      setCache(cacheKey, null);
      return null;
    }
    if (!res.ok) throw upstreamError(`Steam global achievement percentages error ${res.status}`);
    const { achievementpercentages } = await res.json();
    const list = achievementpercentages?.achievements || [];
    // Steam returns `percent` as a numeric string (e.g. "80.9"), not a number.
    const percentages = Object.fromEntries(list.map(a => [a.name, Number(a.percent)]));
    setCache(cacheKey, percentages);
    return percentages;
  });
}

// Recent news/announcements for a game — patch notes, event posts, community announcements.
// `ISteamNews/GetNewsForApp` is a documented, public, key-less endpoint (unlike the
// undocumented ones covered by CLAUDE.md's compliance note) — no auth needed, safe to call
// at the same volume as the rest of fetchGameDetails. `maxlength=1` asks Steam to truncate
// `contents` to almost nothing since the side panel only ever shows title/date/link, never
// the body — no point paying for or caching text nobody reads.
//
// `feeds=steam_community_announcements` restricts the response server-side to the developer/
// publisher's own posts — same content and language as the game's own Steam store page.
// Without it, the endpoint also aggregates syndicated third-party press (feedname varies per
// outlet, e.g. "Gamemag.ru", "Rock, Paper, Shotgun") in whatever language that outlet
// publishes in, mixed in with zero regard for the requester's locale; for some games that
// press coverage outnumbers official posts by 10:1 or more, which used to mean fetching many
// raw items client-side just to find a handful of official ones tucked in between (or missing
// them entirely on a small enough `count`). `feeds` finds every official post regardless of
// how much unrelated press surrounds it, so a modest `count` is enough again. This is an
// undocumented param (not listed on Steamworks' public GetNewsForApp page, same trust tier as
// the other undocumented endpoints covered by CLAUDE.md's compliance note) but does exactly
// what it says — verified directly against the live API. The `feedname` filter below is kept
// as a belt-and-suspenders check on top of it rather than removed — cheap insurance against
// this undocumented param being dropped or behaving inconsistently for some app, in which case
// this still keeps only official posts, just without `feeds`' efficiency benefit.
function extractNews(raw) {
  const items = raw?.newsitems || [];
  // Capped at 20 to match `count=20` on the request below — once `feeds` has already
  // restricted the raw response to official posts, keeping every one of them the fetch
  // could possibly return costs nothing extra upstream. The panel itself shows all of
  // these (see newsHtml, public/panel.js) since the section collapses by default; the
  // cap here just stops the list growing unbounded for an unusually prolific developer.
  return items
    .filter(n => n.feedname === 'steam_community_announcements')
    .slice(0, 20)
    .map(n => ({
      title: n.title,
      url: n.url,
      date: n.date, // unix seconds
      feedLabel: n.feedlabel || null,
    }));
}

async function getGameNews(appid, { force = false } = {}) {
  const cacheKey = `news:${appid}`;
  const hit = getCached(cacheKey, { force });
  if (hit !== undefined) return hit;

  return withDedup(cacheKey, async () => {
    const res = await fetch(
      `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${appid}&count=20&maxlength=1&format=json&feeds=steam_community_announcements`,
      { signal: signal() }
    );
    if (!res.ok) throw upstreamError(`Steam news error ${res.status}`);
    const { appnews } = await res.json();
    const news = extractNews(appnews);
    setCache(cacheKey, news);
    return news;
  });
}

module.exports = { resolveSteamId, getOwnedGames, getWishlist, getPlayerSummaries, getGameRating, getAppDetails, getSteamTags, getGameDemo, searchStoreGames, getProtonDbStatus, getGameSchema, getPlayerAchievements, getGlobalAchievementPercentages, getGameNews };
