'use strict';

import { buildMediaItems, resolveShotIndex, preferredShotIndex } from './mediaItems.ts';
import type { MediaItem } from './mediaItems.ts';
import type { Game, ReadonlyGame } from './types.ts';
import type Hls from 'hls.js';
// Pulled into its own plain-TS module (no JSX) so test/lightbox.test.js can still import it
// directly — Node's test runner strips TypeScript syntax natively but has no JSX transform,
// so it can no longer `require()` this file itself once it contains real JSX. Re-exported
// below so this stays the one public entry point for it either way.
import { fmtTime } from './lightboxTime.ts';
export { fmtTime } from './lightboxTime.ts';

import { createSignal, createEffect, createRoot, batch } from 'solid-js';
import { render } from 'solid-js/web';

// ── Icons ──────────────────────────────────────────────────────────────────

const LB_FS_ENTER  = `<svg viewBox="0 0 12 12" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" aria-hidden="true"><polyline points="4,1 1,1 1,4"/><polyline points="8,1 11,1 11,4"/><polyline points="1,8 1,11 4,11"/><polyline points="11,8 11,11 8,11"/></svg>`;
const LB_LINK_ICON = `<svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M5.5 8.5a3 3 0 0 0 4.24 0l1.42-1.42a3 3 0 0 0-4.24-4.24l-.71.71"/><path d="M8.5 5.5a3 3 0 0 0-4.24 0L2.84 6.92a3 3 0 0 0 4.24 4.24l.71-.71"/></svg>`;
const LB_CHECK_ICON = `<svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="2,7 5.5,11 12,3"/></svg>`;
const LB_FS_EXIT   = `<svg viewBox="0 0 12 12" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" aria-hidden="true"><polyline points="1,4 1,1 4,1"/><polyline points="11,4 11,1 8,1"/><polyline points="4,11 1,11 1,8"/><polyline points="8,11 11,11 11,8"/></svg>`;
const LB_PLAY_ICON  = `<svg viewBox="0 0 12 12" width="16" height="16" fill="currentColor" aria-hidden="true"><polygon points="2,1 11,6 2,11"/></svg>`;
const LB_PAUSE_ICON = `<svg viewBox="0 0 12 12" width="16" height="16" fill="currentColor" aria-hidden="true"><rect x="1" y="1" width="4" height="10" rx="0.5"/><rect x="7" y="1" width="4" height="10" rx="0.5"/></svg>`;
const LB_VOL_ICON   = `<svg viewBox="0 0 14 12" width="16" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><polygon points="1,4 5,4 8,1 8,11 5,8 1,8" fill="currentColor" stroke="none"/><path d="M10 3.5c1 .9 1.5 1.7 1.5 2.5S11 8.1 10 9" stroke-linecap="round"/></svg>`;
const LB_MUTE_ICON  = `<svg viewBox="0 0 14 12" width="16" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><polygon points="1,4 5,4 8,1 8,11 5,8 1,8" fill="currentColor" stroke="none"/><line x1="10.5" y1="4" x2="13.5" y2="8" stroke-linecap="round"/><line x1="13.5" y1="4" x2="10.5" y2="8" stroke-linecap="round"/></svg>`;

// ── State ──────────────────────────────────────────────────────────────────
// Converted from plain module-level variables to Solid signals for
// the state that actually needs to trigger the (still deliberately imperative — see the
// header comment above `renderLightbox` further down) per-step render: the open game and
// `idx`. Zoom/pan (`lbZoom`/`lbPanX`/`lbPanY`) and the slide-direction flag (`lbLastDir`)
// stay plain variables, unchanged — nothing in JSX ever reads them (they only ever drive a
// direct `img.style.transform`/animation-class write inside already-imperative gesture code),
// so making them signals would add Solid overhead for zero reactive benefit, the same
// reasoning `panel.tsx`'s own hero zoom-equivalent state would have gotten if this file had
// any (it doesn't).
const [lbGame, setLbGame] = createSignal<ReadonlyGame | null>(null);
const [idx, setIdx] = createSignal(0);
// Derived from the open game on each read, not snapshotted at open time — the same shape, for
// the same reason, as `PanelHero`'s own `items()` (panel.tsx): a row opened before its details
// have streamed in has nothing but a banner to offer, and gains its screenshots and videos
// asynchronously *without the row object ever being replaced*, so only a read through the store
// proxy sees them arrive. Snapshotting meant such a game showed that lone banner for as long as
// it stayed open. Plain accessors rather than `createMemo`s: a memo at module level would need
// its own `createRoot` (see the effect at the foot of this file) to cache two array spreads.
const shots = () => { const g = lbGame(); return g ? buildMediaItems(g.appid, g.details?.meta) : []; };
const gameName = () => lbGame()?.name ?? '';
let lbZoom = 1, lbPanX = 0, lbPanY = 0, lbLastDir = 0, lbVcTimer: ReturnType<typeof setTimeout> | undefined;

type LbVideo = HTMLVideoElement & { _hls?: { destroy: () => void } | null; _hlsToken?: number };
type LbFlashEl = HTMLElement & { _flashTimer?: ReturnType<typeof setTimeout> };

const LB_SEEK_SECONDS = 5;
const LB_DOUBLE_TAP_MS = 300;
const LB_DOUBLE_TAP_DIST = 30;

let _onLightboxParamChange: ((shotId: string | null) => void) | null = null;
let _onGameNav: ((dir: number) => void) | null = null;
let _onGameRandom: (() => void) | null = null;
let _getGamePosition: (() => { index: number; total: number } | null) | null = null;
// Set when a re-point landed on a banner for want of anything else — see `repointLightboxGame`.
// Holds the *kind* of shot being left, so the screenshot/trailer that eventually arrives is
// picked by the same rule the re-point itself would have used.
let _awaitingMedia: MediaItem['type'] | null = null;
let _lbPrevFocus: Element | null = null;
const _lbPrefetchedHls = new Set();

// ── Init ───────────────────────────────────────────────────────────────────

