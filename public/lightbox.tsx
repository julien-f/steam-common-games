import { pushOverlayEntry, popOverlayEntry } from './overlayHistory.ts';
import { loadHlsModule, playHls, stopHls } from './hlsPlayer.ts';
import { present } from './presentation.ts';
import type { HlsVideo } from './hlsPlayer.ts';
import { urlWithoutShot } from './urlState.ts';
import { buildMediaItems, resolveShotIndex, preferredShotIndex, mediaLabel } from './mediaItems.ts';
import type { MediaItem, ShotKind } from './mediaItems.ts';
import type { Game, ReadonlyGame } from './types.ts';
import { fmtTime } from './utils.ts';
import { loadedWhen, morph } from './viewTransition.ts';
import { decideSwipeAxis, resolveSwipe, LB_SWIPE_RESISTANCE } from './lightboxSwipe.ts';
import type { SwipeAxis } from './lightboxSwipe.ts';

import { createSignal, createEffect, createRoot, batch, untrack } from 'solid-js';
import { render } from 'solid-js/web';
import ChevronDown from 'lucide-solid/icons/chevron-down';
import ChevronLeft from 'lucide-solid/icons/chevron-left';
import ChevronRight from 'lucide-solid/icons/chevron-right';
import ChevronUp from 'lucide-solid/icons/chevron-up';
import FastForward from 'lucide-solid/icons/fast-forward';
import Maximize from 'lucide-solid/icons/maximize';
import Minimize from 'lucide-solid/icons/minimize';
import Pause from 'lucide-solid/icons/pause';
import Play from 'lucide-solid/icons/play';
import Rewind from 'lucide-solid/icons/rewind';
import Volume2 from 'lucide-solid/icons/volume-2';
import VolumeX from 'lucide-solid/icons/volume-x';
import X from 'lucide-solid/icons/x';
import ZoomIn from 'lucide-solid/icons/zoom-in';

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
const shots = () => {
  const g = lbGame();
  return g ? buildMediaItems(g.appid, g.details?.meta) : [];
};
const gameName = () => lbGame()?.name ?? '';
// The game `renderLightbox` last drew, so a render can tell a game step from a media step.
let lbRenderedAppid: number | undefined;
let lbZoom = 1,
  lbPanX = 0,
  lbPanY = 0,
  lbLastDir = 0,
  lbVcTimer: ReturnType<typeof setTimeout> | undefined,
  lbCounterTimer: ReturnType<typeof setTimeout> | undefined,
  lbPointerTimer: ReturnType<typeof setTimeout> | undefined;
// Bumped on every renderLightbox() call and loadLbImage(); a detached Image()'s onload checks it's still current
// before touching the shared img element, so a slow load from a shot the viewer already
// navigated away from can't clobber the one currently displayed — img is reused across shots
// same as videoEl's _hlsToken guard above.
let lbImgToken = 0;
// Which axis `lbLastDir` was a step along, so the enter animation comes from the side the
// viewer swiped toward: 'x' for media within a game, 'y' for a game step (↑/↓, the caption
// buttons, a vertical swipe). Reset with `lbLastDir` on every render.
let lbLastAxis: SwipeAxis = 'x';

// The <video> is kept *out* of the DOM unless a video is actually on screen, and held by
// reference instead. It used to sit there from page load, which made every page of this app
// look like a video page to the rest of the browser: media-key routing, Picture-in-Picture
// affordances, and any extension that arms itself on the mere presence of a media element.
// Video Speed Controller is the concrete case — it binds keydown in the *capture* phase on
// `document` and swallows its own shortcuts (`r` among them) as soon as one connected <video>
// exists anywhere on the page, which silently killed this app's own R/↑/↓ before they were ever
// dispatched. Detached, none of that sees it; attached, such an extension is armed exactly while
// a trailer is playing, which is when its owner wants it. Held by reference rather than
// re-queried because `wireVideoControls` binds to it once at mount, while it is detached.
let lbVideoEl!: HlsVideo;
let lbVideoAnchor!: Element;
function attachLbVideo() {
  if (!lbVideoEl.isConnected) lbVideoAnchor.before(lbVideoEl);
}
function detachLbVideo() {
  lbVideoEl.remove();
}
function lbShowingVideo() {
  return lbVideoEl.isConnected;
}
function lbShowingImage() {
  const img = document.querySelector<HTMLElement>('#screenshot-lightbox .lb-img');
  return !!img && img.style.display !== 'none';
}
type LbFlashEl = HTMLElement & { _flashTimer?: ReturnType<typeof setTimeout> };

const LB_SEEK_SECONDS = 5;
const LB_DOUBLE_TAP_MS = 300;
const LB_DOUBLE_TAP_DIST = 30;
// A tap on a video's side third waits out a possible second tap (a seek) before playing or pausing.
let lbVideoTapTimer: ReturnType<typeof setTimeout> | undefined;

// No-ops until initLightbox sets them; nothing can open the lightbox before that.
let _onLightboxParamChange: (shotId: string | null) => void = () => {};
let _onGameNav: (dir: number) => void = () => {};
let _onGameRandom: () => void = () => {};
let _getGamePosition: () => { index: number; total: number } | null = () => null;
// Set when a re-point landed on a banner for want of anything else — see `repointLightboxGame`.
// Holds the *kind* of shot being left, so the screenshot/trailer that eventually arrives is
// picked by the same rule the re-point itself would have used.
let _awaitingMedia: ShotKind | null = null;
let _lbPrevFocus: Element | null = null;
// One mount at a time: a second initLightbox (Vite hot-reloading AppShell) tears the first down —
// its DOM and every listener it put on `document` — instead of mounting a duplicate beside it.
let _lbTeardown: (() => void) | null = null;
let _lbSignal: AbortSignal | undefined;
const _lbPrefetchedHls = new Set();

// ── Init ───────────────────────────────────────────────────────────────────

