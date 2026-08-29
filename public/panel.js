'use strict';

import { esc, formatMoney, scoreColor, dealRecordTier, DEAL_RECORD_TIERS, fmtH, fmtLastPlayed, computeSteamdbRating } from './utils.js';
import { openLightbox, closeLightbox, isLightboxOpen } from './lightbox.js';
import { buildMediaItems } from './mediaItems.js';

// ── Shared game side panel ──────────────────────────────────────────────────
// Used by both the comparison page (app.js) and the Library Explorer
// (library.js). An ES module, importing from utils.js, lightbox.js, and
// mediaItems.js.
//
// Host pages call initPanel(options) once, then panelOpen(game)/panelClose()
// to show/hide it. Anything page-specific — the "Owned by" section, tag-click
// filtering, the nav bar's list of games — is left to the host page via
// options or by wrapping panelOpen/panelClose with its own extra logic.
// `options.onClose` specifically exists because panelClose() itself is called from more
// places than just the host's own code (the backdrop click, × button, and swipe-to-close
// all call it directly) — a host that needs to run cleanup on every close (not just the
// ones it explicitly triggers) should do it there rather than in a wrapper around
// panelClose(), which those other paths would silently bypass.
// pickRandomFrom() below is a generic "shuffle bag" usable by both pages.

let panelOptions = {};
let panelGame = null;
let heroIdx = 0;
let panelPrevFocus = null;
let panelRefreshing = false; // true while the host's onRefresh() is in flight
let moreLinksOpen = false; // whether the header's "⋯" overflow menu (News/Workshop/Website) is open

// Stack of {appid, name} for games navigated away from via a DLC link or "Part of <Base
// Game>" link click (see navigateToGame/panelGoBack below) — NOT touched by an ordinary
// panel open (a table row click, a search-box pick, prev/next/random) since those aren't
// part of any such browsing trail; panelOpen() below clears it unless told to keep it
// (`keepHistory: true`), which only navigateToGame/panelGoBack ever pass through the host's
// onNavigateGame callback.
// Holds plain {appid, name} pairs rather than full game objects — going back re-opens via
// the same host mechanism (panelOptions.onNavigateGame) a fresh lookup would use, same
// dedup-with-already-loaded-rows behavior included, rather than panel.js caching its own
// stale copy of a game's details.
let panelHistory = [];

function panelShuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Rejects anything but a plain http(s) URL — same guard accountsBar.js/app.js already apply
// to profile URLs. esc() alone escapes HTML special chars but does nothing about the scheme,
// so a developer-supplied `meta.website` or a news item's `url` (both flow through unfiltered
// from Steam's own APIs — see lib/steam.js) could otherwise be a `javascript:`/`data:` URI
// that runs script when clicked instead of navigating away. Returns '' for anything unsafe.
function safeHref(url) {
  return /^https?:\/\//i.test(url || '') ? url : '';
}

const randomQueues = new Map(); // queueKey → remaining shuffled games

// Picks the next game from a shuffle bag scoped to queueKey (e.g. a group key,
// or a fixed constant for a page with only one list) so repeated picks cycle
// through every item before repeating. The bag is rebuilt when exhausted or
// when `list` no longer matches what's left in it (e.g. after filtering).
export function pickRandomFrom(list, queueKey, currentAppid) {
  if (!list.length) return null;
  let queue = randomQueues.get(queueKey) || [];
  const ids = new Set(list.map(g => g.appid));
  const queueValid = queue.length > 0 && queue.every(g => ids.has(g.appid));
  if (!queueValid) {
    const remaining = panelShuffle(list).filter(g => g.appid !== currentAppid);
    queue = remaining.length ? remaining : panelShuffle(list);
  }
  const pick = queue.shift();
  randomQueues.set(queueKey, queue);
  return pick;
}

export function clearRandomQueue(queueKey) {
  randomQueues.delete(queueKey);
}

export function clearAllRandomQueues() {
  randomQueues.clear();
}

export function initPanel(options = {}) {
  panelOptions = options;

  document.getElementById('panel-backdrop').addEventListener('click', panelClose);
  document.getElementById('panel-close').addEventListener('click', panelClose);

  // Delegated on #panel-body (a stable element that only has its innerHTML replaced)
  // rather than bound directly to #panel-hero — the hero now lives inside #panel-body's
  // generated markup (see renderPanelBody) and is recreated from scratch on every
  // render, so a listener attached straight to the old hero node would go stale/detached
  // the moment the panel re-renders (including at init time, before the first
  // panelOpen() has rendered anything at all).
  const panelBodyEl = document.getElementById('panel-body');
  panelBodyEl.addEventListener('click', e => {
    if (!e.target.closest('.panel-hero')) return;
    const thumb = e.target.closest('.panel-film-item');
    if (thumb) { heroIdx = Number(thumb.dataset.idx); renderPanelHero(); return; }
    if (e.target.closest('.panel-hero-prev')) { panelStepHero(-1); return; }
    if (e.target.closest('.panel-hero-next')) { panelStepHero(1); return; }
    if (e.target.closest('.panel-hero-img')) openLightbox(panelGame, heroIdx);
  });
  panelBodyEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.closest('.panel-hero-img')) { e.preventDefault(); openLightbox(panelGame, heroIdx); }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('.panel-achievement--spoiler')) {
      e.preventDefault();
      const el = e.target.closest('.panel-achievement--spoiler');
      revealAchievement(Number(el.dataset.appid), el.dataset.apiname);
    }
  });
  panelBodyEl.addEventListener('wheel', e => {
    const strip = e.target.closest('.panel-filmstrip');
    if (!strip) return;
    e.preventDefault();
    strip.scrollLeft += e.deltaY || e.deltaX;
  }, { passive: false });

  document.getElementById('game-panel').addEventListener('click', e => {
    if (e.target.closest('.panel-refresh-btn')) { handlePanelRefresh(); return; }
    if (e.target.closest('.panel-back-btn')) { panelGoBack(); return; }
    const toggleBtn = e.target.closest('.panel-collapsible-chip');
    if (toggleBtn) { toggleSection(Number(toggleBtn.dataset.appid), toggleBtn.dataset.section); return; }
    const hiddenAch = e.target.closest('.panel-achievement--spoiler');
    if (hiddenAch) { revealAchievement(Number(hiddenAch.dataset.appid), hiddenAch.dataset.apiname); return; }
    const filterBtn = e.target.closest('.panel-achievements-filter-btn');
    if (filterBtn) { setAchievementsFilter(Number(filterBtn.dataset.appid), filterBtn.dataset.filter); return; }
    const copyLinkBtn = e.target.closest('.panel-copy-link-btn');
    if (copyLinkBtn) { copyPanelLink(copyLinkBtn); return; }
    const moreLinksBtn = e.target.closest('.panel-icon-more-btn');
    if (moreLinksBtn) { toggleMoreLinks(); return; }
    const navBtn = e.target.closest('.panel-subnav-btn');
    if (navBtn) { jumpToPanelSection(navBtn.dataset.target); return; }
    // A real <a href> (see dlcHtml/baseGameHtml) so ctrl/cmd/shift-click and middle-click
    // still open it in a new tab/window the normal browser way — only a plain click is
    // intercepted to navigate within the panel itself instead of leaving the page. Shared by
    // both a DLC entry and the "Part of <Base Game>" link (the same relationship, just
    // walked in opposite directions), so both carry the same data-appid/data-name pair.
    const gameLink = e.target.closest('.panel-dlc-item, .panel-basegame-link');
    if (gameLink) {
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      navigateToGame(Number(gameLink.dataset.appid), gameLink.dataset.name);
      return;
    }
    const btn = e.target.closest('.panel-tag-btn');
    if (!btn || !panelOptions.onTagClick) return;
    panelOptions.onTagClick(btn.dataset.dim, btn.dataset.val);
  });

  // Dismiss the "⋯ More links" menu on outside click, same convention as gameSearch.js's
  // own dropdown. Bound to document (not #game-panel) since the header rebuilds on every
  // renderPanelBody, same reasoning as every other delegated listener above — but this one
  // specifically needs to catch clicks *outside* the panel too (backdrop, page behind it).
  document.addEventListener('click', e => {
    if (moreLinksOpen && !e.target.closest('.panel-icon-more')) { moreLinksOpen = false; if (panelGame) renderPanelBody(panelGame); }
  });

  initPanelSwipe();
  initHeroSwipe();
  initSubnavScrollSpy();
}

function toggleMoreLinks() {
  moreLinksOpen = !moreLinksOpen;
  if (panelGame) renderPanelBody(panelGame);
}

// Highlights whichever subnav button corresponds to the section currently scrolled to the
// top of the visible body, instead of the subnav being a static row of jump-links with no
// sense of "where am I". Bound once to #panel-body (stable across re-renders, same
// reasoning as the other delegated listeners in initPanel above) rather than to the subnav
// itself, which is rebuilt from scratch on every renderPanelBody call.
function initSubnavScrollSpy() {
  document.getElementById('panel-body').addEventListener('scroll', () => {
    requestAnimationFrame(updateSubnavScrollSpy);
  }, { passive: true });
}

// Buttons are walked in DOM order, which renderPanelBody keeps identical to the physical
// top-to-bottom order of the sections themselves (Owners right after the tag cloud,
// then HLTB/News/Achievements — see subnavItems above) — so the *last* button whose
// section has scrolled up to (or past) the sticky header counts as "current", same idea as
// a scrollspy TOC. None qualifying means we're still above the first section, i.e. still
// looking at the Overview (glance grid/description) itself.
function updateSubnavScrollSpy() {
  const nav = document.querySelector('.panel-subnav');
  if (!nav) return;
  const body = document.getElementById('panel-body');
  const headerH = document.querySelector('.panel-header-sticky')?.getBoundingClientRect().height ?? 0;
  const threshold = body.getBoundingClientRect().top + headerH + 8;
  const buttons = [...nav.querySelectorAll('.panel-subnav-btn')];
  let activeTarget = 'top';
  for (const btn of buttons) {
    const target = btn.dataset.target;
    if (target === 'top') continue;
    const el = document.getElementById(target);
    if (!el || el.getBoundingClientRect().top > threshold) continue;
    activeTarget = target;
  }
  buttons.forEach(btn => btn.classList.toggle('active', btn.dataset.target === activeTarget));
}

export function isPanelOpen() { return panelGame != null; }
export function getPanelGame() { return panelGame; }

// Shared Escape-key handling: close the lightbox first (unless the browser's own Escape is
// about to exit fullscreen instead — bail and leave the lightbox open, same as the lightbox's
// own fullscreen behavior expects), else close the panel. Exposed as a function rather than a
// document-level listener panel.js binds itself, since a host page's own Escape handling may
// need to check something else first with higher priority (app.js's/library.js's keyboard-
// shortcuts help modal) — a host calls this only once nothing more specific has already
// claimed the keypress. Previously each of app.js/library.js/bundles.js hand-rolled this exact
// same lightbox-then-panel logic; bundles.js's copy had drifted and silently dropped the
// lightbox-close branch entirely (Escape did nothing while its lightbox was open) — pulled out
// here so there's one copy to keep correct instead of three that can quietly disagree.
export function panelHandleEscape() {
  if (isLightboxOpen()) {
    if (document.fullscreenElement || document.webkitFullscreenElement) return; // browser exits FS; keep lightbox open
    closeLightbox();
    return;
  }
  panelClose();
}