// `onGameNav(dir)`/`onGameRandom()`: the host's own prev/next-game step and random pick (the
// same ones the panel itself offers) — they let ↑/↓ and R page games while the lightbox stays
// open, jumping straight to the new game's own media (see `renderLightbox`'s caption for how
// the switch is made visible), rather than either doing nothing or silently switching games
// behind a fullscreen image that never changed. Both re-point through `repointLightboxGame`.
// `getGamePosition()`: where the open game sits in that list, for the caption — null when there
// is no list to page through at all (a standalone lookup), which is also what hides the caption's
// own ↑/↓ buttons. All optional; a host with none of them just no-ops.
export function initLightbox({ onParamChange, onGameNav, onGameRandom, getGamePosition }: {
  onParamChange?: (shotId: string | null) => void;
  onGameNav?: (dir: number) => void;
  onGameRandom?: () => void;
  getGamePosition?: () => { index: number; total: number } | null;
} = {}) {
  _onLightboxParamChange = onParamChange ?? null;
  _onGameNav = onGameNav ?? null;
  _onGameRandom = onGameRandom ?? null;
  _getGamePosition = getGamePosition ?? null;
  document.addEventListener('fullscreenchange', syncLightboxFullscreenBtn);
  document.addEventListener('webkitfullscreenchange', syncLightboxFullscreenBtn);
  mountLightboxDom();
}

export function isLightboxOpen() { return lbGame() !== null; }

// Every game step from inside the lightbox (↑/↓, R, the caption's own buttons) goes through
// here. The host's step opens the panel *behind* the overlay, and `panelOpen` focuses that
// panel's hero image — which drops focus straight out of the lightbox's own trap onto an element
// the lightbox is covering. Whatever had focus in here keeps it, so holding ↓ on the caption
// button doesn't walk focus away mid-click; the close button is the fallback, as on a real open.
function stepGameFromLightbox(step: () => void) {
  const lb = document.getElementById('screenshot-lightbox')!;
  const before = document.activeElement;
  step();
  if (lb.contains(document.activeElement)) return;
  ((before && lb.contains(before) ? before : lb.querySelector('.lb-close')) as HTMLElement).focus();
}

// ── Fullscreen button sync ─────────────────────────────────────────────────

// Lazily cast (not a module-level const) — a `document` reference at module
// load would throw in the Node test environment (no DOM), which imports this
// file just for `fmtTime`.
function webkitDoc(): Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void } {
  return document as Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };
}

function syncLightboxFullscreenBtn() {
  const btn = document.querySelector('#screenshot-lightbox .lb-fullscreen');
  if (!btn) return;
  const isFs = !!(document.fullscreenElement || webkitDoc().webkitFullscreenElement);
  btn.innerHTML = isFs ? LB_FS_EXIT : LB_FS_ENTER;
  btn.setAttribute('aria-label', isFs ? 'Exit fullscreen' : 'Enter fullscreen');
}

// ── Video playback (HLS) ───────────────────────────────────────────────────

// hls.js is ~130KB gzipped — dwarfing the rest of this app's own JS combined — for a library
// only Safari's *own* native HLS support (the canPlayType branch below) doesn't need at all,
// and which most panel opens never touch regardless of browser (screenshots, not video, are
// the common case). Loaded via a dynamic import the first time a non-Safari browser actually
// needs to play a video, instead of a static import that shipped it to every page load
// unconditionally. Memoized so a second video only pays the (already-resolved) promise, not a
// second network fetch; also let's the adjacent-shot prefetch below warm this same promise
// ahead of the user actually reaching a video shot, same idea as its existing manifest prefetch.
let _hlsModulePromise: Promise<any> | null = null;
function loadHlsModule(): Promise<any> {
  return (_hlsModulePromise ??= import('hls.js').then(m => m.default));
}

async function playHls(videoEl: LbVideo, src: string | null | undefined) {
  if (!src) return;
  hideLbError();
  if (videoEl._hls) { videoEl._hls.destroy(); videoEl._hls = null; }
  if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
    // Assigned as a property (not addEventListener) since videoEl is reused
    // across shots — a property assignment overwrites rather than stacking.
    videoEl.onerror = () => showLbError("Couldn't load this video.");
    videoEl.src = src;
    videoEl.play().catch(() => {});
    return;
  }
  // videoEl is reused across shots, and loading hls.js is async — guard against a stale
  // load resolving after the user already stepped to a different shot (stopHls bumps this
  // same token) or reopened this same videoEl with a newer playHls call in the meantime.
  const token = (videoEl._hlsToken = (videoEl._hlsToken || 0) + 1);
  const Hls = await loadHlsModule();
  if (videoEl._hlsToken !== token) return;
  if (!Hls.isSupported()) return;
  const hls = new Hls({ autoStartLoad: true, startLevel: -1 });
  hls.on(Hls.Events.ERROR, (_event: unknown, data: { fatal?: boolean }) => {
    if (data?.fatal) showLbError("Couldn't load this video.");
  });
  hls.loadSource(src);
  hls.attachMedia(videoEl);
  hls.on(Hls.Events.MANIFEST_PARSED, () => videoEl.play().catch(() => {}));
  videoEl._hls = hls;
}

function stopHls(videoEl: LbVideo | null) {
  if (!videoEl) return;
  videoEl.pause();
  videoEl._hlsToken = (videoEl._hlsToken || 0) + 1; // invalidate any in-flight playHls() load
  if (videoEl._hls) { videoEl._hls.destroy(); videoEl._hls = null; }
  videoEl.removeAttribute('src');
}

// ── Load errors (image/video) ──────────────────────────────────────────────

function showLbError(msg: string) {
  const lb = document.getElementById('screenshot-lightbox');
  if (!lb) return;
  lb.classList.remove('lb--loading');
  const err = lb.querySelector<HTMLElement>('.lb-error')!;
  err.querySelector<HTMLElement>('.lb-error-msg')!.textContent = msg;
  err.style.display = 'flex';
}

function hideLbError() {
  const lb = document.getElementById('screenshot-lightbox');
  const err = lb?.querySelector<HTMLElement>('.lb-error');
  if (err) err.style.display = 'none';
}

