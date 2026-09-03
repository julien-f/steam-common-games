'use strict';

import { formatMoney, scoreColor, dealRecordTier, DEAL_RECORD_TIERS, discountPct, fmtH, fmtLastPlayed, computeSteamdbRating } from './utils.ts';
import { openLightbox, closeLightbox, isLightboxOpen } from './lightbox.tsx';
import { buildMediaItems } from './mediaItems.ts';
import type { MediaItem } from './mediaItems.ts';
import { getStoredRegion, resolveRegion } from './region.ts';
import type { Game } from './types.ts';

import { createSignal, createEffect, createMemo, For, Show, type JSX } from 'solid-js';
import { render } from 'solid-js/web';

// Host-page options passed to initPanel. All optional — a page supplies only the hooks it
// needs; the field names mirror exactly what panel.tsx reads off panelOptions below.
export interface PanelOptions {
  onTagClick?: (dim: string, val: string) => void;
  isTagActive?: (dim: string, val: string) => boolean;
  onRefresh?: (game: Game) => void;
  onNavigateGame?: (appid: number, name: string) => void;
  onClose?: (opts?: { preserveUrl?: boolean }) => void;
  inertSelector?: string;
  pricesHandledByHost?: boolean | ((game: Game) => boolean);
  showAchievements?: boolean;
  enableTagFilters?: boolean;
  gameHref?: (appid: string | number) => string;
  getOwnersHtml?: (game: Game) => string;
}

// ── Shared game side panel ──────────────────────────────────────────────────
// Used by all three pages (app.ts/library.ts/bundles.tsx, imported directly).
// A real Solid component now (converted from the original
// panel.ts's hand-rolled innerHTML rebuilds): `initPanel(options)` mounts it once into the
// static `#panel-body` element every page's own markup already has; `panelOpen(game)`/
// `panelClose()` show/hide it exactly as before. Anything page-specific — the "Owned by"
// section, tag-click filtering, the nav bar's list of games — is still left to the host page
// via options or by wrapping panelOpen/panelClose with its own extra logic, unchanged.
//
// Every exported function below keeps its exact original name/signature (every host page's
// import is untouched by this conversion) — the one
// deliberate behavior difference is internal: `panelOptions.onClose` still exists because
// panelClose() itself is called from more places than just the host's own code (the backdrop
// click, × button, and swipe-to-close all call it directly) — a host that needs to run cleanup
// on every close (not just the ones it explicitly triggers) should do it there rather than in a
// wrapper around panelClose(), which those other paths would silently bypass.
//
// Reactivity model: `panelGame`/`heroIdx`/`moreLinksOpen`/`panelHistory`/`expandedSections`/
// `revealedAchievements`/`achievementsFilter`/`panelRefreshing` are all real Solid signals now —
// panel.tsx's own click handlers (attached directly per-element via JSX `onClick`, not the old
// delegated `closest()` dispatch off one listener) call their setters directly, so the relevant
// piece of the body re-renders with no external "please re-render" call needed. The one signal
// that IS an external "please re-render" bump is `revision`: host pages mutate a `Game` object's
// fields directly (score, HLTB, price, etc. — `row.field = x`), which Solid has no way to see on
// its own (they're plain objects, not a store), so `renderPanelBody(game)` — still exported,
// still called the same way at every existing mutation site across all three pages — bumps
// `revision`, which is read (alongside `panelGame` itself) inside the one big reactive body
// expression below, forcing a full re-read of every field off the current game object. This is
// the same "mutate, then explicitly notify" convention this codebase already used everywhere
// before Solid; only the notify step's *implementation* changed.
let panelOptions: PanelOptions = {};
const [panelGame, setPanelGame] = createSignal<Game | null>(null);
const [heroIdx, setHeroIdx] = createSignal(0);
const [revision, setRevision] = createSignal(0);
let panelPrevFocus: HTMLElement | null = null;
const [panelRefreshing, setPanelRefreshing] = createSignal(false); // true while the host's onRefresh() is in flight
const [moreLinksOpen, setMoreLinksOpen] = createSignal(false); // whether the header's "⋯" overflow menu (News/Workshop/Website) is open

// Stack of {appid, name} for games navigated away from via a DLC link or "Part of <Base
// Game>" link click (see navigateToGame/panelGoBack below) — NOT touched by an ordinary
// panel open (a table row click, a search-box pick, prev/next/random) since those aren't
// part of any such browsing trail; panelOpen() below clears it unless told to keep it
// (`keepHistory: true`), which only navigateToGame/panelGoBack ever pass through the host's
// onNavigateGame callback.
// Holds plain {appid, name} pairs rather than full game objects — going back re-opens via
// the same host mechanism (panelOptions.onNavigateGame) a fresh lookup would use, same
// dedup-with-already-loaded-rows behavior included, rather than panel.ts caching its own
// stale copy of a game's details.
const [panelHistory, setPanelHistory] = createSignal<{ appid: number; name: string }[]>([]);

// Which subnav button (a section id, or 'top' for Overview) is currently highlighted —
// see PanelSubnav/updateSubnavScrollSpy below. A signal now (previously an imperative
// classList.toggle() pass over the subnav's DOM buttons) specifically so PanelSubnav's own
// button elements can react to it in place via `classList`, without needing to be told
// which one is active by a caller reaching back into the DOM after the fact.
const [activeSubnavTarget, setActiveSubnavTarget] = createSignal('top');

function panelShuffle(arr: { appid: number }[]) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Rejects anything but a plain http(s) URL — same guard accountsBar.ts/app.ts already apply
// to profile URLs. JSX text/attribute interpolation escapes on its own, so this guard is the
// one XSS-relevant check still needed: a developer-supplied `meta.website` or a news item's
// `url` (both flow through unfiltered from Steam's own APIs — see lib/steam.js) could
// otherwise be a `javascript:`/`data:` URI that runs script when clicked instead of
// navigating away. Returns '' for anything unsafe.
function safeHref(url: string | null | undefined) {
  return /^https?:\/\//i.test(url || '') ? url : '';
}

const randomQueues = new Map<string, { appid: number }[]>(); // queueKey → remaining shuffled games