// Forces a fresh rating/HLTB/store-metadata/tags fetch for the open game, bypassing
// its cache TTL. The actual fetch + state update is host-specific (app.js updates its
// `games` array and table row; library.js updates its data-table row) — panelOptions.onRefresh
// does that and panel.js only owns the button's disabled/spinning state and re-render.
async function handlePanelRefresh() {
  if (!panelGame || panelRefreshing || !panelOptions.onRefresh) return;
  const game = panelGame;
  panelRefreshing = true;
  renderPanelBody(game);
  try {
    // DLC is only force-refetched if it was ever actually loaded (i.e. the card was expanded
    // at some point this session) — no reason to kick off a fetch for a card nobody's opened
    // just because the refresh button was clicked.
    await Promise.all([
      panelOptions.onRefresh(game),
      loadNews(game, { force: true }),
      loadPrice(game, { force: true }), // no-op (see loadPrice) if this game is priced by the host instead
      game.dlc !== undefined ? loadDlc(game, { force: true }) : null,
    ]);
  } finally {
    panelRefreshing = false;
    if (panelGame === game) renderPanelBody(game); // no-op if the panel moved on mid-fetch
  }
}

// The 🔗 button beside Store/ITAD in the header — copies a link back to this exact game.
// Deliberately just `?game=<appid>` on the current page's own path, not the full current
// URL (which may carry `u=`/filters/sort/tab/view from whatever search led here) — someone
// sharing "check out this game" almost always means the game itself, not "reproduce my
// exact search too", and each host page's own `?game=` handling (see restorePanelFromUrl in
// app.js, the standalone-lookup fallback in library.js) already knows how to open just that.
function copyPanelLink(btn) {
  if (!panelGame || !navigator.clipboard?.writeText) return;
  const url = `${location.origin}${location.pathname}?game=${panelGame.appid}`;
  navigator.clipboard.writeText(url).then(() => flashCopyLinkBtn(btn), () => {});
}

function flashCopyLinkBtn(btn) {
  const prevTitle = btn.title;
  btn.textContent = '✓';
  btn.title = 'Copied!';
  btn.classList.add('panel-copy-link-btn--copied');
  setTimeout(() => {
    btn.textContent = '🔗';
    btn.title = prevTitle;
    btn.classList.remove('panel-copy-link-btn--copied');
  }, 1500);
}

// Whether this game's price is someone else's job to fetch. `panelOptions.pricesHandledByHost`
// is either a plain boolean (bundles.js: every row is always batch-priced by loadPrices) or a
// function of the game (library.js: only the Wishlist tab's own loadWishlistPrices batches
// prices — its Library tab rows are owned games with no price columns/batch of their own, same
// as the comparison page). Checked purely at fetch-decision time, not by racing against
// whether that host's own batch call has actually resolved yet — a host that says it handles
// pricing is trusted to do so on its own schedule, so loadPrice below never fires for it
// regardless of timing, which is what keeps this from ever duplicating that host's own batched
// /api/prices call (see CLAUDE.md's "one page-level control, not per-game" reasoning for why
// that matters). Pages that never set the option at all (app.js) always fall through to
// loadPrice — nothing else there ever prices a row.
function pricesHandledByHost(game) {
  const opt = panelOptions.pricesHandledByHost;
  return typeof opt === 'function' ? !!opt(game) : !!opt;
}

// Lazily resolved once per session (like library.js's/bundles.js's own itadConfiguredPromise)
// rather than per-call — a plain GET /api/health, cheap to over-share across every game this
// fetches a price for.
let panelItadConfiguredPromise = null;
function isItadConfigured() {
  if (!panelItadConfiguredPromise) {
    panelItadConfiguredPromise = fetch('/api/health').then(r => r.json()).then(d => !!d.itadConfigured).catch(() => false);
  }
  return panelItadConfiguredPromise;
}

// Prices a single game via the shared POST /api/prices route (appids: [appid], same route
// bundles.js/library.js batch through) — only for a game nothing else already prices (see
// pricesHandledByHost above). Mirrors loadNews's shape: fetched once per game per session
// (`game.priceLoading` guards a fast reopen from firing a second concurrent request for the
// same game), and a stale resolve for a game the panel has since moved on from just updates
// the (now background) game object without forcing a re-render.
//
// discountPct's formula is duplicated here as a two-line inline calc rather than imported from
// public/gameColumns.js (even though both are ES modules now) — gameColumns.js pulls in
// @vates/data-table-core, meaningless for a plain side panel, same reasoning as the rest of
// this card's own small copy of gameColumns.js/bundles.js render logic (see priceHtml's own
// comment below).
async function loadPrice(game, { force = false } = {}) {
  if (pricesHandledByHost(game)) return;
  if (game.bestDealPrice !== undefined && !force) return; // already loaded (or already tried) this session
  if (game.priceLoading) return; // already in flight
  game.priceLoading = true;
  try {
    if (!(await isItadConfigured())) { game.bestDealPrice = null; return; }
    const country = resolveRegion(getStoredRegion());
    const qs = new URLSearchParams({ country });
    if (force) qs.set('refresh', '1');
    const res = await fetch(`/api/prices?${qs}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appids: [game.appid] }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Price lookup failed');
    const info = data.prices[game.appid];
    game.steamRegular  = info?.steamRegular?.amount ?? null;
    game.bestDealPrice = info?.bestDeal?.price?.amount ?? null;
    game.bestDealShop  = info?.bestDeal?.shop          ?? null;
    game.bestDealUrl   = info?.bestDeal?.url           ?? null;
    game.bestDealCut   = (game.steamRegular > 0 && game.bestDealPrice != null)
      ? Math.round((1 - game.bestDealPrice / game.steamRegular) * 100) : null;
    game.lowAll        = info?.lowAll?.amount          ?? null;
    game.lowY1         = info?.lowY1?.amount           ?? null;
    game.lowM3         = info?.lowM3?.amount           ?? null;
    game.priceCurrency = info?.steamRegular?.currency ?? info?.bestDeal?.price?.currency ?? info?.lowAll?.currency ?? info?.lowY1?.currency ?? info?.lowM3?.currency ?? null;
  } catch {
    game.bestDealPrice = game.bestDealPrice ?? null; // leave the card on "no data" rather than stuck "…" forever
  } finally {
    game.priceLoading = false;
    if (panelGame === game) renderPanelBody(game); // no-op if the panel moved on mid-fetch
  }
}

// News is deliberately NOT part of the host pages' rating/HLTB/meta/tags fetch (see
// server.js's newsLimit comment for why) — it's kept entirely off `game.details` (which
// app.js/library.js freely reassign wholesale whenever fresh rating/HLTB/etc. lands) and
// fetched here instead, once per game, lazily, the same on-demand shape achievements
// already use. `game.news`/`game.newsLoading` persist on the game/row object itself, so a
// game already opened once in this session doesn't refetch on a later reopen.
async function loadNews(game, { force = false } = {}) {
  if (game.news !== undefined && !force) return; // already loaded this session
  game.newsLoading = true;
  game.newsError = false;
  try {
    const res = await fetch(`/api/game-news/${game.appid}${force ? '?refresh=1' : ''}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'News lookup failed');
    game.news = data.news;
  } catch {
    game.newsError = true;
    // Keep whatever was last successfully loaded rather than wiping it on a failed forced
    // refresh; null only the first time (nothing to fall back to). newsHtml below shows an
    // explicit "couldn't load" message instead of silently hiding the section whenever
    // there's no fallback data to show in its place.
    game.news = game.news ?? null;
  } finally {
    game.newsLoading = false;
    if (panelGame === game) renderPanelBody(game); // no-op if the panel moved on mid-fetch
  }
}

// DLC list — like news/achievements, kept off `game.details` and fetched lazily by
// panel.js itself, but unlike those two it's not even fetched on panelOpen: the DLC card's
// collapsed header only needs `game.details.meta.dlc`'s bare appid *count* (already present
// for free, see extractAppDetails in lib/steam.js), so the name/capsule-resolving fetch
// itself is deferred until the card is actually expanded (see toggleSection below).
// `game.dlc`/`game.dlcLoading` persist on the game object, so re-expanding later in the same
// session doesn't refetch.
//
// Each DLC appid is resolved through the exact same `GET /api/game-details/:appid` every
// other single-game lookup already goes through (`fetchStandaloneDetails`, the "look up any
// game" search box, prev/next/random) — not a bespoke batch endpoint. A DLC appid isn't
// fundamentally different from any other appid the app looks up, so it shouldn't need its
// own rate-limit policy or its own cap on how many get resolved at once: it's subject to the
// same `detailsLimit` per-minute budget as any other burst of game lookups (e.g. rapidly
// opening many panels), and the same cache/dedup/circuit-breaker underneath. A DLC entry
// that fails to resolve (delisted, or simply rate-limited this time) is just dropped from
// the list rather than surfaced as an error — the rest is still worth showing. Only `meta`
// is used for display here, but resolving the full response (rating/HLTB/tags/ProtonDB too)
// is a feature, not waste: it warms that DLC's own cache, so clicking into its panel next
// (see navigateToGame) opens instantly instead of re-fetching everything from scratch.
//
// A base game can have dozens of DLC entries (e.g. Stellaris), each its own network
// round-trip subject to the same rate limiter as everything else — waiting for every single
// one to settle before showing anything (the original `Promise.allSettled` shape) meant the
// card sat on its loading skeleton for however long the *slowest* entry took, even though
// most had already resolved. `game.dlcPartial` holds the in-progress array (one slot per
// `dlcIds` index, filled in as each fetch resolves) so `dlcHtml` can render what's already
// available immediately and stream the rest in, rather than an all-or-nothing reveal.
// `game.dlc` itself is still only assigned once every entry has settled — every other spot
// that reads it (the refresh gate above, `toggleSection`'s expand-fetch, the "already loaded"
// early-return below) keeps treating "loaded" as "fully loaded", unchanged.
async function loadDlc(game, { force = false } = {}) {
  if (game.dlc !== undefined && !force) return; // already loaded (or already failed) this session
  const dlcIds = game.details?.meta?.dlc || [];
  if (!dlcIds.length) { game.dlc = []; return; }
  game.dlcLoading = true;
  // Seed partial slots from the previous complete list (keyed by appid) so a force-refresh
  // keeps showing the old entries in place while each is re-fetched, instead of the list
  // shrinking back down to empty and refilling.
  const prevById = new Map((game.dlc || []).map(d => [d.appid, d]));
  const partial = dlcIds.map(id => prevById.get(id));
  game.dlcPartial = partial;
  if (panelGame === game) renderPanelBody(game);
  try {
    await Promise.all(dlcIds.map(async (id, i) => {
      try {
        const res = await fetch(`/api/game-details/${id}${force ? '?refresh=1' : ''}`);
        const data = await res.json();
        partial[i] = (res.ok && data.meta)
          ? { appid: id, name: data.meta.name, capsule: data.meta.capsule, releaseDate: data.meta.releaseDate, comingSoon: data.meta.comingSoon }
          : undefined; // delisted, or just failed/rate-limited this time
      } catch {
        partial[i] = undefined;
      }
      if (panelGame === game) renderPanelBody(game); // stream this entry in as soon as it resolves
    }));
    game.dlc = partial.filter(Boolean);
  } catch {
    game.dlc = game.dlc ?? null; // leave the card's body empty rather than surfacing an error for a non-essential feature
  } finally {
    game.dlcLoading = false;
    game.dlcPartial = undefined;
    if (panelGame === game) renderPanelBody(game); // no-op if the panel moved on mid-fetch
  }
}