// Re-attempts loading whatever shot is currently shown, from the Retry button.
function retryCurrentShot() {
  hideLbError();
  const shot = shots()[idx()];
  if (!shot) return;
  if (shot.type === 'video') {
    const vid = document.querySelector<LbVideo>('#screenshot-lightbox .lb-video')!;
    playHls(vid, shot.hls);
  } else {
    const img = document.querySelector<HTMLImageElement>('#screenshot-lightbox .lb-img')!;
    const lb = document.getElementById('screenshot-lightbox');
    lb?.classList.add('lb--loading');
    // Cache-bust: a browser that already recorded this exact URL as failed
    // won't necessarily re-attempt the network request otherwise.
    const bust = shot.main! + (shot.main!.includes('?') ? '&' : '?') + '_retry=' + Date.now();
    const full = new Image();
    full.onload  = () => { img.src = bust; img.style.opacity = '1'; lb?.classList.remove('lb--loading'); };
    full.onerror = () => { img.style.opacity = '0'; lb?.classList.remove('lb--loading'); showLbError("Couldn't load this image."); };
    full.src = bust;
  }
}

// ── Zoom / pan ─────────────────────────────────────────────────────────────

function applyLbTransform() {
  const img = document.querySelector<HTMLImageElement>('#screenshot-lightbox .lb-img');
  if (!img) return;
  if (lbZoom === 1) {
    lbPanX = 0; lbPanY = 0;
    img.style.transform = '';
    img.style.cursor = '';
  } else {
    const maxX = img.offsetWidth  * (lbZoom - 1) / 2;
    const maxY = img.offsetHeight * (lbZoom - 1) / 2;
    lbPanX = Math.max(-maxX, Math.min(maxX, lbPanX));
    lbPanY = Math.max(-maxY, Math.min(maxY, lbPanY));
    img.style.transform = `scale(${lbZoom}) translate(${lbPanX / lbZoom}px, ${lbPanY / lbZoom}px)`;
    img.style.cursor = 'grab';
  }
}

function resetLbZoom() {
  lbZoom = 1; lbPanX = 0; lbPanY = 0;
  applyLbTransform();
}

// Zooms 2x centered on a given viewport point — shared by desktop dblclick
// and touch double-tap.
function lbZoomTowardPoint(clientX: number, clientY: number) {
  const img = document.querySelector<HTMLImageElement>('#screenshot-lightbox .lb-img');
  if (!img) return;
  const rect = img.getBoundingClientRect();
  lbZoom = 2;
  lbPanX = -(clientX - rect.left - rect.width  / 2);
  lbPanY = -(clientY - rect.top  - rect.height / 2);
  applyLbTransform();
  img.style.cursor = 'grab';
}

// ── Video seeking (keyboard arrows + touch double-tap) ─────────────────────

const LB_TOUCH_SEEK_SECONDS = 10; // matches the common mobile-player convention (YouTube etc.)

function seekVideo(vid: HTMLVideoElement | null, deltaSeconds: number) {
  if (!vid) return;
  vid.currentTime = Math.max(0, Math.min(vid.duration || Infinity, vid.currentTime + deltaSeconds));
  showLbChrome();
  schedHideLbChrome();
}

// Transient "⏪10s" / "10s⏩" flash shown on a touch double-tap seek. Each
// side tracks its own hide timer (rather than one shared timer) so a
// double-tap on one side can't be cut short by one on the other.
function flashSeek(side: 'left' | 'right') {
  const lb = document.getElementById('screenshot-lightbox');
  const el = lb?.querySelector<HTMLElement>(`.lb-seek-flash-${side}`);
  if (!el) return;
  const flash = el as LbFlashEl;
  clearTimeout(flash._flashTimer);
  el.classList.add('lb-seek-flash--show');
  flash._flashTimer = setTimeout(() => el.classList.remove('lb-seek-flash--show'), 500);
}

// `fmtTime` itself now lives in `./lightboxTime.ts` (see the import at the top of this file)
// and is re-exported below.

function lbScrubGradient(pct: number) {
  return `linear-gradient(to right, var(--accent) ${pct}%, rgba(255,255,255,0.25) ${pct}%)`;
}

// Zeroes out the scrubber/time labels immediately so a newly-loaded video
// doesn't briefly show the previous video's playhead position — the video
// element's own 'timeupdate'/'durationchange' events lag behind the src swap.
function resetLbVc(vc: HTMLElement) {
  const scrub = vc.querySelector<HTMLInputElement>('.lb-vc-scrub')!;
  scrub.value = String(0);
  scrub.style.backgroundImage = lbScrubGradient(0);
  vc.querySelector<HTMLElement>('.lb-vc-time')!.textContent = '0:00';
  vc.querySelector<HTMLElement>('.lb-vc-dur')!.textContent = '0:00';
}

// ── Chrome (toolbar/nav/video-controls) idle-hide ──────────────────────────

// Idle state hides ALL lightbox chrome (video controls, prev/next, toolbar)
// and the mouse cursor while the viewer is inactive — whether a video is
// playing unattended or it's just a still image sitting there. A *paused*
// video is the one exception: it stays fully visible regardless of the
// timer, since "paused" itself already signals the viewer is looking at it.
function showLbChrome() {
  const lb = document.getElementById('screenshot-lightbox');
  if (!lb) return;
  lb.classList.remove('lb-idle');
  clearTimeout(lbVcTimer);
}

function schedHideLbChrome() {
  const lb  = document.getElementById('screenshot-lightbox');
  if (!lb) return;
  const vid = lb.querySelector<HTMLVideoElement>('.lb-video');
  const isPausedVideo = vid && vid.style.display !== 'none' && vid.paused;
  clearTimeout(lbVcTimer);
  if (!isPausedVideo) lbVcTimer = setTimeout(() => lb.classList.add('lb-idle'), 3000);
}

// ── Focus helpers ──────────────────────────────────────────────────────────

// Returns all focusable elements that are not inside a display:none ancestor.
function getFocusable(lb: HTMLElement): HTMLElement[] {
  return [...lb.querySelectorAll<HTMLElement>('button:not([disabled]), input[type="range"]')]
    .filter(el => {
      let node: HTMLElement | null = el;
      while (node && node !== lb) {
        if (node.style.display === 'none') return false;
        node = node.parentElement;
      }
      return true;
    });
}

