// Steam trailer playback (HLS) into a reused <video>, shared by the lightbox and the presentation window.

export type HlsVideo = HTMLVideoElement & { _hls?: { destroy: () => void } | null; _hlsToken?: number };

// hls.js is ~130KB gzipped and only needed once a non-Safari browser plays a trailer: loaded then,
// memoized, so the lightbox's prefetch can warm it ahead of a video shot.
let _hlsModulePromise: Promise<any> | null = null;
export function loadHlsModule(): Promise<any> {
  return (_hlsModulePromise ??= import('hls.js').then((m) => m.default));
}

export async function playHls(videoEl: HlsVideo, src: string | null | undefined, onError: () => void) {
  if (!src) return;
  if (videoEl._hls) {
    videoEl._hls.destroy();
    videoEl._hls = null;
  }
  if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
    // Assigned as a property (not addEventListener) since videoEl is reused
    // across shots — a property assignment overwrites rather than stacking.
    videoEl.onerror = onError;
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
    if (data?.fatal) onError();
  });
  hls.loadSource(src);
  hls.attachMedia(videoEl);
  hls.on(Hls.Events.MANIFEST_PARSED, () => videoEl.play().catch(() => {}));
  videoEl._hls = hls;
}

export function stopHls(videoEl: HlsVideo | null) {
  if (!videoEl) return;
  videoEl.pause();
  videoEl._hlsToken = (videoEl._hlsToken || 0) + 1; // invalidate any in-flight playHls() load
  if (videoEl._hls) {
    videoEl._hls.destroy();
    videoEl._hls = null;
  }
  videoEl.removeAttribute('src');
}
