'use strict';

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

let lightboxShots = [];
let lightboxIdx   = 0;
let lbZoom = 1, lbPanX = 0, lbPanY = 0, lbLastDir = 0, lbVcTimer = null;

let _onLightboxParamChange = null;
let _lbPrevFocus = null;

// ── Init ───────────────────────────────────────────────────────────────────

function initLightbox({ onParamChange } = {}) {
  _onLightboxParamChange = onParamChange ?? null;
  document.addEventListener('fullscreenchange', syncLightboxFullscreenBtn);
  document.addEventListener('webkitfullscreenchange', syncLightboxFullscreenBtn);
}

function isLightboxOpen() { return lightboxShots.length > 0; }

// ── Fullscreen button sync ─────────────────────────────────────────────────

function syncLightboxFullscreenBtn() {
  const btn = document.querySelector('#screenshot-lightbox .lb-fullscreen');
  if (!btn) return;
  const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
  btn.innerHTML = isFs ? LB_FS_EXIT : LB_FS_ENTER;
  btn.setAttribute('aria-label', isFs ? 'Exit fullscreen' : 'Enter fullscreen');
}

// ── Video playback (HLS) ───────────────────────────────────────────────────

function playHls(videoEl, src) {
  if (!src) return;
  if (videoEl._hls) { videoEl._hls.destroy(); videoEl._hls = null; }
  if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
    videoEl.src = src;
    videoEl.play().catch(() => {});
  } else if (typeof Hls !== 'undefined' && Hls.isSupported()) {
    const hls = new Hls({ autoStartLoad: true, startLevel: -1 });
    hls.loadSource(src);
    hls.attachMedia(videoEl);
    hls.on(Hls.Events.MANIFEST_PARSED, () => videoEl.play().catch(() => {}));
    videoEl._hls = hls;
  }
}

function stopHls(videoEl) {
  if (!videoEl) return;
  videoEl.pause();
  if (videoEl._hls) { videoEl._hls.destroy(); videoEl._hls = null; }
  videoEl.removeAttribute('src');
}

// ── Zoom / pan ─────────────────────────────────────────────────────────────