// Picks the next game from a shuffle bag scoped to queueKey (e.g. a group key,
// or a fixed constant for a page with only one list) so repeated picks cycle
// through every item before repeating. The bag is rebuilt when exhausted or
// when `list` no longer matches what's left in it (e.g. after filtering).
export function pickRandomFrom(list: { appid: number }[], queueKey: string, currentAppid: number) {
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

export function clearRandomQueue(queueKey: string) {
  randomQueues.delete(queueKey);
}

export function clearAllRandomQueues() {
  randomQueues.clear();
}

export function initPanel(options: PanelOptions = {}) {
  panelOptions = options;

  document.getElementById('panel-backdrop')!.addEventListener('click', () => panelClose());
  document.getElementById('panel-close')!.addEventListener('click', () => panelClose());

  const panelBodyEl = document.getElementById('panel-body')!;
  render(() => <PanelBody />, panelBodyEl);

  panelBodyEl.addEventListener('wheel', e => {
    const strip = (e.target as Element).closest?.('.panel-filmstrip') as HTMLElement | null;
    if (!strip) return;
    e.preventDefault();
    strip.scrollLeft += e.deltaY || e.deltaX;
  }, { passive: false });

  // Dismiss the "⋯ More links" menu on outside click, same convention as gameSearch.ts's
  // own dropdown — needs to catch clicks *outside* the panel too (backdrop, page behind it),
  // so this stays a document-level listener rather than something the menu button's own
  // onClick could handle alone. Uses `e.composedPath()` rather than `e.target.closest(...)` —
  // the menu button's own click toggles `moreLinksOpen` synchronously, which re-renders this
  // exact DOM subtree (a brand new button element replacing the old one) *before* this
  // document-level listener runs (it's registered after Solid's own delegated click listener,
  // so it always fires second) — by then `e.target` is the already-detached old button, whose
  // `.closest()` walk no longer reaches the (also-replaced) `.panel-icon-more` wrapper,
  // reading as an "outside" click and immediately closing the menu that same click just
  // opened. `composedPath()` is captured at dispatch time, before any handler (including
  // Solid's own) had a chance to mutate the DOM, so it's unaffected by that race — confirmed
  // live (the menu never opened at all before this fix).
  document.addEventListener('click', e => {
    if (moreLinksOpen() && !e.composedPath().some(el => el instanceof Element && el.classList.contains('panel-icon-more'))) setMoreLinksOpen(false);
  });

  initPanelSwipe();
  initHeroSwipe();
  initSubnavScrollSpy();
}

// Highlights whichever subnav button corresponds to the section currently scrolled to the
// top of the visible body, instead of the subnav being a static row of jump-links with no
// sense of "where am I". Bound once to #panel-body (a stable element across re-renders)
// rather than the subnav itself, which the reactive body below still rebuilds on every
// `revision`/`panelGame` change.
function initSubnavScrollSpy() {
  document.getElementById('panel-body')!.addEventListener('scroll', () => {
    requestAnimationFrame(updateSubnavScrollSpy);
  }, { passive: true });
}

// Buttons are walked in DOM order, which the body below keeps identical to the physical
// top-to-bottom order of the sections themselves (Owners right after the tag cloud,
// then HLTB/News/Achievements — see getSubnavSections below) — so the *last* button whose
// section has scrolled up to (or past) the sticky header counts as "current", same idea as
// a scrollspy TOC. None qualifying means we're still above the first section, i.e. still
// looking at the Overview (glance grid/description) itself. Only computes *which* target is
// current and writes it to `activeSubnavTarget` — PanelSubnav's own `classList` bindings
// react to that signal, so this function no longer touches the DOM beyond reading it.
function updateSubnavScrollSpy() {
  const nav = document.querySelector('.panel-subnav');
  if (!nav) return;
  const body = document.getElementById('panel-body')!;
  const headerH = document.querySelector('.panel-header-sticky')?.getBoundingClientRect().height ?? 0;
  const threshold = body.getBoundingClientRect().top + headerH + 8;
  const targets = [...nav.querySelectorAll<HTMLElement>('.panel-subnav-btn')].map(btn => btn.dataset.target);
  let activeTarget = 'top';
  for (const target of targets) {
    if (target === undefined || target === 'top') continue;
    const el = document.getElementById(target);
    if (!el || el.getBoundingClientRect().top > threshold) continue;
    activeTarget = target;
  }
  setActiveSubnavTarget(activeTarget);
}

export function isPanelOpen() { return panelGame() != null; }
export function getPanelGame() { return panelGame(); }

// Shared Escape-key handling: close the lightbox first (unless the browser's own Escape is
// about to exit fullscreen instead — bail and leave the lightbox open, same as the lightbox's
// own fullscreen behavior expects), else close the panel. Exposed as a function rather than a
// document-level listener panel.tsx binds itself, since a host page's own Escape handling may
// need to check something else first with higher priority (app.ts's/library.ts's keyboard-
// shortcuts help modal) — a host calls this only once nothing more specific has already
// claimed the keypress.
export function panelHandleEscape() {
  if (isLightboxOpen()) {
    if (document.fullscreenElement || (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement) return; // browser exits FS; keep lightbox open
    closeLightbox();
    return;
  }
  panelClose();
}

// Forces a fresh rating/HLTB/store-metadata/tags fetch for the open game, bypassing
// its cache TTL. The actual fetch + state update is host-specific (app.ts updates its
// `games` array and table row; library.ts updates its data-table row) — panelOptions.onRefresh
// does that and panel.tsx only owns the button's disabled/spinning state and re-render.
async function handlePanelRefresh() {
  const game = panelGame();
  if (!game || panelRefreshing() || !panelOptions.onRefresh) return;
  setPanelRefreshing(true);
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
    // Explicit, rather than relying on loadNews/loadPrice/loadDlc's own renderPanelBody calls
    // above to happen to cover onRefresh's mutation too — onRefresh's field writes need their
    // own re-render regardless of whether any of those other three calls did anything this time.
    if (panelGame() === game) renderPanelBody(game);
  } finally {
    setPanelRefreshing(false);
  }
}

// The 🔗 button beside Store/ITAD in the header — copies a link back to this exact game.
// Deliberately just `?game=<appid>` on the current page's own path, not the full current
// URL (which may carry `u=`/filters/sort/tab/view from whatever search led here) — someone
// sharing "check out this game" almost always means the game itself, not "reproduce my
// exact search too", and each host page's own `?game=` handling (see restorePanelFromUrl in
// app.ts, the standalone-lookup fallback in library.ts) already knows how to open just that.
function copyPanelLink(e: MouseEvent) {
  const game = panelGame();
  if (!game || !navigator.clipboard?.writeText) return;
  const btn = e.currentTarget as HTMLElement;
  const url = `${location.origin}${location.pathname}?game=${game.appid}`;
  navigator.clipboard.writeText(url).then(() => flashCopyLinkBtn(btn), () => {});
}

function flashCopyLinkBtn(btn: HTMLElement) {
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
// is either a plain boolean (bundles.tsx: every row is always batch-priced by loadPrices) or a
// function of the game (library.ts: only the Wishlist tab's own loadWishlistPrices batches
// prices — its Library tab rows are owned games with no price columns/batch of their own, same
// as the comparison page). Checked purely at fetch-decision time, not by racing against
// whether that host's own batch call has actually resolved yet — a host that says it handles
// pricing is trusted to do so on its own schedule, so loadPrice below never fires for it
// regardless of timing, which is what keeps this from ever duplicating that host's own batched
// /api/prices call (see CLAUDE.md's "one page-level control, not per-game" reasoning for why
// that matters). Pages that never set the option at all (app.ts) always fall through to
// loadPrice — nothing else there ever prices a row.
function pricesHandledByHost(game: Game) {
  const opt = panelOptions.pricesHandledByHost;
  return typeof opt === 'function' ? !!opt(game) : !!opt;
}

// Lazily resolved once per session (like library.ts's/bundles.tsx's own itadConfiguredPromise)
// rather than per-call — a plain GET /api/health, cheap to over-share across every game this
// fetches a price for.
let panelItadConfiguredPromise: Promise<boolean> | null = null;
function isItadConfigured() {
  if (!panelItadConfiguredPromise) {
    panelItadConfiguredPromise = fetch('/api/health').then(r => r.json()).then(d => !!d.itadConfigured).catch(() => false);
  }
  return panelItadConfiguredPromise;
}

// Prices a single game via the shared POST /api/prices route (appids: [appid], same route
// bundles.tsx/library.ts batch through) — only for a game nothing else already prices (see
// pricesHandledByHost above). Mirrors loadNews's shape: fetched once per game per session
// (`game.priceLoading` guards a fast reopen from firing a second concurrent request for the
// same game), and a stale resolve for a game the panel has since moved on from just updates
// the (now background) game object without forcing a re-render.
async function loadPrice(game: Game, { force = false } = {}) {
  if (pricesHandledByHost(game)) return;
  if (game.bestDealPrice !== undefined && !force) return; // already loaded (or already tried) this session
  if (game.priceLoading) return; // already in flight
  game.priceLoading = true;
  if (panelGame() === game) renderPanelBody(game);
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
    game.bestDealCut   = discountPct(game.bestDealPrice, game.steamRegular);
    game.lowAll        = info?.lowAll?.amount          ?? null;
    game.lowY1         = info?.lowY1?.amount           ?? null;
    game.lowM3         = info?.lowM3?.amount           ?? null;
    game.priceCurrency = info?.steamRegular?.currency ?? info?.bestDeal?.price?.currency ?? info?.lowAll?.currency ?? info?.lowY1?.currency ?? info?.lowM3?.currency ?? null;
  } catch {
    game.bestDealPrice = game.bestDealPrice ?? null; // leave the card on "no data" rather than stuck "…" forever
  } finally {
    game.priceLoading = false;
    if (panelGame() === game) renderPanelBody(game); // no-op if the panel moved on mid-fetch
  }
}

// News is deliberately NOT part of the host pages' rating/HLTB/meta/tags fetch (see
// server.js's newsLimit comment for why) — it's kept entirely off `game.details` (which
// app.ts/library.ts freely reassign wholesale whenever fresh rating/HLTB/etc. lands) and
// fetched here instead, once per game, lazily, the same on-demand shape achievements
// already use. `game.news`/`game.newsLoading` persist on the game/row object itself, so a
// game already opened once in this session doesn't refetch on a later reopen.
async function loadNews(game: Game, { force = false } = {}) {
  if (game.news !== undefined && !force) return; // already loaded this session
  game.newsLoading = true;
  game.newsError = false;
  if (panelGame() === game) renderPanelBody(game);
  try {
    const res = await fetch(`/api/game-news/${game.appid}${force ? '?refresh=1' : ''}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'News lookup failed');
    game.news = data.news;
  } catch {
    game.newsError = true;
    // Keep whatever was last successfully loaded rather than wiping it on a failed forced
    // refresh; null only the first time (nothing to fall back to). NewsSection below shows an
    // explicit "couldn't load" message instead of silently hiding the section whenever
    // there's no fallback data to show in its place.
    game.news = game.news ?? null;
  } finally {
    game.newsLoading = false;
    if (panelGame() === game) renderPanelBody(game); // no-op if the panel moved on mid-fetch
  }
}

// DLC list — like news/achievements, kept off `game.details` and fetched lazily by
// panel.tsx itself, but unlike those two it's not even fetched on panelOpen: the DLC card's
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
// `dlcIds` index, filled in as each fetch resolves) so DlcSection can render what's already
// available immediately and stream the rest in, rather than an all-or-nothing reveal.
// `game.dlc` itself is still only assigned once every entry has settled — every other spot
// that reads it (the refresh gate above, `toggleSection`'s expand-fetch, the "already loaded"
// early-return below) keeps treating "loaded" as "fully loaded", unchanged.
type DlcEntry = { appid: number; name: string; capsule: string; releaseDate: string; comingSoon: boolean };
async function loadDlc(game: Game, { force = false } = {}) {
  if (game.dlc !== undefined && !force) return; // already loaded (or already failed) this session
  const dlcIds = game.details?.meta?.dlc || [];
  if (!dlcIds.length) { game.dlc = []; return; }
  game.dlcLoading = true;
  // Seed partial slots from the previous complete list (keyed by appid) so a force-refresh
  // keeps showing the old entries in place while each is re-fetched, instead of the list
  // shrinking back down to empty and refilling.
  const prevById = new Map((game.dlc || []).map(d => [d.appid, d]));
  const partial: (DlcEntry | undefined)[] = dlcIds.map(id => prevById.get(id));
  game.dlcPartial = partial;
  if (panelGame() === game) renderPanelBody(game);
  try {
    await Promise.all(dlcIds.map(async (id: number, i: number) => {
      try {
        const res = await fetch(`/api/game-details/${id}${force ? '?refresh=1' : ''}`);
        const data = await res.json();
        partial[i] = (res.ok && data.meta)
          ? { appid: id, name: data.meta.name, capsule: data.meta.capsule, releaseDate: data.meta.releaseDate, comingSoon: data.meta.comingSoon }
          : undefined; // delisted, or just failed/rate-limited this time
      } catch {
        partial[i] = undefined;
      }
      if (panelGame() === game) renderPanelBody(game); // stream this entry in as soon as it resolves
    }));
    game.dlc = partial.filter((d): d is DlcEntry => d != null);
  } catch {
    game.dlc = game.dlc ?? null; // leave the card's body empty rather than surfacing an error for a non-essential feature
  } finally {
    game.dlcLoading = false;
    game.dlcPartial = undefined;
    if (panelGame() === game) renderPanelBody(game); // no-op if the panel moved on mid-fetch
  }
}

// Clicking a DLC entry in the expanded card (see DlcSection), or the "Part of <Base Game>"
// link (see BaseGameLink) — same relationship walked in opposite directions, so both push the
// game being left onto panelHistory, then hand off to the host's own "open this appid"
// mechanism (the same one backing the "look up any game" search box), just told to keep the
// history stack instead of starting a fresh one. `name` is the target's already-known name
// (from the just-fetched DLC list, or from `fullgame` on the current game's own metadata),
// passed through purely to avoid a title flash while the host's own fetch is in flight, same
// convention as gameSearch.ts's onSelect.
function navigateToGame(appid: number, name: string) {
  const game = panelGame();
  if (!game || !panelOptions.onNavigateGame) return;
  // If the target is whatever's already sitting on top of the stack, this is a
  // there-and-back-again hop (e.g. base game → DLC → the same base game's own "Part of"
  // link) reached via a forward link rather than the explicit ← Back button — collapse it
  // by popping instead of pushing, so bouncing between a base game and its DLC entries
  // doesn't grow a stack of duplicate consecutive appids.
  const hist = panelHistory();
  if (hist.length && hist[hist.length - 1].appid === appid) {
    setPanelHistory(hist.slice(0, -1));
  } else {
    setPanelHistory([...hist, { appid: game.appid, name: game.name }]);
  }
  panelOptions.onNavigateGame(appid, name);
}

// The header's "← Back" button (see renderPanelBody) — pops the trail and reopens whatever
// was on top the same way navigateToGame opens a DLC/base-game link, just in the other
// direction. Popping before calling onNavigateGame (rather than after) means the callback
// only ever needs to know "keep whatever's left in the stack", identical in both directions.
function panelGoBack() {
  const hist = panelHistory();
  if (!hist.length || !panelOptions.onNavigateGame) return;
  const prev = hist[hist.length - 1];
  setPanelHistory(hist.slice(0, -1));
  panelOptions.onNavigateGame(prev.appid, prev.name);
}

function getPanelItems() {
  // Callers all check panelGame() first.
  const g = panelGame()!;
  return buildMediaItems(g.appid, g.details?.meta);
}

// dir: -1 (previous) or 1 (next). wrap: true for keyboard arrow navigation
// (cycles through all media), false for the hero prev/next buttons (clamps
// at the ends — the next button is disabled once heroIdx is at the last item).
export function panelStepHero(dir: number, { wrap = false } = {}) {
  if (!panelGame()) return false;
  const items = getPanelItems();
  if (wrap) {
    if (items.length <= 1) return false;
    setHeroIdx((heroIdx() + dir + items.length) % items.length);
  } else {
    setHeroIdx(Math.max(0, heroIdx() + dir));
  }
  if (wrap) (document.getElementById('panel-hero')?.querySelector('.panel-hero-img') as HTMLElement | null)?.focus();
  return true;
}

// `keepHistory`: true only when this open is a DLC/base-game navigation hop (forward via
// navigateToGame, or backward via panelGoBack) — every other opener (table row, search pick,
// prev/next/random) leaves it false, which starts a fresh browsing trail.
export function panelOpen(game: Game, { keepHistory = false } = {}) {
  if (!keepHistory) setPanelHistory([]);
  setPanelGame(game);
  setHeroIdx(0);
  setMoreLinksOpen(false);
  panelPrevFocus = document.activeElement as HTMLElement | null;
  document.getElementById('panel-body')!.scrollTop = 0;
  loadNews(game); // no-op (see loadNews) if this game's news was already fetched this session
  loadPrice(game); // no-op (see loadPrice) if this game is priced by the host, or already loaded
  document.getElementById('game-panel')!.classList.add('open');
  document.getElementById('panel-backdrop')!.classList.add('open');
  if (panelOptions.inertSelector) {
    const el = document.querySelector(panelOptions.inertSelector);
    if (el) (el as HTMLElement & { inert: boolean }).inert = true;
  }
  ((document.getElementById('panel-hero')?.querySelector('.panel-hero-img') ?? document.getElementById('panel-close')!) as HTMLElement).focus();
}

// `preserveUrl`: threaded through to `onClose` unchanged — for a host that clears
// `?game=`/`&shot=` there, this lets a caller that's about to reopen the same game right
// after (e.g. a forced-refresh reload) close the panel's DOM state without losing the
// deep link it'll restore from once the reload completes. Not used by the backdrop
// click/× button/swipe paths below, which always want the default (URL cleared).
export function panelClose({ preserveUrl = false } = {}) {
  if (!panelGame()) return;
  setPanelGame(null);
  setPanelHistory([]); // closing the panel ends whatever DLC browsing trail was in progress
  document.getElementById('game-panel')!.classList.remove('open');
  document.getElementById('panel-backdrop')!.classList.remove('open');
  if (panelOptions.inertSelector) {
    const el = document.querySelector(panelOptions.inertSelector);
    if (el) (el as HTMLElement & { inert: boolean }).inert = false;
  }
  document.getElementById('panel-nav')?.replaceChildren();
  panelPrevFocus?.focus();
  panelPrevFocus = null;
  // Every close path funnels through here — the backdrop click and × button are bound
  // straight to this function (see initPanel above), and swipe-to-close calls it directly
  // too — so this is the one place host-specific close cleanup (clearing `?game=`/`&shot=`
  // from the URL, resetting the host's own "active game" state) can hook in without every
  // host having to remember to wrap all of those paths itself.
  panelOptions.onClose?.({ preserveUrl });
}

// Bumps `revision` — the "a host page mutated this game object's fields directly, please
// re-read them" notify step (see this file's own header comment for the full reasoning).
// Still exported under its original name/signature: every existing call site across all
// three host pages (`row.field = x; renderPanelBody(row)`) is unchanged.
export function renderPanelBody(_game: Game) {
  setRevision(r => r + 1);
}

// Scrolls #panel-body so `target` (a section id, or the literal 'top') sits just below the
// sticky title/subnav header, rather than under it. Computed via getBoundingClientRect()
// deltas (viewport-relative, so it's correct regardless of #panel-body's own positioning
// context) rather than offsetTop, which is relative to the nearest *positioned* ancestor —
// here that's #game-panel (position: fixed), not #panel-body itself, so offsetTop would
// include the hero/hero-filmstrip height above the header and land short.
function jumpToPanelSection(target: string) {
  const body = document.getElementById('panel-body')!;
  if (target === 'top') { body.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  const el = document.getElementById(target);
  if (!el) return;
  const headerH = document.querySelector('.panel-header-sticky')?.getBoundingClientRect().height ?? 0;
  const delta = el.getBoundingClientRect().top - body.getBoundingClientRect().top - headerH - 8;
  body.scrollTo({ top: body.scrollTop + delta, behavior: 'smooth' });
}

// ProtonDB's community-reported Linux/Steam Deck compatibility tiers, worst to best.
// Colors are our own (not scraped from protondb.com), just distinct + dark enough for
// white badge text: red (unplayable) through gold/platinum (flawless) plus a green
// "native" tier for games with an actual Linux port (no Proton layer needed at all).
// Tier names themselves come straight from ProtonDB's API (see lib/steam.js) and are
// already human-readable words — capitalized for display, not remapped through a label
// table, so a new tier ProtonDB introduces still renders (just without a custom color).
// No "pending" entry — extractProtonDb (lib/steam.js) maps a "pending" (too-few-reports)
// result to its own provisionalTier before it ever reaches the client, flagged `pd.pending`
// (see GlanceGrid below) so it can still be shown, just visibly marked low-confidence rather
// than presented as equal to a confirmed tier of the same name.
const PROTON_TIER_COLORS: Record<string, string> = {
  borked: '#b91c1c', bronze: '#8b4513', silver: '#757575', gold: '#b8860b',
  platinum: '#5b6b85', native: '#15803d',
};
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// Compact review-count suffix for the reviews line, e.g. 465234 -> "465k", 2100000 -> "2.1m".
function fmtCompactCount(n: number) {
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
type TagKind = keyof typeof TAG_KIND_META;
const TAG_KIND_META = {
  tags: { label: 'Tag', color: '#d97757' },
  genres: { label: 'Genre', color: '#66c0f4' },
  categories: { label: 'Category', color: '#66c04f' },
  devpub: { label: 'Developer/Publisher', color: '#b892d6' },
};

function TagCloud(props: { groups: { kind: TagKind; dim: string | null; items?: string[] | null }[] }): JSX.Element {
  const present = props.groups.filter(gr => gr.items?.length);
  if (!present.length) return null;
  const seenKinds = new Set<TagKind>();
  const pills = present.flatMap(({ kind, dim, items }) => {
    const values = kind === 'tags' ? [...items!] : [...items!].sort((a, b) => a.localeCompare(b));
    seenKinds.add(kind);
    return values.map(v => ({ kind, dim, v }));
  });
  return (
    <div class="panel-section panel-section--meta panel-card">
      <div class="panel-section-title">Tags &amp; details</div>
      <div class="panel-tags">
        <For each={pills}>
          {({ kind, dim, v }) => {
            const dot = <span class="panel-tag-dot" style={{ background: TAG_KIND_META[kind].color }} />;
            if (dim) {
              const active = panelOptions.isTagActive?.(dim, v);
              return (
                <button class={`panel-tag panel-tag-btn${active ? ' active' : ''}`} onClick={() => panelOptions.onTagClick?.(dim, v)}>
                  {dot}{v}
                </button>
              );
            }
            return <span class="panel-tag">{dot}{v}</span>;
          }}
        </For>
      </div>
      <div class="panel-tag-legend">
        <For each={[...seenKinds]}>
          {k => (
            <span class="panel-tag-legend-item">
              <span class="panel-tag-dot" style={{ background: TAG_KIND_META[k].color }} />{TAG_KIND_META[k].label}
            </span>
          )}
        </For>
      </div>
    </div>
  );
}

// The glance strip: a fixed 2×2 grid (Weighted Rating+Metacritic, then HLTB+Linux/Deck) —
// every chip built from one template (a value, then a one-line caption) so the four
// read as one family. Each chip IS the link to its source; there's no separate
// "Links" section duplicating them. Only *evaluative* values (the two scores, the
// Linux/Deck tier) get semantic color — HLTB is a plain duration, not a judgment,
// so it stays neutral ink.
// `faded`: for a value that's a real tier/score but a low-confidence one (currently only
// ProtonDB's provisional-tier case below) — dims the whole chip so it doesn't read as equally
// certain as a normal chip of the same color/value.
function GlanceChip(props: { href?: string | null; value: string | number | null; color?: string | null; caption: JSX.Element; faded?: boolean }): JSX.Element {
  const inner = (
    <span class="panel-glance-sub">
      <span class="panel-glance-num" style={props.color ? { color: props.color } : undefined}>{String(props.value)}</span>
      <span class="panel-glance-val">{props.caption}</span>
    </span>
  );
  const style = props.faded ? { opacity: .65 } : undefined;
  return props.href
    ? <a class="panel-glance-chip" href={props.href} target="_blank" rel="noopener" style={style}>{inner}</a>
    : <div class="panel-glance-chip panel-glance-chip--static" style={style}>{inner}</div>;
}

function GlanceGrid(props: { game: Game }): JSX.Element {
  const g = props.game;
  if (g.loading) {
    return (
      <div class="panel-glance">
        <For each={[0, 1, 2, 3]}>
          {() => <div class="panel-glance-chip panel-glance-chip--sk"><span class="sk" style={{ width: '100%', height: '32px', 'border-radius': '6px' }} /></div>}
        </For>
      </div>
    );
  }
  if (!g.details) return null;
  const r = g.details.rating;
  const mc = g.details.meta?.metacritic;
  const h = g.details.hltb;
  const pd = g.details.protondb;
  const reviewsUrl = `https://store.steampowered.com/app/${g.appid}/#app_reviews_hash`;
  const protondbUrl = `https://www.protondb.com/app/${g.appid}`;

  // Every chip stays in the grid even when its source has no data for this game —
  // a missing weighted rating or ProtonDB tier is itself informative, and a chip that
  // vanishes instead makes the 2×2 grid reflow into a lopsided 3-chip layout. Each
  // still links out where a useful destination exists, same as the HLTB search fallback.
  // The link points at the game's Steam reviews (the actual source of the underlying
  // data) rather than SteamDB, since the number/caption is this app's own weighted
  // rating, not SteamDB's.
  let ratingChip: JSX.Element;
  if (r) {
    const pct = r.total ? Math.round(r.positive / r.total * 100) : 0;
    const steamdbRating = Math.round(computeSteamdbRating(r.positive, r.total) ?? 0);
    ratingChip = <GlanceChip href={reviewsUrl} value={steamdbRating} color={scoreColor(steamdbRating)} caption={<><b>Weighted</b> · {pct}% of {fmtCompactCount(r.total)}</>} />;
  } else {
    ratingChip = <GlanceChip href={reviewsUrl} value="—" caption={<><b>Weighted</b> · no rating</>} />;
  }

  const mcChip = mc
    ? <GlanceChip href={mc.url} value={mc.score} color={scoreColor(mc.score)} caption={<><b>Metacritic</b> · critic score</>} />
    : <GlanceChip value="—" caption={<><b>Metacritic</b> · no score</>} />;

  let hltbChip: JSX.Element;
  if (h?.id) {
    // A matched HLTB entry can still have no submitted completion times (all: null,
    // e.g. a very new/obscure game) — that's a real page with no data, not a failed
    // search, so it still links straight to the page rather than a generic search.
    const hltbUrl = `https://howlongtobeat.com/game/${h.id}`;
    hltbChip = h.all
      ? <GlanceChip href={hltbUrl} value={`${h.all}h`} caption={<><b>HLTB</b> · all playstyles</>} />
      : <GlanceChip href={hltbUrl} value="—" caption={<><b>HLTB</b> · no data</>} />;
  } else {
    hltbChip = <GlanceChip href={`https://howlongtobeat.com/?q=${encodeURIComponent(g.name)}`} value="—" caption={<><b>HLTB</b> · search</>} />;
  }

  let protonChip: JSX.Element;
  if (pd?.tier) {
    const color = PROTON_TIER_COLORS[pd.tier] || '#52525b';
    // Kept short (no "reports"/"confidence" words) — the glance chip's one-line caption
    // truncates rather than wraps, and "strong · 336" already reads fine without them.
    const detail = [pd.confidence, pd.total ? fmtCompactCount(pd.total) : ''].filter(Boolean).join(' · ');
    // pd.pending: too few reports for ProtonDB itself to be confident, showing its
    // provisionalTier instead of nothing (see extractProtonDb, lib/steam.js) — faded, with a
    // "?" and a "provisional" caption suffix, so it doesn't read as an equally-confirmed tier.
    const value = pd.pending ? `${capitalize(pd.tier)} ?` : capitalize(pd.tier);
    protonChip = <GlanceChip href={protondbUrl} value={value} color={color} faded={pd.pending} caption={<><b>Linux/Deck</b>{detail ? ` · ${detail}` : ''}{pd.pending ? ' · provisional' : ''}</>} />;
  } else {
    protonChip = <GlanceChip href={protondbUrl} value="—" caption={<><b>Linux/Deck</b> · no reports</>} />;
  }

  return <div class="panel-glance">{ratingChip}{mcChip}{hltbChip}{protonChip}</div>;
}

// Which collapsible sections (HLTB breakdown, news, achievements — anything built with
// CollapsibleCard() below) are expanded, keyed `${appid}:${section}` so each game/section
// pair remembers its own choice independently, and which individual hidden achievements
// have been click-revealed (keyed `${appid}:${apiname}`). Re-opening a game later in the
// same session remembers prior choices; never cleared (a handful of strings per game
// touched is negligible, and a page reload resets it anyway). Real Solid signals now (each
// holding a Set, replaced wholesale on every toggle) rather than plain module-level Sets, so
// a CollapsibleCard's own expanded/collapsed chevron reacts on its own without an external
// renderPanelBody() bump.
const [expandedSections, setExpandedSections] = createSignal<Set<string>>(new Set());
const [revealedAchievements, setRevealedAchievements] = createSignal<Set<string>>(new Set());
// Which achievement list filter ('all' | 'unlocked' | 'locked') each game is currently
// showing — same per-appid, never-cleared-this-session shape as expandedSections above.
// Defaults to 'all' (map lookup miss) for any appid never touched.
const [achievementsFilter, setAchievementsFilter] = createSignal<Map<number, string>>(new Map());

function isSectionExpanded(appid: number, section: string) { return expandedSections().has(`${appid}:${section}`); }

function toggleSection(appid: number, section: string) {
  const key = `${appid}:${section}`;
  const wasExpanded = expandedSections().has(key);
  const next = new Set(expandedSections());
  if (wasExpanded) next.delete(key); else next.add(key);
  setExpandedSections(next);
  // DLC is the one collapsible card whose contents aren't already loaded by the time it's
  // rendered (news/achievements are fetched as soon as the panel opens, whether or not
  // their card ever gets expanded) — see loadDlc's own comment for why. Kick the fetch off
  // only on the first actual expand, and only for the game the chip belongs to (a stale
  // click on a chip from a re-render that's already moved on shouldn't fetch for the wrong
  // game — matching the currently open game, not just any appid, guards that).
  const game = panelGame();
  if (!wasExpanded && section === 'dlc' && game?.appid === appid) loadDlc(game);
}

// Shared "one card, expand-in-place" shape used by HLTB breakdown, news, and achievements:
// a full-width chip (glance-grid numeral + caption, same template as GlanceChip) as the
// header/toggle, an optional icon-link out to the source, and a divided list below once
// expanded. Kept as one component so the three sections read as one visual family instead
// of three near-identical hand-rolled blocks that drift apart over time.
// `numHtml` is optional — HLTB's breakdown has no single number that isn't either
// misleading (an arbitrary pick among Main/Extra/Completionist) or a plain repeat of the
// glance strip's own "All PlayStyles" figure, so it renders as a plain text-only teaser
// instead of forcing a numeral into a slot where one doesn't actually fit. `icon` fills
// that same leading slot instead, for a card with no num at all (HLTB, News) — without
// it, those two rows read as plain text next to achievements' bold colored percentage,
// losing the "one visual family" look this whole shape is meant to have.
function CollapsibleCard(props: {
  appid: number; section: string;
  num?: JSX.Element; numColor?: string | null; icon?: string;
  val: JSX.Element; body: JSX.Element;
  linkHref?: string | null; linkTitle: string;
}): JSX.Element {
  const expanded = () => isSectionExpanded(props.appid, props.section);
  const numSpan = props.num != null
    ? <span class="panel-glance-num" style={props.numColor ? { color: props.numColor } : undefined}>{props.num}</span>
    : props.icon ? <span class="panel-achievements-icon">{props.icon}</span> : null;
  return (
    <div class="panel-achievements-card">
      <div class="panel-achievements-card-header">
        <button type="button" class="panel-achievements-chip panel-collapsible-chip" aria-expanded={expanded() ? 'true' : 'false'} onClick={() => toggleSection(props.appid, props.section)}>
          {numSpan}
          <span class="panel-glance-val">{props.val}</span>
          <span class="panel-achievements-chevron">{expanded() ? '▾' : '▸'}</span>
        </button>
        <Show when={props.linkHref}>
          {href => <a class="panel-icon-link" href={href()} target="_blank" rel="noopener" title={props.linkTitle} aria-label={props.linkTitle}>↗</a>}
        </Show>
      </div>
      <Show when={expanded()}>
        <div class="panel-achievements-list">{props.body}</div>
      </Show>
    </div>
  );
}

// Steam's own percent strings already carry a decimal (e.g. "80.9"), but round numbers
// parse to a plain integer (100 from "100.0") — toFixed(1) on those would print "100.0%",
// so only force the decimal when the value isn't already a whole number.
function fmtRarity(pct: number) {
  return `${Number.isInteger(pct) ? pct : pct.toFixed(1)}%`;
}

function revealAchievement(appid: number, apiname: string) {
  const next = new Set(revealedAchievements());
  next.add(`${appid}:${apiname}`);
  setRevealedAchievements(next);
}

function setAchievementsFilterFor(appid: number, filter: string) {
  const next = new Map(achievementsFilter());
  next.set(appid, filter);
  setAchievementsFilter(next);
}

// Achievements section — opt-in via panelOptions.showAchievements (only the Library
// Explorer sets it; the comparison page's groups have no single well-defined "player" to
// fetch progress for). `g.achievements` is loaded and attached by the host page itself
// (library.ts), asynchronously and separately from the rating/HLTB/tags SSE stream, since
// the achievement *list* only depends on the appid but progress depends on which account(s)
// are currently loaded — `g` carries `achievementsLoading` while that fetch is in flight,
// then either `achievements` (the server's `{ achievements, total, unlocked, private,
// playerCount, steamUrl }` shape) or nothing at all (fetch never ran/failed). The list itself
// is still fetched and shown with zero accounts loaded (`playerCount: 0`, no `steamUrl`) —
// only the achieved/unlocktime/progress-summary parts need an account, gated by `hasProgress`
// below.
function AchievementsSection(props: { game: Game }): JSX.Element {
  const g = props.game;
  if (!panelOptions.showAchievements) return null;
  if (g.achievementsLoading) {
    return (
      <div class="panel-section" id="panel-section-achievements">
        <div class="panel-section-title">Achievements</div>
        <div class="panel-achievements"><span class="sk" style={{ width: '100%', height: '48px', 'border-radius': '6px' }} /></div>
      </div>
    );
  }
  const data = g.achievements;
  // `undefined` means the fetch hasn't been attempted (or finished) yet — nothing to show
  // and no failure to report either, so stay silent same as before. `null` (see library.ts's
  // loadAchievements) means it was attempted and failed — that's worth a visible message
  // rather than silently looking identical to a game with no achievements at all.
  if (data === undefined) return null;
  if (data === null) {
    return (
      <div class="panel-section" id="panel-section-achievements">
        <div class="panel-section-title">Achievements</div>
        <div class="panel-no-data">Couldn't load achievements.</div>
      </div>
    );
  }
  if (!data.total) {
    return (
      <div class="panel-section" id="panel-section-achievements">
        <div class="panel-section-title">Achievements</div>
        <div class="panel-no-data">This game has no achievements.</div>
      </div>
    );
  }
  // With no player loaded (data.playerCount === 0 — a standalone "look up any game" lookup,
  // see loadAchievements in library.ts), `data.unlocked` is always 0 by construction, not a
  // real "nobody's unlocked anything" result — the list itself (names/descriptions/icons/
  // rarity) is still real store metadata worth showing, just without any progress claim on
  // top of it. `hasProgress` gates every place that would otherwise imply real unlock data.
  const hasProgress = data.playerCount > 0;
  const pct = hasProgress ? Math.round((data.unlocked / data.total) * 100) : null;

  // Sorted once per fetch and cached on the data object itself (a fresh object every
  // fetch/refresh, so this never goes stale) rather than re-sorting the full list on every
  // render.
  const sorted = data._sortedAchievements ??= data.achievements
    .slice()
    .sort((a, b) => Number(b.achieved) - Number(a.achieved));
  // 'unlocked'/'locked' only make sense with real progress loaded — filtering by achieved
  // status when nobody's loaded would just be "everything" vs. "nothing" either way.
  // Both kept as reactive accessors, not resolved to plain values here: `bodyContent` below is
  // a plain JSX value built once per AchievementsSection call, so `achievementsFilter()` has to
  // be read from directly inside a JSX `{}` expression (via these) to be tracked at all — same
  // reasoning as PanelBody's own comment on `moreLinksOpen`/`revealedAchievements`. `createMemo`
  // rather than a bare thunk since `visible()` is read from two separate JSX spots below (the
  // `<Show>` and the `<For>`) in the same render — a memo shares one `sorted.filter()` pass
  // across both instead of each read re-running it.
  const filter = createMemo(() => hasProgress ? (achievementsFilter().get(g.appid) || 'all') : 'all');
  const visible = createMemo(() => { const f = filter(); return f === 'all' ? sorted : sorted.filter(a => (f === 'unlocked') === !!a.achieved); });

  const bodyContent = (
    <>
      <Show when={hasProgress}>
        <div class="panel-achievements-filter">
          <For each={['all', 'unlocked', 'locked']}>
            {f => <button type="button" class={`panel-achievements-filter-btn${filter() === f ? ' active' : ''}`} onClick={() => setAchievementsFilterFor(g.appid, f)}>{f === 'all' ? 'All' : f === 'unlocked' ? 'Unlocked' : 'Locked'}</button>}
          </For>
        </div>
      </Show>
      <Show when={!hasProgress}><div class="panel-no-data">Load a player above to see who's unlocked what.</div></Show>
      <Show when={hasProgress && data.private}><div class="panel-no-data">Progress unavailable — profile may be private.</div></Show>
      <Show when={!visible().length}><div class="panel-no-data">No achievements match this filter.</div></Show>
      <For each={visible()}>
        {(a: any) => {
          // A hidden achievement not yet unlocked keeps its name/description a surprise by
          // default, same as Steam's own profile pages — the schema still carries the real
          // text either way (whether it's still a spoiler depends on which account(s) are
          // loaded, not on the shared/cached schema), this just withholds it client-side
          // until clicked, rather than never sending it at all.
          const revealed = () => revealedAchievements().has(`${g.appid}:${a.apiname}`);
          const spoiler = () => a.hidden && !a.achieved && !revealed();
          const name = () => spoiler() ? 'Hidden achievement' : (a.name || a.apiname);
          const desc = () => spoiler() ? 'Click to reveal' : (a.description || '');
          const icon = a.achieved ? a.icon : (a.icongray || a.icon);
          // Unlock date is real data the server already returns (`unlocktime`, seconds since
          // epoch) but otherwise has nowhere to show — surfaced as a plain hover tooltip
          // rather than a fifth line of on-card text.
          const title = a.achieved && a.unlocktime ? `Unlocked ${fmtLastPlayed(a.unlocktime)}` : '';
          // Rarity isn't a spoiler — it's shown even for a still-hidden achievement, same as
          // Steam's own profile pages. Fixed to 1 decimal only when it's not a whole number.
          const rarityLabel = a.globalPct == null ? null : fmtRarity(a.globalPct);
          const onSpoilerActivate = (e: MouseEvent | KeyboardEvent) => { if (spoiler()) { e.preventDefault(); revealAchievement(g.appid, a.apiname); } };
          return (
            <div
              class={`panel-achievement-row${a.achieved ? ' unlocked' : ''}${spoiler() ? ' panel-achievement--spoiler' : ''}`}
              title={title || undefined}
              role={spoiler() ? 'button' : undefined}
              tabIndex={spoiler() ? 0 : undefined}
              onClick={onSpoilerActivate}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onSpoilerActivate(e); }}
            >
              <img class="panel-achievement-icon" src={icon} alt="" loading="lazy" />
              <div class="panel-achievement-text">
                <div class="panel-achievement-name">{name()}</div>
                <Show when={desc()}>{d => <div class="panel-achievement-desc">{d()}</div>}</Show>
              </div>
              <Show when={rarityLabel != null}>
                <div class="panel-achievement-rarity" title={`${rarityLabel} of players have unlocked this`}>{rarityLabel}</div>
              </Show>
            </div>
          );
        }}
      </For>
    </>
  );

  return (
    <div class="panel-section" id="panel-section-achievements">
      <CollapsibleCard
        appid={g.appid}
        section="achievements"
        num={hasProgress ? `${pct}%` : '—'}
        numColor={hasProgress ? scoreColor(pct!) : null}
        val={<><b>Achievements</b> · {hasProgress ? `${data.unlocked} / ${data.total} unlocked` : `${data.total} total`}</>}
        body={bodyContent}
        linkHref={data.steamUrl}
        linkTitle="View achievements on Steam"
      />
    </div>
  );
}

// Recent news/announcements (patch notes, event posts) — a handful of headlines, each
// linking straight to the full post, plus a link to the game's full news hub on the Steam
// store for anything older than what's shown here. Dates use the same plain-ISO convention
// as fmtLastPlayed/the table's date columns rather than a relative "3 days ago" string.
function NewsSection(props: { game: Game }): JSX.Element {
  const g = props.game;
  if (g.newsLoading) {
    return (
      <div class="panel-section" id="panel-section-news">
        <div class="panel-section-title">News</div>
        <span class="sk" style={{ display: 'block', width: '100%', height: '48px', 'border-radius': '6px' }} />
      </div>
    );
  }
  const items = g.news;
  // `newsError` with nothing to fall back on (no prior successful load) is worth a visible
  // message rather than silently looking identical to a game with no news at all.
  if (g.newsError && !items) {
    return (
      <div class="panel-section" id="panel-section-news">
        <div class="panel-section-title">News</div>
        <div class="panel-no-data">Couldn't load news.</div>
      </div>
    );
  }
  if (!items || !items.length) return null;
  return (
    <div class="panel-section" id="panel-section-news">
      <CollapsibleCard
        appid={g.appid}
        section="news"
        icon="📰"
        // Spelling out "more on Steam" here (not just relying on the ↗ icon's title tooltip)
        // makes it explicit that this list is a preview, not the full history.
        val={<><b>News</b> · more on Steam</>}
        body={
          <div class="panel-collapsible-body-pad">
            <div class="panel-news">
              <For each={items}>
                {n => (
                  <a class="panel-news-item" href={safeHref(n.url) || undefined} target="_blank" rel="noopener">
                    <span class="panel-news-title">{n.title}</span>
                    <span class="panel-news-meta">{fmtLastPlayed(n.date)}{n.feedLabel ? ` · ${n.feedLabel}` : ''}</span>
                  </a>
                )}
              </For>
            </div>
          </div>
        }
        linkHref={`https://store.steampowered.com/news/app/${g.appid}`}
        linkTitle="View all news on Steam"
      />
    </div>
  );
}

// Price info — a single always-open card (no chip grid, no collapsible secondary numbers):
// the current best deal (same display/color/badge/tooltip as the Best Deal table cell in
// bundles.tsx/library.ts), its discount off Steam Full Price when there is one, a direct link
// to the shop itself, and a link to the game's ITAD page for the fuller picture (historical
// lows, every other shop) this card deliberately leaves out. See the original panel.ts's own
// (much longer) header comment — preserved in git history — for the full "where do these
// numbers come from" reasoning; unchanged by this conversion.
function PriceSection(props: { game: Game }): JSX.Element {
  const g = props.game;
  if (g.priceLoading) {
    return (
      <div class="panel-section panel-card" id="panel-section-price">
        <div class="panel-section-title">Price</div>
        <span class="sk" style={{ display: 'block', width: '100%', height: '32px', 'border-radius': '6px' }} />
      </div>
    );
  }
  if (g.bestDealPrice === undefined) return null; // never priced (or not loaded yet)

  const itadUrl = `https://isthereanydeal.com/steam/app/${g.appid}`;
  const titleEl = <div class="panel-section-title">Price <a href={itadUrl} target="_blank" rel="noopener">IsThereAnyDeal ↗</a></div>;

  if (g.bestDealPrice == null) {
    return <div class="panel-section panel-card" id="panel-section-price">{titleEl}<div class="panel-no-data">No pricing data available.</div></div>;
  }

  // dealRecordTier (public/utils.ts) is the single shared source of this tier/color/icon logic.
  const rec = dealRecordTier(g.bestDealPrice, g);
  const color = rec ? rec.color : null;
  const boldStyle = rec?.bold ? { 'font-weight': 700 } : {};
  const badge = rec ? ' ' + rec.icon : '';
  const tooltip = g.bestDealShop ? `${g.bestDealShop}${rec ? ` — ${rec.tooltipLabel}` : ''}` : '';

  // `0` (the best deal genuinely isn't any cheaper than Steam) is treated the same as `null`/
  // undefined (no discount to show) — "if any" per the spec, not a flat "-0%" reading as noise.
  const discountEl = g.bestDealCut
    ? <><span class="panel-price-sep">·</span><span class="panel-price-discount">-{g.bestDealCut}%</span></>
    : null;

  // The shop name, and — unlike the table cell, which stays tooltip-only since it's
  // space-constrained — the *whole rest of the card* doubles as the buy link (see the
  // original file's own comment, preserved in git history, for the full reasoning).
  const shopUrl = safeHref(g.bestDealUrl);
  const shopEl = g.bestDealShop
    ? <><span class="panel-price-sep">·</span><span class="panel-price-shop">{shopUrl ? 'Buy at ' : 'at '}{g.bestDealShop}{shopUrl ? ' ↗' : ''}</span></>
    : null;
  const lineInner = (
    <>
      <span class="panel-price-amount" style={{ ...(color ? { color } : {}), ...boldStyle }}>{formatMoney(g.bestDealPrice, g.priceCurrency)}{badge}</span>
      {discountEl}
      {shopEl}
    </>
  );
  const lineEl = shopUrl
    ? <a class="panel-price-line panel-price-line--link" href={shopUrl} target="_blank" rel="noopener" title={tooltip || undefined}>{lineInner}</a>
    : <div class="panel-price-line" title={tooltip || undefined}>{lineInner}</div>;

  // Historical lows (all-time/1yr/3mo) — see the original file's own (much longer) comment,
  // preserved in git history, for the full "why collapse equal-amount tiers" reasoning.
  const presentTiers = [...DEAL_RECORD_TIERS].reverse().filter(t => (g as any)[t.low] != null && (g as any)[t.low] !== g.bestDealPrice);
  const lowGroups: { amount: number; tiers: typeof DEAL_RECORD_TIERS[number][] }[] = [];
  for (const t of presentTiers) {
    const amount = (g as any)[t.low] as number; // filtered non-null above
    const last = lowGroups[lowGroups.length - 1];
    if (last && last.amount === amount) last.tiers.unshift(t);
    else lowGroups.push({ amount, tiers: [t] });
  }

  return (
    <div class="panel-section panel-card" id="panel-section-price">
      {titleEl}
      {lineEl}
      <Show when={lowGroups.length}>
        <div class="panel-price-lows">
          <For each={lowGroups}>
            {({ amount, tiers }, i) => {
              const icons = tiers.map(t => t.icon).join('');
              const label = tiers.map(t => t.statusLabel).join(' / ');
              const lowColor = tiers[0].color; // rarest tier in the group leads the color too
              return (
                <>
                  <Show when={i() > 0}><span class="panel-price-sep">·</span></Show>
                  <span class="panel-price-low" title={`${label}: ${formatMoney(amount, g.priceCurrency)}`} style={{ color: lowColor }}>{formatMoney(amount, g.priceCurrency)} {icons}</span>
                </>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
}

// "Part of <Base Game>" — the reverse of the DLC card below: present only when the
// currently open game is itself a piece of DLC (`meta.fullgame`, free on the same
// appdetails response, see extractAppDetails in lib/steam.js). Same real-`<a href>` /
// intercepted-click treatment as a DLC entry, just walking the base-game/DLC relationship
// in the other direction via the same navigateToGame.
function BaseGameLink(props: { game: Game }): JSX.Element {
  const fg = props.game.details?.meta?.fullgame;
  if (!fg) return null;
  const onClick = (e: MouseEvent) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigateToGame(fg.appid, fg.name || '');
  };
  return <>DLC for <a class="panel-basegame-link" href={panelOptions.gameHref?.(fg.appid) ?? '#'} onClick={onClick}>{fg.name || `App ${fg.appid}`}</a></>;
}

// DLC — a base game's downloadable content, collapsed by default (see loadDlc above for
// why it's the one card whose body isn't already loaded by render time). The collapsed
// header's count comes straight from `meta.dlc` (the bare appid list, free — see
// extractAppDetails in lib/steam.js) so it's shown immediately even before the card is ever
// expanded; only the expanded body's names/capsules depend on the lazy fetch. Each entry is
// a real `<a href>` (panelOptions.gameHref, host-supplied so the URL matches whichever page
// this is) rather than a plain button, so ctrl/cmd/shift-click and middle-click open it in a
// new tab the normal way — a plain click navigates within this panel instead via
// navigateToGame.
function sortDlcByRelease(list: DlcEntry[]) {
  const sortKey = (d: DlcEntry) => {
    const t = d.releaseDate ? Date.parse(d.releaseDate) : NaN;
    return Number.isNaN(t) ? -Infinity : t;
  };
  return list.slice().sort((a, b) => {
    if (!!a.comingSoon !== !!b.comingSoon) return a.comingSoon ? -1 : 1;
    return sortKey(b) - sortKey(a);
  });
}

function DlcItem(props: { d: DlcEntry }): JSX.Element {
  const onClick = (e: MouseEvent) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigateToGame(props.d.appid, props.d.name);
  };
  return (
    <a class="panel-dlc-item" href={panelOptions.gameHref?.(props.d.appid) ?? '#'} onClick={onClick}>
      <img class="panel-dlc-capsule" src={props.d.capsule} alt="" loading="lazy" />
      <span class="panel-dlc-name">{props.d.name}</span>
    </a>
  );
}

function DlcSection(props: { game: Game }): JSX.Element {
  const g = props.game;
  const dlcIds = g.details?.meta?.dlc;
  if (!dlcIds || !dlcIds.length) return null;

  let body: JSX.Element = <div class="panel-collapsible-body-pad"><span class="sk" style={{ display: 'block', width: '100%', height: '48px', 'border-radius': '6px' }} /></div>;
  if (g.dlcLoading) {
    // Stream in whichever entries have already resolved instead of holding the whole card on
    // its skeleton until every single one settles (see loadDlc's own comment).
    const loaded = (g.dlcPartial || []).filter((d): d is DlcEntry => d != null);
    const remaining = dlcIds.length - loaded.length;
    if (loaded.length) {
      body = (
        <div class="panel-dlc-list">
          <For each={loaded}>{d => <DlcItem d={d} />}</For>
          <Show when={remaining}>{n => <div class="panel-dlc-loading-more">Loading {n()} more…</div>}</Show>
        </div>
      );
    }
  } else if (g.dlc === null) {
    body = <div class="panel-collapsible-body-pad"><div class="panel-no-data">Couldn't load DLC details.</div></div>;
  } else if (g.dlc) {
    body = g.dlc.length
      ? <div class="panel-dlc-list"><For each={sortDlcByRelease(g.dlc)}>{d => <DlcItem d={d} />}</For></div>
      : <div class="panel-collapsible-body-pad"><div class="panel-no-data">No DLC details available.</div></div>;
  }

  return (
    <div class="panel-section" id="panel-section-dlc">
      <CollapsibleCard
        appid={g.appid}
        section="dlc"
        icon="📦"
        val={<><b>DLC</b> · {dlcIds.length} available</>}
        body={body}
        linkHref={`https://store.steampowered.com/dlc/${g.appid}/`}
        linkTitle="View all DLC on Steam"
      />
    </div>
  );
}

// ── Hero carousel ────────────────────────────────────────────────────────────
// Its own stable component (not part of the big coarse re-render below) — reading
// `panelGame()`/`heroIdx()` directly, so stepping the hero only patches the hero's own DOM
// subtree, same as the original panelStepHero → renderPanelHero's targeted `.outerHTML`
// update, just done via Solid's own fine-grained reactivity instead of a hand-rolled partial
// DOM replace.
function HeroMain(props: { items: MediaItem[] }): JSX.Element {
  const idx = () => Math.max(0, Math.min(heroIdx(), props.items.length - 1));
  const current = () => props.items[idx()];
  const name = () => panelGame()?.name ?? '';
  const isShot = () => idx() > 0;
  const hasMany = () => props.items.length > 1;
  let imgEl!: HTMLImageElement;
  const onLoad = () => imgEl.classList.remove('loading');
  // A broken image (banner guess 404ing, or — as with a video's poster — a genuinely dead
  // upstream Steam CDN asset) used to hide the whole `.panel-hero-main`, which also wiped
  // out the prev/next nav and, for videos, the play-button overlay and click target — even
  // though the video itself (or the full-res screenshot behind a broken thumb) still plays/
  // loads fine. Just mark the image broken and leave the rest of the hero working.
  const onError = () => { imgEl.classList.remove('loading'); imgEl.classList.add('panel-hero-img--broken'); };
  return (
    <div class={`panel-hero-main${current().type === 'video' ? ' is-video' : ''}`}>
      <img
        ref={imgEl}
        class={`panel-hero-img loading${isShot() ? ' panel-hero-img--shot' : ''}`}
        tabIndex={0}
        role="button"
        aria-label="Open in lightbox"
        src={current().type === 'video' ? current().thumb : current().main}
        alt={name()}
        onLoad={onLoad}
        onError={onError}
        onClick={() => { const g = panelGame(); if (g) openLightbox(g, idx()); }}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); const g = panelGame(); if (g) openLightbox(g, idx()); } }}
      />
      <Show when={hasMany()}>
        <button class="panel-hero-btn panel-hero-prev" disabled={idx() <= 0} aria-label="Previous" onClick={() => panelStepHero(-1)}>&#8249;</button>
        <button class="panel-hero-btn panel-hero-next" disabled={idx() >= props.items.length - 1} aria-label="Next" onClick={() => panelStepHero(1)}>&#8250;</button>
      </Show>
    </div>
  );
}