// `onGameNav(dir)`/`onGameRandom()`: the host's own prev/next-game step and random pick (the
// same ones the panel itself offers) — they let ↑/↓ and R page games while the lightbox stays
// open, jumping straight to the new game's own media (see `renderLightbox`'s caption for how
// the switch is made visible), rather than either doing nothing or silently switching games
// behind a fullscreen image that never changed. Both re-point through `repointLightboxGame`.
// `getGamePosition()`: where the open game sits in that list, for the caption — null when there
// is no list to page through at all (a standalone lookup), which is also what hides the caption's
// own ↑/↓ buttons.
export function initLightbox({
  onParamChange,
  onGameNav,
  onGameRandom,
  getGamePosition,
}: {
  onParamChange: (shotId: string | null) => void;
  onGameNav: (dir: number) => void;
  onGameRandom: () => void;
  getGamePosition: () => { index: number; total: number } | null;
}) {
  _onLightboxParamChange = onParamChange;
  _onGameNav = onGameNav;
  _onGameRandom = onGameRandom;
  _getGamePosition = getGamePosition;
  _lbTeardown?.();
  const abort = new AbortController();
  _lbSignal = abort.signal;
  document.addEventListener('fullscreenchange', syncLightboxFullscreenBtn, { signal: _lbSignal });
  document.addEventListener('webkitfullscreenchange', syncLightboxFullscreenBtn, { signal: _lbSignal });
  document.addEventListener('fullscreenchange', lockLbLandscape, { signal: _lbSignal });
  document.addEventListener('webkitfullscreenchange', lockLbLandscape, { signal: _lbSignal });
  screen.orientation?.addEventListener('change', lockLbLandscape, { signal: _lbSignal });
  const dispose = mountLightboxDom();
  _lbTeardown = () => {
    abort.abort();
    dispose();
    _lbTeardown = null;
  };
  return _lbTeardown;
}

export function isLightboxOpen() {
  return lbGame() !== null;
}

// The open game and the shot on screen — reactive, so the panel's hero can follow it.
export function lightboxShot(): { appid: number; shotId: string } | null {
  const game = lbGame();
  const shot = shots()[idx()];
  return game && shot ? { appid: game.appid, shotId: shot.shotId } : null;
}

// Every game step from inside the lightbox (↑/↓, R, the caption's own buttons) goes through
// here. The host's step opens the panel *behind* the overlay, and `panelOpen` focuses that
// panel's hero image — which drops focus straight out of the lightbox's own trap onto an element
// the lightbox is covering. Whatever had focus in here keeps it, so holding ↓ on the caption
// button doesn't walk focus away mid-click; the surface is the fallback, as on a real open.
// `dir` only drives the enter animation's direction — 0 (R, which has no direction) skips it.
// A wrap past either end of the list enters from the other side, the cue that it went back round —
// except after a swipe, where the new game follows the finger.
function stepGameNav(dir: number, swipe = false) {
  const pos = _getGamePosition();
  const wraps = !swipe && pos !== null && pos.index === (dir > 0 ? pos.total - 1 : 0);
  stepGameFromLightbox(() => _onGameNav(dir), wraps ? -dir : dir);
}

function stepGameFromLightbox(step: () => void, dir = 0) {
  const lb = document.getElementById('screenshot-lightbox')!;
  const before = document.activeElement;
  if (dir !== 0) {
    lbLastDir = dir;
    lbLastAxis = 'y';
  }
  const game = lbGame();
  step();
  if (lbGame() === game) {
    // No game to step to: no render consumed the direction, which would animate the next one.
    lbLastDir = 0;
    lbLastAxis = 'x';
  }
  if (lb.contains(document.activeElement)) return;
  ((before && lb.contains(before) ? before : lbSurface(lb)) as HTMLElement).focus();
}

// ── Fullscreen button sync ─────────────────────────────────────────────────

function webkitDoc(): Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void } {
  return document as Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };
}

function isFullscreen() {
  return !!(document.fullscreenElement || webkitDoc().webkitFullscreenElement);
}

function exitFullscreen() {
  (document.exitFullscreen?.() ?? webkitDoc().webkitExitFullscreen?.())?.catch?.(() => {});
}

function syncLightboxFullscreenBtn() {
  const btn = document.querySelector('#screenshot-lightbox .lb-fullscreen');
  if (!btn) return;
  const isFs = isFullscreen();
  btn.classList.toggle('lb-on', isFs);
  btn.setAttribute('aria-label', isFs ? 'Exit fullscreen' : 'Enter fullscreen');
}

function toggleLbFullscreen(lb: HTMLElement) {
  if (isFullscreen()) {
    exitFullscreen();
  } else {
    const surface = lbSurface(lb);
    (
      surface.requestFullscreen?.() ??
      (surface as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> }).webkitRequestFullscreen?.()
    )?.catch?.(() => {});
  }
}

// Fullscreen media is landscape, so a phone turns to show it, pictures included. Re-asserted on
// any orientation change while fullscreen: Firefox for Android resets the orientation when a
// trailer's media session ends (stepping to the next item), overriding the lock. Rejected where
// unsupported (desktop, iOS) — nothing to do then.
function lockLbLandscape() {
  const o = screen.orientation as ScreenOrientation & { lock?: (type: string) => Promise<void> };
  if (!isFullscreen()) return;
  o?.lock?.('landscape').catch(() => {});
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

function showLbVideoError() {
  showLbError("Couldn't load this video.");
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
    const vid = lbVideoEl;
    playHls(vid, shot.hls, showLbVideoError);
  } else {
    // Cache-bust: a browser that already recorded this exact URL as failed
    // won't necessarily re-attempt the network request otherwise.
    loadLbImage(shot.main! + (shot.main!.includes('?') ? '&' : '?') + '_retry=' + Date.now());
  }
}

// Swaps `src` in once loaded unless a later load started since; opacity 0 on error hides the broken-image icon.
function loadLbImage(src: string) {
  const lb = document.getElementById('screenshot-lightbox')!;
  const img = lb.querySelector<HTMLImageElement>('.lb-img')!;
  const token = ++lbImgToken;
  lb.classList.add('lb--loading');
  const full = new Image();
  full.onload = () => {
    if (token !== lbImgToken) return;
    img.src = src;
    img.style.opacity = '1';
    lb.classList.remove('lb--loading');
  };
  full.onerror = () => {
    if (token !== lbImgToken) return;
    img.style.opacity = '0';
    lb.classList.remove('lb--loading');
    showLbError("Couldn't load this image.");
  };
  full.src = src;
}

// ── Zoom / pan ─────────────────────────────────────────────────────────────

function applyLbTransform() {
  const img = document.querySelector<HTMLImageElement>('#screenshot-lightbox .lb-img');
  if (!img) return;
  document.querySelector('#screenshot-lightbox .lb-zoom')?.setAttribute('aria-pressed', String(lbZoom > 1));
  if (lbZoom === 1) {
    lbPanX = 0;
    lbPanY = 0;
    img.style.transform = '';
    img.style.cursor = '';
  } else {
    const maxX = (img.offsetWidth * (lbZoom - 1)) / 2;
    const maxY = (img.offsetHeight * (lbZoom - 1)) / 2;
    lbPanX = Math.max(-maxX, Math.min(maxX, lbPanX));
    lbPanY = Math.max(-maxY, Math.min(maxY, lbPanY));
    img.style.transform = `scale(${lbZoom}) translate(${lbPanX / lbZoom}px, ${lbPanY / lbZoom}px)`;
    img.style.cursor = 'grab';
  }
}