function applyLbTransform() {
  const img = document.querySelector('#screenshot-lightbox .lb-img');
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

// ── Time formatting ────────────────────────────────────────────────────────

function fmtTime(s) {
  if (!isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

// ── Video controls visibility ──────────────────────────────────────────────

function showLbVc() {
  const vc = document.querySelector('#screenshot-lightbox .lb-vctrls');
  if (!vc || vc.style.display === 'none') return;
  vc.classList.remove('lb-vctrls--hidden');
  clearTimeout(lbVcTimer);
}

function schedHideLbVc() {
  const vc  = document.querySelector('#screenshot-lightbox .lb-vctrls');
  const vid = document.querySelector('#screenshot-lightbox .lb-video');
  if (!vc || vc.style.display === 'none') return;
  clearTimeout(lbVcTimer);
  if (vid && !vid.paused) lbVcTimer = setTimeout(() => vc.classList.add('lb-vctrls--hidden'), 3000);
}

// ── Focus helpers ──────────────────────────────────────────────────────────

// Returns all focusable elements that are not inside a display:none ancestor.
function getFocusable(lb) {
  return [...lb.querySelectorAll('button:not([disabled]), input[type="range"]')]
    .filter(el => {
      let node = el;
      while (node && node !== lb) {
        if (node.style.display === 'none') return false;
        node = node.parentElement;
      }
      return true;
    });
}

// ── DOM creation ───────────────────────────────────────────────────────────

function createLightboxDom() {
  const lb = document.createElement('div');
  lb.id = 'screenshot-lightbox';
  lb.setAttribute('role', 'dialog');
  lb.setAttribute('aria-modal', 'true');
  lb.setAttribute('aria-label', 'Screenshot viewer');
  lb.innerHTML = `
    <div class="lb-backdrop"></div>
    <button class="lb-btn lb-prev" aria-label="Previous screenshot">&#8249;</button>
    <img class="lb-img" src="" alt="Screenshot">
    <video class="lb-video" playsinline></video>
    <button class="lb-btn lb-next" aria-label="Next screenshot">&#8250;</button>
    <div class="lb-vctrls" style="display:none">
      <button class="lb-vc-btn lb-vc-play" aria-label="Play">${LB_PLAY_ICON}</button>
      <span class="lb-vc-time">0:00</span>
      <input class="lb-vc-scrub" type="range" min="0" max="1" step="0.001" value="0" aria-label="Seek">
      <span class="lb-vc-dur">0:00</span>
      <button class="lb-vc-btn lb-vc-mute" aria-label="Mute">${LB_VOL_ICON}</button>
    </div>
    <div class="lb-toolbar">
      <div class="lb-toolbar-left">
        <button class="lb-fullscreen" aria-label="Enter fullscreen">${LB_FS_ENTER}</button>
        <button class="lb-share" aria-label="Copy link to this screenshot">${LB_LINK_ICON}</button>
      </div>
      <div class="lb-counter"></div>
      <div class="lb-toolbar-right">
        <button class="lb-close" aria-label="Close lightbox">&#215;</button>
      </div>
    </div>`;
  return lb;
}

// ── Event wiring ───────────────────────────────────────────────────────────

function wireButtons(lb) {
  lb.querySelector('.lb-backdrop').addEventListener('click', closeLightbox);
  lb.querySelector('.lb-close').addEventListener('click', closeLightbox);
  lb.querySelector('.lb-share').addEventListener('click', async () => {
    const btn = lb.querySelector('.lb-share');
    try {
      await navigator.clipboard.writeText(location.href);
      btn.innerHTML = LB_CHECK_ICON;
      setTimeout(() => { btn.innerHTML = LB_LINK_ICON; }, 1500);
    } catch {
      window.prompt('Copy this link:', location.href);
    }
  });
  lb.querySelector('.lb-prev').addEventListener('click', () => stepLightbox(-1));
  lb.querySelector('.lb-next').addEventListener('click', () => stepLightbox(1));
  lb.querySelector('.lb-fullscreen').addEventListener('click', () => {
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      (document.exitFullscreen?.() ?? document.webkitExitFullscreen?.())?.catch?.(() => {});
    } else {
      (lb.requestFullscreen?.() ?? lb.webkitRequestFullscreen?.())?.catch?.(() => {});
    }
  });
}

function wireKeyboard(lb) {
  document.addEventListener('keydown', e => {
    if (!lightboxShots.length) return;
    const onScrub = e.target.classList.contains('lb-vc-scrub');

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

    if (!onScrub) {
      if (e.key === 'ArrowLeft')  { e.preventDefault(); stepLightbox(-1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); stepLightbox(1); }
    }
    if (e.key === 'f' || e.key === 'F') {
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        (document.exitFullscreen?.() ?? document.webkitExitFullscreen?.())?.catch?.(() => {});
      } else {
        (lb.requestFullscreen?.() ?? lb.webkitRequestFullscreen?.())?.catch?.(() => {});
      }
    }
    const vc = lb.querySelector('.lb-vctrls');
    if (vc && vc.style.display !== 'none') {
      const vid = lb.querySelector('.lb-video');
      if (e.key === ' ' && !onScrub) { e.preventDefault(); vid.paused ? vid.play().catch(() => {}) : vid.pause(); }
      if (e.key === 'm' || e.key === 'M') { vid.muted = !vid.muted; }
    }
  });
}

function wireMouseHandlers(lb) {
  lb.addEventListener('wheel', e => {
    if (lb.querySelector('.lb-img').style.display === 'none') return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    lbZoom = Math.max(1, Math.min(4, lbZoom * factor));
    if (lbZoom === 1) { lbPanX = 0; lbPanY = 0; }
    applyLbTransform();
  }, { passive: false });

  const lbImg = lb.querySelector('.lb-img');
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
    if (lbZoom > 1) {
      resetLbZoom();
    } else {
      // zoom 2× towards the clicked point
      const rect = lbImg.getBoundingClientRect();
      const cx = e.clientX - rect.left - rect.width  / 2;
      const cy = e.clientY - rect.top  - rect.height / 2;
      lbZoom = 2;
      lbPanX = -cx;
      lbPanY = -cy;
      applyLbTransform();
      lbImg.style.cursor = 'grab';
    }
  });
}