// ── DOM creation ───────────────────────────────────────────────────────────
// A real Solid component now (was a hand-built innerHTML template assigned once to a
// lazily-created singleton element). Mounted exactly once via `mountLightboxDom` below
// (called from `initLightbox`, same "once per page" lifetime the old lazy-singleton getter
// amounted to in practice — nothing about creating this ~20-node tree eagerly instead of on
// first open is expensive enough to matter). Every class/id is preserved verbatim, so
// `style.css` and every `document.getElementById('screenshot-lightbox')`/`.lb-*` selector
// used throughout the rest of this file (the wiring functions below, all of which are
// unchanged) keeps working exactly as before — this conversion only touches how the markup
// itself is produced and mounted, not how the rest of the file finds or manipulates it.
function LightboxDom() {
  return (
    <div id="screenshot-lightbox" role="dialog" aria-modal="true" aria-label="Screenshot viewer">
      <div class="lb-backdrop" />
      <button class="lb-btn lb-prev" aria-label="Previous screenshot">&#8249;</button>
      <img class="lb-img" src="" alt="Screenshot" />
      <video class="lb-video" playsinline />
      <button class="lb-btn lb-next" aria-label="Next screenshot">&#8250;</button>
      <div class="lb-error" style={{ display: 'none' }} role="alert">
        <p class="lb-error-msg" />
        <button class="lb-error-retry">Retry</button>
      </div>
      <div class="lb-seek-flash lb-seek-flash-left" aria-hidden="true">⏪ {LB_TOUCH_SEEK_SECONDS}s</div>
      <div class="lb-seek-flash lb-seek-flash-right" aria-hidden="true">{LB_TOUCH_SEEK_SECONDS}s ⏩</div>
      <div class="lb-vctrls" style={{ display: 'none' }}>
        {/* eslint-disable-next-line solid/no-innerhtml -- a module-level literal SVG string
            from the top of this file, not data: nothing here comes from a game, a user, or an
            API response. Solid's JSX can't express a raw SVG child any other way. */}
        <button class="lb-vc-btn lb-vc-play" aria-label="Play" innerHTML={LB_PLAY_ICON} />
        <span class="lb-vc-time">0:00</span>
        <input class="lb-vc-scrub" type="range" min="0" max="1" step="0.001" value="0" aria-label="Seek" />
        <span class="lb-vc-dur">0:00</span>
        {/* eslint-disable-next-line solid/no-innerhtml -- a module-level literal SVG string
            from the top of this file, not data: nothing here comes from a game, a user, or an
            API response. Solid's JSX can't express a raw SVG child any other way. */}
        <button class="lb-vc-btn lb-vc-mute" aria-label="Mute" innerHTML={LB_VOL_ICON} />
      </div>
      <div class="lb-toolbar">
        {/* The caption doubles as the list stepper: ↑/↓ flanking "<game> · 14 of 343" put the
            control on the thing it changes, and cover the axis the edge ‹ › don't (they step
            media within one game). Both buttons are hidden when there's no list to page
            through — see `_getGamePosition`. */}
        <div class="lb-caption">
          <button class="lb-game-prev" aria-label="Previous game">&#8593;</button>
          <span class="lb-caption-text" />
          <span class="lb-caption-pos" />
          <button class="lb-game-next" aria-label="Next game">&#8595;</button>
        </div>
        <div class="lb-toolbar-row">
          <div class="lb-toolbar-left">
            {/* eslint-disable-next-line solid/no-innerhtml -- module-level literal SVG strings
                (see the top of this file); no external input reaches these. */}
            <button class="lb-fullscreen" aria-label="Enter fullscreen" innerHTML={LB_FS_ENTER} />
            {/* eslint-disable-next-line solid/no-innerhtml -- module-level literal SVG strings
                (see the top of this file); no external input reaches these. */}
            <button class="lb-share" aria-label="Copy link to this screenshot" innerHTML={LB_LINK_ICON} />
          </div>
          <div class="lb-counter" aria-live="polite" aria-atomic="true" />
          <div class="lb-toolbar-right">
            <button class="lb-close" aria-label="Close lightbox">&#215;</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Event wiring ───────────────────────────────────────────────────────────
// Unchanged from the original file (still plain imperative addEventListener wiring against
// `lb.querySelector(...)`, not JSX event props) — these bind once, to a singleton element
// that (like the original) never gets torn down/rebuilt, so there's no fine-grained-vs-coarse
// reactivity question to answer here the way panel.tsx had for its own repeatedly-rebuilt
// body: the actual per-shot update logic lives in `renderLightbox` below (now a `createEffect`
// triggered by the `shots`/`idx`/`gameName` signals above), not in these handlers.

function wireButtons(lb: HTMLElement) {
  lb.querySelector('.lb-backdrop')!.addEventListener('click', closeLightbox);
  lb.querySelector('.lb-close')!.addEventListener('click', closeLightbox);
  lb.querySelector('.lb-share')!.addEventListener('click', async () => {
    const btn = lb.querySelector<HTMLElement>('.lb-share')!;
    try {
      await navigator.clipboard.writeText(location.href);
      btn.innerHTML = LB_CHECK_ICON;
      setTimeout(() => { btn.innerHTML = LB_LINK_ICON; }, 1500);
    } catch {
      window.prompt('Copy this link:', location.href);
    }
  });
  lb.querySelector('.lb-error-retry')!.addEventListener('click', retryCurrentShot);
  lb.querySelector('.lb-prev')!.addEventListener('click', () => stepLightbox(-1));
  lb.querySelector('.lb-next')!.addEventListener('click', () => stepLightbox(1));
  lb.querySelector('.lb-game-prev')!.addEventListener('click', () => stepGameFromLightbox(() => _onGameNav?.(-1)));
  lb.querySelector('.lb-game-next')!.addEventListener('click', () => stepGameFromLightbox(() => _onGameNav?.(1)));
  lb.querySelector('.lb-fullscreen')!.addEventListener('click', () => {
    if (document.fullscreenElement || webkitDoc().webkitFullscreenElement) {
      (document.exitFullscreen?.() ?? webkitDoc().webkitExitFullscreen?.())?.catch?.(() => {});
    } else {
      (lb.requestFullscreen?.() ?? (lb as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> }).webkitRequestFullscreen?.())?.catch?.(() => {});
    }
  });
}

function wireKeyboard(lb: HTMLElement) {
  document.addEventListener('keydown', e => {
    if (!isLightboxOpen()) return;
    const onScrub = (e.target as HTMLElement | null)?.classList.contains('lb-vc-scrub');

    // Focus trap
    if (e.key === 'Tab') {
      const focusable = getFocusable(lb);
      if (!focusable.length) return;
      const first = focusable[0];
      const last  = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last)  { e.preventDefault(); first.focus(); }
      }
      return;
    }

    const vc = lb.querySelector<HTMLElement>('.lb-vctrls');
    const vid = vc && vc.style.display !== 'none' ? lb.querySelector<HTMLVideoElement>('.lb-video') : null;

    if ((!onScrub || e.shiftKey) && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      // While a video is playing, bare arrows seek it in place so the user
      // isn't yanked to the next screenshot mid-scrub; Shift+arrow always
      // forces media navigation instead, as an explicit escape hatch — even
      // when focus is on the scrub bar itself, whose native range-input
      // behavior would otherwise consume a bare arrow key to nudge its value.
      if (vid && !e.shiftKey) {
        seekVideo(vid, dir * LB_SEEK_SECONDS);
      } else {
        stepLightbox(dir);
      }
    }
    if (!onScrub && (e.key === 'Home' || e.key === 'End') && shots().length > 1) {
      e.preventDefault();
      gotoLightbox(e.key === 'Home' ? 0 : shots().length - 1);
    }
    if (!onScrub && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && _onGameNav) {
      e.preventDefault();
      stepGameFromLightbox(() => _onGameNav!(e.key === 'ArrowDown' ? 1 : -1));
    }
    // R, the same random pick the panel offers — page-level shortcuts are all blocked while the
    // lightbox is open (panelKeyboard.ts hands it the keyboard wholesale), so it has to be bound
    // here to work at all, exactly as ↑/↓ above do.
    if (!onScrub && (e.key === 'r' || e.key === 'R') && _onGameRandom) {
      e.preventDefault();
      stepGameFromLightbox(() => _onGameRandom!());
    }
    if (e.key === 'f' || e.key === 'F') {
      if (document.fullscreenElement || webkitDoc().webkitFullscreenElement) {
        (document.exitFullscreen?.() ?? webkitDoc().webkitExitFullscreen?.())?.catch?.(() => {});
      } else {
        (lb.requestFullscreen?.() ?? (lb as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> }).webkitRequestFullscreen?.())?.catch?.(() => {});
      }
    }
    if (vid) {
      if (e.key === ' ' && !onScrub) { e.preventDefault(); vid.paused ? vid.play().catch(() => {}) : vid.pause(); }
      if (e.key === 'm' || e.key === 'M') { vid.muted = !vid.muted; }
    }
  });
}

