'use strict';

import { fmtAge, fmtPlaytime, formatMoney, scoreColor, dealRecordTier, DEAL_RECORD_TIERS, fmtH, fmtLastPlayed, computeSteamdbRating } from './utils.ts';
import { openLightbox, closeLightbox, isLightboxOpen } from './lightbox.tsx';
import { buildMediaItems } from './mediaItems.ts';
import type { MediaItem } from './mediaItems.ts';
import { getMyOwnershipStatus, getOwnersFor } from './myOwnership.ts';
import type { OwnershipStatus } from './myOwnership.ts';
import { sortOwners, ownerMeterPct } from './ownerList.ts';
import type { GameOwner } from './accountData.ts';
import { ACCOUNT_CHANGED_EVENT, getEffectiveCurrentAccount } from './accountsStore.ts';
import { achievementsAccountKey } from './achievementsRequest.ts';
import {
  peekNews, fetchNews, peekAchievements, fetchAchievements, peekPrice, fetchPrice, peekDlc, fetchDlc,
} from './panelData.ts';
import type { DlcEntry, PanelAchievements, PanelDlc, PanelNews, PanelPrice } from './panelData.ts';
import { nextHopHistory } from './panelHistory.ts';
import type { PanelHistoryEntry } from './panelHistory.ts';
import { setGameTitle } from './pageTitle.ts';
import { withAccountParam } from './urlState.ts';
import type { Game, PriceFields, ReadonlyGame } from './types.ts';

import { createSignal, createEffect, createMemo, createResource, createRoot, For, Show, type JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { A } from '@solidjs/router';

// Host-page options passed to initPanel. All optional — a page supplies only the hooks it
// needs; the field names mirror exactly what panel.tsx reads off panelOptions below.
export interface PanelOptions {
  onTagClick?: (dim: string, val: string) => void;
  isTagActive?: (dim: string, val: string) => boolean;
  onRefresh?: (game: ReadonlyGame) => void;
  onNavigateGame?: (appid: number, name: string) => void;
  onClose?: (opts?: { preserveUrl?: boolean }) => void;
  enableTagFilters?: boolean;
}

// ── Shared game side panel ──────────────────────────────────────────────────
// Mounted once by AppShell.tsx's single `initPanel(options)` call (see docs/list-centric-
// redesign.md), not per-route — ListRoute.tsx (the only caller of `panelOpen` now) just
// opens/closes it, it never configures it itself. This used to be
// used by three separate pages (app.tsx/library.tsx/bundles.tsx), each supplying its own
// `initPanel` options — that per-page option-supplying shape is why `PanelOptions` still
// exists as a real interface (a global single-instance app has no *structural* need for one),
// though only `onNavigateGame` is actually passed today; the rest (`onTagClick`/`isTagActive`/
// `enableTagFilters`) are dead weight from that era with no current caller — left in place rather
// than ripped out, since removing them touches more of this file for a change genuinely out of
// scope for the pass that noticed it (see this file's git history/CHANGELOG for the specifics).
// `pricesHandledByHost` did go: its one reader was the old `loadPrice`, and the price resource's
// own source answers the same question off the row itself ("has anything already priced this?"). A real Solid component now (converted from the
// original panel.ts's hand-rolled innerHTML rebuilds): `initPanel(options)` mounts it once into
// the static `#panel-body` element every page's own markup already has; `panelOpen(game)`/
// `panelClose()` show/hide it exactly as before. Anything page-specific — tag-click filtering,
// the nav bar's list of games — is still left to the host page via options or by wrapping
// panelOpen/panelClose with its own extra logic, unchanged.
//
// Every exported function below keeps its exact original name/signature (every host page's
// import is untouched by this conversion) — the one
// deliberate behavior difference is internal: `panelOptions.onClose` still exists because
// panelClose() itself is called from more places than just the host's own code (the × button
// and swipe-to-close both call it directly) — a host that needs to run cleanup on every close
// (not just the ones it explicitly triggers) should do it there rather than in a wrapper around
// panelClose(), which those other paths would silently bypass.
//
// Docked, not modal (see docs/list-centric-redesign.md and style.css's own "App shell layout"
// comment): the panel is a sibling column next to whatever list/content is showing, not an
// overlay — no backdrop element, no click-outside-to-close, no `inert`-toggling of the
// background (there's nothing to make inert; the rest of the page stays fully interactive
// while the panel is open). `.open` still gates visibility (hidden entirely when no game is
// open, shown as a column when one is), it just means something different in the CSS now.
//
// Reactivity model — three kinds of state, no "please re-render" call anywhere:
//
//  1. The panel's own UI state (`panelGame`/`heroIdx`/`moreLinksOpen`/`panelHistory`/
//     `expandedSections`/`revealedAchievements`/`achievementsFilter`/`panelRefreshing`) — plain
//     signals, set directly by this file's own click handlers.
//  2. The open game's data — read straight off the game object, which is a Solid *store* row
//     owned by whichever route loaded it (see rowStore.ts). A field written as the details
//     stream lands patches only what renders that field.
//  3. Everything the panel fetches for itself (news, achievements, owners, ownership, price,
//     DLC) — a `createResource` each, keyed on whichever game is open (see "Per-game async
//     data" below), with the fetching itself in panelData.ts.
//
// This replaced a `revision` counter signal and an exported `renderPanelBody(game)` that bumped
// it: host routes (and this file's own loaders) mutated plain `Game` objects, which Solid cannot
// see, so ~30 call sites had to announce every write, and each announcement re-rendered the
// entire panel body. See CLAUDE.md's "Frontend reactivity" section for the full story — and note
// what the shape below is *for*: `npm run lint`'s `solid/reactivity` rule is what keeps a plain
// `const x = someSignal()` / `const g = props.game.field` capture from quietly reintroducing the
// same class of bug.
let panelOptions: PanelOptions = {};
const [panelGame, setPanelGame] = createSignal<ReadonlyGame | null>(null);
const [heroIdx, setHeroIdx] = createSignal(0);
let panelPrevFocus: HTMLElement | null = null;
const [panelRefreshing, setPanelRefreshing] = createSignal(false); // true while the host's onRefresh() is in flight
const [moreLinksOpen, setMoreLinksOpen] = createSignal(false); // whether the header's "⋯" overflow menu (News/Workshop/Website) is open

// Stack of {appid, name} for games navigated away from via a DLC link or "DLC for <Base Game>"
// link click (see navigateToGame/panelGoBack below) — NOT touched by an ordinary panel open (a
// table row click, a search-box pick, prev/next/random), since those aren't part of any such
// browsing trail. Holds plain {appid, name} pairs rather than full game objects — going back
// re-opens via the same host mechanism (panelOptions.onNavigateGame) a fresh lookup would use,
// same dedup-with-already-loaded-rows behavior included, rather than panel.tsx caching its own
// stale copy of a game's details. The push/pop rule itself is nextHopHistory (panelHistory.ts).
const [panelHistory, setPanelHistory] = createSignal<PanelHistoryEntry[]>([]);

// The appid of a hop this panel itself started — set by navigateToGame/panelGoBack right before
// handing off to the host's own opener, and consumed by the next panelOpen, which is what keeps
// that open from clearing the trail those two just pushed to or popped from.
//
// Module state rather than a `panelOpen({ keepHistory })` argument, which is what this replaced:
// the host may take a whole route navigation to get there (`onNavigateGame` → AppShell's
// openGameGlobally → `/game/:appid` for the recents list, where the actual open happens later
// from that route's own load()), and no argument survives that. It's also the only place in the
// app that knows the answer — every other opener starts a fresh trail — so asking three modules
// to thread a boolean back here was both fragile and, for the `/game/:appid` path, impossible:
// the trail was silently wiped on every hop, so "← Back" never appeared at all and panelGoBack
// was unreachable.
let pendingHopAppid: number | null = null;

function panelShuffle(arr: { appid: number }[]) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Rejects anything but a plain http(s) URL — the same guard the now-deleted accountsBar.ts/
// app.tsx used to apply to profile URLs. JSX text/attribute interpolation escapes on its own, so this guard is the
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

  // accountsStore.ts is deliberately a plain module with no reactivity of its own, so its change
  // event is what makes `currentMembers()` (and with it the achievements/owners/ownership
  // resources, all keyed on `appid:account`) react to picking a different account or following a
  // `?u=` link — rather than only re-checking on the next panel open. Registered here, not at
  // module scope, since panel.tsx is imported by Node unit tests too, which have no `window`.
  window.addEventListener(ACCOUNT_CHANGED_EVENT, () => setAccountRev(r => r + 1));

  // The one place document.title's "a game is open" layer is driven from (see pageTitle.ts).
  // `game.name` is read inside the effect, so a standalone lookup's placeholder title
  // (`App <appid>`, before store metadata resolves the real one) is replaced as soon as the
  // store row's `name` is written — the effect subscribes to that one field.
  createEffect(() => {
    const game = panelGame();
    setGameTitle(game ? game.name : null);
  });
}