function PanelHero(): JSX.Element {
  // Reads `revision()` too, not just `panelGame()` — a standalone "look up any game" open
  // (or a DLC/base-game navigation hop) shows the panel immediately against a bare skeleton
  // object (`{loading: true, details: null}`), *then* asynchronously fetches and mutates that
  // *same* object once real metadata (screenshots/videos) arrives, notifying via
  // `renderPanelBody`/`revision` — not a new `panelGame()` reference. Without reading
  // `revision()` here too, this component's own JSX expressions (the only place `items()` is
  // actually called reactively) never re-run for that case, and the hero stays stuck on
  // whatever media (often none) was available at the very first render — confirmed live.
  const items = () => { revision(); const g = panelGame(); return g ? buildMediaItems(g.appid, g.details?.meta) : []; };
  const idx = () => Math.max(0, Math.min(heroIdx(), items().length - 1));
  const hasMany = () => items().length > 1;
  let filmstripEl: HTMLDivElement | undefined;

  // Keeps the active filmstrip thumb scrolled into view whenever the hero steps — same
  // "scrollIntoView on every step, including the very first render" behavior the original
  // buildPanelHero/renderPanelHero had.
  createEffect(() => {
    heroIdx();
    filmstripEl?.querySelector('.panel-film-item.active')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  });

  // `error` doesn't bubble, so the filmstrip's broken-thumbnail fallback needs the capture
  // phase — Solid's JSX has no capture-phase prop for a plain element, so this is wired up
  // imperatively via the ref callback instead (same `addEventListener(..., true)` the
  // original file used), delegated once here (not per-<img>) since Solid already only
  // re-renders a given <img> when its own props actually change.
  const onFilmstripRef = (el: HTMLDivElement) => {
    filmstripEl = el;
    el.addEventListener('error', e => {
      const img = e.target as HTMLImageElement;
      if (!img.classList?.contains('panel-film-thumb')) return;
      const fallback = img.dataset.fallback;
      if (fallback && img.src !== fallback) { img.src = fallback; return; }
      img.classList.add('panel-film-thumb--broken');
    }, true);
  };

  return (
    <div id="panel-hero" class="panel-hero">
      <Show when={items().length}>
        <HeroMain items={items()} />
      </Show>
      <Show when={hasMany()}>
        <div class="panel-filmstrip" ref={onFilmstripRef}>
          <For each={items()}>
            {(item, i) => {
              // Screenshots have a separate full-res `main` behind the small `thumb` — if
              // the thumbnail variant 404s (a stale/broken CDN asset upstream), retrying
              // with the full-res image gives the filmstrip a second shot before giving up.
              // Videos have no such fallback, so a broken video thumb goes straight to the
              // broken-image state.
              const fallback = item.type === 'image' && item.main !== item.thumb ? item.main : '';
              return (
                <button
                  type="button"
                  class={`panel-film-item${i() === idx() ? ' active' : ''}${item.type === 'video' ? ' is-video' : ''}`}
                  aria-label={i() === 0 ? (panelGame()?.name ?? '') : (item.type === 'video' ? `Video ${i()}` : `Screenshot ${i()}`)}
                  onClick={() => setHeroIdx(i())}
                >
                  <img class="panel-film-thumb" src={item.thumb} data-fallback={fallback} alt="" loading="lazy" />
                </button>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
}

// A sticky jump-nav for the sections below the fold. Listed in the same physical
// top-to-bottom order the sections themselves appear in PanelRest's own return below
// (Owners right after the tag cloud, ahead of the collapsibles) so scroll-spy highlighting
// (see updateSubnavScrollSpy) always lights up left-to-right. Each condition mirrors its
// own *Section function's exact gating logic (loading skeleton and "couldn't load" states
// count as "has a section to jump to", same as the original file's own
// `newsSectionHtml`/`achievementsSectionHtml` non-empty-string checks — not just "has real
// content") rather than checking a rendered `<Component/>` call's own truthiness (always
// truthy regardless of what it renders to, including `null`). `hasHltb` mirrors the same
// gating PanelRest's own `hltbDetail` uses — a small, accepted duplication (see PanelRest's
// own comment on `ownersHtml`/`hltbDetail`) rather than plumbing PanelRest's *content*
// through here just to answer "does the section exist".
function getSubnavSections(g: Game): { label: string; target: string }[] {
  const h = g.details?.hltb;
  const meta = g.details?.meta;
  const hasOwners = !!panelOptions.getOwnersHtml?.(g);
  const hasHltb = !g.loading && !!h && !!(h.main || h.extra || h.completionist);
  const hasNews = !!(g.newsLoading || (g.newsError && !g.news) || (g.news && g.news.length));
  const hasAchievements = !!panelOptions.showAchievements && !!(g.achievementsLoading || g.achievements !== undefined);
  const hasDlc = !!(meta?.dlc && meta.dlc.length);
  return [
    hasOwners && { label: 'Owners', target: 'panel-section-owners' },
    hasHltb && { label: 'HLTB', target: 'panel-section-hltb' },
    hasNews && { label: 'News', target: 'panel-section-news' },
    hasAchievements && { label: 'Achievements', target: 'panel-section-achievements' },
    hasDlc && { label: 'DLC', target: 'panel-section-dlc' },
  ].filter((it): it is { label: string; target: string } => !!it);
}

// The section jump-nav, split out as its own always-mounted component (a sibling of
// PanelRest's own coarse block within PanelHeader below, not nested inside it) specifically
// so its DOM node has a lifecycle independent of `revision`/`moreLinksOpen`/`panelRefreshing`/
// `panelHistory` changing. It used to be built as plain JSX inline in PanelRest, which is
// torn down and recreated in full on every one of those — including every time an unrelated
// async section (news/achievements/price/DLC) finished loading elsewhere in the panel — which
// visibly flashed this button row's active-tab highlight off and back on each time (confirmed
// live via a MutationObserver: `.panel-subnav` was removed/re-added several times in the tens
// of milliseconds right after opening a game). Mounting it here instead, with the active tab
// itself now a signal (`activeSubnavTarget`) rather than an external classList patch, means an
// unrelated section resolving updates at most this component's own `items` memo — via `<For>`'s
// keyed diffing and `classList`, not a wholesale rebuild — while the DOM node itself never goes
// away for as long as this component instance stays mounted.
function PanelSubnav(): JSX.Element {
  const items = createMemo(() => {
    revision();
    const g = panelGame();
    return g ? getSubnavSections(g) : [];
  });

  // Reset to Overview whenever the open game itself changes (a fresh row click, prev/next/
  // random, a DLC hop) — the scroll position and active tab from whatever game was open
  // before aren't meaningful for a different one.
  createEffect(() => {
    panelGame();
    setActiveSubnavTarget('top');
  });
  // Re-run the scroll-spy whenever the section list changes (a section appearing/disappearing
  // shifts where the other anchors sit). PanelRest's own re-renders (its content growing as
  // news/achievements/etc. load in) can shift those same anchors without necessarily changing
  // *this* item list, so it also re-queues the scroll-spy itself — see PanelRest below.
  createEffect(() => {
    items();
    queueMicrotask(updateSubnavScrollSpy);
  });

  return (
    <Show when={items().length >= 2}>
      <div class="panel-subnav">
        <button type="button" class="panel-subnav-btn" classList={{ active: activeSubnavTarget() === 'top' }} data-target="top" onClick={() => jumpToPanelSection('top')}>Overview</button>
        <For each={items()}>{it => (
          <button type="button" class="panel-subnav-btn" classList={{ active: activeSubnavTarget() === it.target }} data-target={it.target} onClick={() => jumpToPanelSection(it.target)}>{it.label}</button>
        )}</For>
      </div>
    </Show>
  );
}

// The sticky header: back button, title/release-date/ownership badge, icon links, and the
// section jump-nav. Mounted once (a plain literal child of PanelBody, like PanelHero), for
// the same reason PanelSubnav above needs to be: `<PanelSubnav/>` is written here as a bare
// sibling of the coarse `{}` block below, not nested inside it, so its own component instance
// (and the signal/memo it owns) survives that block's re-renders untouched — see PanelSubnav's
// own comment for the bug this fixes. Everything else in this header has no comparable
// external-DOM-patch concern, so it stays one coarse block, same convention PanelRest below
// uses for the rest of the body.
function PanelHeader(): JSX.Element {
  return (
    <Show when={panelGame()}>
      <div class="panel-header-sticky">
        {(() => {
          const g = panelGame();
          revision(); moreLinksOpen(); panelRefreshing(); panelHistory();
          if (!g) return null;
          const meta = g.details?.meta;

          const storeUrl = `https://store.steampowered.com/app/${g.appid}`;
          const itadUrl = `https://isthereanydeal.com/steam/app/${g.appid}`;

          // Computed as a plain boolean first (not by checking the rendered element's own
          // truthiness — a `<Component/>` call is a truthy value regardless of what it
          // renders to, including `null`) so metaLine's separator and baseGameSection itself
          // can never disagree about whether there's actually a base game to show.
          const hasBaseGame = !g.loading && !!meta?.fullgame;
          const baseGameSection = hasBaseGame ? <BaseGameLink game={g} /> : null;
          // Release date and "DLC for X" folded onto one line ("<date> · DLC for X") since
          // both are short, secondary metadata about the same thing.
          const metaLine = (meta?.releaseDate || baseGameSection) ? (
            <div class="panel-release">{meta?.releaseDate}{meta?.releaseDate && baseGameSection ? <span class="panel-meta-sep"> · </span> : null}{baseGameSection}</div>
          ) : null;

          // "In library" / "On wishlist" status — passive, same convention as the Price card
          // (panel.tsx doesn't fetch anything itself; it just renders whatever the host page
          // already resolved). See the original file's own comment (preserved in git
          // history) for the full "why 'In library' not 'In your library'" reasoning.
          const ownershipRow = (g.inLibrary == null && g.onWishlist == null) ? null : (
            <div class="panel-ownership-row">
              <Show when={g.inLibrary}><span class="panel-ownership-badge owned">✓ In library</span></Show>
              <Show when={g.onWishlist}><span class="panel-ownership-badge wishlisted">☆ On wishlist</span></Show>
            </div>
          );

          // Store and ITAD are the two links everyone wants at a glance and stay directly in
          // the row — Workshop/Website are each conditional, tucked into a single "⋯ More"
          // menu instead (see the original file's own comment, preserved in git history, for
          // the full reasoning).
          const moreLinkItems = [
            !g.loading && (meta?.categories || []).includes('Steam Workshop') &&
              { icon: '🛠️', label: 'Steam Workshop', href: `https://steamcommunity.com/app/${g.appid}/workshop/` },
            meta?.website && { icon: '🌐', label: 'Official Website', href: meta.website },
            { icon: '🔎', label: 'More Like This (Steam)', href: `https://store.steampowered.com/recommended/morelike/app/${g.appid}/` },
          ].filter((it): it is { icon: string; label: string; href: string } => !!it);
          const moreLinksOpenNow = moreLinksOpen();
          const moreLinks = moreLinkItems.length ? (
            <div class="panel-icon-more">
              <button type="button" class="panel-icon-link panel-icon-more-btn" aria-haspopup="true" aria-expanded={moreLinksOpenNow ? 'true' : 'false'} title="More links" aria-label="More links" onClick={() => setMoreLinksOpen(!moreLinksOpenNow)}>⋯</button>
              <Show when={moreLinksOpenNow}>
                <div class="panel-icon-more-menu">
                  <For each={moreLinkItems}>{it => <a class="panel-icon-more-item" href={safeHref(it.href) || undefined} target="_blank" rel="noopener">{it.icon} {it.label}</a>}</For>
                </div>
              </Show>
            </div>
          ) : null;

          const refreshing = panelRefreshing();
          const refreshBtn = (panelOptions.onRefresh && !g.loading) ? (
            <button
              type="button"
              class={`panel-refresh-btn${refreshing ? ' is-refreshing' : ''}`}
              disabled={refreshing}
              title="Refresh rating, HLTB &amp; store details for this game"
              aria-label="Refresh details"
              onClick={handlePanelRefresh}
            >↻</button>
          ) : null;

          // "← Back" only appears once a DLC hop is actually in progress — a plain
          // table-row click never gets this button, only a game reached by following a DLC
          // link (or by going back through more than one of them) does.
          const hist = panelHistory();
          const backBtn = hist.length ? (
            <button type="button" class="panel-back-btn" title={`Back to ${hist[hist.length - 1].name}`} onClick={panelGoBack}>
              &#8249; {hist[hist.length - 1].name}
            </button>
          ) : null;

          return (
            <>
              {backBtn}
              <div class="panel-title-row">
                <div>
                  <div class="panel-title" id="panel-title">{g.name}</div>
                  {metaLine}
                  {ownershipRow}
                </div>
                <div class="panel-icon-links">
                  <a class="panel-icon-link" href={storeUrl} target="_blank" rel="noopener" title="Steam Store" aria-label="Steam Store">🛒</a>
                  <a class="panel-icon-link" href={itadUrl} target="_blank" rel="noopener" title="IsThereAnyDeal" aria-label="IsThereAnyDeal">$</a>
                  {moreLinks}
                  <span class="panel-icon-divider" role="separator" aria-hidden="true" />
                  <button type="button" class="panel-icon-link panel-copy-link-btn" title="Copy link to this game" aria-label="Copy link to this game" onClick={copyPanelLink}>🔗</button>
                  {refreshBtn}
                </div>
              </div>
            </>
          );
        })()}
        <PanelSubnav />
      </div>
    </Show>
  );
}

// ── The rest of the panel body ───────────────────────────────────────────────
// Unlike the hero above, this is deliberately one coarse reactive block, re-computed in
// full on every `revision`/`panelGame` change — the same "rebuild the whole thing" behavior
// the original innerHTML-based renderPanelBody had, just expressed as a fresh JSX tree each
// time instead of a fresh HTML string. The header/subnav above are the one deliberate
// exception (see their own comments for why); nothing here needs that same finer-grained
// isolation (stepping media, handled by the hero above, is by far the most frequent single
// interaction — an unrelated section loading here has no comparable external-DOM-patch or
// visible-flash concern the way the subnav's active-tab highlight did).
function PanelRest(): JSX.Element {
  const g = panelGame();
  if (!g) return null;
  const h = g.details?.hltb;
  const meta = g.details?.meta;

  const description = meta?.description;
  // `description` (Steam's `short_description`) can carry literal HTML entities as plain
  // text (e.g. "Baldur's Gate..." legitimately has "&amp;" for "Dungeons & Dragons"), and
  // JSX text interpolation doesn't decode entities on its own — decoding it inertly via a
  // DOMParser document that's never attached to the page (runs no scripts, loads no
  // resources) and then rendering the decoded *text* (never raw markup/innerHTML) is what
  // the original file did too; preserved verbatim here since JSX interpolation is already
  // exactly as safe as that plain-text insert was.
  const decodedDescription = description ? new DOMParser().parseFromString(description, 'text/html').body.textContent || '' : '';

  const ownersHtml = panelOptions.getOwnersHtml?.(g) ?? '';

  // The glance strip already carries HLTB's "All PlayStyles" number (see GlanceGrid above)
  // — this is just the fuller Main/Extra/Completionist breakdown beneath it, once, not a
  // second copy of the headline figure. Collapsed by default like achievements/news, EXCEPT
  // when `all` itself is missing — then this breakdown is the only duration data the panel
  // has at all, so hiding it behind a click would bury the one piece of HLTB info actually
  // available for this game.
  let hltbDetail: JSX.Element = null;
  if (!g.loading && h && (h.main || h.extra || h.completionist)) {
    if (!isSectionExpanded(g.appid, 'hltb') && h.all == null) {
      const next = new Set(expandedSections());
      next.add(`${g.appid}:hltb`);
      setExpandedSections(next);
    }
    const parts = [h.main && 'Main Story', h.extra && 'Main + Extra', h.completionist && 'Completionist'].filter(Boolean);
    hltbDetail = (
      <div class="panel-section" id="panel-section-hltb">
        <CollapsibleCard
          appid={g.appid}
          section="hltb"
          icon="⏱️"
          val={<><b>How Long To Beat</b> · {parts.join(', ')}</>}
          body={
            <div class="panel-collapsible-body-pad">
              <div class="panel-hltb">
                <Show when={h.main}>{v => <div class="panel-hltb-item"><div class="panel-hltb-label">Main Story</div><div class="panel-hltb-val">{fmtH(v())}</div></div>}</Show>
                <Show when={h.extra}>{v => <div class="panel-hltb-item"><div class="panel-hltb-label">Main + Extra</div><div class="panel-hltb-val">{fmtH(v())}</div></div>}</Show>
                <Show when={h.completionist}>{v => <div class="panel-hltb-item"><div class="panel-hltb-label">Completionist</div><div class="panel-hltb-val">{fmtH(v())}</div></div>}</Show>
              </div>
            </div>
          }
          linkHref={h.id ? `https://howlongtobeat.com/game/${h.id}` : null}
          linkTitle="View on HowLongToBeat"
        />
      </div>
    );
  }

  // The caller passes each of the four TagKind literals; narrowing back to TagKind (not a
  // bare string) is what lets the TagCloud call below type-check its `kind` field.
  const tagDim = (key: string) => panelOptions.enableTagFilters ? (key as TagKind) : null;
  const devs = meta?.developers || [];
  const pubs = meta?.publishers || [];
  const sameDevPub = devs.length > 0 && devs.length === pubs.length && devs.every((d, i) => d === pubs[i]);
  const cloud = g.loading ? null : (
    <TagCloud groups={[
      { kind: 'tags', dim: tagDim('tags'), items: g.details?.tags },
      { kind: 'genres', dim: tagDim('genres'), items: meta?.genres },
      { kind: 'categories', dim: tagDim('categories'), items: meta?.categories },
      { kind: 'devpub', dim: tagDim('developers'), items: devs },
      ...(sameDevPub ? [] : [{ kind: 'devpub' as const, dim: tagDim('publishers'), items: pubs }]),
    ]} />
  );

  const priceSection = g.loading ? null : <PriceSection game={g} />;
  const dlcSection = g.loading ? null : <DlcSection game={g} />;
  const newsSection = <NewsSection game={g} />;
  const achievementsSection = <AchievementsSection game={g} />;

  // A free demo is a "try before you buy" call to action, not supplementary info like
  // Website/Workshop below.
  const demoBanner = (!g.loading && g.details?.demo) ? (
    <a class="panel-demo-banner" href={safeHref(`https://store.steampowered.com/app/${g.details.demo}`) || undefined} target="_blank" rel="noopener">
      <span class="panel-demo-banner-icon">🎮</span> Try the Free Demo
    </a>
  ) : null;

  // Re-run the scroll-spy once this content has actually rendered — a re-render triggered by
  // a section's own data arriving (or a collapsible toggling) can shift where the section
  // anchors below sit, even when PanelSubnav's own item list doesn't itself change. Queued as
  // a microtask so it runs after Solid has actually patched the DOM for this render. (See
  // PanelSubnav's own comment for the complementary call keyed off its item list instead.)
  queueMicrotask(updateSubnavScrollSpy);

  // DLC is the one collapsible card whose fetch is normally gated behind an actual click
  // (see toggleSection/loadDlc above) — but `expandedSections` remembers "DLC is expanded"
  // per appid for the rest of the session, independent of any one game *object*. Navigating
  // to a game via a DLC link (or back, or prev/next/random) always creates/looks up a fresh
  // game object with its own never-yet-fetched `dlc` — so if that appid's card was expanded
  // at some earlier point this session, it renders open here too but with nothing loaded to
  // show, and no click is ever going to happen to trigger the fetch since it's already
  // open. Kick it off here instead whenever that mismatch shows up.
  if (!g.loading && g.dlc === undefined && !g.dlcLoading && isSectionExpanded(g.appid, 'dlc')) queueMicrotask(() => loadDlc(g));

  return (
    <>
      {demoBanner}
      <GlanceGrid game={g} />
      {priceSection}
      <Show when={description}>
        <div class="panel-desc panel-card" id="panel-desc">{decodedDescription}</div>
      </Show>
      {cloud}
      <Show when={ownersHtml}>
        <div id="panel-section-owners" innerHTML={ownersHtml} />
      </Show>
      {hltbDetail}
      {newsSection}
      {achievementsSection}
      {dlcSection}
    </>
  );
}

function PanelBody(): JSX.Element {
  return (
    <>
      <PanelHero />
      <PanelHeader />
      {(() => {
        // Every signal `PanelRest`'s own top-level body reads (as a plain `const x =
        // someSignal();` capture, not a call written directly inside one of its returned
        // JSX `{}` expressions) needs to be read here too — a Solid component function is
        // called once per mount and is itself *not* a reactive scope; only genuine JSX `{}`
        // expressions get their own tracked effect. `PanelRest` is invoked via a plain
        // component call (`<PanelRest/>` → `createComponent`), so a signal it only reads at
        // its own top level (alongside `panelGame` itself) would otherwise never cause this
        // to re-run. `moreLinksOpen`/`panelRefreshing`/`panelHistory` used to need listing
        // here too, back when PanelRest also built the sticky header — now that the header
        // (and the section jump-nav within it) is `PanelHeader` above, mounted once and
        // independent of this block, PanelRest itself no longer reads any of those three, so
        // they're dropped from this list along with it. `expandedSections`/
        // `revealedAchievements`/`achievementsFilter` don't need to be listed here — every
        // place that reads them (CollapsibleCard's own `expanded()`, an achievement row's own
        // `spoiler()`/`revealed()`) calls the signal directly inside its own JSX expression,
        // which Solid does track independently, regardless of this outer scope.
        revision(); panelGame();
        return <PanelRest />;
      })()}
    </>
  );
}

function initHeroSwipe() {
  // Bound to #panel-body (stable across renders) rather than #panel-hero itself, which is
  // recreated on every panelOpen but not on most re-renders (see PanelHero above) — binding
  // here rather than to the hero element means this never needs to be rebound.
  const hero = document.getElementById('panel-body')!;
  let startX = 0, startY = 0, tracking = false, decided = false, isHoriz = false;

  hero.addEventListener('touchstart', e => {
    const target = e.target as Element;
    if (e.touches.length !== 1 || target.closest('.panel-filmstrip') || !target.closest('.panel-hero')) return;
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
  const panel = document.getElementById('game-panel')!;
  let startX = 0, startY = 0, tracking = false, decided = false, horiz = false;

  panel.addEventListener('touchstart', e => {
    if (e.touches.length !== 1 || (e.target as Element).closest('.panel-filmstrip')) return;
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

  function finish(clientX: number) {
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