function wireMouseHandlers(lb: HTMLElement) {
  lb.addEventListener('wheel', e => {
    if (lb.querySelector<HTMLImageElement>('.lb-img')!.style.display === 'none') return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    lbZoom = Math.max(1, Math.min(4, lbZoom * factor));
    if (lbZoom === 1) { lbPanX = 0; lbPanY = 0; }
    applyLbTransform();
  }, { passive: false });

  const lbImg = lb.querySelector<HTMLImageElement>('.lb-img')!;
  let lbDragging = false, lbDragStartX = 0, lbDragStartY = 0, lbPanStartX = 0, lbPanStartY = 0;
  lbImg.addEventListener('mousedown', e => {
    if (lbZoom <= 1) return;
    lbDragging = true;
    lbDragStartX = e.clientX; lbDragStartY = e.clientY;
    lbPanStartX = lbPanX; lbPanStartY = lbPanY;
    lbImg.style.cursor = 'grabbing';
    e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!lbDragging) return;
    lbPanX = lbPanStartX + (e.clientX - lbDragStartX);
    lbPanY = lbPanStartY + (e.clientY - lbDragStartY);
    applyLbTransform();
  });
  document.addEventListener('mouseup', () => {
    if (!lbDragging) return;
    lbDragging = false;
    lbImg.style.cursor = lbZoom > 1 ? 'grab' : '';
  });
  lbImg.addEventListener('dblclick', e => {
    if (lbZoom > 1) resetLbZoom();
    else lbZoomTowardPoint(e.clientX, e.clientY);
  });
}

function wireTouchHandlers(lb: HTMLElement) {
  let lbX = 0, lbY = 0, lbActive = false;
  let pinchStartDist = 0, pinchStartZoom = 1;
  let touchPanning = false, touchPanStartX = 0, touchPanStartY = 0, touchPanOriginX = 0, touchPanOriginY = 0;
  let lbLastTapTime = 0, lbLastTapX = 0, lbLastTapY = 0;

  lb.addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
      if (lb.querySelector<HTMLImageElement>('.lb-img')!.style.display === 'none') return;
      pinchStartDist = Math.hypot(
        e.touches[1].clientX - e.touches[0].clientX,
        e.touches[1].clientY - e.touches[0].clientY
      );
      pinchStartZoom = lbZoom;
      lbActive = false;
      e.preventDefault();
    } else if (e.touches.length === 1) {
      lbX = e.touches[0].clientX; lbY = e.touches[0].clientY; lbActive = true;
      if (lbZoom > 1) {
        touchPanning = true;
        touchPanStartX = e.touches[0].clientX; touchPanStartY = e.touches[0].clientY;
        touchPanOriginX = lbPanX; touchPanOriginY = lbPanY;
      }
    }
  }, { passive: false });

  lb.addEventListener('touchmove', e => {
    if (e.touches.length === 2) {
      if (lb.querySelector<HTMLImageElement>('.lb-img')!.style.display === 'none') return;
      const dist = Math.hypot(
        e.touches[1].clientX - e.touches[0].clientX,
        e.touches[1].clientY - e.touches[0].clientY
      );
      lbZoom = Math.max(1, Math.min(4, pinchStartZoom * dist / pinchStartDist));
      if (lbZoom === 1) { lbPanX = 0; lbPanY = 0; }
      applyLbTransform();
      e.preventDefault();
    } else if (e.touches.length === 1 && touchPanning) {
      lbPanX = touchPanOriginX + (e.touches[0].clientX - touchPanStartX);
      lbPanY = touchPanOriginY + (e.touches[0].clientY - touchPanStartY);
      applyLbTransform();
      e.preventDefault();
    }
  }, { passive: false });

  lb.addEventListener('touchend', e => {
    if (e.touches.length < 2) touchPanning = false;
    if (!lbActive) return;
    lbActive = false;
    const endX = e.changedTouches[0].clientX, endY = e.changedTouches[0].clientY;
    const dx = endX - lbX, dy = endY - lbY;
    const isTap = Math.abs(dx) < 10 && Math.abs(dy) < 10;
    const showingImg = lb.querySelector<HTMLImageElement>('.lb-img')!.style.display !== 'none';
    const showingVid = lb.querySelector<HTMLVideoElement>('.lb-video')!.style.display !== 'none';
    if (isTap && (showingImg || showingVid)) {
      const now = Date.now();
      const tapDist = Math.hypot(endX - lbLastTapX, endY - lbLastTapY);
      if (now - lbLastTapTime < LB_DOUBLE_TAP_MS && tapDist < LB_DOUBLE_TAP_DIST) {
        lbLastTapTime = 0; // consume, so a 3rd quick tap starts a fresh pair rather than re-triggering
        if (showingImg) {
          if (lbZoom > 1) resetLbZoom();
          else lbZoomTowardPoint(endX, endY);
        } else {
          // Video: double-tap the left/right third to seek, YouTube-style.
          // The middle third is left alone — a plain single tap already
          // toggles play/pause via the video's own 'click' listener.
          const rect = lb.getBoundingClientRect();
          const frac = (endX - rect.left) / rect.width;
          const vid = lb.querySelector<HTMLVideoElement>('.lb-video');
          if (frac < 1 / 3) { seekVideo(vid, -LB_TOUCH_SEEK_SECONDS); flashSeek('left'); }
          else if (frac > 2 / 3) { seekVideo(vid, LB_TOUCH_SEEK_SECONDS); flashSeek('right'); }
        }
      } else {
        lbLastTapTime = now; lbLastTapX = endX; lbLastTapY = endY;
      }
      return;
    }
    if (lbZoom > 1) return;
    if (Math.abs(dx) > Math.abs(dy) * 1.2 && Math.abs(dx) > 50) stepLightbox(dx < 0 ? 1 : -1);
    else if (dy > 80 && Math.abs(dy) > Math.abs(dx)) closeLightbox();
  }, { passive: true });

  lb.addEventListener('touchcancel', () => { lbActive = false; touchPanning = false; }, { passive: true });
}