// Clicking a DLC entry in the expanded card (see dlcHtml), or the "Part of <Base Game>" link
// (see baseGameHtml) — same relationship walked in opposite directions, so both push the
// game being left onto panelHistory, then hand off to the host's own "open this appid"
// mechanism (the same one backing the "look up any game" search box), just told to keep the
// history stack instead of starting a fresh one. `name` is the target's already-known name
// (from the just-fetched DLC list, or from `fullgame` on the current game's own metadata),
// passed through purely to avoid a title flash while the host's own fetch is in flight, same
// convention as gameSearch.js's onSelect.
function navigateToGame(appid, name) {
  if (!panelGame || !panelOptions.onNavigateGame) return;
  // If the target is whatever's already sitting on top of the stack, this is a
  // there-and-back-again hop (e.g. base game → DLC → the same base game's own "Part of"
  // link) reached via a forward link rather than the explicit ← Back button — collapse it
  // by popping instead of pushing, so bouncing between a base game and its DLC entries
  // doesn't grow a stack of duplicate consecutive appids.
  if (panelHistory.length && panelHistory[panelHistory.length - 1].appid === appid) {
    panelHistory.pop();
  } else {
    panelHistory.push({ appid: panelGame.appid, name: panelGame.name });
  }
  panelOptions.onNavigateGame(appid, name);
}

// The header's "← Back" button (see renderPanelBody) — pops the trail and reopens whatever
// was on top the same way navigateToGame opens a DLC/base-game link, just in the other
// direction. Popping before calling onNavigateGame (rather than after) means the callback
// only ever needs to know "keep whatever's left in the stack", identical in both directions.
function panelGoBack() {
  if (!panelHistory.length || !panelOptions.onNavigateGame) return;
  const prev = panelHistory.pop();
  panelOptions.onNavigateGame(prev.appid, prev.name);
}

// dir: -1 (previous) or 1 (next). wrap: true for keyboard arrow navigation
// (cycles through all media), false for the hero prev/next buttons (clamps
// at the ends — the next button is disabled once heroIdx is at the last item).
export function panelStepHero(dir, { wrap = false } = {}) {
  if (!panelGame) return false;
  const items = getPanelItems();
  if (wrap) {
    if (items.length <= 1) return false;
    heroIdx = (heroIdx + dir + items.length) % items.length;
  } else {
    heroIdx = Math.max(0, heroIdx + dir);
  }
  renderPanelHero();
  if (wrap) document.getElementById('panel-hero').querySelector('.panel-hero-img')?.focus();
  return true;
}

// `keepHistory`: true only when this open is a DLC/base-game navigation hop (forward via
// navigateToGame, or backward via panelGoBack) — every other opener (table row, search pick,
// prev/next/random) leaves it false, which starts a fresh browsing trail.
export function panelOpen(game, { keepHistory = false } = {}) {
  if (!keepHistory) panelHistory = [];
  panelGame = game;
  heroIdx = 0;
  moreLinksOpen = false;
  panelPrevFocus = document.activeElement;
  document.getElementById('panel-body').scrollTop = 0;
  loadNews(game); // no-op (see loadNews) if this game's news was already fetched this session
  loadPrice(game); // no-op (see loadPrice) if this game is priced by the host, or already loaded
  renderPanelBody(game);
  document.getElementById('game-panel').classList.add('open');
  document.getElementById('panel-backdrop').classList.add('open');
  if (panelOptions.inertSelector) {
    const el = document.querySelector(panelOptions.inertSelector);
    if (el) el.inert = true;
  }
  (document.getElementById('panel-hero').querySelector('.panel-hero-img') ?? document.getElementById('panel-close')).focus();
}

// `preserveUrl`: threaded through to `onClose` unchanged — for a host that clears
// `?game=`/`&shot=` there, this lets a caller that's about to reopen the same game right
// after (e.g. a forced-refresh reload) close the panel's DOM state without losing the
// deep link it'll restore from once the reload completes. Not used by the backdrop
// click/× button/swipe paths below, which always want the default (URL cleared).
export function panelClose({ preserveUrl = false } = {}) {
  if (!panelGame) return;
  panelGame = null;
  panelHistory = []; // closing the panel ends whatever DLC browsing trail was in progress
  document.getElementById('game-panel').classList.remove('open');
  document.getElementById('panel-backdrop').classList.remove('open');
  if (panelOptions.inertSelector) {
    const el = document.querySelector(panelOptions.inertSelector);
    if (el) el.inert = false;
  }
  document.getElementById('panel-nav')?.replaceChildren();
  panelPrevFocus?.focus();
  panelPrevFocus = null;
  // Every close path funnels through here — the backdrop click and × button are bound
  // straight to this function (see initPanel below), and swipe-to-close calls it directly
  // too — so this is the one place host-specific close cleanup (clearing `?game=`/`&shot=`
  // from the URL, resetting the host's own "active game" state) can hook in without every
  // host having to remember to wrap all of those paths itself.
  panelOptions.onClose?.({ preserveUrl });
}