function resetLbZoom() {
  lbZoom = 1;
  applyLbTransform();
}

// Zooms 2x centered on a given viewport point — shared by desktop dblclick
// and touch double-tap.
function lbZoomTowardPoint(clientX: number, clientY: number) {
  const img = document.querySelector<HTMLImageElement>('#screenshot-lightbox .lb-img');
  if (!img) return;
  const rect = img.getBoundingClientRect();
  lbZoom = 2;
  lbPanX = -(clientX - rect.left - rect.width / 2);
  lbPanY = -(clientY - rect.top - rect.height / 2);
  applyLbTransform();
}

// Double-click, double-tap and the zoom button: 2x toward the point, or back.
function toggleLbZoomAt(clientX: number, clientY: number) {
  if (lbZoom > 1) resetLbZoom();
  else lbZoomTowardPoint(clientX, clientY);
}

// The visible way to what double-click, double-tap and pinch do: 2x on the image's centre, or back.
function toggleLbZoom() {
  if (!lbShowingImage()) return;
  const r = document.querySelector('#screenshot-lightbox .lb-img')!.getBoundingClientRect();
  toggleLbZoomAt(r.left + r.width / 2, r.top + r.height / 2);
}

// ── Video seeking (keyboard arrows + touch double-tap) ─────────────────────

const LB_POINTER_ZONE = 120; // px from an edge within which the mouse brings back that edge's chrome
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
// and the mouse cursor while the viewer is inactive — a video playing or
// paused, or a still image. A trailer that isn't playing keeps its large play
// button, which isn't part of the chrome.
function showLbChrome() {
  const lb = document.getElementById('screenshot-lightbox');
  if (!lb) return;
  lb.classList.remove('lb-idle');
  clearTimeout(lbVcTimer);
}

function schedHideLbChrome() {
  const lb = document.getElementById('screenshot-lightbox');
  if (!lb) return;
  clearTimeout(lbVcTimer);
  lbVcTimer = setTimeout(() => {
    // A keyboard user's focused control stays in sight (WCAG 2.4.7); checked again later.
    if (lb.querySelector('button:focus-visible, input:focus-visible')) schedHideLbChrome();
    else lb.classList.add('lb-idle');
  }, 3000);
}

// With the chrome idle, a step flashes only the counter, plus the game's name on a game step.
function flashLbCounter(lb: HTMLElement, gameChanged: boolean) {
  if (!lb.classList.contains('lb-idle')) return;
  lb.classList.add('lb--stepped');
  lb.classList.toggle('lb--stepped-game', gameChanged);
  clearTimeout(lbCounterTimer);
  lbCounterTimer = setTimeout(() => lb.classList.remove('lb--stepped', 'lb--stepped-game'), 1500);
}

// ── Focus helpers ──────────────────────────────────────────────────────────

function lbSurface(lb: HTMLElement): HTMLElement {
  return lb.querySelector<HTMLElement>('.lb-surface')!;
}

// Rendered ones only: the trap's wrap landing on a CSS-hidden button (‹ › with one item) loses focus.
function getFocusable(lb: HTMLElement): HTMLElement[] {
  return [...lb.querySelectorAll<HTMLElement>('button:not([disabled]), input[type="range"]')].filter((el) =>
    el.checkVisibility({ visibilityProperty: true }),
  );
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
    // A modal <dialog>: the page behind is inert. Fullscreen goes on `.lb-surface`, as a dialog can't be fullscreen.
    <dialog id="screenshot-lightbox" aria-labelledby="lb-caption-text lb-title">
      <div class="lb-surface" tabindex="-1" autofocus>
        <span id="lb-title" hidden>
          media viewer
        </span>
        <div class="lb-backdrop" />
        <button class="lb-btn lb-prev" aria-label="Previous screenshot">
          <ChevronLeft />
        </button>
        <img class="lb-img" src="" alt="Screenshot" />
        <video class="lb-video" playsinline />
        <button class="lb-btn lb-next" aria-label="Next screenshot">
          <ChevronRight />
        </button>
        <div class="lb-error" style={{ display: 'none' }} role="alert">
          <p class="lb-error-msg" />
          <button class="lb-error-retry">Retry</button>
        </div>
        <div class="lb-seek-flash lb-seek-flash-left" aria-hidden="true">
          <Rewind /> {LB_TOUCH_SEEK_SECONDS}s
        </div>
        <div class="lb-seek-flash lb-seek-flash-right" aria-hidden="true">
          {LB_TOUCH_SEEK_SECONDS}s <FastForward />
        </div>
        <button class="lb-bigplay" aria-label="Play trailer">
          <Play />
        </button>
        <div class="lb-vctrls" style={{ display: 'none' }}>
          {/* Two-state controls draw both icons; `lb-on` picks which shows. */}
          <button class="lb-vc-btn lb-vc-play" aria-label="Play">
            <Play class="lb-icon-off" />
            <Pause class="lb-icon-on" />
          </button>
          <span class="lb-vc-time">0:00</span>
          <input class="lb-vc-scrub" type="range" min="0" max="1" step="0.001" value="0" aria-label="Seek" />
          <span class="lb-vc-dur">0:00</span>
          <button class="lb-vc-btn lb-vc-mute" aria-label="Mute">
            <Volume2 class="lb-icon-off" />
            <VolumeX class="lb-icon-on" />
          </button>
        </div>
        <div class="lb-toolbar">
          {/* The caption doubles as the list stepper: ↑/↓ flanking "<game> · 14 of 343" put the
            control on the thing it changes, and cover the axis the edge ‹ › don't (they step
            media within one game). Both buttons are hidden when there's no list to page
            through — see `_getGamePosition`. */}
          <div class="lb-caption">
            <button class="lb-game-prev" aria-label="Previous game">
              <ChevronUp />
            </button>
            <span class="lb-caption-text" id="lb-caption-text" />
            <span class="lb-caption-pos" />
            <button class="lb-game-next" aria-label="Next game">
              <ChevronDown />
            </button>
          </div>
          <div class="lb-toolbar-row">
            <div class="lb-toolbar-left">
              <button class="lb-fullscreen" aria-label="Enter fullscreen">
                <Maximize class="lb-icon-off" />
                <Minimize class="lb-icon-on" />
              </button>
            </div>
            <div class="lb-counter" aria-live="polite" aria-atomic="true" />
            <div class="lb-toolbar-right">
              <button class="lb-zoom" aria-label="Zoom" aria-pressed="false">
                <ZoomIn />
              </button>
              <button class="lb-close" aria-label="Close lightbox">
                <X />
              </button>
            </div>
          </div>
        </div>
      </div>
    </dialog>
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
  // Esc, or Android's Back: closed the same way as from ×. `close` covers a dialog the browser
  // closed itself, when it won't let `cancel` be cancelled (no user activation since the last one).
  lb.addEventListener('cancel', (e) => {
    e.preventDefault();
    closeLightbox();
  });
  lb.addEventListener('close', closeLightbox);
  lb.querySelector('.lb-backdrop')!.addEventListener('click', closeLightbox);
  lb.querySelector('.lb-close')!.addEventListener('click', closeLightbox);
  lb.querySelector('.lb-error-retry')!.addEventListener('click', retryCurrentShot);
  lb.querySelector('.lb-prev')!.addEventListener('click', () => stepLightbox(-1));
  lb.querySelector('.lb-next')!.addEventListener('click', () => stepLightbox(1));
  lb.querySelector('.lb-game-prev')!.addEventListener('click', () => stepGameNav(-1));
  lb.querySelector('.lb-game-next')!.addEventListener('click', () => stepGameNav(1));
  lb.querySelector('.lb-fullscreen')!.addEventListener('click', () => toggleLbFullscreen(lb));
  lb.querySelector('.lb-zoom')!.addEventListener('click', toggleLbZoom);
}