function wireVideoControls(lb: HTMLElement) {
  const vid2    = lb.querySelector<HTMLVideoElement>('.lb-video')!;
  const vc2     = lb.querySelector<HTMLElement>('.lb-vctrls')!;
  const scrub   = vc2.querySelector<HTMLInputElement>('.lb-vc-scrub')!;
  const timEl   = vc2.querySelector<HTMLElement>('.lb-vc-time')!;
  const durEl   = vc2.querySelector<HTMLElement>('.lb-vc-dur')!;
  const playBtn = vc2.querySelector<HTMLElement>('.lb-vc-play')!;
  const muteBtn = vc2.querySelector<HTMLElement>('.lb-vc-mute')!;

  const updateScrubBg = () => { scrub.style.backgroundImage = lbScrubGradient(Number(scrub.value) * 100); };

  vid2.addEventListener('timeupdate', () => {
    if (!vid2.duration) return;
    scrub.value = String(vid2.currentTime / vid2.duration);
    timEl.textContent = fmtTime(vid2.currentTime);
    updateScrubBg();
  });
  vid2.addEventListener('durationchange', () => { durEl.textContent = fmtTime(vid2.duration); });
  vid2.addEventListener('play',  () => {
    playBtn.innerHTML = LB_PAUSE_ICON;
    playBtn.setAttribute('aria-label', 'Pause');
    schedHideLbChrome();
  });
  vid2.addEventListener('pause', () => {
    playBtn.innerHTML = LB_PLAY_ICON;
    playBtn.setAttribute('aria-label', 'Play');
    showLbChrome();
  });
  vid2.addEventListener('ended', () => {
    playBtn.innerHTML = LB_PLAY_ICON;
    playBtn.setAttribute('aria-label', 'Play');
    showLbChrome();
  });
  vid2.addEventListener('volumechange', () => {
    muteBtn.innerHTML = vid2.muted ? LB_MUTE_ICON : LB_VOL_ICON;
    muteBtn.setAttribute('aria-label', vid2.muted ? 'Unmute' : 'Mute');
  });

  scrub.addEventListener('input', () => {
    if (vid2.duration) vid2.currentTime = Number(scrub.value) * vid2.duration;
    updateScrubBg();
  });
  scrub.addEventListener('mousedown', () => clearTimeout(lbVcTimer));
  scrub.addEventListener('mouseup',   () => schedHideLbChrome());

  playBtn.addEventListener('click', () => { vid2.paused ? vid2.play().catch(() => {}) : vid2.pause(); });
  muteBtn.addEventListener('click', () => { vid2.muted = !vid2.muted; });

  vid2.addEventListener('click', () => { vid2.paused ? vid2.play().catch(() => {}) : vid2.pause(); });

  // Unconditional (not gated on vc2 being visible) so an image, not just a
  // video, also gets idle-hide chrome on interaction — see showLbChrome.
  lb.addEventListener('mousemove',  () => { showLbChrome(); schedHideLbChrome(); });
  lb.addEventListener('mouseleave', () => { schedHideLbChrome(); });
  lb.addEventListener('touchstart', () => { showLbChrome(); schedHideLbChrome(); }, { passive: true });
}

// ── Mount ────────────────────────────────────────────────────────────────
// Replaces the original lazy-singleton `getLightbox()` — mounted eagerly, once, from
// `initLightbox` (called once for the whole app, from AppShell.tsx's own `onMount` — see
// docs/dev/frontend.md), same "exists exactly once for the app's whole lifetime" shape
// the lazy getter amounted to in practice (nothing else ever unmounts it), just created up front
// instead of on first open — negligible cost for a
// ~20-node static tree, and it means every other function in this file can keep using a bare
// `document.getElementById('screenshot-lightbox')`/`.lb-*` lookup exactly as before, with no
// "has it been created yet" guard needed anywhere.
function mountLightboxDom() {
  render(() => <LightboxDom />, document.body);
  const lb = document.getElementById('screenshot-lightbox')!;
  wireButtons(lb);
  wireKeyboard(lb);
  wireMouseHandlers(lb);
  wireTouchHandlers(lb);
  wireVideoControls(lb);
}

// ── Public API ─────────────────────────────────────────────────────────────