// Highlights whichever subnav button corresponds to the section currently scrolled to the
// top of the visible body, instead of the subnav being a static row of jump-links with no
// sense of "where am I". Bound once to #panel-body (a stable element across every render)
// rather than to the subnav, which is rebuilt whenever the panel moves to a different game.
function initSubnavScrollSpy() {
  document.getElementById('panel-body')!.addEventListener('scroll', () => {
    requestAnimationFrame(updateSubnavScrollSpy);
  }, { passive: true });
}

// Buttons are walked in DOM order, which the body below keeps identical to the physical
// top-to-bottom order of the sections themselves (Owners right after the tag cloud,
// then HLTB/News/Achievements — see subnavItems below) — so the *last* button whose
// section has scrolled up to (or past) the sticky header counts as "current", same idea as
// a scrollspy TOC. None qualifying means we're still above the first section, i.e. still
// looking at the Overview (glance grid/description) itself.
function updateSubnavScrollSpy() {
  const nav = document.querySelector('.panel-subnav');
  if (!nav) return;
  const body = document.getElementById('panel-body')!;
  const headerH = document.querySelector('.panel-header-sticky')?.getBoundingClientRect().height ?? 0;
  const threshold = body.getBoundingClientRect().top + headerH + 8;
  const buttons = [...nav.querySelectorAll<HTMLElement>('.panel-subnav-btn')];
  let activeTarget = 'top';
  for (const btn of buttons) {
    const target = btn.dataset.target;
    if (target === undefined || target === 'top') continue;
    const el = document.getElementById(target);
    if (!el || el.getBoundingClientRect().top > threshold) continue;
    activeTarget = target;
  }
  buttons.forEach(btn => btn.classList.toggle('active', btn.dataset.target === activeTarget));
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
    // Each `refetch()` re-runs that resource's fetcher with `refetching` set, which is what its
    // fetcher reads as "force" (bypass both this app's session cache and the server's own TTL).
    // A refetch of a resource whose source is currently null — price, for a game its list
    // already priced — is a no-op by construction, no extra check needed here.
    //
    // DLC is only force-refetched if it was ever actually loaded (i.e. the card was expanded at
    // some point this session): no reason to kick off a fetch for a card nobody's opened just
    // because the refresh button was clicked.
    await Promise.all([
      panelOptions.onRefresh(game),
      panelData.refetchNews(),
      panelData.refetchPrice(),
      panelData.refetchAchievements(),
      peekDlc(game.appid) !== undefined ? panelData.refetchDlc() : null,
    ]);
  } finally {
    setPanelRefreshing(false);
  }
}

// The 🔗 button beside Store/ITAD in the header — copies a link back to this exact game.
// Always `/game/<appid>` (the canonical, single, shareable link — see
// docs/list-centric-redesign.md's routing section and ListRoute.tsx's `recent` kind), never
// whatever route/list happened to have this game open (which may carry `u=`/filters/sort/a
// route-local `?game=` from whatever search led here) — someone sharing "check out this game"
// almost always means the game itself, not "reproduce my exact search too", and a route-local
// link wouldn't even resolve for a recipient who doesn't already have that same list loaded
// (an account's Owned/Wishlist, a specific bundle), unlike /game/<appid>, which works for anyone.
function copyPanelLink(e: MouseEvent) {
  const game = panelGame();
  if (!game || !navigator.clipboard?.writeText) return;
  const btn = e.currentTarget as HTMLElement;
  const url = `${location.origin}/game/${game.appid}`;
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

// Which collapsible sections (HLTB breakdown, news, achievements — anything built with
// CollapsibleCard() below) are expanded, keyed `${appid}:${section}` so each game/section
// pair remembers its own choice independently, and which individual hidden achievements
// have been click-revealed (keyed `${appid}:${apiname}`). Re-opening a game later in the
// same session remembers prior choices; never cleared (a handful of strings per game
// touched is negligible, and a page reload resets it anyway). Solid signals (each holding a Set,
// replaced wholesale on every toggle) rather than plain module-level Sets, so a CollapsibleCard's
// own expanded/collapsed chevron reacts to a toggle on its own.
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
}

// ── Per-game async data ──────────────────────────────────────────────────────
// News, achievements, "Owned by", ownership status, price and DLC — everything the panel
// fetches for itself, as six `createResource`s keyed on whichever game is open. The fetching
// and session-caching itself lives in panelData.ts; this is only the reactive wiring.
//
// This replaced six hand-rolled `loadX(game)` functions that each set a `game.xLoading` flag,
// awaited a fetch, wrote the result onto the `Game` object, and called `renderPanelBody(game)`
// behind an `if (panelGame() === game)` staleness guard. A resource keyed on the open game
// gives all four of those for free: `.loading` is the flag, the value is the result, a
// superseded response is discarded rather than needing the guard, and — since a resource is a
// signal — whatever reads it re-renders on its own with no "please re-render" bump. See
// CLAUDE.md's "Frontend reactivity" section for the whole story.
//
// `createRoot`: these are computations, so they need an owner, and there is no component to own
// them — the panel is a module-level singleton whose data outlives every render of it (an
// in-flight fetch survives a close/reopen). One explicit, never-disposed root at module scope is
// exactly that lifetime, and keeps the resources readable from the plain module functions below
// (panelOpen, handlePanelRefresh) the same way the signals above already are.
//
// Every source below resolves to a *primitive* (an appid, or an `appid:account` string) rather
// than an object literal: `createResource` memoizes its source with `===`, so an object would
// refetch every time the source merely recomputed — e.g. `dlcSource` re-runs whenever any
// section anywhere is expanded/collapsed, and must not turn that into a fresh DLC fetch.
const [accountRev, setAccountRev] = createSignal(0);

// The account whose progress/ownership the panel is answering for — `getEffectiveCurrentAccount`
// is a plain non-reactive module (accountsStore.ts, deliberately), so its own change event is
// what makes this reactive; `initPanel` subscribes. Bumping this re-keys the three
// account-specific resources below, so switching accounts (or following a `?u=` link) re-fetches
// instead of leaving another account's progress on screen.
function currentMembers(): string[] {
  accountRev();
  return getEffectiveCurrentAccount()?.members ?? [];
}