function wireKeyboard(lb: HTMLElement) {
  document.addEventListener(
    'keydown',
    (e) => {
      if (!isLightboxOpen()) return;
      // A dialog over this one (the shortcuts) has the keyboard.
      if ([...document.querySelectorAll('dialog[open]')].some((d) => d !== lb)) return;
      // Ctrl/⌘/Alt+key is the browser's (reload, find, print); Shift is part of some bindings.
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const onScrub = (e.target as HTMLElement | null)?.classList.contains('lb-vc-scrub');

      // Focus trap
      if (e.key === 'Tab') {
        showLbChrome();
        schedHideLbChrome();
        const focusable = getFocusable(lb);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
        return;
      }

      const vid = lbShowingVideo() ? lbVideoEl : null;

      if ((!onScrub || e.shiftKey) && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        // While a video is playing, bare arrows seek it in place so the user
        // isn't yanked to the next screenshot mid-scrub; Shift+arrow always
        // forces media navigation instead, as an explicit escape hatch — even
        // when focus is on the scrub bar itself, whose native range-input
        // behavior would otherwise consume a bare arrow key to nudge its value.
        if (vid && !vid.paused && !e.shiftKey) {
          seekVideo(vid, dir * LB_SEEK_SECONDS);
        } else {
          stepLightbox(dir);
        }
      }
      if (!onScrub && (e.key === 'Home' || e.key === 'End') && shots().length > 1) {
        e.preventDefault();
        gotoLightbox(e.key === 'Home' ? 0 : shots().length - 1);
      }
      if (!onScrub && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        stepGameNav(e.key === 'ArrowDown' ? 1 : -1);
      }
      // R, the same random pick the panel offers — page-level shortcuts are all blocked while the
      // lightbox is open (panelKeyboard.ts hands it the keyboard wholesale), so it has to be bound
      // here to work at all, exactly as ↑/↓ above do.
      if (!onScrub && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault();
        stepGameFromLightbox(_onGameRandom);
      }
      // Presents it instead: the presentation window stands in for the lightbox.
      if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        // panelKeyboard.ts's P would present again once the lightbox is closed.
        e.stopImmediatePropagation();
        const game = lbGame();
        const shot = shots()[idx()];
        if (game && shot) present(game, shot.shotId);
        closeLightbox();
        return;
      }
      if (e.key === 'f' || e.key === 'F') toggleLbFullscreen(lb);
      if ((e.key === 'z' || e.key === 'Z') && !vid) toggleLbZoom();
      if (vid) {
        // A focused button takes Space as its own press.
        if (e.key === ' ' && !onScrub && !(e.target as HTMLElement).closest('button')) {
          e.preventDefault();
          vid.paused ? vid.play().catch(() => {}) : vid.pause();
        }
        if (e.key === 'm' || e.key === 'M') {
          vid.muted = !vid.muted;
        }
      }
    },
    { signal: _lbSignal },
  );
}

function wireMouseHandlers(lb: HTMLElement) {
  lb.addEventListener(
    'wheel',
    (e) => {
      if (!lbShowingImage()) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      lbZoom = Math.max(1, Math.min(4, lbZoom * factor));
      applyLbTransform();
    },
    { passive: false },
  );

  const lbImg = lb.querySelector<HTMLImageElement>('.lb-img')!;
  let lbDragging = false,
    lbDragStartX = 0,
    lbDragStartY = 0,
    lbPanStartX = 0,
    lbPanStartY = 0;
  lbImg.addEventListener('mousedown', (e) => {
    if (lbZoom <= 1) return;
    lbDragging = true;
    lbDragStartX = e.clientX;
    lbDragStartY = e.clientY;
    lbPanStartX = lbPanX;
    lbPanStartY = lbPanY;
    lbImg.style.cursor = 'grabbing';
    e.preventDefault();
  });
  document.addEventListener(
    'mousemove',
    (e) => {
      if (!lbDragging) return;
      lbPanX = lbPanStartX + (e.clientX - lbDragStartX);
      lbPanY = lbPanStartY + (e.clientY - lbDragStartY);
      applyLbTransform();
    },
    { signal: _lbSignal },
  );
  document.addEventListener(
    'mouseup',
    () => {
      if (!lbDragging) return;
      lbDragging = false;
      lbImg.style.cursor = lbZoom > 1 ? 'grab' : '';
    },
    { signal: _lbSignal },
  );
  lbImg.addEventListener('dblclick', (e) => toggleLbZoomAt(e.clientX, e.clientY));
}

// ── Swipe drag ─────────────────────────────────────────────────────────────