export function openLightbox(game: Game, idxOrShotId: number | string) {
  // Only on a real open: this is also how an already-open lightbox is re-pointed at another game
  // (↑/↓ — see AppShell's onGameNav), and capturing focus again there would remember an element
  // inside the lightbox itself, so closing would restore focus to something already hidden.
  if (!isLightboxOpen()) _lbPrevFocus = document.activeElement;
  const newShots = buildMediaItems(game.appid, game.details?.meta);
  // Batched: setLbGame alone would otherwise let the render effect below run once with the new
  // game's (possibly shorter) media list but the previous game's stale idx, indexing past the
  // end of the new list.
  batch(() => {
    setLbGame(game);
    setIdx(resolveShotIndex(newShots, idxOrShotId));
  });
  // A deliberate open supersedes any pending "take the media when it lands" latch.
  _awaitingMedia = null;
  const lb = document.getElementById('screenshot-lightbox')!;
  lb.classList.add('open');
  document.body.classList.add('lb-open');
  lb.querySelector<HTMLElement>('.lb-close')!.focus();
  _onLightboxParamChange?.(newShots[idx()].shotId);
}

// Re-points an already-open lightbox at another game — ↑/↓ and R, via AppShell's `onGameNav`/
// `onGameRandom`. Separate from `openLightbox` because the shot to land on depends on the one
// being left, which only this module knows: paging through a list is a browse, so it lands on
// real media rather than on the banner `openLightbox(game, 0)` used to pick (see
// `preferredShotIndex`).
export function repointLightboxGame(game: ReadonlyGame) {
  const leaving = shots()[idx()]?.type ?? 'image';
  const next = buildMediaItems(game.appid, game.details?.meta);
  const target = preferredShotIndex(next, leaving);
  // A lone banner means this row's details are still streaming — there is nothing else to show
  // *yet*. Latch the intent so the first real media to arrive is taken (see the effect at the
  // foot of this file); without it the banner would simply stay up, which is the whole reason
  // paging through a list used to be unrewarding.
  _awaitingMedia = next.length === 1 ? leaving : null;
  batch(() => {
    setLbGame(game);
    setIdx(target);
  });
  _onLightboxParamChange?.(next[target].shotId);
}

export function closeLightbox() {
  setLbGame(null);
  _awaitingMedia = null;
  clearTimeout(lbVcTimer);
  const lb = document.getElementById('screenshot-lightbox')!;
  stopHls(lb.querySelector<LbVideo>('.lb-video'));
  lb.classList.remove('open', 'lb--loading', 'lb-idle');
  document.body.classList.remove('lb-open');
  if (document.fullscreenElement || webkitDoc().webkitFullscreenElement) {
    (document.exitFullscreen?.() ?? webkitDoc().webkitExitFullscreen?.())?.catch?.(() => {});
  }
  _onLightboxParamChange?.(null);
  (_lbPrevFocus as HTMLElement | null)?.focus();
  _lbPrevFocus = null;
}

export function stepLightbox(dir: number) {
  // The viewer has taken over: whatever is on screen from here on is their choice, so the latch
  // must never move it under them.
  _awaitingMedia = null;
  lbLastDir = dir;
  const list = shots();
  const next = (idx() + dir + list.length) % list.length;
  setIdx(next);
  _onLightboxParamChange?.(list[next].shotId);
}

// Absolute jump (Home/End) — still animates in the right direction rather
// than always sliding one way, same as a multi-step stepLightbox would.
function gotoLightbox(target: number) {
  if (target === idx()) return;
  _awaitingMedia = null; // same reason as stepLightbox's

  lbLastDir = target > idx() ? 1 : -1;
  setIdx(target);
  _onLightboxParamChange?.(shots()[target].shotId);
}