// Scrolls #panel-body so `target` (a section id, or the literal 'top') sits just below the
// sticky title/subnav header, rather than under it. Computed via getBoundingClientRect()
// deltas (viewport-relative, so it's correct regardless of #panel-body's own positioning
// context) rather than offsetTop, which is relative to the nearest *positioned* ancestor —
// here that's #game-panel (position: fixed), not #panel-body itself, so offsetTop would
// include the hero/hero-filmstrip height above the header and land short.
function jumpToPanelSection(target) {
  const body = document.getElementById('panel-body');
  if (target === 'top') { body.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  const el = document.getElementById(target);
  if (!el) return;
  const headerH = document.querySelector('.panel-header-sticky')?.getBoundingClientRect().height ?? 0;
  const delta = el.getBoundingClientRect().top - body.getBoundingClientRect().top - headerH - 8;
  body.scrollTo({ top: body.scrollTop + delta, behavior: 'smooth' });
}

function getPanelItems() {
  return buildMediaItems(panelGame.appid, panelGame.details?.meta);
}

function buildPanelHero() {
  if (!panelGame) return;
  const hero = document.getElementById('panel-hero');
  const items = getPanelItems();
  heroIdx = Math.max(0, Math.min(heroIdx, items.length - 1));
  const hasMany = items.length > 1;

  hero.innerHTML = `
    ${renderHeroMain(items)}
    ${hasMany ? `
      <div class="panel-filmstrip">${items.map((item, i) => {
        // Screenshots have a separate full-res `main` behind the small `thumb` — if the
        // thumbnail variant 404s (a stale/broken CDN asset upstream), retrying with the
        // full-res image gives the filmstrip a second shot before giving up. Videos have
        // no such fallback (there's no full-res still behind the poster), so a broken
        // video thumb goes straight to the broken-image state below.
        const fallback = item.type === 'image' && item.main !== item.thumb ? item.main : '';
        return `<button type="button" class="panel-film-item${i === heroIdx ? ' active' : ''}${item.type === 'video' ? ' is-video' : ''}" data-idx="${i}" aria-label="${i === 0 ? esc(panelGame.name) : (item.type === 'video' ? `Video ${i}` : `Screenshot ${i}`)}">` +
        `<img class="panel-film-thumb" src="${esc(item.thumb)}" data-fallback="${esc(fallback)}" alt="" loading="lazy">` +
        `</button>`;
      }).join('')}</div>
    ` : ''}`;

  setupHeroImg(hero);
  // `error` doesn't bubble, so this needs the capture phase; delegated (rather than one
  // listener per <img>) since the whole filmstrip is rebuilt fresh here each time.
  hero.querySelector('.panel-filmstrip')?.addEventListener('error', (e) => {
    const img = e.target;
    if (!img.classList?.contains('panel-film-thumb')) return;
    const fallback = img.dataset.fallback;
    if (fallback && img.src !== fallback) { img.src = fallback; return; }
    img.classList.add('panel-film-thumb--broken');
  }, true);
  hero.querySelector('.panel-film-item.active')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
}

function renderPanelHero(scrollActive = true) {
  if (!panelGame) return;
  const hero = document.getElementById('panel-hero');
  const items = getPanelItems();
  heroIdx = Math.max(0, Math.min(heroIdx, items.length - 1));

  const main = hero.querySelector('.panel-hero-main');
  if (!main) { buildPanelHero(); return; }

  main.outerHTML = renderHeroMain(items);
  setupHeroImg(hero);

  hero.querySelectorAll('.panel-film-item').forEach((el, i) =>
    el.classList.toggle('active', i === heroIdx)
  );

  if (scrollActive) hero.querySelector('.panel-film-item.active')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
}

function renderHeroMain(items) {
  const current = items[heroIdx];
  const isShot = heroIdx > 0;
  const hasMany = items.length > 1;
  return `<div class="panel-hero-main${current.type === 'video' ? ' is-video' : ''}">` +
    `<img class="panel-hero-img${isShot ? ' panel-hero-img--shot' : ''}" tabindex="0" role="button" aria-label="Open in lightbox" src="${esc(current.type === 'video' ? current.thumb : current.main)}" alt="${esc(panelGame.name)}">` +
    (hasMany
      ? `<button class="panel-hero-btn panel-hero-prev"${heroIdx <= 0 ? ' disabled' : ''} aria-label="Previous">&#8249;</button>` +
        `<button class="panel-hero-btn panel-hero-next"${heroIdx >= items.length - 1 ? ' disabled' : ''} aria-label="Next">&#8250;</button>`
      : '') +
    `</div>`;
}

function setupHeroImg(hero) {
  const heroEl = hero.querySelector('.panel-hero-img');
  heroEl.classList.remove('panel-hero-img--broken');
  heroEl.classList.add('loading');
  heroEl.onload  = () => heroEl.classList.remove('loading');
  // A broken image (banner guess 404ing, or — as with a video's poster — a genuinely dead
  // upstream Steam CDN asset) used to hide the whole `.panel-hero-main`, which also wiped
  // out the prev/next nav and, for videos, the play-button overlay and click target —
  // even though the video itself (or the full-res screenshot behind a broken thumb) still
  // plays/loads fine. Just mark the image broken and leave the rest of the hero working.
  heroEl.onerror = () => { heroEl.classList.remove('loading'); heroEl.classList.add('panel-hero-img--broken'); };
}

// ProtonDB's community-reported Linux/Steam Deck compatibility tiers, worst to best.
// Colors are our own (not scraped from protondb.com), just distinct + dark enough for
// white badge text: red (unplayable) through gold/platinum (flawless) plus a green
// "native" tier for games with an actual Linux port (no Proton layer needed at all).
// Tier names themselves come straight from ProtonDB's API (see lib/steam.js) and are
// already human-readable words — capitalized for display, not remapped through a label
// table, so a new tier ProtonDB introduces still renders (just without a custom color).
// No "pending" entry — extractProtonDb (lib/steam.js) already collapses that tier to null
// server-side, since "too few reports to rate yet" isn't a compatibility outcome worth a
// badge of its own; `pd` is simply absent for those games, same as one with no data at all.
const PROTON_TIER_COLORS = {
  borked: '#b91c1c', bronze: '#8b4513', silver: '#757575', gold: '#b8860b',
  platinum: '#5b6b85', native: '#15803d',
};
const capitalize = s => s.charAt(0).toUpperCase() + s.slice(1);

// Compact review-count suffix for the reviews line, e.g. 465234 -> "465k", 2100000 -> "2.1m".
function fmtCompactCount(n) {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1_000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

// Tags/genres/categories/developer-publisher used to each get their own "uppercase
// title + pill row" section — four near-identical blocks in a row. Merged into one
// cloud instead, kind distinguished by a small colored dot (+ a legend) rather than
// by which section a pill happens to sit in. `kind` picks the dot color/legend label;
// `dim` (may be null when tag-click filtering is disabled) is the actual click-filter
// dimension, kept separate from `kind` since developers/publishers share one visual
// kind but are two different filter dimensions.
const TAG_KIND_META = {
  tags: { label: 'Tag', color: '#d97757' },
  genres: { label: 'Genre', color: '#66c0f4' },
  categories: { label: 'Category', color: '#66c04f' },
  devpub: { label: 'Developer/Publisher', color: '#b892d6' },
};

function tagCloud(groups) {
  const present = groups.filter(gr => gr.items?.length);
  if (!present.length) return '';
  const seenKinds = new Set();
  const pillsHtml = present.flatMap(({ kind, dim, items }) => {
    const values = kind === 'tags' ? [...items] : [...items].sort((a, b) => a.localeCompare(b));
    seenKinds.add(kind);
    const dot = `<span class="panel-tag-dot" style="background:${TAG_KIND_META[kind].color}"></span>`;
    return values.map(v => {
      if (dim) {
        const active = panelOptions.isTagActive?.(dim, v) ? ' active' : '';
        return `<button class="panel-tag panel-tag-btn${active}" data-dim="${dim}" data-val="${esc(v)}">${dot}${esc(v)}</button>`;
      }
      return `<span class="panel-tag">${dot}${esc(v)}</span>`;
    });
  }).join('');
  const legendHtml = [...seenKinds].map(k =>
    `<span class="panel-tag-legend-item"><span class="panel-tag-dot" style="background:${TAG_KIND_META[k].color}"></span>${TAG_KIND_META[k].label}</span>`
  ).join('');
  return `<div class="panel-section panel-section--meta panel-card">
    <div class="panel-section-title">Tags &amp; details</div>
    <div class="panel-tags">${pillsHtml}</div>
    <div class="panel-tag-legend">${legendHtml}</div>
  </div>`;
}

// The glance strip: a fixed 2×2 grid (Weighted Rating+Metacritic, then HLTB+Linux/Deck) —
// every chip built from one template (a value, then a one-line caption) so the four
// read as one family. Each chip IS the link to its source; there's no separate
// "Links" section duplicating them. Only *evaluative* values (the two scores, the
// Linux/Deck tier) get semantic color — HLTB is a plain duration, not a judgment,
// so it stays neutral ink.
function glanceChip(href, value, color, caption) {
  const inner = `<span class="panel-glance-sub">
    <span class="panel-glance-num"${color ? ` style="color:${color}"` : ''}>${esc(String(value))}</span>
    <span class="panel-glance-val">${caption}</span>
  </span>`;
  return href
    ? `<a class="panel-glance-chip" href="${esc(href)}" target="_blank" rel="noopener">${inner}</a>`
    : `<div class="panel-glance-chip panel-glance-chip--static">${inner}</div>`;
}

function glanceGrid(g) {
  if (g.loading) {
    return `<div class="panel-glance">${
      '<div class="panel-glance-chip panel-glance-chip--sk"><span class="sk" style="width:100%;height:32px;border-radius:6px"></span></div>'.repeat(4)
    }</div>`;
  }
  const r = g.details?.rating;
  const mc = g.details?.meta?.metacritic;
  const h = g.details?.hltb;
  const pd = g.details?.protondb;
  const reviewsUrl = `https://store.steampowered.com/app/${g.appid}/#app_reviews_hash`;
  const protondbUrl = `https://www.protondb.com/app/${g.appid}`;

  if (!g.details) return '';

  // Every chip stays in the grid even when its source has no data for this game —
  // a missing weighted rating or ProtonDB tier is itself informative, and a chip that
  // vanishes instead makes the 2×2 grid reflow into a lopsided 3-chip layout. Each
  // still links out where a useful destination exists, same as the HLTB search fallback.
  // The link points at the game's Steam reviews (the actual source of the underlying
  // data) rather than SteamDB, since the number/caption is this app's own weighted
  // rating, not SteamDB's.
  const chips = [];
  if (r) {
    const pct = r.total ? Math.round(r.positive / r.total * 100) : 0;
    const steamdbRating = Math.round(computeSteamdbRating(r.positive, r.total));
    chips.push(glanceChip(reviewsUrl, steamdbRating, scoreColor(steamdbRating), `<b>Weighted</b> · ${pct}% of ${fmtCompactCount(r.total)}`));
  } else {
    chips.push(glanceChip(reviewsUrl, '—', null, `<b>Weighted</b> · no rating`));
  }
  if (mc) {
    chips.push(glanceChip(mc.url, mc.score, scoreColor(mc.score), `<b>Metacritic</b> · critic score`));
  } else {
    chips.push(glanceChip(null, '—', null, `<b>Metacritic</b> · no score`));
  }
  if (h?.id) {
    // A matched HLTB entry can still have no submitted completion times (all: null,
    // e.g. a very new/obscure game) — that's a real page with no data, not a failed
    // search, so it still links straight to the page rather than a generic search.
    const hltbUrl = `https://howlongtobeat.com/game/${h.id}`;
    chips.push(h.all
      ? glanceChip(hltbUrl, `${h.all}h`, null, `<b>HLTB</b> · all playstyles`)
      : glanceChip(hltbUrl, '—', null, `<b>HLTB</b> · no data`));
  } else {
    chips.push(glanceChip(`https://howlongtobeat.com/?q=${encodeURIComponent(g.name)}`, '—', null, `<b>HLTB</b> · search`));
  }
  if (pd?.tier) {
    const color = PROTON_TIER_COLORS[pd.tier] || '#52525b';
    // Kept short (no "reports"/"confidence" words) — the glance chip's one-line caption
    // truncates rather than wraps, and "strong · 336" already reads fine without them.
    const detail = [pd.confidence, pd.total ? fmtCompactCount(pd.total) : ''].filter(Boolean).join(' · ');
    chips.push(glanceChip(protondbUrl, capitalize(pd.tier), color, `<b>Linux/Deck</b>${detail ? ' · ' + detail : ''}`));
  } else {
    chips.push(glanceChip(protondbUrl, '—', null, `<b>Linux/Deck</b> · no reports`));
  }
  return `<div class="panel-glance">${chips.join('')}</div>`;
}

// Which collapsible sections (HLTB breakdown, news, achievements — anything built with
// collapsibleCard() below) are expanded, keyed `${appid}:${section}` so each game/section
// pair remembers its own choice independently, and which individual hidden achievements
// have been click-revealed (keyed `${appid}:${apiname}`). Re-opening a game later in the
// same session remembers prior choices; never cleared (a handful of strings per game
// touched is negligible, and a page reload resets it anyway). Module-level like
// heroIdx/randomQueues above — this is UI state, not game data.
const expandedSections = new Set();
const revealedAchievements = new Set();
// Which achievement list filter ('all' | 'unlocked' | 'locked') each game is currently
// showing — same per-appid, never-cleared-this-session shape as expandedSections above.
// Defaults to 'all' (map lookup miss) for any appid never touched.
const achievementsFilter = new Map();

function isSectionExpanded(appid, section) { return expandedSections.has(`${appid}:${section}`); }

function toggleSection(appid, section) {
  const key = `${appid}:${section}`;
  const wasExpanded = expandedSections.has(key);
  if (wasExpanded) expandedSections.delete(key);
  else expandedSections.add(key);
  if (panelGame) renderPanelBody(panelGame);
  // DLC is the one collapsible card whose contents aren't already loaded by the time it's
  // rendered (news/achievements are fetched as soon as the panel opens, whether or not
  // their card ever gets expanded) — see loadDlc's own comment for why. Kick the fetch off
  // only on the first actual expand, and only for the game the chip belongs to (a stale
  // click on a chip from a re-render that's already moved on shouldn't fetch for the wrong
  // game — matching `panelGame`, not just any appid, guards that).
  if (!wasExpanded && section === 'dlc' && panelGame?.appid === appid) loadDlc(panelGame);
}

// Shared "one card, expand-in-place" shape used by HLTB breakdown, news, and achievements:
// a full-width chip (glance-grid numeral + caption, same template as glanceChip) as the
// header/toggle, an optional icon-link out to the source, and a divided list below once
// expanded. Kept as one function so the three sections read as one visual family instead
// of three near-identical hand-rolled blocks that drift apart over time.
// `numHtml` is optional — HLTB's breakdown has no single number that isn't either
// misleading (an arbitrary pick among Main/Extra/Completionist) or a plain repeat of the
// glance strip's own "All PlayStyles" figure, so it renders as a plain text-only teaser
// instead of forcing a numeral into a slot where one doesn't actually fit. `icon` fills
// that same leading slot instead, for a card with no numHtml at all (HLTB, News) — without
// it, those two rows read as plain text next to achievements' bold colored percentage,
// losing the "one visual family" look this whole shape is meant to have.
function collapsibleCard({ appid, section, numHtml, numColor, icon, valHtml, bodyHtml, linkHref, linkTitle }) {
  const expanded = isSectionExpanded(appid, section);
  const numSpan = numHtml != null
    ? `<span class="panel-glance-num"${numColor ? ` style="color:${numColor}"` : ''}>${numHtml}</span>`
    : icon ? `<span class="panel-achievements-icon">${icon}</span>` : '';
  return `<div class="panel-achievements-card">
    <div class="panel-achievements-card-header">
      <button type="button" class="panel-achievements-chip panel-collapsible-chip" data-appid="${appid}" data-section="${section}" aria-expanded="${expanded}">
        ${numSpan}
        <span class="panel-glance-val">${valHtml}</span>
        <span class="panel-achievements-chevron">${expanded ? '▾' : '▸'}</span>
      </button>
      ${linkHref ? `<a class="panel-icon-link" href="${esc(linkHref)}" target="_blank" rel="noopener" title="${esc(linkTitle)}" aria-label="${esc(linkTitle)}">↗</a>` : ''}
    </div>
    ${expanded ? `<div class="panel-achievements-list">${bodyHtml}</div>` : ''}
  </div>`;
}

// Steam's own percent strings already carry a decimal (e.g. "80.9"), but round numbers
// parse to a plain integer (100 from "100.0") — toFixed(1) on those would print "100.0%",
// so only force the decimal when the value isn't already a whole number.
function fmtRarity(pct) {
  return `${Number.isInteger(pct) ? pct : pct.toFixed(1)}%`;
}

function revealAchievement(appid, apiname) {
  revealedAchievements.add(`${appid}:${apiname}`);
  if (panelGame) renderPanelBody(panelGame);
}

function setAchievementsFilter(appid, filter) {
  achievementsFilter.set(appid, filter);
  if (panelGame) renderPanelBody(panelGame);
}

// Achievements section — opt-in via panelOptions.showAchievements (only the Library
// Explorer sets it; the comparison page's groups have no single well-defined "player" to
// fetch progress for). `g.achievements` is loaded and attached by the host page itself
// (library.js), asynchronously and separately from the rating/HLTB/tags SSE stream, since
// the achievement *list* only depends on the appid but progress depends on which account(s)
// are currently loaded — `g` carries `achievementsLoading` while that fetch is in flight,
// then either `achievements` (the server's `{ achievements, total, unlocked, private,
// playerCount, steamUrl }` shape) or nothing at all (fetch never ran/failed). The list itself
// is still fetched and shown with zero accounts loaded (`playerCount: 0`, no `steamUrl`) —
// only the achieved/unlocktime/progress-summary parts need an account, gated by `hasProgress`
// below.
function achievementsHtml(g) {
  if (!panelOptions.showAchievements) return '';
  if (g.achievementsLoading) {
    return `<div class="panel-section" id="panel-section-achievements">
      <div class="panel-section-title">Achievements</div>
      <div class="panel-achievements"><span class="sk" style="width:100%;height:48px;border-radius:6px"></span></div>
    </div>`;
  }
  const data = g.achievements;
  // `undefined` means the fetch hasn't been attempted (or finished) yet — nothing to show
  // and no failure to report either, so stay silent same as before. `null` (see library.js's
  // loadAchievements) means it was attempted and failed — that's worth a visible message
  // rather than silently looking identical to a game with no achievements at all.
  if (data === undefined) return '';
  if (data === null) {
    return `<div class="panel-section" id="panel-section-achievements">
      <div class="panel-section-title">Achievements</div>
      <div class="panel-no-data">Couldn't load achievements.</div>
    </div>`;
  }
  if (!data.total) {
    return `<div class="panel-section" id="panel-section-achievements">
      <div class="panel-section-title">Achievements</div>
      <div class="panel-no-data">This game has no achievements.</div>
    </div>`;
  }
  // With no player loaded (data.playerCount === 0 — a standalone "look up any game" lookup,
  // see loadAchievements in library.js), `data.unlocked` is always 0 by construction, not a
  // real "nobody's unlocked anything" result — the list itself (names/descriptions/icons/
  // rarity) is still real store metadata worth showing, just without any progress claim on
  // top of it. `hasProgress` gates every place that would otherwise imply real unlock data.
  const hasProgress = data.playerCount > 0;
  const pct = hasProgress ? Math.round((data.unlocked / data.total) * 100) : null;

  // Sorted once per fetch and cached on the data object itself (a fresh object every
  // fetch/refresh, so this never goes stale) rather than re-sorting the full list on every
  // render — any unrelated toggle elsewhere in the panel re-renders the whole body, and a
  // game with a few hundred achievements shouldn't pay for a full re-sort every time.
  const sorted = data._sortedAchievements ??= data.achievements
    .slice()
    .sort((a, b) => Number(b.achieved) - Number(a.achieved));
  // 'unlocked'/'locked' only make sense with real progress loaded — filtering by achieved
  // status when nobody's loaded would just be "everything" vs. "nothing" either way.
  const filter = hasProgress ? (achievementsFilter.get(g.appid) || 'all') : 'all';
  const visible = filter === 'all' ? sorted : sorted.filter(a => (filter === 'unlocked') === !!a.achieved);
  const filterRowHtml = hasProgress ? `<div class="panel-achievements-filter">
    ${['all', 'unlocked', 'locked'].map(f => `<button type="button" class="panel-achievements-filter-btn${filter === f ? ' active' : ''}" data-appid="${g.appid}" data-filter="${f}">${f === 'all' ? 'All' : f === 'unlocked' ? 'Unlocked' : 'Locked'}</button>`).join('')}
  </div>` : '';

  // Rows, not individual cards — one divider between rows instead of a border around each,
  // so the list reads as one thing inside the card rather than boxes stacked inside a box.
  const bodyHtml = `
    ${filterRowHtml}
    ${!hasProgress ? `<div class="panel-no-data">Load a player above to see who's unlocked what.</div>`
      : data.private ? `<div class="panel-no-data">Progress unavailable — profile may be private.</div>` : ''}
    ${!visible.length ? `<div class="panel-no-data">No achievements match this filter.</div>` : ''}
    ${visible
      .map(a => {
        // A hidden achievement not yet unlocked keeps its name/description a surprise by
        // default, same as Steam's own profile pages — the schema still carries the real
        // text either way (whether it's still a spoiler depends on which account(s) are
        // loaded, not on the shared/cached schema), this just withholds it client-side
        // until clicked, rather than never sending it at all.
        const revealed = revealedAchievements.has(`${g.appid}:${a.apiname}`);
        const spoiler = a.hidden && !a.achieved && !revealed;
        const name = spoiler ? 'Hidden achievement' : (a.name || a.apiname);
        const desc = spoiler ? 'Click to reveal' : (a.description || '');
        const icon = a.achieved ? a.icon : (a.icongray || a.icon);
        // Unlock date is real data the server already returns (`unlocktime`, seconds since
        // epoch) but otherwise has nowhere to show — surfaced as a plain hover tooltip
        // rather than a fifth line of on-card text. fmtLastPlayed (utils.js) is the same
        // plain-date formatter the Last Played column uses.
        const title = a.achieved && a.unlocktime ? `Unlocked ${fmtLastPlayed(a.unlocktime)}` : '';
        // Rarity isn't a spoiler — it's shown even for a still-hidden achievement, same as
        // Steam's own profile pages (knowing "2% of players have this" doesn't give away
        // what it actually is). Fixed to 1 decimal only when it's not a whole number, so
        // "80.9%" and "100%" both read naturally instead of "100.0%".
        const rarityLabel = a.globalPct == null ? null : fmtRarity(a.globalPct);
        const rarityHtml = rarityLabel == null ? '' : `<div class="panel-achievement-rarity" title="${esc(rarityLabel)} of players have unlocked this">${esc(rarityLabel)}</div>`;
        return `<div class="panel-achievement-row${a.achieved ? ' unlocked' : ''}${spoiler ? ' panel-achievement--spoiler' : ''}"${title ? ` title="${esc(title)}"` : ''}${spoiler ? ` data-appid="${g.appid}" data-apiname="${esc(a.apiname)}" role="button" tabindex="0"` : ''}>
          <img class="panel-achievement-icon" src="${esc(icon)}" alt="" loading="lazy">
          <div class="panel-achievement-text">
            <div class="panel-achievement-name">${esc(name)}</div>
            ${desc ? `<div class="panel-achievement-desc">${esc(desc)}</div>` : ''}
          </div>
          ${rarityHtml}
        </div>`;
      }).join('')}`;

  return `<div class="panel-section" id="panel-section-achievements">${collapsibleCard({
    appid: g.appid,
    section: 'achievements',
    numHtml: hasProgress ? `${pct}%` : '—',
    numColor: hasProgress ? scoreColor(pct) : null,
    valHtml: `<b>Achievements</b> · ${hasProgress ? `${data.unlocked} / ${data.total} unlocked` : `${data.total} total`}`,
    bodyHtml,
    linkHref: data.steamUrl,
    linkTitle: 'View achievements on Steam',
  })}</div>`;
}

// Recent news/announcements (patch notes, event posts) — a handful of headlines, each
// linking straight to the full post, plus a link to the game's full news hub on the Steam
// store for anything older than what's shown here. Dates use the same plain-ISO convention
// as fmtLastPlayed/the table's date columns rather than a relative "3 days ago" string.
function newsHtml(g) {
  if (g.newsLoading) {
    return `<div class="panel-section" id="panel-section-news">
      <div class="panel-section-title">News</div>
      <span class="sk" style="display:block;width:100%;height:48px;border-radius:6px"></span>
    </div>`;
  }
  const items = g.news;
  // `newsError` with nothing to fall back on (no prior successful load) is worth a visible
  // message rather than silently looking identical to a game with no news at all — same
  // reasoning as achievements' explicit "couldn't load" state above. A failed *refresh* that
  // still has stale data from an earlier successful load (see loadNews) just shows that
  // stale list below instead, since it's still real, if no-longer-fresh, data.
  if (g.newsError && !items) {
    return `<div class="panel-section" id="panel-section-news">
      <div class="panel-section-title">News</div>
      <div class="panel-no-data">Couldn't load news.</div>
    </div>`;
  }
  if (!items || !items.length) return '';
  // Used to truncate further to 3 client-side on top of extractNews' own 5-item cap
  // (lib/steam.js), back when this section always rendered inline and a longer list ate
  // into the panel's visible height for every game that had one. Now that it's collapsed
  // by default (see collapsibleCard above), that constraint is gone — showing everything
  // the server already fetched costs nothing until someone actually expands the card.
  const bodyHtml = `<div class="panel-collapsible-body-pad">
    <div class="panel-news">
      ${items.map(n => `
        <a class="panel-news-item" href="${esc(safeHref(n.url))}" target="_blank" rel="noopener">
          <span class="panel-news-title">${esc(n.title)}</span>
          <span class="panel-news-meta">${esc(fmtLastPlayed(n.date))}${n.feedLabel ? ` · ${esc(n.feedLabel)}` : ''}</span>
        </a>`).join('')}
    </div>
  </div>`;
  return `<div class="panel-section" id="panel-section-news">${collapsibleCard({
    appid: g.appid,
    section: 'news',
    icon: '📰',
    // No numeral here (same reasoning as HLTB's chip, see collapsibleCard's numHtml
    // comment) — the latest post's date used to sit here, but each headline already shows
    // its own date once expanded, so repeating just the newest one in the collapsed header
    // added a number without adding new information over what a click away reveals.
    //
    // Spelling out "more on Steam" here (not just relying on the ↗ icon's title tooltip)
    // makes it explicit that this list is a preview, not the full history — the fetch
    // itself is capped at 5 posts (extractNews, lib/steam.js), so there's essentially
    // always more on the actual Steam news hub even once every fetched item is shown.
    valHtml: `<b>News</b> · more on Steam`,
    bodyHtml,
    linkHref: `https://store.steampowered.com/news/app/${g.appid}`,
    linkTitle: 'View all news on Steam',
  })}</div>`;
}

// Price info — a single always-open card (no chip grid, no collapsible secondary numbers):
// the current best deal (same display/color/badge/tooltip as the Best Deal table cell in
// bundles.js/library.js), its discount off Steam Full Price when there is one, a direct link
// to the shop itself, and a link to the game's ITAD page for the fuller picture (historical
// lows, every other shop) this card deliberately leaves out.
//
// The numbers themselves come from one of two places, so every game gets a price rather than
// only the ones a host page already happens to batch-price:
//   - library.js's Wishlist tab (loadWishlistPrices) and bundles.js's game table (loadPrices)
//     both set these exact field names (bestDealPrice/bestDealCut/bestDealShop/bestDealUrl/
//     lowAll/lowY1/lowM3/priceCurrency) directly on the row object as part of their own
//     page-level batch call, well before it's ever opened here — panel.js's own loadPrice
//     (see its own comment above) never fires for these (pricesHandledByHost), so there's
//     only ever one price fetch per game, not two racing each other.
//   - Everything else (the comparison page's owned-games rows, library.js's own Library tab,
//     and any standalone gameSearch.js lookup on any page) gets priced by loadPrice itself,
//     fired once from panelOpen — a lazy single-game fetch through the same shared
//     POST /api/prices route, the same on-demand shape news/achievements already use.
// Either way this card just reads whatever's currently on `g` — same "if present, render"
// idiom used throughout this file for rating/HLTB/tags off g.details — so it doesn't need to
// know which of the two populated it. `g.bestDealPrice === undefined` still means "no data
// yet" (loading, or genuinely not fetched); `null` means "fetched, and there's nothing to
// show" (ITAD not configured, no listing, or a failed lookup).
//
// Both host mutation sites (loadWishlistPrices/loadPrices) and loadPrice itself re-render an
// already-open panel right after mutating a row (the same
// `if (isPanelOpen() && getPanelGame() === row) renderPanelBody(row)` idiom
// streamGameDetails/loadAchievements already use elsewhere) — without that, a panel opened
// before its price fetch resolved would never pick the numbers up once they landed.
//
// formatMoney itself is the global from public/utils.js, not a local copy — see its own
// comment there for why it (unlike the rest of the price-column logic, which lives in
// public/gameColumns.js, an ES module panel.js can't import from) lives in the one shared
// plain-script file every page already loads before panel.js.

function priceHtml(g) {
  // `priceLoading` only ever gets set by panel.js's own loadPrice (see its own comment above)
  // — a host page's own batch call sets bestDealPrice directly, with no intermediate loading
  // flag on the row, same as rating/HLTB/tags off g.details elsewhere in this file.
  if (g.priceLoading) {
    return `<div class="panel-section panel-card" id="panel-section-price">
      <div class="panel-section-title">Price</div>
      <span class="sk" style="display:block;width:100%;height:32px;border-radius:6px"></span>
    </div>`;
  }
  if (g.bestDealPrice === undefined) return ''; // never priced (or not loaded yet) — see comment above

  const itadUrl = `https://isthereanydeal.com/steam/app/${g.appid}`;
  const titleHtml = `<div class="panel-section-title">Price <a href="${esc(itadUrl)}" target="_blank" rel="noopener">IsThereAnyDeal ↗</a></div>`;

  if (g.bestDealPrice == null) {
    return `<div class="panel-section panel-card" id="panel-section-price">${titleHtml}<div class="panel-no-data">No pricing data available.</div></div>`;
  }

  // dealRecordTier (public/utils.js) is the single shared source of this tier/color/icon logic
  // — reused verbatim by the table cell's own renderBestDeal (bundles.js/library.js) and the
  // Price Status column, so all three stay in sync automatically (see dealRecordTier's own
  // comment for why that matters: a 3-month-low tier was once added to only one of these).
  const rec = dealRecordTier(g.bestDealPrice, g);
  const color = rec ? rec.color : null;
  const badge = rec ? ' ' + rec.icon : '';
  const tooltip = g.bestDealShop ? `${g.bestDealShop}${rec ? ` — ${rec.tooltipLabel}` : ''}` : '';

  // `0` (the best deal genuinely isn't any cheaper than Steam) is treated the same as `null`/
  // undefined (no discount to show) — "if any" per the spec, not a flat "-0%" reading as noise.
  const discountHtml = g.bestDealCut
    ? `<span class="panel-price-sep">·</span><span class="panel-price-discount">-${g.bestDealCut}%</span>`
    : '';

  // The shop name, and — unlike the table cell, which stays tooltip-only since it's
  // space-constrained — the *whole rest of the card* doubles as the buy link: ITAD's own
  // affiliate/redirect link for this exact deal (`bestDealUrl`, passed through unmodified,
  // same as the Bundles page's own "Get this bundle" link), so there's a large, easy target
  // rather than one small "Fanatical ↗" word to hit. Only the title row above (the "Price"
  // label and its separate IsThereAnyDeal ↗ link) stays outside it. safeHref guards against
  // anything but a plain http(s) URL, same as every other external link built from
  // third-party data in this file; with no url for this deal, the line falls back to a plain
  // (unlinked) div — still worth naming the shop as text either way.
  const shopUrl = safeHref(g.bestDealUrl);
  const shopHtml = g.bestDealShop
    ? `<span class="panel-price-sep">·</span><span class="panel-price-shop">${shopUrl ? 'Buy at ' : 'at '}${esc(g.bestDealShop)}${shopUrl ? ' ↗' : ''}</span>`
    : '';
  const lineInner = `
      <span class="panel-price-amount"${color ? ` style="color:${color}"` : ''}>${esc(formatMoney(g.bestDealPrice, g.priceCurrency))}${badge}</span>
      ${discountHtml}
      ${shopHtml}`;
  const lineTitleAttr = tooltip ? ` title="${esc(tooltip)}"` : '';
  const lineHtml = shopUrl
    ? `<a class="panel-price-line panel-price-line--link" href="${esc(shopUrl)}" target="_blank" rel="noopener"${lineTitleAttr}>${lineInner}</a>`
    : `<div class="panel-price-line"${lineTitleAttr}>${lineInner}</div>`;

  // Historical lows (all-time/1yr/3mo) — a second, compact line below the buy line, reusing
  // DEAL_RECORD_TIERS' own icon/color/label (public/utils.js) so this stays in sync with the
  // badge shown on the amount above rather than hand-rolling a second copy of that mapping.
  // Omitted entirely when ITAD returned none of the three (a very new/unlisted game).
  //
  // A low that exactly equals bestDealPrice is dropped — the main price line already carries
  // that exact number, badged via `rec` above, so repeating it here would just be the same
  // figure twice. (This can empty the whole lows line, e.g. the current deal already IS the
  // all-time low and every window shares that value — the main line's own 🔥 badge already
  // said so, so there's nothing left worth adding.)
  //
  // lowAll <= lowY1 <= lowM3 always (a longer lookback window can only find a price at or
  // below any shorter window's minimum), so it's common for two or all three to share the same
  // value (e.g. the all-time low happened within the last 3 months). Showing "🔥 $4.99 · ★
  // $4.99 · ☆ $4.99" reads as noise/a possible bug rather than three real distinct data
  // points, so consecutive tiers with an identical amount are collapsed into one entry with
  // their icons combined (rarest first, e.g. "🔥★☆ $4.99") rather than repeating the price.
  //
  // Displayed shortest window first (3mo, 1yr, all-time) — DEAL_RECORD_TIERS itself stays
  // ordered rarest-first (that's the order dealRecordTier needs to pick the first/rarest
  // matching tier for the badge above), so this line iterates it in reverse rather than
  // reordering the shared list. Equal-amount grouping still works the same either way (equal
  // amounts stay adjacent, just in the opposite direction); `unshift` below keeps each group's
  // own icons/label in rarest-first order regardless of the reversed iteration, so a collapsed
  // "🔥★☆ $4.99" entry never comes out as "☆★🔥" instead.
  const presentTiers = [...DEAL_RECORD_TIERS].reverse().filter(t => g[t.low] != null && g[t.low] !== g.bestDealPrice);
  const lowGroups = [];
  for (const t of presentTiers) {
    const last = lowGroups[lowGroups.length - 1];
    if (last && last.amount === g[t.low]) last.tiers.unshift(t);
    else lowGroups.push({ amount: g[t.low], tiers: [t] });
  }
  const lowsHtml = lowGroups
    .map(({ amount, tiers }) => {
      const icons = tiers.map(t => t.icon).join('');
      const label = tiers.map(t => t.statusLabel).join(' / ');
      const color = tiers[0].color; // rarest tier in the group leads the color too
      return `<span class="panel-price-low" title="${esc(label)}: ${esc(formatMoney(amount, g.priceCurrency))}" style="color:${color}">${icons} ${esc(formatMoney(amount, g.priceCurrency))}</span>`;
    })
    .join('<span class="panel-price-sep">·</span>');

  return `<div class="panel-section panel-card" id="panel-section-price">
    ${titleHtml}
    ${lineHtml}
    ${lowsHtml ? `<div class="panel-price-lows">${lowsHtml}</div>` : ''}
  </div>`;
}

// "Part of <Base Game>" — the reverse of the DLC card below: present only when the
// currently open game is itself a piece of DLC (`meta.fullgame`, free on the same
// appdetails response, see extractAppDetails in lib/steam.js). Same real-`<a href>` /
// intercepted-click treatment as a DLC entry (see the delegated listener in initPanel),
// just walking the base-game/DLC relationship in the other direction via the same
// navigateToGame.
// Returns inline content only (no wrapping block element) — folded into the same line as
// the release date in renderPanelBody's markup, rather than a line of its own, so a DLC
// entry's sticky header isn't title + release date + "DLC for X" stacked three deep.
function baseGameHtml(g) {
  const fg = g.details?.meta?.fullgame;
  if (!fg) return '';
  return `DLC for <a class="panel-basegame-link" href="${esc(panelOptions.gameHref?.(fg.appid) ?? '#')}" data-appid="${fg.appid}" data-name="${esc(fg.name || '')}">${esc(fg.name || `App ${fg.appid}`)}</a>`;
}

// DLC — a base game's downloadable content, collapsed by default (see loadDlc above for
// why it's the one card whose body isn't already loaded by render time). The collapsed
// header's count comes straight from `meta.dlc` (the bare appid list, free — see
// extractAppDetails in lib/steam.js) so it's shown immediately even before the card is ever
// expanded; only the expanded body's names/capsules depend on the lazy fetch. Each entry is
// a real `<a href>` (panelOptions.gameHref, host-supplied so the URL matches whichever page
// this is) rather than a plain button, so ctrl/cmd/shift-click and middle-click open it in a
// new tab the normal way — a plain click is intercepted (see the delegated listener in
// initPanel) to navigate within this panel instead via navigateToGame.
//
// `g.dlc.length` can come back smaller than `dlcIds.length` — not a truncation (loadDlc
// resolves every one of them, no cap), just individual entries that failed to resolve this
// time (delisted, or genuinely rate-limited under a big burst) and were silently dropped,
// same graceful degradation as any other per-item failure elsewhere in the panel.
// Newest-released first, with not-yet-released entries surfaced above everything else (the
// same "what's coming" framing Steam's own DLC listings use) rather than buried below the
// oldest release. `releaseDate` is Steam's raw display string (e.g. "3 Mar, 2017"), not a
// machine-sortable field — Date.parse() on it is a best effort; a comingSoon entry with no
// parseable date, or any other unparseable date, sorts to the bottom of its group instead of
// throwing the whole order off.
function sortDlcByRelease(list) {
  const sortKey = d => {
    const t = d.releaseDate ? Date.parse(d.releaseDate) : NaN;
    return Number.isNaN(t) ? -Infinity : t;
  };
  return list.slice().sort((a, b) => {
    if (!!a.comingSoon !== !!b.comingSoon) return a.comingSoon ? -1 : 1;
    return sortKey(b) - sortKey(a);
  });
}

function dlcItemHtml(d) {
  return `<a class="panel-dlc-item" href="${esc(panelOptions.gameHref?.(d.appid) ?? '#')}" data-appid="${d.appid}" data-name="${esc(d.name)}">
      <img class="panel-dlc-capsule" src="${esc(d.capsule)}" alt="" loading="lazy">
      <span class="panel-dlc-name">${esc(d.name)}</span>
    </a>`;
}

function dlcHtml(g) {
  const dlcIds = g.details?.meta?.dlc;
  if (!dlcIds || !dlcIds.length) return '';

  let bodyHtml = `<div class="panel-collapsible-body-pad"><span class="sk" style="display:block;width:100%;height:48px;border-radius:6px"></span></div>`;
  if (g.dlcLoading) {
    // Stream in whichever entries have already resolved instead of holding the whole card on
    // its skeleton until every single one settles (see loadDlc's own comment).
    const loaded = (g.dlcPartial || []).filter(Boolean);
    const remaining = dlcIds.length - loaded.length;
    if (loaded.length) {
      bodyHtml = `<div class="panel-dlc-list">${loaded.map(dlcItemHtml).join('')}${
        remaining ? `<div class="panel-dlc-loading-more">Loading ${remaining} more…</div>` : ''
      }</div>`;
    }
  } else if (g.dlc === null) {
    bodyHtml = `<div class="panel-collapsible-body-pad"><div class="panel-no-data">Couldn't load DLC details.</div></div>`;
  } else if (g.dlc) {
    bodyHtml = g.dlc.length
      ? `<div class="panel-dlc-list">${sortDlcByRelease(g.dlc).map(dlcItemHtml).join('')}</div>`
      : `<div class="panel-collapsible-body-pad"><div class="panel-no-data">No DLC details available.</div></div>`;
  }

  return `<div class="panel-section" id="panel-section-dlc">${collapsibleCard({
    appid: g.appid,
    section: 'dlc',
    icon: '📦',
    valHtml: `<b>DLC</b> · ${dlcIds.length} available`,
    bodyHtml,
    linkHref: `https://store.steampowered.com/dlc/${g.appid}/`,
    linkTitle: 'View all DLC on Steam',
  })}</div>`;
}

export function renderPanelBody(game) {
  const g = game;
  const h = g.details?.hltb;
  const meta = g.details?.meta;

  const storeUrl    = `https://store.steampowered.com/app/${g.appid}`;
  const itadUrl     = `https://isthereanydeal.com/steam/app/${g.appid}`;
  const releaseDate = meta?.releaseDate;
  const description = meta?.description;

  const ownersHtml = panelOptions.getOwnersHtml?.(g) ?? '';

  // The glance strip already carries HLTB's "All PlayStyles" number (see glanceGrid
  // above) — this is just the fuller Main/Extra/Completionist breakdown beneath it,
  // once, not a second copy of the headline figure. Collapsed by default like
  // achievements/news, EXCEPT when `all` itself is missing — then this breakdown is the
  // only duration data the panel has at all, so hiding it behind a click would bury the
  // one piece of HLTB info actually available for this game.
  let hltbDetailHtml = '';
  if (!g.loading && h && (h.main || h.extra || h.completionist)) {
    if (!isSectionExpanded(g.appid, 'hltb') && h.all == null) expandedSections.add(`${g.appid}:hltb`);
    // No numeral in this chip (see collapsibleCard's numHtml comment) — Main Story would
    // be an arbitrary pick among three categories the breakdown itself doesn't privilege,
    // and "All PlayStyles" is already the glance strip's own headline figure just above.
    // The caption instead just names which categories the breakdown actually has.
    const parts = [h.main && 'Main Story', h.extra && 'Main + Extra', h.completionist && 'Completionist'].filter(Boolean);
    const bodyHtml = `<div class="panel-collapsible-body-pad">
      <div class="panel-hltb">
        ${h.main ? `<div class="panel-hltb-item"><div class="panel-hltb-label">Main Story</div><div class="panel-hltb-val">${fmtH(h.main)}</div></div>` : ''}
        ${h.extra ? `<div class="panel-hltb-item"><div class="panel-hltb-label">Main + Extra</div><div class="panel-hltb-val">${fmtH(h.extra)}</div></div>` : ''}
        ${h.completionist ? `<div class="panel-hltb-item"><div class="panel-hltb-label">Completionist</div><div class="panel-hltb-val">${fmtH(h.completionist)}</div></div>` : ''}
      </div>
    </div>`;
    hltbDetailHtml = `<div class="panel-section" id="panel-section-hltb">${collapsibleCard({
      appid: g.appid,
      section: 'hltb',
      icon: '⏱️',
      valHtml: `<b>How Long To Beat</b> · ${parts.join(', ')}`,
      bodyHtml,
      linkHref: h.id ? `https://howlongtobeat.com/game/${h.id}` : null,
      linkTitle: 'View on HowLongToBeat',
    })}</div>`;
  }

  const tagDim = key => panelOptions.enableTagFilters ? key : null;
  const devs = meta?.developers || [];
  const pubs = meta?.publishers || [];
  const sameDevPub = devs.length > 0 && devs.length === pubs.length && devs.every((d, i) => d === pubs[i]);
  const cloudHtml = g.loading ? '' : tagCloud([
    { kind: 'tags', dim: tagDim('tags'), items: g.details?.tags },
    { kind: 'genres', dim: tagDim('genres'), items: meta?.genres },
    { kind: 'categories', dim: tagDim('categories'), items: meta?.categories },
    { kind: 'devpub', dim: tagDim('developers'), items: devs },
    ...(sameDevPub ? [] : [{ kind: 'devpub', dim: tagDim('publishers'), items: pubs }]),
  ]);

  const refreshBtn = (panelOptions.onRefresh && !g.loading) ? `
    <button type="button" class="panel-refresh-btn${panelRefreshing ? ' is-refreshing' : ''}"${panelRefreshing ? ' disabled' : ''}
      title="Refresh rating, HLTB &amp; store details for this game" aria-label="Refresh details">↻</button>` : '';

  const baseGameSectionHtml = g.loading ? '' : baseGameHtml(g);
  const priceSectionHtml = g.loading ? '' : priceHtml(g);
  const dlcSectionHtml = g.loading ? '' : dlcHtml(g);
  const newsSectionHtml = newsHtml(g);
  const achievementsSectionHtml = achievementsHtml(g);

  // A free demo is a "try before you buy" call to action, not supplementary info like
  // Website/Workshop below — those are fine tucked one click away in "⋯ More", but a demo
  // link is worth surfacing without any extra click. A standalone banner right under the
  // sticky header (rather than a header icon) keeps the header itself compact — it's the
  // first thing seen on open, but scrolls away with the rest of the body like everything
  // else, instead of permanently occupying pinned header space for every game that has one.
  const demoBannerHtml = (!g.loading && g.details?.demo)
    ? `<a class="panel-demo-banner" href="${esc(safeHref(`https://store.steampowered.com/app/${g.details.demo}`))}" target="_blank" rel="noopener">
        <span class="panel-demo-banner-icon">🎮</span> Try the Free Demo
      </a>`
    : '';

  // Store and ITAD are the two links everyone wants at a glance (info page, deal price) and
  // stay directly in the row — Workshop/Website are each conditional (present for some games,
  // absent for others) and, unlike Store/ITAD, only ever add up on top of an already full row
  // rather than replacing anything in it. Tucked into a single "⋯ More" menu instead, so the
  // row's width no longer scales with how many of these a given game happens to have.
  //
  // No News item here — a standalone header icon to the Steam news hub used to exist as a
  // fallback for whenever the News *section* itself has nothing to show (no card if there are
  // zero official announcements), but the section's own ↗ icon already covers the case that
  // matters (an actual News card, linking to the exact same hub); a game with confirmed zero
  // official posts isn't worth a dedicated icon just to go check whether unrelated syndicated
  // press showed up on the raw hub instead.
  const moreLinkItems = [
    // Steam Workshop — a category like any other in `meta.categories` (already fetched,
    // feeds the tag cloud), just also worth a direct link for the games that actually have
    // it, rather than only ever showing up as one pill among many.
    !g.loading && (meta?.categories || []).includes('Steam Workshop') &&
      { icon: '🛠️', label: 'Steam Workshop', href: `https://steamcommunity.com/app/${g.appid}/workshop/` },
    // Official website — a plain field on the same appdetails response as everything else
    // here, present for plenty of games and absent for plenty of others (mostly smaller ones).
    meta?.website && { icon: '🌐', label: 'Official Website', href: meta.website },
    // "Discover similar games" — Steam's own "More Like This" page for this appid, the exact
    // same first-party recommendation surface the app's own store page embeds. Deliberately
    // just a link, not a fetched/rendered list: this app has no way to compute or source that
    // ranking itself (see the earlier investigation into steampeek.hu/gmndx.com — third-party,
    // undocumented, and either scrape-only or, for gmndx.com, explicitly opted out of AI-agent
    // crawling) that doesn't cost either a real upstream trust-tier risk or a wrong/derived
    // answer. Unconditional (no `!g.loading` gate, unlike Workshop/Website above) since it only
    // needs `g.appid`, already known before any metadata has loaded.
    { icon: '🔎', label: 'More Like This (Steam)', href: `https://store.steampowered.com/recommended/morelike/app/${g.appid}/` },
    // Free demo is NOT here — unlike Website/Workshop (supplementary info, worth a quiet
    // icon-link), a demo is a "try before you buy" call to action worth surfacing without an
    // extra click. See demoBannerHtml below instead.
  ].filter(Boolean);
  const moreLinksHtml = moreLinkItems.length ? `<div class="panel-icon-more">
    <button type="button" class="panel-icon-link panel-icon-more-btn" aria-haspopup="true" aria-expanded="${moreLinksOpen}" title="More links" aria-label="More links">⋯</button>
    ${moreLinksOpen ? `<div class="panel-icon-more-menu">${moreLinkItems.map(it =>
      `<a class="panel-icon-more-item" href="${esc(safeHref(it.href))}" target="_blank" rel="noopener">${it.icon} ${esc(it.label)}</a>`
    ).join('')}</div>` : ''}
  </div>` : '';

  // "← Back" only appears once a DLC hop is actually in progress (panelHistory is empty
  // for every ordinary panel open — see panelOpen's keepHistory param) — a plain table-row
  // click never gets this button, only a game reached by following a DLC link (or by going
  // back through more than one of them) does.
  const backHtml = panelHistory.length
    ? `<button type="button" class="panel-back-btn" title="Back to ${esc(panelHistory[panelHistory.length - 1].name)}">
        &#8249; ${esc(panelHistory[panelHistory.length - 1].name)}
      </button>`
    : '';

  // A sticky jump-nav for the sections below the fold — collapsing HLTB/news/achievements
  // by default (see collapsibleCard above) means the panel is now mostly a scroll of
  // section headers, so there's no longer an at-a-glance way to tell what's *in* a long
  // panel without scrolling all the way through it. Built from which sections actually
  // rendered content this time (an ownersHtml-less standalone lookup, or a game with no
  // achievements/news/HLTB data, simply doesn't get a button for it) — only shown once
  // there's more than one place worth jumping to; a lone "Owners" button with nothing
  // else below it isn't worth the row. Listed in the same order the sections actually
  // appear below (Owners right after the tag cloud, ahead of the collapsibles — see
  // renderPanelBody's markup below) so scroll-spy highlighting (see
  // initSubnavScrollSpy) always lights up left-to-right as you scroll down, never out
  // of order.
  const subnavItems = [
    ownersHtml && { label: 'Owners', target: 'panel-section-owners' },
    hltbDetailHtml && { label: 'HLTB', target: 'panel-section-hltb' },
    newsSectionHtml && { label: 'News', target: 'panel-section-news' },
    achievementsSectionHtml && { label: 'Achievements', target: 'panel-section-achievements' },
    dlcSectionHtml && { label: 'DLC', target: 'panel-section-dlc' },
  ].filter(Boolean);
  const subnavHtml = subnavItems.length < 2 ? '' : `<div class="panel-subnav">
    <button type="button" class="panel-subnav-btn" data-target="top">Overview</button>
    ${subnavItems.map(it => `<button type="button" class="panel-subnav-btn" data-target="${it.target}">${it.label}</button>`).join('')}
  </div>`;

  // Only the title row (title/release date/icon-links) is wrapped in .panel-header-sticky
  // and stays pinned while scrolling — the hero (built into #panel-hero below) and the
  // glance grid scroll away with the rest of the body (description, owners, tag cloud,
  // HLTB breakdown). #panel-hero used to be a fixed sibling of #panel-body outside the
  // scroll container, which meant it (plus the glance grid) permanently ate into the
  // panel's visible height on short/mobile screens with no way to scroll it out of the
  // way. Rendering it as the first child here instead — and rebuilding it fresh via
  // buildPanelHero() below, same as before — lets it scroll away like everything else.
  const panelBody = document.getElementById('panel-body');
  // Replacing #panel-body's innerHTML rebuilds #panel-hero from scratch, and
  // buildPanelHero() below unconditionally scrollIntoView()s its active filmstrip item —
  // needed so opening the panel or paging the hero lands on the right frame, but with no
  // sense of "did the user actually ask to see the hero", it just as happily yanks the
  // whole panel back up to the top on a re-render that has nothing to do with the hero at
  // all (toggling a collapsible section, the refresh button). Snapshot the scroll position
  // now and restore it after, so those re-renders leave the reader wherever they were.
  const prevScrollTop = panelBody.scrollTop;

  // Release date and "DLC for X" used to stack as two separate lines under the title —
  // folded onto one ("<date> · DLC for X") since both are short, secondary metadata about
  // the same thing (when/what this is), and stacking them was most of what made the sticky
  // header tall for a DLC entry reached via a base-game/DLC hop (which also has the ← Back
  // line above the title).
  const metaLineHtml = releaseDate || baseGameSectionHtml
    ? `<div class="panel-release">${releaseDate ? esc(releaseDate) : ''}${releaseDate && baseGameSectionHtml ? ' <span class="panel-meta-sep">·</span> ' : ''}${baseGameSectionHtml}</div>`
    : '';

  panelBody.innerHTML = `
    <div id="panel-hero" class="panel-hero"></div>
    <div class="panel-header-sticky">
      ${backHtml}
      <div class="panel-title-row">
        <div>
          <div class="panel-title" id="panel-title">${esc(g.name)}</div>
          ${metaLineHtml}
        </div>
        <div class="panel-icon-links">
          <a class="panel-icon-link" href="${esc(storeUrl)}" target="_blank" rel="noopener" title="Steam Store" aria-label="Steam Store">🛒</a>
          <a class="panel-icon-link" href="${esc(itadUrl)}" target="_blank" rel="noopener" title="IsThereAnyDeal" aria-label="IsThereAnyDeal">$</a>
          ${moreLinksHtml}
          <span class="panel-icon-divider" role="separator" aria-hidden="true"></span>
          <button type="button" class="panel-icon-link panel-copy-link-btn" title="Copy link to this game" aria-label="Copy link to this game">🔗</button>
          ${refreshBtn}
        </div>
      </div>
      ${subnavHtml}
    </div>
    ${demoBannerHtml}
    ${glanceGrid(g)}
    ${priceSectionHtml}
    ${description ? `<div class="panel-desc panel-card" id="panel-desc"></div>` : ''}
    ${cloudHtml}
    ${ownersHtml ? `<div id="panel-section-owners">${ownersHtml}</div>` : ''}
    ${hltbDetailHtml}
    ${newsSectionHtml}
    ${achievementsSectionHtml}
    ${dlcSectionHtml}`;

  // `description` (Steam's `short_description`) isn't run through the innerHTML template
  // above like everything else here: it's store metadata attributed to the game's own
  // developer/publisher, and the panel opens for any appid with no ownership check (the
  // "look up any game" box, a bare `?game=` link) — dropping it into innerHTML unescaped
  // would let a malicious/compromised store listing run arbitrary script the moment its
  // panel opens. But it can also contain literal HTML entities as plain text (e.g. "Baldur's
  // Gate..." legitimately has "&amp;" for "Dungeons & Dragons"), so esc()'ing it like every
  // other field here would double-escape those into visible "&amp;" text instead of "&".
  // Decoding it inertly first — a DOMParser document that's never attached to the page runs
  // no scripts and loads no resources — then inserting the result as plain text handles both:
  // entities decode correctly, and any actual markup (there shouldn't be any in this field,
  // but nothing here assumes that) degrades to visible text rather than executing.
  if (description) {
    document.getElementById('panel-desc').textContent =
      new DOMParser().parseFromString(description, 'text/html').body.textContent || '';
  }

  buildPanelHero();
  panelBody.scrollTop = prevScrollTop;
  // Subnav markup (and every section it targets) is rebuilt fresh above — re-run the
  // scroll-spy once so a re-render triggered mid-scroll (toggling a collapsible, the
  // refresh button) doesn't leave the old subnav's active button highlighted, or none at
  // all, until the next scroll event fires.
  updateSubnavScrollSpy();

  // DLC is the one collapsible card whose fetch is normally gated behind an actual click
  // (see toggleSection/loadDlc above) — but `expandedSections` remembers "DLC is expanded"
  // per appid for the rest of the session, independent of any one game *object*. Navigating
  // to a game via a DLC link (or back, or prev/next/random) always creates/looks up a fresh
  // game object with its own never-yet-fetched `dlc` — so if that appid's card was expanded
  // at some earlier point this session, it renders open here too (dlcHtml honors the same
  // isSectionExpanded flag toggleSection reads) but with nothing loaded to show, and no click
  // is ever going to happen to trigger the fetch since it's already open. Kick it off here
  // instead whenever that mismatch shows up. Placed after the render above (not before) so
  // loadDlc's own synchronous pre-fetch renderPanelBody() call — same as a real toggle click
  // triggers — runs after this call's own DOM writes are done, not nested inside them.
  if (!g.loading && g.dlc === undefined && !g.dlcLoading && isSectionExpanded(g.appid, 'dlc')) loadDlc(g);
}