const panelData = createRoot(() => {
  const openAppid = createMemo(() => panelGame()?.appid ?? null);
  // Shared by the three account-specific resources — achievementsAccountKey is just "sort the
  // member ids and join them", which is as much the right cache key for owners/ownership as it
  // is for achievements.
  const appidAndAccount = createMemo(() => {
    const appid = openAppid();
    return appid == null ? null : `${appid}:${achievementsAccountKey(currentMembers())}`;
  });

  // A plain `refetch()` from the refresh button is always a forced one; the source-driven initial
  // load passes `refetching: false`. That's the only distinction any of these fetchers needs.
  const isForced = (info: { refetching: boolean | unknown }) => info.refetching !== false;

  const [news, { refetch: refetchNews }] = createResource<PanelNews, number>(openAppid, (appid, info) => {
    const force = isForced(info);
    const cached = peekNews(appid);
    // Returning the cached value rather than a promise resolves the resource synchronously —
    // no `pending` tick, so reopening a game paints its real News card instead of flashing the
    // loading skeleton at it again.
    return !force && cached !== undefined ? cached : fetchNews(appid, { force });
  });

  const [achievements, { refetch: refetchAchievements }] = createResource<PanelAchievements, string>(appidAndAccount, (_key, info) => {
    // Read off the current game rather than packed into the source key: the key only has to
    // change when the *identity* of what's being fetched changes (this appid, this account), and
    // a resource fetcher runs untracked, so reading the game here subscribes to nothing.
    const g = panelGame();
    if (!g) return null;
    const members = currentMembers();
    const force = isForced(info);
    const cached = peekAchievements(g.appid, members);
    if (!force && cached !== undefined) return cached;
    return fetchAchievements(g.appid, members, { force, achievementCount: g.details?.meta?.achievementCount });
  });

  // Both of these are free in practice — myOwnership.ts already holds the current account's
  // owned/wishlist sets (and per-member playtimes) from one fetch shared with the ✓/☆ markers on
  // every table row, so these await a resolved promise rather than making a request.
  const [owners] = createResource<GameOwner[], string>(appidAndAccount, () => {
    const appid = openAppid();
    return appid == null ? [] : getOwnersFor(appid);
  });

  const [ownership] = createResource<OwnershipStatus | null, string>(appidAndAccount, () => {
    const appid = openAppid();
    return appid == null ? null : getMyOwnershipStatus(appid);
  });

  // Only for a game whose price nothing else has already loaded: a wishlist/bundle list batches
  // every row's prices in one call, and those rows carry the result in their own price fields
  // (which is what `bestDealPrice !== undefined` detects) for the table's price columns to render
  // — the panel reads those directly instead of duplicating the request. Checked as the resource
  // *source*, so a row that gets priced by its list later simply stops being a candidate.
  const priceSource = createMemo(() => {
    const g = panelGame();
    if (!g || g.bestDealPrice !== undefined) return null;
    return g.appid;
  });

  const [price, { refetch: refetchPrice }] = createResource<PanelPrice, number>(priceSource, (appid, info) => {
    const force = isForced(info);
    const cached = peekPrice(appid);
    return !force && cached !== undefined ? cached : fetchPrice(appid, { force });
  });

  // DLC is the one card whose fetch is gated behind actually expanding it (see panelData.ts's
  // fetchDlc) — expressed here as "this game's card is expanded" being part of the source, so
  // expanding it *is* what starts the fetch. That also covers the case the old code needed a
  // separate kick-off for: `expandedSections` remembers "DLC is expanded" per appid for the whole
  // session, so a game reopened later renders its card already open, with no click left to happen
  // — the source is already truthy on the first render, so the fetch just runs.
  const dlcSource = createMemo(() => {
    const g = panelGame();
    if (!g) return null;
    const ids = g.details?.meta?.dlc;
    if (!ids || !ids.length) return null;
    return isSectionExpanded(g.appid, 'dlc') ? g.appid : null;
  });

  // The in-progress list, streamed in one entry at a time (see fetchDlc's `onPartial`) — a
  // resource is one value per fetch, so the partial state is its own signal alongside it rather
  // than something forced through `mutate`. Tagged with the appid it belongs to, so a partial
  // list can never be shown under a different game.
  const [dlcPartial, setDlcPartial] = createSignal<{ appid: number; entries: (DlcEntry | undefined)[] } | null>(null);

  const [dlc, { refetch: refetchDlc }] = createResource<PanelDlc, number>(dlcSource, (appid, info) => {
    const force = isForced(info);
    const cached = peekDlc(appid);
    if (!force && cached !== undefined) return cached;
    const ids = panelGame()?.details?.meta?.dlc ?? [];
    return fetchDlc(appid, ids, { force, onPartial: entries => setDlcPartial({ appid, entries }) });
  });

  return { news, refetchNews, achievements, refetchAchievements, owners, ownership, price, refetchPrice, dlc, refetchDlc, dlcPartial };
});

// The price fields backing the Price card: whatever the host route already loaded onto the row
// (see `priceSource` above), else this panel's own lookup. Both are the same `PriceFields` shape
// — priceLoading.ts's `applyPriceInfo` fills either one — so nothing downstream cares which it
// got. `undefined` means "no price data for this game at all" (nothing loaded it, and this panel
// isn't looking it up either), which renders as no card.
function panelPriceFields(game: ReadonlyGame): PriceFields | null | undefined {
  return game.bestDealPrice !== undefined ? game : panelData.price();
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
  // See nextHopHistory (panelHistory.ts) for the push-vs-pop rule.
  setPanelHistory(hist => nextHopHistory(hist, { appid: game.appid, name: game.name }, appid));
  pendingHopAppid = appid;
  panelOptions.onNavigateGame(appid, name);
}