// The media element on screen — the one a swipe drags. Zoom/pan owns `.lb-img`'s transform
// too, but a drag only ever runs at zoom 1, so the two never write it at once.
function lbMediaEl(): HTMLElement | null {
  if (lbShowingImage()) return document.querySelector<HTMLElement>('#screenshot-lightbox .lb-img');
  return lbShowingVideo() ? lbVideoEl : null;
}

function setLbDrag(el: HTMLElement, x: number, y: number) {
  el.style.transition = 'none';
  el.style.transform = `translate(${x}px, ${y}px)`;
}

// `animate`: a swipe that didn't commit eases back. A committed one clears instantly instead —
// `renderLightbox`'s own enter animation takes the element over from there.
function clearLbDrag(el: HTMLElement, animate: boolean) {
  el.style.transition = animate ? 'transform 0.2s ease, opacity 0.18s' : '';
  el.style.transform = '';
  if (animate)
    setTimeout(() => {
      el.style.transition = '';
    }, 200);
}

function wireTouchHandlers(lb: HTMLElement) {
  let lbX = 0,
    lbY = 0,
    lbActive = false;
  let pinchStartDist = 0,
    pinchStartZoom = 1;
  let touchPanning = false,
    touchPanStartX = 0,
    touchPanStartY = 0,
    touchPanOriginX = 0,
    touchPanOriginY = 0;
  let lbLastTapTime = 0,
    lbLastTapX = 0,
    lbLastTapY = 0;
  // Swipe drag: the axis locked onto (null until the finger has moved far enough to tell), when
  // it started (for the flick threshold), and what each axis has to step to — the latter read
  // once per gesture rather than per touchmove, `_getGamePosition` reaching the route's own list
  // (see `renderLightbox`'s untracked read of it).
  let dragAxis: SwipeAxis | null = null;
  let dragStart = 0,
    dragMediaCount = 0,
    dragHasGameList = false;

  lb.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length === 2) {
        if (!lbShowingImage()) return;
        pinchStartDist = Math.hypot(
          e.touches[1].clientX - e.touches[0].clientX,
          e.touches[1].clientY - e.touches[0].clientY,
        );
        pinchStartZoom = lbZoom;
        lbActive = false;
        e.preventDefault();
      } else if (e.touches.length === 1) {
        // A touch starting on the chrome is operating it, not swiping the media behind it —
        // dragging the video scrubber sideways otherwise steps to the next shot as well.
        if ((e.target as Element).closest('.lb-vctrls, .lb-toolbar, .lb-btn, .lb-bigplay')) {
          lbActive = false;
          return;
        }
        lbX = e.touches[0].clientX;
        lbY = e.touches[0].clientY;
        lbActive = true;
        dragAxis = null;
        dragStart = e.timeStamp;
        dragMediaCount = shots().length;
        dragHasGameList = _getGamePosition() !== null;
        if (lbZoom > 1) {
          touchPanning = true;
          touchPanStartX = e.touches[0].clientX;
          touchPanStartY = e.touches[0].clientY;
          touchPanOriginX = lbPanX;
          touchPanOriginY = lbPanY;
        }
      }
    },
    { passive: false },
  );

  lb.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length === 2) {
        if (!lbShowingImage()) return;
        const dist = Math.hypot(
          e.touches[1].clientX - e.touches[0].clientX,
          e.touches[1].clientY - e.touches[0].clientY,
        );
        lbZoom = Math.max(1, Math.min(4, (pinchStartZoom * dist) / pinchStartDist));
        applyLbTransform();
        e.preventDefault();
      } else if (e.touches.length === 1 && touchPanning) {
        lbPanX = touchPanOriginX + (e.touches[0].clientX - touchPanStartX);
        lbPanY = touchPanOriginY + (e.touches[0].clientY - touchPanStartY);
        applyLbTransform();
        e.preventDefault();
      } else if (e.touches.length === 1 && lbActive && lbZoom === 1) {
        const dx = e.touches[0].clientX - lbX,
          dy = e.touches[0].clientY - lbY;
        dragAxis ??= decideSwipeAxis(dx, dy);
        if (!dragAxis) return;
        const el = lbMediaEl();
        if (!el) return;
        // Nothing to step to on this axis: the media still follows the finger, damped, so the
        // gesture reads as resistance rather than as a step that silently didn't happen.
        const slack = (dragAxis === 'x' ? dragMediaCount > 1 : dragHasGameList) ? 1 : LB_SWIPE_RESISTANCE;
        setLbDrag(el, dragAxis === 'x' ? dx * slack : 0, dragAxis === 'y' ? dy * slack : 0);
        e.preventDefault();
      }
    },
    { passive: false },
  );

  lb.addEventListener(
    'touchend',
    (e) => {
      if (e.touches.length < 2) touchPanning = false;
      if (!lbActive) return;
      lbActive = false;
      const endX = e.changedTouches[0].clientX,
        endY = e.changedTouches[0].clientY;
      const dx = endX - lbX,
        dy = endY - lbY;
      if (dragAxis) {
        const action = resolveSwipe({
          axis: dragAxis,
          dx,
          dy,
          dt: e.timeStamp - dragStart,
          mediaCount: dragMediaCount,
          hasGameList: dragHasGameList,
        });
        dragAxis = null;
        const el = lbMediaEl();
        if (el) clearLbDrag(el, !action);
        if (action === 'media-prev' || action === 'media-next') stepLightbox(action === 'media-next' ? 1 : -1, true);
        else if (action) {
          stepGameNav(action === 'game-next' ? 1 : -1, true);
        }
        return;
      }
      const isTap = Math.abs(dx) < 10 && Math.abs(dy) < 10;
      const showingImg = lbShowingImage();
      const showingVid = lbShowingVideo();
      if (isTap && (showingImg || showingVid)) {
        const now = Date.now();
        const tapDist = Math.hypot(endX - lbLastTapX, endY - lbLastTapY);
        if (now - lbLastTapTime < LB_DOUBLE_TAP_MS && tapDist < LB_DOUBLE_TAP_DIST) {
          lbLastTapTime = 0; // consume, so a 3rd quick tap starts a fresh pair rather than re-triggering
          if (showingImg) {
            // Or the browser follows up with a dblclick, whose handler would toggle the zoom back.
            e.preventDefault();
            toggleLbZoomAt(endX, endY);
          } else {
            // Video: double-tap the left/right third to seek, YouTube-style.
            // The middle third is left alone — a plain single tap already
            // toggles play/pause via the video's own 'click' listener.
            const rect = lb.getBoundingClientRect();
            const frac = (endX - rect.left) / rect.width;
            const vid = lbVideoEl;
            if (frac < 1 / 3 || frac > 2 / 3) {
              clearTimeout(lbVideoTapTimer);
              e.preventDefault(); // no click: it would play or pause
            }
            if (frac < 1 / 3) {
              seekVideo(vid, -LB_TOUCH_SEEK_SECONDS);
              flashSeek('left');
            } else if (frac > 2 / 3) {
              seekVideo(vid, LB_TOUCH_SEEK_SECONDS);
              flashSeek('right');
            }
          }
        } else {
          lbLastTapTime = now;
          lbLastTapX = endX;
          lbLastTapY = endY;
        }
      }
    },
    { passive: false },
  );

  lb.addEventListener(
    'touchcancel',
    () => {
      lbActive = false;
      touchPanning = false;
      if (dragAxis) {
        dragAxis = null;
        const el = lbMediaEl();
        if (el) clearLbDrag(el, true);
      }
    },
    { passive: true },
  );
}