function wireTouchHandlers(lb) {
  let lbX = 0, lbY = 0, lbActive = false;
  let pinchStartDist = 0, pinchStartZoom = 1;
  let touchPanning = false, touchPanStartX = 0, touchPanStartY = 0, touchPanOriginX = 0, touchPanOriginY = 0;

  lb.addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
      if (lb.querySelector('.lb-img').style.display === 'none') return;
      pinchStartDist = Math.hypot(
        e.touches[1].clientX - e.touches[0].clientX,
        e.touches[1].clientY - e.touches[0].clientY
      );
      pinchStartZoom = lbZoom;
      lbActive = false;
      e.preventDefault();
    } else if (e.touches.length === 1) {
      if (lbZoom > 1) {
        touchPanning = true;
        touchPanStartX = e.touches[0].clientX; touchPanStartY = e.touches[0].clientY;
        touchPanOriginX = lbPanX; touchPanOriginY = lbPanY;
        lbActive = false;
      } else {
        lbX = e.touches[0].clientX; lbY = e.touches[0].clientY; lbActive = true;
      }
    }
  }, { passive: false });

  lb.addEventListener('touchmove', e => {
    if (e.touches.length === 2) {
      if (lb.querySelector('.lb-img').style.display === 'none') return;
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
    if (lbZoom > 1) return;
    const dx = e.changedTouches[0].clientX - lbX;
    const dy = e.changedTouches[0].clientY - lbY;
    if (Math.abs(dx) > Math.abs(dy) * 1.2 && Math.abs(dx) > 50) stepLightbox(dx < 0 ? 1 : -1);
    else if (dy > 80 && Math.abs(dy) > Math.abs(dx)) closeLightbox();
  }, { passive: true });

  lb.addEventListener('touchcancel', () => { lbActive = false; touchPanning = false; }, { passive: true });
}

function wireVideoControls(lb) {
  const vid2    = lb.querySelector('.lb-video');
  const vc2     = lb.querySelector('.lb-vctrls');
  const scrub   = vc2.querySelector('.lb-vc-scrub');
  const timEl   = vc2.querySelector('.lb-vc-time');
  const durEl   = vc2.querySelector('.lb-vc-dur');
  const playBtn = vc2.querySelector('.lb-vc-play');
  const muteBtn = vc2.querySelector('.lb-vc-mute');

  const updateScrubBg = () => {
    const pct = scrub.value * 100;
    scrub.style.backgroundImage =
      `linear-gradient(to right, var(--accent) ${pct}%, rgba(255,255,255,0.25) ${pct}%)`;
  };

  vid2.addEventListener('timeupdate', () => {
    if (!vid2.duration) return;
    scrub.value = vid2.currentTime / vid2.duration;
    timEl.textContent = fmtTime(vid2.currentTime);
    updateScrubBg();
  });
  vid2.addEventListener('durationchange', () => { durEl.textContent = fmtTime(vid2.duration); });
  vid2.addEventListener('play',  () => {
    playBtn.innerHTML = LB_PAUSE_ICON;
    playBtn.setAttribute('aria-label', 'Pause');
    schedHideLbVc();
  });
  vid2.addEventListener('pause', () => {
    playBtn.innerHTML = LB_PLAY_ICON;
    playBtn.setAttribute('aria-label', 'Play');
    showLbVc();
  });
  vid2.addEventListener('ended', () => {
    playBtn.innerHTML = LB_PLAY_ICON;
    playBtn.setAttribute('aria-label', 'Play');
    showLbVc();
  });
  vid2.addEventListener('volumechange', () => {
    muteBtn.innerHTML = vid2.muted ? LB_MUTE_ICON : LB_VOL_ICON;
    muteBtn.setAttribute('aria-label', vid2.muted ? 'Unmute' : 'Mute');
  });

  scrub.addEventListener('input', () => {
    if (vid2.duration) vid2.currentTime = scrub.value * vid2.duration;
    updateScrubBg();
  });
  scrub.addEventListener('mousedown', () => clearTimeout(lbVcTimer));
  scrub.addEventListener('mouseup',   () => schedHideLbVc());

  playBtn.addEventListener('click', () => { vid2.paused ? vid2.play().catch(() => {}) : vid2.pause(); });
  muteBtn.addEventListener('click', () => { vid2.muted = !vid2.muted; });

  vid2.addEventListener('click', () => { vid2.paused ? vid2.play().catch(() => {}) : vid2.pause(); });

  lb.addEventListener('mousemove',  () => { if (vc2.style.display !== 'none') { showLbVc(); schedHideLbVc(); } });
  lb.addEventListener('mouseleave', () => { if (vc2.style.display !== 'none') schedHideLbVc(); });
  lb.addEventListener('touchstart', () => { if (vc2.style.display !== 'none') { showLbVc(); schedHideLbVc(); } }, { passive: true });
}

// ── Singleton getter ────────────────────────────────────────────────────────

function getLightbox() {
  let lb = document.getElementById('screenshot-lightbox');
  if (lb) return lb;
  lb = createLightboxDom();
  document.body.appendChild(lb);
  wireButtons(lb);
  wireKeyboard(lb);
  wireMouseHandlers(lb);
  wireTouchHandlers(lb);
  wireVideoControls(lb);
  return lb;
}