// The actual per-shot render — deliberately kept as a plain imperative function (called from
// inside a `createEffect` below, not decomposed into fine-grained JSX bindings) rather than
// converted the way `panel.tsx`'s own body was. Unlike that file, there's no template shape
// to gain from JSX here: every line below is either a targeted, already-hand-optimized DOM
// write (avoiding image flicker, restarting HLS/animation state correctly, preloading
// adjacent shots) or a side effect (network fetches, timers) — the same imperative style the
// original file used, now just re-triggered by a Solid effect instead of being called
// manually after mutating plain module variables.
function renderLightbox() {
  const list = shots();
  // Defensively clamped, same idiom panel.tsx's own hero index uses. Every *write* path
  // (openLightbox's batch(), stepLightbox's modulo, gotoLightbox's explicit target) keeps idx()
  // in bounds on its own, but the list itself is derived now and can shrink underneath a
  // perfectly valid index — a ↻ Refresh whose new details carry fewer screenshots than the
  // previous ones did is enough.
  const i = Math.max(0, Math.min(idx(), list.length - 1));
  const name = gameName();
  const lb = document.getElementById('screenshot-lightbox')!;
  const shot = list[i];
  const img  = lb.querySelector<HTMLImageElement>('.lb-img')!;
  const vid  = lb.querySelector<LbVideo>('.lb-video')!;
  const vc   = lb.querySelector<HTMLElement>('.lb-vctrls')!;
  const dir  = lbLastDir;
  lbLastDir = 0;
  resetLbZoom();
  showLbChrome();
  hideLbError();
  // Visible game-name caption — the game/shot identity used to exist only as invisible
  // alt/aria-label text (see `label` below), so switching games while the lightbox stayed open
  // (↑/↓, R) had no on-screen confirmation it had happened at all, especially when the new shot
  // looked much like the old one. It carries the position in the list too: `1 / 12` below counts
  // this game's own media, which says nothing about how far through 343 rows you are.
  const caption = lb.querySelector<HTMLElement>('.lb-caption')!;
  const pos = _getGamePosition?.() ?? null;
  // The two counters wear the same pill (`.lb-counter` below is the other), one per axis, so
  // they read as a pair and neither is mistaken for part of the title beside it.
  const posEl = caption.querySelector<HTMLElement>('.lb-caption-pos')!;
  posEl.textContent = pos ? `${pos.index + 1} / ${pos.total}` : '';
  posEl.style.display = pos ? '' : 'none';
  caption.querySelector<HTMLElement>('.lb-caption-text')!.textContent = name;
  caption.style.display = name || pos ? '' : 'none';
  // No list behind the open game (a standalone lookup) means nothing to step to. Hiding them
  // inline also drops them out of the Tab focus trap — see getFocusable.
  for (const sel of ['.lb-game-prev', '.lb-game-next']) {
    caption.querySelector<HTMLElement>(sel)!.style.display = pos ? '' : 'none';
  }
  const label = `${name ? name + ' — ' : ''}${pos ? `game ${pos.index + 1} of ${pos.total} — ` : ''}` +
    `${shot.type === 'video' ? 'Video' : 'Screenshot'} ${i + 1} of ${list.length}`;
  if (shot.type === 'video') {
    img.style.display = 'none';
    lb.classList.remove('lb--loading');
    vid.style.display = 'block';
    vid.poster = shot.thumb || '';
    vid.setAttribute('aria-label', label);
    vc.style.display = '';
    resetLbVc(vc);
    playHls(vid, shot.hls);
    schedHideLbChrome();
  } else {
    stopHls(vid);
    vc.style.display = 'none';
    vid.style.display = 'none';
    img.style.display = 'block';
    img.alt = label;
    img.onload = null;
    img.onerror = null;
    if (dir !== 0) {
      img.className = `lb-img lb-anim-${dir > 0 ? 'right' : 'left'}`;
      img.addEventListener('animationend', () => { img.className = 'lb-img'; }, { once: true });
    } else {
      img.className = 'lb-img';
    }
    // Show a degraded placeholder (the thumbnail, already loaded/cached from
    // the hero carousel) instead of leaving the *previous* shot on screen
    // while the full-size image loads. The banner shot has no separate
    // thumbnail (thumb === main), so there's nothing degraded to show — fall
    // back to blank there.
    if (shot.thumb && shot.thumb !== shot.main) {
      img.style.opacity = '1';
      img.src = shot.thumb;
    } else {
      img.style.opacity = '0';
    }
    lb.classList.add('lb--loading');
    const full = new Image();
    // Left at opacity 0 (rather than 1) so the browser's own broken-image
    // icon doesn't show behind the error overlay.
    full.onload  = () => { img.src = shot.main!; img.style.opacity = '1'; lb.classList.remove('lb--loading'); };
    full.onerror = () => { img.style.opacity = '0'; lb.classList.remove('lb--loading'); showLbError("Couldn't load this image."); };
    full.src = shot.main!;
    schedHideLbChrome();
  }
  lb.querySelector('.lb-counter')!.textContent = `${i + 1} / ${list.length}`;
  lb.querySelector<HTMLButtonElement>('.lb-prev')!.disabled = list.length <= 1;
  lb.querySelector<HTMLButtonElement>('.lb-next')!.disabled = list.length <= 1;
  // Preload prev and next images so navigation feels instant; for a video,
  // warm its poster the same way and prime its HLS manifest in the HTTP
  // cache so stepping onto it doesn't pay the full fetch latency cold.
  for (const offset of [-1, 1]) {
    const adjacent = list[(i + offset + list.length) % list.length];
    if (!adjacent) continue;
    const preloadSrc = adjacent.type === 'video' ? adjacent.thumb : adjacent.main;
    if (preloadSrc && preloadSrc !== shot.main) {
      let pre = lb.querySelector<HTMLImageElement>(`.lb-preload[data-src="${CSS.escape(preloadSrc)}"]`);
      if (!pre) {
        pre = document.createElement('img');
        pre.className = 'lb-preload';
        pre.dataset.src = preloadSrc;
        pre.src = preloadSrc;
        pre.style.cssText = 'position:absolute;width:0;height:0;opacity:0;pointer-events:none';
        lb.appendChild(pre);
      }
    }
    if (adjacent.type === 'video' && adjacent.hls && !_lbPrefetchedHls.has(adjacent.hls)) {
      _lbPrefetchedHls.add(adjacent.hls);
      fetch(adjacent.hls).catch(() => {});
      loadHlsModule().catch(() => {}); // warm it ahead of time — see its own comment above
    }
  }
  // Drop stale preloads (keep only prev/next)
  const keep = new Set<string>(
    [-1, 1].map(o => {
      const s = list[(i + o + list.length) % list.length];
      const src = s && (s.type === 'video' ? s.thumb : s.main);
      return src ?? '';
    }).filter(src => src !== '')
  );
  lb.querySelectorAll<HTMLImageElement>('.lb-preload').forEach(el => { if (!keep.has(el.dataset.src ?? '')) el.remove(); });
}

// The one Solid-driven trigger for the whole file: re-runs `renderLightbox()` whenever
// `shots`/`idx`/`gameName` change (opening, closing, stepping, or a game switch via
// `onGameNav` all funnel through one of those three signals) — replacing every explicit
// `renderLightbox()` call the original file made right after mutating its own plain
// variables. Created once at module load (outside any component), same as `panel.tsx`'s own
// top-level `createRoot` block of effects — this module has page-lifetime scope, never torn
// down, so it's never explicitly disposed. Guarded on `shots().length` so it doesn't run
// `renderLightbox()` (which indexes into `shots()[idx()]`) while the lightbox is closed and
// empty.
// Wrapped in `createRoot` — like `panel.tsx`'s own top-level effects, this has page-lifetime
// scope (never torn down), so without a root it would warn "created outside a createRoot ...
// will never be disposed" (same fix panel.tsx's own top-level effects needed).
createRoot(() => {
  // Consumes the `_awaitingMedia` latch (see `repointLightboxGame`): a game paged onto before
  // its details had streamed in has only its banner to offer, so the moment the real media
  // lands, take it. Created *before* the render effect below so it runs first within the same
  // flush — the render then happens once, on the shot actually wanted, rather than painting the
  // banner and immediately replacing it. Deliberately one-shot and cancelled by any viewer
  // input (`stepLightbox`/`gotoLightbox`/a fresh open/close), so it can never move an image
  // out from under someone who is looking at it.
  createEffect(() => {
    const list = shots();
    const leaving = _awaitingMedia;
    if (!leaving || list.length <= 1) return;
    _awaitingMedia = null;
    const target = preferredShotIndex(list, leaving);
    if (target === 0) return; // trailers but no screenshots — not worth autoplaying unasked
    setIdx(target);
    _onLightboxParamChange?.(list[target].shotId);
  });
  createEffect(() => {
    const list = shots(); idx(); gameName();
    if (list.length) renderLightbox();
  });
});