function wireVideoControls(lb: HTMLElement) {
  const vid2 = lbVideoEl;
  const vc2 = lb.querySelector<HTMLElement>('.lb-vctrls')!;
  const scrub = vc2.querySelector<HTMLInputElement>('.lb-vc-scrub')!;
  const timEl = vc2.querySelector<HTMLElement>('.lb-vc-time')!;
  const durEl = vc2.querySelector<HTMLElement>('.lb-vc-dur')!;
  const playBtn = vc2.querySelector<HTMLElement>('.lb-vc-play')!;
  const muteBtn = vc2.querySelector<HTMLElement>('.lb-vc-mute')!;

  const updateScrubBg = () => {
    scrub.style.backgroundImage = lbScrubGradient(Number(scrub.value) * 100);
  };

  vid2.addEventListener('timeupdate', () => {
    if (!vid2.duration) return;
    scrub.value = String(vid2.currentTime / vid2.duration);
    timEl.textContent = fmtTime(vid2.currentTime);
    updateScrubBg();
  });
  vid2.addEventListener('durationchange', () => {
    durEl.textContent = fmtTime(vid2.duration);
  });
  vid2.addEventListener('play', () => {
    playBtn.classList.add('lb-on');
    playBtn.setAttribute('aria-label', 'Pause');
    document.getElementById('screenshot-lightbox')?.classList.remove('lb--unstarted');
    syncLbPaused();
    schedHideLbChrome();
  });
  vid2.addEventListener('pause', () => {
    playBtn.classList.remove('lb-on');
    playBtn.setAttribute('aria-label', 'Play');
    syncLbPaused();
    if (!lbShowingVideo()) return; // stopHls' own pause, on a close or a step off the trailer
    showLbChrome();
    schedHideLbChrome();
  });
  vid2.addEventListener('ended', () => {
    playBtn.classList.remove('lb-on');
    playBtn.setAttribute('aria-label', 'Play');
    syncLbPaused();
    showLbChrome();
    schedHideLbChrome();
  });
  vid2.addEventListener('volumechange', () => {
    muteBtn.classList.toggle('lb-on', vid2.muted);
    muteBtn.setAttribute('aria-label', vid2.muted ? 'Unmute' : 'Mute');
  });

  scrub.addEventListener('input', () => {
    if (vid2.duration) vid2.currentTime = Number(scrub.value) * vid2.duration;
    updateScrubBg();
  });
  scrub.addEventListener('mousedown', () => clearTimeout(lbVcTimer));
  scrub.addEventListener('mouseup', () => schedHideLbChrome());

  playBtn.addEventListener('click', () => {
    vid2.paused ? vid2.play().catch(() => {}) : vid2.pause();
  });
  lb.querySelector('.lb-bigplay')!.addEventListener('click', () => vid2.play().catch(() => {}));
  // Screen locked, app or tab switched: stop rather than play on unseen. Not resumed on return —
  // the large play button is there, and sound starting by itself on unlock would surprise.
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.visibilityState === 'hidden' && lbShowingVideo()) vid2.pause();
    },
    { signal: _lbSignal },
  );
  muteBtn.addEventListener('click', () => {
    vid2.muted = !vid2.muted;
  });

  vid2.addEventListener('click', (e) => {
    // A tap on a trailer whose controls had idled out only brings them back, as phone players do.
    if (tapRevealedChrome) return;
    const toggle = () => (vid2.paused ? vid2.play().catch(() => {}) : vid2.pause());
    const rect = lb.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    if ((e as PointerEvent).pointerType === 'touch' && (frac < 1 / 3 || frac > 2 / 3)) {
      lbVideoTapTimer = setTimeout(toggle, LB_DOUBLE_TAP_MS);
    } else toggle();
  });

  // Once the chrome has idled out, the mouse brings back only the part it nears — the toolbar
  // at the top, an arrow at its edge, a trailer's controls at the bottom — and the cursor.
  const pointerZones = ['lb-pointer', 'lb-near-top', 'lb-near-bottom', 'lb-near-left', 'lb-near-right'];
  lb.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    lb.classList.add('lb-pointer');
    lb.classList.toggle('lb-near-top', e.clientY < LB_POINTER_ZONE);
    lb.classList.toggle('lb-near-bottom', e.clientY > innerHeight - LB_POINTER_ZONE);
    lb.classList.toggle('lb-near-left', e.clientX < LB_POINTER_ZONE);
    lb.classList.toggle('lb-near-right', e.clientX > innerWidth - LB_POINTER_ZONE);
    clearTimeout(lbPointerTimer);
    lbPointerTimer = setTimeout(() => lb.classList.remove(...pointerZones), 3000);
  });
  lb.addEventListener('mouseleave', () => lb.classList.remove(...pointerZones));
  // A tap brings the chrome back; a swipe steps media without it.
  let tapRevealedChrome = false;
  let tapX = 0,
    tapY = 0;
  lb.addEventListener(
    'touchstart',
    (e) => {
      tapRevealedChrome = lb.classList.contains('lb-idle');
      tapX = e.touches[0].clientX;
      tapY = e.touches[0].clientY;
    },
    { passive: true },
  );
  lb.addEventListener(
    'touchend',
    (e) => {
      const t = e.changedTouches[0];
      if (Math.abs(t.clientX - tapX) >= 10 || Math.abs(t.clientY - tapY) >= 10) return;
      showLbChrome();
      schedHideLbChrome();
    },
    { passive: true },
  );
}