// ── Public API ─────────────────────────────────────────────────────────────

function openLightbox(game, idxOrShotId) {
  _lbPrevFocus = document.activeElement;
  lightboxShots = buildMediaItems(game.appid, game.details?.meta);
  lightboxIdx = resolveShotIndex(lightboxShots, idxOrShotId);
  renderLightbox();
  const lb = getLightbox();
  lb.classList.add('open');
  document.body.classList.add('lb-open');
  lb.querySelector('.lb-close').focus();
  _onLightboxParamChange?.(lightboxShots[lightboxIdx].shotId);
}

function closeLightbox() {
  lightboxShots = [];
  clearTimeout(lbVcTimer);
  const lb = getLightbox();
  stopHls(lb.querySelector('.lb-video'));
  lb.classList.remove('open', 'lb--loading');
  document.body.classList.remove('lb-open');
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    (document.exitFullscreen?.() ?? document.webkitExitFullscreen?.())?.catch?.(() => {});
  }
  _onLightboxParamChange?.(null);
  _lbPrevFocus?.focus();
  _lbPrevFocus = null;
}

function stepLightbox(dir) {
  lbLastDir = dir;
  lightboxIdx = (lightboxIdx + dir + lightboxShots.length) % lightboxShots.length;
  renderLightbox();
  _onLightboxParamChange?.(lightboxShots[lightboxIdx].shotId);
}

function renderLightbox() {
  const lb = getLightbox();
  const shot = lightboxShots[lightboxIdx];
  const img  = lb.querySelector('.lb-img');
  const vid  = lb.querySelector('.lb-video');
  const vc   = lb.querySelector('.lb-vctrls');
  const dir  = lbLastDir;
  lbLastDir = 0;
  resetLbZoom();
  if (shot.type === 'video') {
    img.style.display = 'none';
    lb.classList.remove('lb--loading');
    vid.style.display = 'block';
    vid.poster = shot.thumb || '';
    vc.style.display = '';
    vc.classList.remove('lb-vctrls--hidden');
    playHls(vid, shot.hls);
    schedHideLbVc();
  } else {
    stopHls(vid);
    vc.style.display = 'none';
    clearTimeout(lbVcTimer);
    vid.style.display = 'none';
    img.style.display = 'block';
    if (dir !== 0) {
      img.onload = null;
      img.style.opacity = '';
      img.src = shot.main;
      img.className = `lb-img lb-anim-${dir > 0 ? 'right' : 'left'}`;
      img.addEventListener('animationend', () => { img.className = 'lb-img'; }, { once: true });
    } else {
      img.className = 'lb-img';
      img.style.opacity = '0';
      lb.classList.add('lb--loading');
      img.onload  = () => { img.style.opacity = '1'; lb.classList.remove('lb--loading'); };
      img.onerror = () => { img.style.opacity = '1'; lb.classList.remove('lb--loading'); };
      img.src = shot.main;
      if (img.complete) { img.onload = null; img.style.opacity = '1'; lb.classList.remove('lb--loading'); }
    }
  }
  lb.querySelector('.lb-counter').textContent = `${lightboxIdx + 1} / ${lightboxShots.length}`;
  lb.querySelector('.lb-prev').disabled = lightboxShots.length <= 1;
  lb.querySelector('.lb-next').disabled = lightboxShots.length <= 1;
  // Preload prev and next images so navigation feels instant
  for (const offset of [-1, 1]) {
    const adjacent = lightboxShots[(lightboxIdx + offset + lightboxShots.length) % lightboxShots.length];
    if (adjacent && adjacent.type !== 'video' && adjacent.main !== shot.main) {
      let pre = lb.querySelector(`.lb-preload[data-src="${CSS.escape(adjacent.main)}"]`);
      if (!pre) {
        pre = document.createElement('img');
        pre.className = 'lb-preload';
        pre.dataset.src = adjacent.main;
        pre.src = adjacent.main;
        pre.style.cssText = 'position:absolute;width:0;height:0;opacity:0;pointer-events:none';
        lb.appendChild(pre);
      }
    }
  }
  // Drop stale preloads (keep only prev/next)
  const keep = new Set(
    [-1, 1].map(o => lightboxShots[(lightboxIdx + o + lightboxShots.length) % lightboxShots.length]?.main)
  );
  lb.querySelectorAll('.lb-preload').forEach(el => { if (!keep.has(el.dataset.src)) el.remove(); });
}

if (typeof module !== 'undefined') module.exports = { fmtTime, isLightboxOpen };