function initHeroSwipe() {
  // Bound to #panel-body (stable across renders) rather than #panel-hero itself, which —
  // now that it's part of #panel-body's generated markup (see renderPanelBody) — is a
  // brand new DOM node after every render; a listener attached directly to it would stop
  // working (or, before the first panelOpen(), fail to attach at all) the moment the
  // panel re-renders. The `.panel-hero` check in touchstart scopes tracking to touches
  // that actually start on the hero, same as the old direct binding did implicitly.
  const hero = document.getElementById('panel-body');
  let startX = 0, startY = 0, tracking = false, decided = false, isHoriz = false;

  hero.addEventListener('touchstart', e => {
    if (e.touches.length !== 1 || e.target.closest('.panel-filmstrip') || !e.target.closest('.panel-hero')) return;
    startX = e.touches[0].clientX; startY = e.touches[0].clientY;
    tracking = true; decided = false; isHoriz = false;
  }, { passive: true });

  hero.addEventListener('touchmove', e => {
    if (!tracking || e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    if (!decided) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      isHoriz = Math.abs(dx) > Math.abs(dy) * 1.2;
      decided = true;
    }
    if (isHoriz) e.stopPropagation(); // don't let panel-close swipe fire
  }, { passive: true });

  hero.addEventListener('touchend', e => {
    if (!tracking || !isHoriz) { tracking = false; return; }
    tracking = false;
    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) < 40) return;
    panelStepHero(dx < 0 ? 1 : -1);
  }, { passive: true });

  hero.addEventListener('touchcancel', () => { tracking = false; }, { passive: true });
}