// The large play button shows over a trailer that isn't playing — autoplay refused, paused, ended.
function syncLbPaused() {
  const lb = document.getElementById('screenshot-lightbox');
  lb?.classList.toggle('lb--paused', lbShowingVideo() && lbVideoEl.paused);
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
function mountLightboxDom(): () => void {
  const dispose = render(() => <LightboxDom />, document.body);
  const lb = document.getElementById('screenshot-lightbox')!;
  lbVideoEl = lb.querySelector<HlsVideo>('.lb-video')!;
  lbVideoAnchor = lb.querySelector('.lb-next')!; // re-inserted here, keeping the original order
  detachLbVideo(); // a closed lightbox shows nothing, so it holds no media element
  wireButtons(lb);
  wireKeyboard(lb);
  wireMouseHandlers(lb);
  wireTouchHandlers(lb);
  wireVideoControls(lb);
  return dispose;
}

// ── Public API ─────────────────────────────────────────────────────────────

export function openLightbox(game: Game, idxOrShotId: number | string) {
  // Only on a real open: this is also how an already-open lightbox is re-pointed at another game
  // (↑/↓ — see AppShell's onGameNav), and capturing focus again there would remember an element
  // inside the lightbox itself, so closing would restore focus to something already hidden.
  if (!isLightboxOpen()) _lbPrevFocus = document.activeElement;
  pushOverlayEntry('lightbox', closeLightbox, urlWithoutShot);
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
  lbShotChosen = true;
  const lb = document.getElementById('screenshot-lightbox') as HTMLDialogElement;
  // Focuses the surface (`autofocus`): the shortcuts work from there, and nothing shows a ring.
  if (!lb.open) lb.showModal();
  document.body.classList.add('lb-open'); // a modal dialog doesn't stop the page scrolling
  _onLightboxParamChange(newShots[idx()].shotId);
}

// The panel hero's picture, clicked, morphs into the lightbox's; the backdrop and the chrome fade in around it.
export function openLightboxFrom(from: HTMLImageElement, game: Game, idxOrShotId: number) {
  const lb = document.getElementById('screenshot-lightbox')!;
  const backdrop = lb.querySelector<HTMLElement>('.lb-backdrop')!;
  morph({
    from,
    update: () => openLightbox(game, idxOrShotId),
    to: () => lb.querySelector<HTMLElement>('.lb-img'),
    ready: (img) => loadedWhen(lb, 'lb--loading', img as HTMLImageElement),
    focus: () => {
      if (isLightboxOpen() && !lb.contains(document.activeElement)) lbSurface(lb).focus();
    },
    start: () => {
      lb.classList.add('lb-morph');
      backdrop.style.viewTransitionName = 'lb-backdrop';
      lb.style.viewTransitionName = 'lb-chrome';
    },
    finish: () => {
      lb.classList.remove('lb-morph');
      backdrop.style.viewTransitionName = '';
      lb.style.viewTransitionName = '';
    },
  });
}

// Re-points an already-open lightbox at another game — ↑/↓ and R, via AppShell's `onGameNav`/
// `onGameRandom`. Separate from `openLightbox` because the shot to land on depends on the one
// being left, which only this module knows: paging through a list is a browse, so it lands on
// real media rather than on the banner `openLightbox(game, 0)` used to pick (see
// `preferredShotIndex`).
// A game paged back to lands on the item the viewer picked there, for the session.
const lbLastShot = new Map<number, string>();
// Whether the item on screen is the viewer's pick (opened on or stepped to), not a game step's landing.
let lbShotChosen = false;

// Where `appid`'s remembered item sits in `list`, else where a game step lands leaving `leaving`.
function landingIndex(appid: number, list: MediaItem[], leaving: ShotKind) {
  const remembered = list.findIndex((s) => s.shotId === lbLastShot.get(appid));
  return remembered >= 0 ? remembered : preferredShotIndex(list, leaving);
}

export function repointLightboxGame(game: ReadonlyGame) {
  const left = shots()[idx()];
  const leavingGame = lbGame();
  // A lone banner is no pick: it stands in while the game's media streams.
  if (left && leavingGame && lbShotChosen && shots().length > 1) lbLastShot.set(leavingGame.appid, left.shotId);
  lbShotChosen = false;
  // A pending latch's kind carries on through a game still loading: its lone banner is no Cover.
  const leaving: ShotKind =
    _awaitingMedia ?? (left?.shotId === 'banner' && shots().length > 1 ? 'cover' : (left?.type ?? 'image'));
  const next = buildMediaItems(game.appid, game.details?.meta);
  const target = landingIndex(game.appid, next, leaving);
  // A lone banner means this row's details are still streaming — there is nothing else to show
  // *yet*. Latch the intent so the first real media to arrive is taken (see the effect at the
  // foot of this file); without it the banner would simply stay up, which is the whole reason
  // paging through a list used to be unrewarding.
  _awaitingMedia = next.length === 1 ? leaving : null;
  batch(() => {
    setLbGame(game);
    setIdx(target);
  });
  _onLightboxParamChange(next[target].shotId);
}

export function closeLightbox() {
  if (!isLightboxOpen()) return; // the `close` event that follows our own close()
  setLbGame(null);
  _awaitingMedia = null;
  clearTimeout(lbVcTimer);
  const lb = document.getElementById('screenshot-lightbox') as HTMLDialogElement;
  stopHls(lbVideoEl);
  detachLbVideo();
  lb.close();
  lb.classList.remove(
    'lb--loading',
    'lb-idle',
    'lb--paused',
    'lb--unstarted',
    'lb--stepped',
    'lb--stepped-game',
    'lb-pointer',
  );
  lbRenderedAppid = undefined;
  document.body.classList.remove('lb-open');
  if (isFullscreen()) exitFullscreen();
  _onLightboxParamChange(null);
  popOverlayEntry('lightbox');
  if (_lbPrevFocus?.isConnected) (_lbPrevFocus as HTMLElement).focus();
  else document.querySelector<HTMLElement>('#panel-hero .panel-hero-open')?.focus();
  _lbPrevFocus = null;
}

function stepLightbox(dir: number, swipe = false) {
  // A lone Cover (media still streaming): no step, so no pick that would cancel the latch.
  if (shots().length <= 1) return;
  // The viewer has taken over: whatever is on screen from here on is their choice, so the latch
  // must never move it under them.
  _awaitingMedia = null;
  lbShotChosen = true;
  lbLastAxis = 'x';
  const list = shots();
  const next = (idx() + dir + list.length) % list.length;
  // Entering from the side actually moved toward, so a wrap to the Cover slides in from the left —
  // except after a swipe, where it follows the finger.
  lbLastDir = swipe ? dir : Math.sign(next - idx()) || dir;
  setIdx(next);
  _onLightboxParamChange(list[next].shotId);
}

// Absolute jump (Home/End) — still animates in the right direction rather
// than always sliding one way, same as a multi-step stepLightbox would.
function gotoLightbox(target: number) {
  if (target === idx()) return;
  _awaitingMedia = null; // same reason as stepLightbox's
  lbShotChosen = true;

  lbLastDir = target > idx() ? 1 : -1;
  lbLastAxis = 'x';
  setIdx(target);
  _onLightboxParamChange(shots()[target].shotId);
}

// The caption, rendered on its own rather than as part of `renderLightbox` below. It carries
// the game/shot identity that used to exist only as invisible alt text (see `label` there), so
// switching games while the lightbox stays open (↑/↓, R) is visibly confirmed even when the new
// shot looks much like the old one — plus the position in the *list*, which the `Screenshot 1 of 12` media
// counter says nothing about. Split out because it's the one part reading the host's list
// position: that read must stay tracked for the position to follow a list still streaming in,
// and must not drag a full image reload along with it each time. Two text writes, no media.
function renderLbCaption() {
  const lb = document.getElementById('screenshot-lightbox');
  if (!lb) return;
  const name = gameName();
  const pos = _getGamePosition();
  const caption = lb.querySelector<HTMLElement>('.lb-caption')!;
  // The two counters wear the same pill (`.lb-counter` is the other), one per axis, so they read
  // as a pair and neither is mistaken for part of the title beside it.
  const posEl = caption.querySelector<HTMLElement>('.lb-caption-pos')!;
  posEl.textContent = pos ? `Game ${pos.index + 1} of ${pos.total}` : '';
  posEl.style.display = pos ? '' : 'none';
  caption.querySelector<HTMLElement>('.lb-caption-text')!.textContent = name;
  caption.style.display = name || pos ? '' : 'none';
  // No list behind the open game (a standalone lookup) means nothing to step to. Hiding them
  // inline also drops them out of the Tab focus trap — see getFocusable.
  for (const sel of ['.lb-game-prev', '.lb-game-next']) {
    caption.querySelector<HTMLElement>(sel)!.style.display = pos ? '' : 'none';
  }
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
  const img = lb.querySelector<HTMLImageElement>('.lb-img')!;
  const vid = lbVideoEl;
  const vc = lb.querySelector<HTMLElement>('.lb-vctrls')!;
  const dir = lbLastDir;
  const axis = lbLastAxis;
  lbLastDir = 0;
  lbLastAxis = 'x';
  resetLbZoom();
  const appid = lbGame()?.appid;
  flashLbCounter(lb, appid !== lbRenderedAppid);
  lbRenderedAppid = appid;
  hideLbError();
  // Invalidate any image preload still in flight from a previous render — see lbImgToken decl.
  lbImgToken++;
  // Untracked, and this is load-bearing: `_getGamePosition` reaches the route's list, which on
  // a list route is the table's `processedData()` — a signal recomputed on every batch of
  // streaming rows. Reading it in *this* effect subscribed the whole imperative render below to
  // it, so a list still loading behind the overlay restarted the image load several times a
  // second and the lightbox visibly blinked. The caption keeps it live in its own pass instead
  // (`renderLbCaption`); the alt text here is rebuilt on every step anyway.
  const pos = untrack(() => _getGamePosition());
  const label =
    `${name ? name + ' — ' : ''}${pos ? `game ${pos.index + 1} of ${pos.total} — ` : ''}` + mediaLabel(list, i);
  lb.querySelector<HTMLElement>('.lb-zoom')!.style.display = shot.type === 'video' ? 'none' : '';
  if (shot.type === 'video') {
    img.style.display = 'none';
    lb.classList.remove('lb--loading');
    attachLbVideo();
    lb.classList.add('lb--unstarted');
    vid.poster = shot.thumb || '';
    vid.setAttribute('aria-label', label);
    vc.style.display = '';
    resetLbVc(vc);
    playHls(vid, shot.hls, showLbVideoError);
    syncLbPaused();
    schedHideLbChrome();
  } else {
    stopHls(vid);
    detachLbVideo();
    lb.classList.remove('lb--unstarted');
    syncLbPaused();
    vc.style.display = 'none';
    img.style.display = 'block';
    img.alt = label;
    img.onload = null;
    img.onerror = null;
    if (dir !== 0) {
      // Named for the side the new shot comes in from, which is the one swiped toward: the
      // next media enters from the right, the next game from the bottom.
      const from = axis === 'y' ? (dir > 0 ? 'bottom' : 'top') : dir > 0 ? 'right' : 'left';
      img.className = `lb-img lb-anim-${from}`;
      img.addEventListener(
        'animationend',
        () => {
          img.className = 'lb-img';
        },
        { once: true },
      );
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
    loadLbImage(shot.main!);
    schedHideLbChrome();
  }
  lb.querySelector('.lb-counter')!.textContent = mediaLabel(list, i);
  lb.querySelector<HTMLButtonElement>('.lb-prev')!.disabled = list.length <= 1;
  lb.querySelector<HTMLButtonElement>('.lb-next')!.disabled = list.length <= 1;
  // Preload prev and next images so navigation feels instant; for a video,
  // warm its poster the same way and prime its HLS manifest in the HTTP
  // cache so stepping onto it doesn't pay the full fetch latency cold.
  const keep = new Set<string>();
  for (const offset of [-1, 1]) {
    const adjacent = list[(i + offset + list.length) % list.length];
    if (!adjacent) continue;
    const preloadSrc = adjacent.type === 'video' ? adjacent.thumb : adjacent.main;
    if (preloadSrc) keep.add(preloadSrc);
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
  lb.querySelectorAll<HTMLImageElement>('.lb-preload').forEach((el) => {
    if (!keep.has(el.dataset.src ?? '')) el.remove();
  });
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
    const target = landingIndex(lbGame()!.appid, list, leaving);
    if (target === 0) return; // the Cover wanted, or trailers but no screenshots (not worth autoplaying unasked)
    setIdx(target);
    _onLightboxParamChange(list[target].shotId);
  });
  createEffect(() => {
    const list = shots();
    idx();
    gameName();
    if (list.length) renderLightbox();
  });
  createEffect(() => {
    if (shots().length) renderLbCaption();
  });
});