// The header's "← Back" button (see PanelRest) — pops the trail and reopens whatever
// was on top the same way navigateToGame opens a DLC/base-game link, just in the other
// direction. Popping before calling onNavigateGame (rather than after) means the callback
// only ever needs to know "keep whatever's left in the stack", identical in both directions.
function panelGoBack() {
  const hist = panelHistory();
  if (!hist.length || !panelOptions.onNavigateGame) return;
  const prev = hist[hist.length - 1];
  setPanelHistory(hist.slice(0, -1));
  pendingHopAppid = prev.appid;
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

export function panelOpen(game: ReadonlyGame) {
  // Every opener (a table row, a search-box pick, prev/next/random, a deep link) starts a fresh
  // browsing trail — except the DLC/base-game hop this panel started itself, which arrives here
  // with `pendingHopAppid` armed (see its own comment above). Consumed either way: if some
  // *other* game opens first, that hop never completed and the trail it belonged to is stale.
  const isHop = pendingHopAppid === game.appid;
  pendingHopAppid = null;
  if (!isHop) setPanelHistory([]);
  setPanelGame(game);
  setHeroIdx(0);
  setMoreLinksOpen(false);
  panelPrevFocus = document.activeElement as HTMLElement | null;
  document.getElementById('panel-body')!.scrollTop = 0;
  // No load* calls here: news/achievements/owners/ownership/price are resources keyed on the
  // open game (see "Per-game async data" above), so setting `panelGame` above is itself what
  // starts whichever of them this game still needs — and what makes a reopen free when it
  // doesn't.
  document.getElementById('game-panel')!.classList.add('open');
  ((document.getElementById('panel-hero')?.querySelector('.panel-hero-img') ?? document.getElementById('panel-close')!) as HTMLElement).focus();
}

// `preserveUrl`: threaded through to `onClose` unchanged — for a host that clears
// `?game=`/`&shot=` there, this lets a caller that's about to reopen the same game right
// after (e.g. a forced-refresh reload) close the panel's DOM state without losing the
// deep link it'll restore from once the reload completes. Not used by the × button/swipe
// paths below, which always want the default (URL cleared).
export function panelClose({ preserveUrl = false } = {}) {
  if (!panelGame()) return;
  setPanelGame(null);
  // Closing the panel ends whatever DLC browsing trail was in progress — including a hop that
  // was handed off but never opened (a bad appid, a failed lookup), which must not be left armed
  // to attach a stale trail to some later, unrelated open of that same game.
  setPanelHistory([]);
  pendingHopAppid = null;
  document.getElementById('game-panel')!.classList.remove('open');
  document.getElementById('panel-nav')?.replaceChildren();
  panelPrevFocus?.focus();
  panelPrevFocus = null;
  // Every close path funnels through here — the × button is bound straight to this function
  // (see initPanel above), and swipe-to-close calls it directly too — so this is the one place
  // host-specific close cleanup (clearing `?game=`/`&shot=` from the URL, resetting the host's
  // own "active game" state) can hook in without every
  // host having to remember to wrap all of those paths itself.
  panelOptions.onClose?.({ preserveUrl });
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
  const present = createMemo(() => props.groups.filter(gr => gr.items?.length));
  const pills = createMemo(() => present().flatMap(({ kind, dim, items }) => {
    const values = kind === 'tags' ? [...items!] : [...items!].sort((a, b) => a.localeCompare(b));
    return values.map(v => ({ kind, dim, v }));
  }));
  const seenKinds = createMemo(() => [...new Set(present().map(gr => gr.kind))]);
  return (
    <Show when={present().length}>
    <div class="panel-section panel-section--meta panel-card">
      <div class="panel-section-title">Tags &amp; details</div>
      <div class="panel-tags">
        <For each={pills()}>
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
        <For each={seenKinds()}>
          {k => (
            <span class="panel-tag-legend-item">
              <span class="panel-tag-dot" style={{ background: TAG_KIND_META[k].color }} />{TAG_KIND_META[k].label}
            </span>
          )}
        </For>
      </div>
    </div>
    </Show>
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
  const inner = () => (
    <span class="panel-glance-sub">
      <span class="panel-glance-num" style={props.color ? { color: props.color } : undefined}>{String(props.value)}</span>
      <span class="panel-glance-val">{props.caption}</span>
    </span>
  );
  const style = () => props.faded ? { opacity: .65 } : undefined;
  return (
    <Show when={props.href} fallback={<div class="panel-glance-chip panel-glance-chip--static" style={style()}>{inner()}</div>}>
      {href => <a class="panel-glance-chip" href={href()} target="_blank" rel="noopener" style={style()}>{inner()}</a>}
    </Show>
  );
}

function GlanceGrid(props: { game: ReadonlyGame }): JSX.Element {
  const details = () => props.game.details;
  const reviewsUrl = () => `https://store.steampowered.com/app/${props.game.appid}/#app_reviews_hash`;
  const protondbUrl = () => `https://www.protondb.com/app/${props.game.appid}`;

  // Every chip stays in the grid even when its source has no data for this game — a missing
  // weighted rating or ProtonDB tier is itself informative, and a chip that vanishes instead makes
  // the 2×2 grid reflow into a lopsided 3-chip layout. Each still links out where a useful
  // destination exists, same as the HLTB search fallback. The rating link points at the game's
  // Steam reviews (the actual source of the underlying data) rather than SteamDB, since the
  // number/caption is this app's own weighted rating, not SteamDB's.
  const ratingChip = () => {
    const r = details()?.rating;
    if (!r) return <GlanceChip href={reviewsUrl()} value="—" caption={<><b>Weighted</b> · no rating</>} />;
    const pct = r.total ? Math.round(r.positive / r.total * 100) : 0;
    const steamdbRating = Math.round(computeSteamdbRating(r.positive, r.total) ?? 0);
    return <GlanceChip href={reviewsUrl()} value={steamdbRating} color={scoreColor(steamdbRating)} caption={<><b>Weighted</b> · {pct}% of {fmtCompactCount(r.total)}</>} />;
  };

  const mcChip = () => {
    const mc = details()?.meta?.metacritic;
    return mc
      ? <GlanceChip href={mc.url} value={mc.score} color={scoreColor(mc.score)} caption={<><b>Metacritic</b> · critic score</>} />
      : <GlanceChip value="—" caption={<><b>Metacritic</b> · no score</>} />;
  };

  const hltbChip = () => {
    const h = details()?.hltb;
    // A matched HLTB entry can still have no submitted completion times (all: null, e.g. a very
    // new/obscure game) — that's a real page with no data, not a failed search, so it still links
    // straight to the page rather than a generic search.
    if (!h?.id) return <GlanceChip href={`https://howlongtobeat.com/?q=${encodeURIComponent(props.game.name)}`} value="—" caption={<><b>HLTB</b> · search</>} />;
    const hltbUrl = `https://howlongtobeat.com/game/${h.id}`;
    return h.all
      ? <GlanceChip href={hltbUrl} value={`${h.all}h`} caption={<><b>HLTB</b> · all playstyles</>} />
      : <GlanceChip href={hltbUrl} value="—" caption={<><b>HLTB</b> · no data</>} />;
  };

  const protonChip = () => {
    const pd = details()?.protondb;
    if (!pd?.tier) return <GlanceChip href={protondbUrl()} value="—" caption={<><b>Linux/Deck</b> · no reports</>} />;
    const color = PROTON_TIER_COLORS[pd.tier] || '#52525b';
    // Kept short (no "reports"/"confidence" words) — the glance chip's one-line caption truncates
    // rather than wraps, and "strong · 336" already reads fine without them.
    const detail = [pd.confidence, pd.total ? fmtCompactCount(pd.total) : ''].filter(Boolean).join(' · ');
    // pd.pending: too few reports for ProtonDB itself to be confident, showing its provisionalTier
    // instead of nothing (see extractProtonDb, lib/steam.js) — faded, with a "?" and a
    // "provisional" caption suffix, so it doesn't read as an equally-confirmed tier.
    const value = pd.pending ? `${capitalize(pd.tier)} ?` : capitalize(pd.tier);
    return <GlanceChip href={protondbUrl()} value={value} color={color} faded={pd.pending} caption={<><b>Linux/Deck</b>{detail ? ` · ${detail}` : ''}{pd.pending ? ' · provisional' : ''}</>} />;
  };

  return (
    <Show when={props.game.loading} fallback={
      <Show when={details()}>
        <div class="panel-glance">{ratingChip()}{mcChip()}{hltbChip()}{protonChip()}</div>
      </Show>
    }>
      <div class="panel-glance">
        <For each={[0, 1, 2, 3]}>
          {() => <div class="panel-glance-chip panel-glance-chip--sk"><span class="sk" style={{ width: '100%', height: '32px', 'border-radius': '6px' }} /></div>}
        </For>
      </div>
    </Show>
  );
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
  const numSpan = () => props.num != null
    ? <span class="panel-glance-num" style={props.numColor ? { color: props.numColor } : undefined}>{props.num}</span>
    : props.icon ? <span class="panel-achievements-icon">{props.icon}</span> : null;
  return (
    <div class="panel-achievements-card">
      <div class="panel-achievements-card-header">
        <button type="button" class="panel-achievements-chip panel-collapsible-chip" aria-expanded={expanded() ? 'true' : 'false'} onClick={() => toggleSection(props.appid, props.section)}>
          {numSpan()}
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

// Achievements section, off the `achievements` resource (see "Per-game async data" above):
// fetched separately from the rating/HLTB/tags stream, since the achievement *list* only depends
// on the appid but progress depends on which account is loaded. The list itself is still fetched
// and shown with zero accounts loaded (`playerCount: 0`, no `steamUrl`) — only the
// achieved/unlocktime/progress-summary parts need an account, gated by `hasProgress` below.
function AchievementsSection(props: { game: ReadonlyGame }): JSX.Element {
  // `undefined` means the fetch hasn't been attempted yet — nothing to show and no failure to
  // report either, so stay silent. `null` means it was attempted and failed — that's worth a
  // visible message rather than silently looking identical to a game with no achievements at all.
  const data = () => panelData.achievements();
  // With no player loaded (`playerCount === 0` — a standalone "look up any game" lookup),
  // `unlocked` is always 0 by construction, not a real "nobody's unlocked anything" result — the
  // list itself (names/descriptions/icons/rarity) is still real store metadata worth showing,
  // just without any progress claim on top of it. `hasProgress` gates every place that would
  // otherwise imply real unlock data.
  const hasProgress = () => (data()?.playerCount ?? 0) > 0;
  const pct = () => { const d = data(); return d && hasProgress() ? Math.round((d.unlocked / d.total) * 100) : null; };

  // Sorted once per fetch and cached on the payload itself (a fresh object every fetch/refresh,
  // so this never goes stale) rather than re-sorting the full list on every render.
  const sorted = createMemo(() => {
    const d = data();
    if (!d) return [];
    return d._sortedAchievements ??= d.achievements.slice().sort((a, b) => Number(b.achieved) - Number(a.achieved));
  });
  // 'unlocked'/'locked' only make sense with real progress loaded — filtering by achieved status
  // when nobody's loaded would just be "everything" vs. "nothing" either way. `createMemo` rather
  // than a bare thunk since `visible()` is read from two separate JSX spots below (the `<Show>`
  // and the `<For>`) in the same render — a memo shares one `filter()` pass across both instead
  // of each read re-running it.
  const filter = createMemo(() => hasProgress() ? (achievementsFilter().get(props.game.appid) || 'all') : 'all');
  const visible = createMemo(() => filter() === 'all'
    ? sorted()
    : sorted().filter(a => (filter() === 'unlocked') === !!a.achieved));

  const body = (
    <>
      <Show when={hasProgress()}>
        <div class="panel-achievements-filter">
          <For each={['all', 'unlocked', 'locked']}>
            {opt => <button type="button" class={`panel-achievements-filter-btn${filter() === opt ? ' active' : ''}`} onClick={() => setAchievementsFilterFor(props.game.appid, opt)}>{opt === 'all' ? 'All' : opt === 'unlocked' ? 'Unlocked' : 'Locked'}</button>}
          </For>
        </div>
      </Show>
      <Show when={!hasProgress()}><div class="panel-no-data">Load a player above to see who's unlocked what.</div></Show>
      <Show when={hasProgress() && data()?.private}><div class="panel-no-data">Progress unavailable — profile may be private.</div></Show>
      <Show when={!visible().length}><div class="panel-no-data">No achievements match this filter.</div></Show>
      <For each={visible()}>
        {a => {
          // A hidden achievement not yet unlocked keeps its name/description a surprise by
          // default, same as Steam's own profile pages — the schema still carries the real text
          // either way (whether it's still a spoiler depends on which account is loaded, not on
          // the shared/cached schema), this just withholds it client-side until clicked, rather
          // than never sending it at all.
          const revealed = () => revealedAchievements().has(`${props.game.appid}:${a.apiname}`);
          const spoiler = () => a.hidden && !a.achieved && !revealed();
          const name = () => spoiler() ? 'Hidden achievement' : (a.name || a.apiname);
          const desc = () => spoiler() ? 'Click to reveal' : (a.description || '');
          const icon = a.achieved ? a.icon : (a.icongray || a.icon);
          // Unlock date is real data the server already returns (`unlocktime`, seconds since
          // epoch) but otherwise has nowhere to show — surfaced as a plain hover tooltip rather
          // than a fifth line of on-card text.
          const title = a.achieved && a.unlocktime ? `Unlocked ${fmtLastPlayed(a.unlocktime)}` : '';
          // Rarity isn't a spoiler — it's shown even for a still-hidden achievement, same as
          // Steam's own profile pages. Fixed to 1 decimal only when it's not a whole number.
          const rarityLabel = a.globalPct == null ? null : fmtRarity(a.globalPct);
          const onSpoilerActivate = (e: MouseEvent | KeyboardEvent) => { if (spoiler()) { e.preventDefault(); revealAchievement(props.game.appid, a.apiname); } };
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
    <Show when={panelData.achievements.loading} fallback={
      <Show when={data() !== undefined}>
        <div class="panel-section" id="panel-section-achievements">
          <Show when={data()} fallback={<><div class="panel-section-title">Achievements</div><div class="panel-no-data">Couldn't load achievements.</div></>}>
            {d => (
              <Show when={d().total} fallback={<><div class="panel-section-title">Achievements</div><div class="panel-no-data">This game has no achievements.</div></>}>
                <CollapsibleCard
                  appid={props.game.appid}
                  section="achievements"
                  num={hasProgress() ? `${pct()}%` : '—'}
                  numColor={hasProgress() ? scoreColor(pct()!) : null}
                  val={<><b>Achievements</b> · {hasProgress() ? `${d().unlocked} / ${d().total} unlocked` : `${d().total} total`}</>}
                  body={body}
                  linkHref={d().steamUrl}
                  linkTitle="View achievements on Steam"
                />
              </Show>
            )}
          </Show>
        </div>
      </Show>
    }>
      <div class="panel-section" id="panel-section-achievements">
        <div class="panel-section-title">Achievements</div>
        <div class="panel-achievements"><span class="sk" style={{ width: '100%', height: '48px', 'border-radius': '6px' }} /></div>
      </div>
    </Show>
  );
}

// The "Owned by" card — one row per member of the current account who owns this game: name,
// when they last played it, and their own playtime with a meter relative to the most-played
// member. Renders nothing at all when nobody in the account owns it, when no account is loaded,
// or before the `owners` resource has resolved. Takes no `game` prop — that resource is already
// keyed on whichever game is open, so there'd be nothing for one to do.
//
// Deliberately shown even for a single-account slot, where it's one row: "owned, never played"
// is itself worth seeing, and it's the only place last-played shows up in the panel.
function OwnersSection(): JSX.Element {
  const owners = (): GameOwner[] => panelData.owners() ?? [];
  const sorted = createMemo(() => sortOwners(owners()));
  const maxMinutes = createMemo(() => Math.max(...sorted().map(o => o.minutes), 1));
  return (
    <Show when={sorted().length > 0}>
      <div class="panel-section panel-card" id="panel-section-owners">
        <div class="panel-section-title">Owned by <span class="panel-section-subtitle">most recently played first</span></div>
        <div class="panel-owners">
          <For each={sorted()}>
            {o => {
              const lastPlayed = fmtLastPlayed(o.lastPlayedSec);
              const playtime = fmtPlaytime(o.minutes);
              // Steam's `rtime_last_played` is genuinely 0 for plenty of owned-and-played games
              // (confirmed live on a game with 477h on it), so a bare "never played" — what the
              // pre-redesign card said, and a bug carried over in the original port — would flatly
              // contradict the playtime printed right underneath it. Only claim "never played"
              // when there's no playtime either.
              const lastPlayedText = lastPlayed || (o.minutes > 0 ? 'last played unknown' : 'never played');
              return (
                <div class="panel-owner">
                  <div class="panel-owner-top">
                    <span class="panel-owner-name">{o.name}</span>
                    <span class="panel-owner-lastplayed">{lastPlayedText}</span>
                  </div>
                  <div class="panel-owner-meter-track">
                    <div class="panel-owner-meter-fill" style={{ width: `${ownerMeterPct(o.minutes, maxMinutes())}%` }} />
                  </div>
                  <span class="panel-owner-playtime">{playtime ? `${playtime} played` : 'not played'}</span>
                </div>
              );
            }}
          </For>
        </div>
      </div>
    </Show>
  );
}

// Recent news/announcements (patch notes, event posts) — a handful of headlines, each
// linking straight to the full post, plus a link to the game's full news hub on the Steam
// store for anything older than what's shown here. Dates use the same plain-ISO convention
// as fmtLastPlayed/the table's date columns rather than a relative "3 days ago" string.
function NewsSection(props: { game: ReadonlyGame }): JSX.Element {
  const items = () => panelData.news();
  return (
    <Show when={panelData.news.loading} fallback={
      // A failed fetch with nothing to fall back on (`null` — see panelData.ts's fetchNews, which
      // keeps a previous successful load rather than wiping it) is worth a visible message rather
      // than silently looking identical to a game with no news at all.
      <Show when={items() === null || items()?.length}>
        <div class="panel-section" id="panel-section-news">
          <Show when={items()} fallback={<><div class="panel-section-title">News</div><div class="panel-no-data">Couldn't load news.</div></>}>
            {list => (
              <CollapsibleCard
                appid={props.game.appid}
                section="news"
                icon="📰"
                // Spelling out "more on Steam" here (not just relying on the ↗ icon's title
                // tooltip) makes it explicit that this list is a preview, not the full history.
                val={<><b>News</b> · more on Steam</>}
                body={
                  <div class="panel-collapsible-body-pad">
                    <div class="panel-news">
                      <For each={list()}>
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
                linkHref={`https://store.steampowered.com/news/app/${props.game.appid}`}
                linkTitle="View all news on Steam"
              />
            )}
          </Show>
        </div>
      </Show>
    }>
      <div class="panel-section" id="panel-section-news">
        <div class="panel-section-title">News</div>
        <span class="sk" style={{ display: 'block', width: '100%', height: '48px', 'border-radius': '6px' }} />
      </div>
    </Show>
  );
}

// Price info — a single always-open card (no chip grid, no collapsible secondary numbers):
// the current best deal (same display/color/badge/tooltip as the Best Deal table cell in
// bundles.tsx/library.ts), its discount off Steam Full Price when there is one, a direct link
// to the shop itself, and a link to the game's ITAD page for the fuller picture (historical
// lows, every other shop) this card deliberately leaves out. See the original panel.ts's own
// (much longer) header comment — preserved in git history — for the full "where do these
// numbers come from" reasoning; unchanged by this conversion.
function PriceSection(props: { game: ReadonlyGame }): JSX.Element {
  // Either the host route's own batched prices (already on the row) or this panel's own lookup —
  // see panelPriceFields. `undefined` means nothing priced this game and nothing is going to.
  const p = () => panelPriceFields(props.game);
  // Narrowed to "has a price": `bestDealPrice` is nullable on the row shape, and everything
  // below (the amount, the record tier, the lows it's compared against) only exists when it isn't
  // null — one check here rather than a non-null assertion at each use.
  const deal = () => {
    const v = p();
    return v && v.bestDealPrice != null ? (v as PriceFields & { bestDealPrice: number }) : null;
  };
  // dealRecordTier (public/utils.ts) is the single shared source of this tier/color/icon logic.
  const rec = () => { const d = deal(); return d ? dealRecordTier(d.bestDealPrice, d) : null; };
  const shopUrl = () => safeHref(deal()?.bestDealUrl);
  const tooltip = () => {
    const shop = deal()?.bestDealShop;
    return shop ? `${shop}${rec() ? ` — ${rec()!.tooltipLabel}` : ''}` : '';
  };

  // Historical lows (all-time/1yr/3mo) — see the original file's own (much longer) comment,
  // preserved in git history, for the full "why collapse equal-amount tiers" reasoning.
  const lowGroups = createMemo(() => {
    const d = deal();
    const groups: { amount: number; tiers: typeof DEAL_RECORD_TIERS[number][] }[] = [];
    if (!d) return groups;
    for (const t of [...DEAL_RECORD_TIERS].reverse()) {
      const amount = d[t.low];
      if (amount == null || amount === d.bestDealPrice) continue;
      const last = groups[groups.length - 1];
      if (last && last.amount === amount) last.tiers.unshift(t);
      else groups.push({ amount, tiers: [t] });
    }
    return groups;
  });

  const line = () => {
    const d = deal()!;
    // `0` (the best deal genuinely isn't any cheaper than Steam) is treated the same as `null`/
    // undefined (no discount to show) — "if any" per the spec, not a flat "-0%" reading as noise.
    // The shop name, and — unlike the table cell, which stays tooltip-only since it's
    // space-constrained — the *whole rest of the card* doubles as the buy link (see the original
    // file's own comment, preserved in git history, for the full reasoning).
    return (
      <>
        <span class="panel-price-amount" style={{ ...(rec() ? { color: rec()!.color } : {}), ...(rec()?.bold ? { 'font-weight': 700 } : {}) }}>
          {formatMoney(d.bestDealPrice, d.priceCurrency)}{rec() ? ' ' + rec()!.icon : ''}
        </span>
        <Show when={d.bestDealCut}>
          <><span class="panel-price-sep">·</span><span class="panel-price-discount">-{d.bestDealCut}%</span></>
        </Show>
        <Show when={d.bestDealShop}>
          <><span class="panel-price-sep">·</span><span class="panel-price-shop">{shopUrl() ? 'Buy at ' : 'at '}{d.bestDealShop}{shopUrl() ? ' ↗' : ''}</span></>
        </Show>
      </>
    );
  };

  return (
    <Show when={panelData.price.loading} fallback={
      <Show when={p() !== undefined}>
        <div class="panel-section panel-card" id="panel-section-price">
          <div class="panel-section-title">Price <a href={`https://isthereanydeal.com/steam/app/${props.game.appid}`} target="_blank" rel="noopener">IsThereAnyDeal ↗</a></div>
          <Show when={deal()} fallback={<div class="panel-no-data">No pricing data available.</div>}>
            <Show when={shopUrl()} fallback={<div class="panel-price-line" title={tooltip() || undefined}>{line()}</div>}>
              {url => <a class="panel-price-line panel-price-line--link" href={url()} target="_blank" rel="noopener" title={tooltip() || undefined}>{line()}</a>}
            </Show>
            <Show when={lowGroups().length}>
              <div class="panel-price-lows">
                <For each={lowGroups()}>
                  {({ amount, tiers }, i) => {
                    const icons = tiers.map(t => t.icon).join('');
                    const label = tiers.map(t => t.statusLabel).join(' / ');
                    const lowColor = tiers[0].color; // rarest tier in the group leads the color too
                    const money = () => formatMoney(amount, deal()?.priceCurrency ?? null);
                    return (
                      <>
                        <Show when={i() > 0}><span class="panel-price-sep">·</span></Show>
                        <span class="panel-price-low" title={`${label}: ${money()}`} style={{ color: lowColor }}>{money()} {icons}</span>
                      </>
                    );
                  }}
                </For>
              </div>
            </Show>
          </Show>
        </div>
      </Show>
    }>
      <div class="panel-section panel-card" id="panel-section-price">
        <div class="panel-section-title">Price</div>
        <span class="sk" style={{ display: 'block', width: '100%', height: '32px', 'border-radius': '6px' }} />
      </div>
    </Show>
  );
}

// "Part of <Base Game>" — the reverse of the DLC card below: present only when the
// currently open game is itself a piece of DLC (`meta.fullgame`, free on the same
// appdetails response, see extractAppDetails in lib/steam.js). Same real-`<a href>` /
// intercepted-click treatment as a DLC entry, just walking the base-game/DLC relationship
// in the other direction via the same navigateToGame.
function BaseGameLink(props: { game: ReadonlyGame }): JSX.Element {
  const fg = () => props.game.details?.meta?.fullgame;
  const onClick = (e: MouseEvent) => {
    const base = fg();
    if (!base || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigateToGame(base.appid, base.name || '');
  };
  return (
    <Show when={fg()}>
      {base => <>DLC for <a class="panel-basegame-link" href={withAccountParam(`/game/${base().appid}`)} onClick={onClick}>{base().name || `App ${base().appid}`}</a></>}
    </Show>
  );
}

// DLC — a base game's downloadable content, collapsed by default (see panelData.ts's fetchDlc
// for why it's the one card whose body isn't already loaded by render time). The collapsed
// header's count comes straight from `meta.dlc` (the bare appid list, free — see
// extractAppDetails in lib/steam.js) so it's shown immediately even before the card is ever
// expanded; only the expanded body's names/capsules depend on the lazy fetch. Each entry is
// a real `<a href>` — `/game/<appid>`, the app's canonical single-game link (see
// docs/list-centric-redesign.md's routing section) — rather than a plain button, so
// ctrl/cmd/shift-click and middle-click open it in a new tab the normal way, while a plain click
// navigates within this panel instead via navigateToGame. This used to be a host-supplied
// `panelOptions.gameHref` (each of the three deleted pages had its own URL shape); with one
// canonical link for every route there's nothing left for a host to decide, and nobody had
// passed it since the redesign — so these were `href="#"`, and middle-click opened nothing.
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
    <a class="panel-dlc-item" href={withAccountParam(`/game/${props.d.appid}`)} onClick={onClick}>
      <img class="panel-dlc-capsule" src={props.d.capsule} alt="" loading="lazy" />
      <span class="panel-dlc-name">{props.d.name}</span>
    </a>
  );
}

function DlcSection(props: { game: ReadonlyGame }): JSX.Element {
  const dlcIds = () => props.game.details?.meta?.dlc ?? [];
  // Whichever entries have already resolved, for the streamed-in-as-they-land state below —
  // tagged with the appid they belong to, so a partial list is never shown under another game.
  const loaded = () => {
    const partial = panelData.dlcPartial();
    return (partial?.appid === props.game.appid ? partial.entries : []).filter((d): d is DlcEntry => d != null);
  };
  const skeleton = <div class="panel-collapsible-body-pad"><span class="sk" style={{ display: 'block', width: '100%', height: '48px', 'border-radius': '6px' }} /></div>;

  const body = () => {
    if (panelData.dlc.loading) {
      // Stream in whichever entries have already resolved instead of holding the whole card on
      // its skeleton until every single one settles (see panelData.ts's fetchDlc).
      const done = loaded();
      if (!done.length) return skeleton;
      const remaining = dlcIds().length - done.length;
      return (
        <div class="panel-dlc-list">
          <For each={done}>{d => <DlcItem d={d} />}</For>
          <Show when={remaining}>{n => <div class="panel-dlc-loading-more">Loading {n()} more…</div>}</Show>
        </div>
      );
    }
    const entries = panelData.dlc();
    if (entries === null) return <div class="panel-collapsible-body-pad"><div class="panel-no-data">Couldn't load DLC details.</div></div>;
    if (!entries) return skeleton;
    return entries.length
      ? <div class="panel-dlc-list"><For each={sortDlcByRelease(entries)}>{d => <DlcItem d={d} />}</For></div>
      : <div class="panel-collapsible-body-pad"><div class="panel-no-data">No DLC details available.</div></div>;
  };

  return (
    <Show when={dlcIds().length}>
      <div class="panel-section" id="panel-section-dlc">
        <CollapsibleCard
          appid={props.game.appid}
          section="dlc"
          icon="📦"
          val={<><b>DLC</b> · {dlcIds().length} available</>}
          body={body()}
          linkHref={`https://store.steampowered.com/dlc/${props.game.appid}/`}
          linkTitle="View all DLC on Steam"
        />
      </div>
    </Show>
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
  // `g.details?.meta` is read here, inside an accessor, rather than captured once — a standalone
  // "look up any game" open (or a DLC/base-game navigation hop) shows the panel immediately
  // against a bare skeleton row (`{loading: true, details: null}`) and fills in real metadata
  // (screenshots/videos) asynchronously, without ever replacing the row object itself. Reading
  // the field through the store row is what makes the hero pick that up; it used to need a
  // `revision()` read here for the same reason, back when the row was a plain object.
  const items = () => { const g = panelGame(); return g ? buildMediaItems(g.appid, g.details?.meta) : []; };
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

// ── The rest of the panel body ───────────────────────────────────────────────
// Split into small components, each reading only the fields it renders — a game object is a
// Solid store row now (see rowStore.ts), so a field written as data streams in patches just the
// text node that shows it. This used to be one coarse block that re-read every field of the game
// and rebuilt the entire subtree on every `revision` bump: ~6 full teardowns per open (five
// async loaders, most bumping on start and finish), each throwing away hover state, keyboard
// focus and the scroll-spy's `active` class. See CLAUDE.md's "Frontend reactivity" section.

// The HLTB Main/Extra/Completionist breakdown. The glance strip above already carries HLTB's
// "All PlayStyles" number (see GlanceGrid), so this is the fuller breakdown beneath it, not a
// second copy of the headline figure.
function HltbSection(props: { game: ReadonlyGame }): JSX.Element {
  const h = () => props.game.details?.hltb;
  const present = () => {
    const x = h();
    return !props.game.loading && !!x && !!(x.main || x.extra || x.completionist);
  };
  const parts = () => {
    const x = h();
    return [x?.main && 'Main Story', x?.extra && 'Main + Extra', x?.completionist && 'Completionist'].filter(Boolean);
  };

  // Collapsed by default like achievements/news, EXCEPT when `all` itself is missing — then this
  // breakdown is the only duration data the panel has at all, so hiding it behind a click would
  // bury the one piece of HLTB info actually available for this game. An effect, not a write
  // during render: a signal write inside a tracked scope is exactly the "changing state while
  // deriving from it" mistake the store conversion is meant to make impossible.
  createEffect(() => {
    const x = h();
    if (!present() || x?.all != null) return;
    const key = `${props.game.appid}:hltb`;
    if (expandedSections().has(key)) return;
    setExpandedSections(prev => new Set(prev).add(key));
  });

  return (
    <Show when={present()}>
      <div class="panel-section" id="panel-section-hltb">
        <CollapsibleCard
          appid={props.game.appid}
          section="hltb"
          icon="⏱️"
          val={<><b>How Long To Beat</b> · {parts().join(', ')}</>}
          body={
            <div class="panel-collapsible-body-pad">
              <div class="panel-hltb">
                <Show when={h()?.main}>{v => <div class="panel-hltb-item"><div class="panel-hltb-label">Main Story</div><div class="panel-hltb-val">{fmtH(v())}</div></div>}</Show>
                <Show when={h()?.extra}>{v => <div class="panel-hltb-item"><div class="panel-hltb-label">Main + Extra</div><div class="panel-hltb-val">{fmtH(v())}</div></div>}</Show>
                <Show when={h()?.completionist}>{v => <div class="panel-hltb-item"><div class="panel-hltb-label">Completionist</div><div class="panel-hltb-val">{fmtH(v())}</div></div>}</Show>
              </div>
            </div>
          }
          linkHref={h()?.id ? `https://howlongtobeat.com/game/${h()!.id}` : null}
          linkTitle="View on HowLongToBeat"
        />
      </div>
    </Show>
  );
}

// Same list of names in the same order — a developer list that's identical to the publisher list
// is folded into one "Developer/Publisher" group rather than shown twice. Takes both arrays as
// parameters rather than closing over them, so the element comparison reads its own arguments
// rather than a captured reactive read (which `solid/reactivity` rightly can't tell apart from a
// stale snapshot).
function sameNames(a: string[], b: string[]): boolean {
  return a.length > 0 && a.length === b.length && a.every((v, i) => v === b[i]);
}

// Tags/genres/categories/developer-publisher, as one cloud (see TagCloud above).
function TagCloudSection(props: { game: ReadonlyGame }): JSX.Element {
  const meta = () => props.game.details?.meta;
  // The caller passes each of the four TagKind literals; narrowing back to TagKind (not a bare
  // string) is what lets the TagCloud call below type-check its `kind` field.
  const tagDim = (key: string) => panelOptions.enableTagFilters ? (key as TagKind) : null;
  const groups = createMemo(() => {
    const devs = meta()?.developers || [];
    const pubs = meta()?.publishers || [];
    const sameDevPub = sameNames(devs, pubs);
    return [
      { kind: 'tags' as const, dim: tagDim('tags'), items: props.game.details?.tags },
      { kind: 'genres' as const, dim: tagDim('genres'), items: meta()?.genres },
      { kind: 'categories' as const, dim: tagDim('categories'), items: meta()?.categories },
      { kind: 'devpub' as const, dim: tagDim('developers'), items: devs },
      ...(sameDevPub ? [] : [{ kind: 'devpub' as const, dim: tagDim('publishers'), items: pubs }]),
    ];
  });
  return (
    <Show when={!props.game.loading}>
      <TagCloud groups={groups()} />
    </Show>
  );
}

// Store and ITAD are the two links everyone wants at a glance and stay directly in the header
// row — Workshop/Website are each conditional, tucked into a single "⋯ More" menu instead (see
// the original file's own comment, preserved in git history, for the full reasoning).
function MoreLinks(props: { game: ReadonlyGame }): JSX.Element {
  const items = () => [
    !props.game.loading && (props.game.details?.meta?.categories || []).includes('Steam Workshop') &&
      { icon: '🛠️', label: 'Steam Workshop', href: `https://steamcommunity.com/app/${props.game.appid}/workshop/` },
    props.game.details?.meta?.website && { icon: '🌐', label: 'Official Website', href: props.game.details.meta.website },
    { icon: '🔎', label: 'More Like This (Steam)', href: `https://store.steampowered.com/recommended/morelike/app/${props.game.appid}/` },
  ].filter((it): it is { icon: string; label: string; href: string } => !!it);

  return (
    <Show when={items().length}>
      <div class="panel-icon-more">
        <button type="button" class="panel-icon-link panel-icon-more-btn" aria-haspopup="true" aria-expanded={moreLinksOpen() ? 'true' : 'false'} title="More links" aria-label="More links" onClick={() => setMoreLinksOpen(!moreLinksOpen())}>⋯</button>
        <Show when={moreLinksOpen()}>
          <div class="panel-icon-more-menu">
            <For each={items()}>{it => <a class="panel-icon-more-item" href={safeHref(it.href) || undefined} target="_blank" rel="noopener">{it.icon} {it.label}</a>}</For>
          </div>
        </Show>
      </div>
    </Show>
  );
}

function RefreshButton(props: { game: ReadonlyGame }): JSX.Element {
  const age = () => props.game.detailsFetchedAt === undefined ? '' : ` — last fetched ${fmtAge(props.game.detailsFetchedAt)}`;
  return (
    <Show when={panelOptions.onRefresh && !props.game.loading}>
      <button
        type="button"
        class={`panel-refresh-btn${panelRefreshing() ? ' is-refreshing' : ''}`}
        disabled={panelRefreshing()}
        title={`Refresh rating, HLTB & store details for this game${age()}`}
        aria-label="Refresh details"
        onClick={handlePanelRefresh}
      >↻</button>
    </Show>
  );
}

// "In library" / "On wishlist" status — unlike the Price card, this one *is* fetched by panel.tsx
// itself (the `ownership` resource above), against `currentAccount` (whichever account's list is
// actually on screen — see myOwnership.ts's own comment for why this used to be `myAccount` and
// isn't anymore) rather than a separately pinned identity, so it always has exactly one
// unambiguous /lists/owned or /lists/wishlist to link to. See the original file's own comment
// (preserved in git history) for the "why 'In library' not 'In your library'" reasoning this
// label wording still follows. Links to `?game=<appid>` on that list (not the bare route) so
// landing there also reopens this exact game, same as `copyPanelLink`'s own `/game/<appid>` link
// opens a specific game rather than just a list.
//
// withAccountParam: these badges answer "does the account currently on screen have this", which
// is the `?u=` link's account when one is being explored (see myOwnership.ts / accountsStore.ts's
// own `?u=` section) — so the list they link to has to be that same account's, not the visitor's
// own stored one. `copyPanelLink` above deliberately does NOT do this: that link is the game's
// canonical shareable address, and carrying whichever account the sender happened to be exploring
// into it would make it explore that account for everyone it's shared with.
//
// Read off the resource, not off `g.inLibrary`/`g.onWishlist`: those two fields still exist, but
// they're the *table's* copy of this, stamped onto every row by the host route for its ✓/☆
// name-cell markers (see gameColumns.ts) — a standalone lookup or a DLC hop is never one of those
// rows and would have no badge at all. The resource answers for any open game, and both go
// through myOwnership.ts's one cached pair of sets, so they can't disagree.
function OwnershipRow(props: { game: ReadonlyGame }): JSX.Element {
  const own = () => panelData.ownership();
  return (
    <Show when={own()?.inLibrary || own()?.onWishlist}>
      <div class="panel-ownership-row">
        <Show when={own()?.inLibrary}><A class="panel-ownership-badge owned" href={withAccountParam(`/lists/owned?game=${props.game.appid}`)}>✓ In library</A></Show>
        <Show when={own()?.onWishlist}><A class="panel-ownership-badge wishlisted" href={withAccountParam(`/lists/wishlist?game=${props.game.appid}`)}>☆ On wishlist</A></Show>
      </div>
    </Show>
  );
}

// A sticky jump-nav for the sections below the fold — see the original file's own comment
// (preserved in git history) for the full reasoning. Listed in the same order the sections
// actually appear below (Owners right after the tag cloud, ahead of the collapsibles) so
// scroll-spy highlighting (see updateSubnavScrollSpy) always lights up left-to-right.
function PanelSubnav(props: { game: ReadonlyGame }): JSX.Element {
  // Each condition counts a section only once it has *confirmed* content (or a confirmed
  // failure, which renders its own "couldn't load" card) — deliberately NOT while its fetch is
  // still in flight, even though the loading skeleton is on screen by then. A still-pending
  // section isn't a jump target yet, and counting one makes this list non-monotonic: News would
  // be true while `news.loading`, then false again for a game whose news resolves empty. Through
  // the `< 2` gate below, that took the whole bar — Overview button included — down with it, so
  // the bar flashed in and out as the panel's own fetches settled (measured live: visible at
  // 4104ms, gone at 4126ms, for a game with no news/HLTB/DLC). Every term here now only ever
  // goes absent → present as a game loads, so the bar appears at most once per open and never
  // disappears.
  //
  // Each mirrors its own section component's gating, computed as a plain boolean rather than by
  // checking a rendered `<Component/>` call's own truthiness (always truthy regardless of what it
  // renders to, including `null`).
  const items = createMemo(() => {
    const g = props.game;
    const h = g.details?.hltb;
    const news = panelData.news();
    return [
      !!panelData.owners()?.length && { label: 'Owned by', target: 'panel-section-owners' },
      !g.loading && !!h && !!(h.main || h.extra || h.completionist) && { label: 'HLTB', target: 'panel-section-hltb' },
      (news === null || !!news?.length) && { label: 'News', target: 'panel-section-news' },
      panelData.achievements() !== undefined && { label: 'Achievements', target: 'panel-section-achievements' },
      !!g.details?.meta?.dlc?.length && { label: 'DLC', target: 'panel-section-dlc' },
    ].filter((it): it is { label: string; target: string } => !!it);
  });

  // Re-run the scroll-spy whenever the set of buttons changes, since a newly rendered button
  // starts out without the `active` class the spy assigns imperatively (it has to measure where
  // each section actually sits). Queued as a microtask so it runs after Solid has patched the
  // DOM. Nothing else needs this anymore: the buttons themselves are no longer thrown away and
  // rebuilt every time some unrelated field of the game changes.
  createEffect(() => {
    items();
    queueMicrotask(updateSubnavScrollSpy);
  });

  return (
    <Show when={items().length >= 2}>
      <div class="panel-subnav">
        <button type="button" class="panel-subnav-btn" data-target="top" onClick={() => jumpToPanelSection('top')}>Overview</button>
        <For each={items()}>{it => <button type="button" class="panel-subnav-btn" data-target={it.target} onClick={() => jumpToPanelSection(it.target)}>{it.label}</button>}</For>
      </div>
    </Show>
  );
}

function PanelRest(props: { game: ReadonlyGame }): JSX.Element {
  // The one deliberate capture of a "reactive variable" in this file: `props.game` is the game
  // *object*, and PanelBody renders this component under a `keyed` <Show>, so a different game
  // means a new PanelRest rather than a new value for this prop. The object itself is a Solid
  // store row, so every `g.field` read below is still tracked individually — capturing the row
  // is not the same thing as capturing a field of it.
  // eslint-disable-next-line solid/reactivity
  const g = props.game;
  const meta = () => g.details?.meta;

  // `description` (Steam's `short_description`) can carry literal HTML entities as plain text
  // (e.g. "Baldur's Gate..." legitimately has "&amp;" for "Dungeons & Dragons"), and JSX text
  // interpolation doesn't decode entities on its own — decoding it inertly via a DOMParser
  // document that's never attached to the page (runs no scripts, loads no resources) and then
  // rendering the decoded *text* (never raw markup/innerHTML) is what the original file did too;
  // preserved verbatim here since JSX interpolation is already exactly as safe as that
  // plain-text insert was.
  const description = () => meta()?.description;
  const decodedDescription = () => {
    const d = description();
    return d ? new DOMParser().parseFromString(d, 'text/html').body.textContent || '' : '';
  };

  // "← Back" only appears once a DLC hop is actually in progress — a plain table-row click never
  // gets this button, only a game reached by following a DLC link (or by going back through more
  // than one of them) does.
  const back = () => { const hist = panelHistory(); return hist.length ? hist[hist.length - 1] : null; };

  // Release date and "DLC for X" folded onto one line ("<date> · DLC for X") since both are
  // short, secondary metadata about the same thing. `hasBaseGame` is a plain boolean rather than
  // the rendered element's own truthiness (a `<Component/>` call is truthy regardless of what it
  // renders to, including `null`) so the separator and the link itself can never disagree about
  // whether there's a base game to show.
  const releaseDate = () => meta()?.releaseDate;
  const hasBaseGame = () => !g.loading && !!meta()?.fullgame;

  return (
    <>
      <div class="panel-header-sticky">
        <Show when={back()}>
          {prev => (
            <button type="button" class="panel-back-btn" title={`Back to ${prev().name}`} onClick={panelGoBack}>
              &#8249; {prev().name}
            </button>
          )}
        </Show>
        <div class="panel-title-row">
          <div>
            {/* The `App <appid>` fallback is presentational only — a game looked up by bare appid
                has no name at all until store metadata resolves one, and nothing persists this
                string as if it were a real title (see ListRoute.tsx's recents mapping). */}
            <div class="panel-title" id="panel-title">{g.name || `App ${g.appid}`}</div>
            <Show when={releaseDate() || hasBaseGame()}>
              <div class="panel-release">
                {releaseDate()}
                <Show when={releaseDate() && hasBaseGame()}><span class="panel-meta-sep"> · </span></Show>
                <Show when={hasBaseGame()}><BaseGameLink game={g} /></Show>
              </div>
            </Show>
            <OwnershipRow game={g} />
          </div>
          <div class="panel-icon-links">
            <a class="panel-icon-link" href={`https://store.steampowered.com/app/${g.appid}`} target="_blank" rel="noopener" title="Steam Store" aria-label="Steam Store">🛒</a>
            <a class="panel-icon-link" href={`https://isthereanydeal.com/steam/app/${g.appid}`} target="_blank" rel="noopener" title="IsThereAnyDeal" aria-label="IsThereAnyDeal">$</a>
            <MoreLinks game={g} />
            <span class="panel-icon-divider" role="separator" aria-hidden="true" />
            <button type="button" class="panel-icon-link panel-copy-link-btn" title="Copy link to this game" aria-label="Copy link to this game" onClick={copyPanelLink}>🔗</button>
            <RefreshButton game={g} />
          </div>
        </div>
        <PanelSubnav game={g} />
      </div>
      {/* A free demo is a "try before you buy" call to action, not supplementary info like the
          Website/Workshop links tucked into "⋯ More". */}
      <Show when={!g.loading && g.details?.demo}>
        {demo => (
          <a class="panel-demo-banner" href={safeHref(`https://store.steampowered.com/app/${demo().appid}`) || undefined} target="_blank" rel="noopener">
            <span class="panel-demo-banner-icon">🎮</span> Try the Free Demo
          </a>
        )}
      </Show>
      <GlanceGrid game={g} />
      <Show when={!g.loading}><PriceSection game={g} /></Show>
      <Show when={description()}>
        <div class="panel-desc panel-card" id="panel-desc">{decodedDescription()}</div>
      </Show>
      <TagCloudSection game={g} />
      <OwnersSection />
      <HltbSection game={g} />
      <NewsSection game={g} />
      <AchievementsSection game={g} />
      <Show when={!g.loading}><DlcSection game={g} /></Show>
    </>
  );
}

function PanelBody(): JSX.Element {
  return (
    <>
      <PanelHero />
      {/* `keyed`, so the body below is rebuilt when the panel moves to a *different game* — and
          only then. Every field of the game itself is read reactively off the store row (see
          PanelRest), so data streaming in for the game already on screen patches the one thing it
          changed instead of re-rendering anything. */}
      <Show when={panelGame()} keyed>
        {game => <PanelRest game={game} />}
      </Show>
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