function initPanelSwipe() {
  const panel = document.getElementById('game-panel');
  let startX = 0, startY = 0, tracking = false, decided = false, horiz = false;

  panel.addEventListener('touchstart', e => {
    if (e.touches.length !== 1 || e.target.closest('.panel-filmstrip')) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    tracking = true;
    decided = false;
    horiz = false;
    panel.style.transition = 'none';
  }, { passive: true });

  panel.addEventListener('touchmove', e => {
    if (!tracking || e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    if (!decided) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      horiz = Math.abs(dx) > Math.abs(dy) * 1.2;
      decided = true;
    }
    if (!horiz || dx <= 0) return;
    e.preventDefault();
    panel.style.transform = `translateX(${dx}px)`;
  }, { passive: false });

  function finish(clientX) {
    if (!tracking) return;
    tracking = false;
    const dx = clientX - startX;
    if (horiz && dx > 80) {
      panel.style.transition = 'transform 0.2s ease';
      panel.style.transform = 'translateX(100%)';
      setTimeout(() => {
        panelClose();
        panel.style.transition = '';
        panel.style.transform = '';
      }, 200);
    } else {
      if (panel.style.transform) {
        panel.style.transition = 'transform 0.25s ease';
        panel.style.transform = '';
        setTimeout(() => { panel.style.transition = ''; }, 250);
      } else {
        panel.style.transition = '';
      }
    }
  }

  panel.addEventListener('touchend', e => finish(e.changedTouches[0].clientX), { passive: true });
  panel.addEventListener('touchcancel', () => {
    tracking = false;
    panel.style.transition = 'transform 0.25s ease';
    panel.style.transform = '';
    setTimeout(() => { panel.style.transition = ''; }, 250);
  }, { passive: true });
}
