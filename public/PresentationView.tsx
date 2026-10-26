// The presentation window (present.html): a lightbox on another screen, showing the one media its main window sends
// (presentation.ts). Its DOM is never rebuilt, so fullscreen holds across sends (docs/dev/frontend.md#the-presentation-window).
import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { playHls, stopHls } from './hlsPlayer.ts';
import type { HlsVideo } from './hlsPlayer.ts';
import { PRESENTATION_CHANNEL, HEARTBEAT_MS } from './presentationProtocol.ts';
import type { FromPresentationBody, OnAir, ToPresentation } from './presentationProtocol.ts';

const IDLE_MS = 3000;

function PresentationView() {
  const main = new URLSearchParams(location.search).get('main');
  const [onAir, setOnAir] = createSignal<OnAir | null>(null);
  const [awake, setAwake] = createSignal(true);
  const [failed, setFailed] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  // A trailer muted for want of a first click in this window: the pill says a click gives it sound.
  const [silenced, setSilenced] = createSignal(false);
  let root!: HTMLDivElement;
  let img!: HTMLImageElement;
  let video!: HlsVideo;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const channel = new BroadcastChannel(PRESENTATION_CHANNEL);

  const post = (msg: FromPresentationBody) => main && channel.postMessage({ main, ...msg });
  const report = () => post({ type: 'state', onAir: onAir() });

  function wake() {
    setAwake(true);
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => setAwake(false), IDLE_MS);
  }

  // What was on screen fades out over the new media: a picture copied, as the DOM is never rebuilt.
  function fadeOut() {
    const src = !img.hidden ? img.currentSrc : !video.hidden ? video.poster : '';
    if (!src) return;
    const ghost = document.createElement('img');
    ghost.className = 'pres-ghost';
    ghost.src = src;
    ghost.addEventListener('animationend', () => ghost.remove(), { once: true });
    root.append(ghost);
  }

  function show({ item }: OnAir) {
    setFailed(false);
    fadeOut();
    // A late error or load from the previous media is dropped.
    const current = () => onAir()?.item === item;
    const fail = () => current() && (setLoading(false), setFailed(true));
    if (item.type === 'video') {
      img.hidden = true;
      video.hidden = false;
      video.poster = item.thumb;
      setLoading(false);
      // Browsers refuse sound before a first click in this window (the main window's doesn't count).
      video.muted = !navigator.userActivation?.hasBeenActive;
      setSilenced(video.muted);
      playHls(video, item.hls, fail);
    } else {
      stopHls(video);
      setSilenced(false);
      video.hidden = true;
      img.hidden = false;
      img.onerror = fail;
      // The thumbnail stands in until the full picture has loaded.
      img.src = item.thumb;
      setLoading(true);
      const full = new Image();
      full.onload = () => current() && ((img.src = item.main!), setLoading(false));
      full.onerror = fail;
      full.src = item.main!;
    }
  }

  function receive(e: MessageEvent<ToPresentation>) {
    const msg = e.data;
    if (msg?.main !== main) return;
    if (msg.type === 'close') window.close();
    // The main window is back from a reload: tell it at once, before it opens a second window.
    if (msg.type === 'main') report();
    if (msg.type === 'onAir') {
      setOnAir(msg.onAir);
      show(msg.onAir);
      wake();
      report();
    }
  }

  // Its only control; the first click also lets the trailer on screen have its sound.
  function toggleFullscreen() {
    video.muted = false;
    setSilenced(false);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else root.requestFullscreen?.().catch(() => {});
    wake();
  }

  let wakeLock: WakeLockSentinel | null = null;
  async function keepScreenOn() {
    if (document.visibilityState !== 'visible' || (wakeLock && !wakeLock.released)) return;
    try {
      wakeLock = (await navigator.wakeLock?.request('screen')) ?? null;
    } catch {
      // Refused (power saving, no HTTPS): the screen may dim, nothing else changes.
    }
  }

  onMount(() => {
    channel.addEventListener('message', receive);
    // Chromium nulls `opener` when the main window closes, others keep it `closed`; a reload keeps it.
    const hadOpener = !!window.opener;
    const heartbeat = setInterval(
      () => (hadOpener && (!window.opener || window.opener.closed) ? window.close() : report()),
      HEARTBEAT_MS,
    );
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'f' || e.key === 'F') toggleFullscreen();
    };
    const bye = () => post({ type: 'bye' });
    document.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', keepScreenOn);
    addEventListener('pagehide', bye);
    keepScreenOn();
    wake();
    post({ type: 'hello' });
    onCleanup(() => {
      clearInterval(heartbeat);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', keepScreenOn);
      removeEventListener('pagehide', bye);
      channel.close();
    });
  });

  return (
    <div
      class="pres"
      classList={{ 'pres--awake': awake(), 'pres--loading': loading() }}
      ref={root}
      onPointerMove={wake}
      onClick={toggleFullscreen}
    >
      <img class="pres-media" ref={img} alt="" hidden />
      <video class="pres-media" ref={video} playsinline hidden />
      <Show when={onAir()}>{(game) => <p class="pres-caption pres-glass">{game().name}</p>}</Show>
      <Show when={silenced()}>
        <p class="pres-sound pres-glass">Click for sound</p>
      </Show>
      <Show when={failed() && onAir()}>
        {(game) => (
          <p class="pres-error pres-glass" role="alert">
            Couldn't load this {game().item.type === 'video' ? 'video' : 'image'}.
          </p>
        )}
      </Show>
    </div>
  );
}

render(() => <PresentationView />, document.getElementById('presentation')!);
