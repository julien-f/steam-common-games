// The presentation window (present.html): a lightbox on another screen, showing the one media its main window sends
// (presentation.ts). Its DOM is never rebuilt, so fullscreen holds across sends (docs/dev/frontend.md#the-presentation-window).
import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { playHls, stopHls } from './hlsPlayer.ts';
import type { HlsVideo } from './hlsPlayer.ts';
import { PRESENTATION_CHANNEL, HEARTBEAT_MS } from './presentationProtocol.ts';
import type { Control, FromPresentationBody, OnAir, ToPresentation } from './presentationProtocol.ts';

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
  // Nothing after `bye`: a closing window's last visibilitychange would otherwise cancel it.
  let closing = false;
  const report = () =>
    !closing && post({ type: 'state', onAir: onAir(), hidden: document.visibilityState === 'hidden' });
  // The main window said it's going: closed unless it says `main` again (a reload) within this.
  let mainGone: ReturnType<typeof setTimeout> | undefined;
  // The host's unmute this window refused: no click here yet (see `Playback.needsClick`).
  let needsClick = false;
  let lastTimeReport = 0;
  const reportPlayback = () =>
    !closing &&
    post({
      type: 'playback',
      playback: {
        paused: video.paused,
        muted: video.muted,
        t: video.currentTime,
        dur: video.duration || 0,
        ended: video.ended,
        failed: failed(),
        needsClick,
      },
    });

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

  function show({ item, startAt, paused }: OnAir) {
    setFailed(false);
    fadeOut();
    // A late error or load from the previous media is dropped.
    const current = () => onAir()?.item === item;
    const fail = () => current() && (setLoading(false), setFailed(true), reportPlayback());
    if (item.type === 'video') {
      img.hidden = true;
      video.hidden = false;
      video.poster = item.thumb;
      setLoading(false);
      // With sound when the browser allows it; muted, and saying so, when it wants a click here first.
      video.muted = false;
      setSilenced(false);
      if (startAt) video.currentTime = startAt;
      if (paused) video.addEventListener('play', () => video.pause(), { once: true });
      playHls(video, item.hls, fail, () => setSilenced(true));
    } else {
      stopHls(video);
      setSilenced(false);
      video.hidden = true;
      img.hidden = false;
      img.onerror = null; // a broken thumbnail isn't the picture failing: `full` says that
      // The thumbnail stands in until the full picture has loaded.
      img.src = item.thumb;
      setLoading(true);
      const full = new Image();
      full.onload = () => current() && ((img.src = item.main!), setLoading(false));
      full.onerror = fail;
      full.src = item.main!;
    }
    reportPlayback();
  }

  function obey(c: Control) {
    if (c === 'retry') return show(onAir()!);
    if (video.hidden) return;
    if (c === 'play') video.play().catch(() => {});
    if (c === 'pause') video.pause();
    if (c === 'replay') {
      video.currentTime = 0;
      video.play().catch(() => {});
    }
    if (c === 'mute') video.muted = true;
    // Unmuted before a click here, Chrome would pause it: it waits for that click instead.
    if (c === 'unmute') {
      if (activatedAt || navigator.userActivation?.hasBeenActive) {
        video.muted = false;
        setSilenced(false);
      } else needsClick = true;
    }
    reportPlayback();
  }

  function receive(e: MessageEvent<ToPresentation>) {
    const msg = e.data;
    if (msg?.main !== main) return;
    if (msg.type === 'close') window.close();
    if (msg.type === 'control') obey(msg.control);
    if (msg.type === 'bye') mainGone = setTimeout(() => window.close(), 3000);
    // The main window is back from a reload: tell it at once, before it opens a second window.
    if (msg.type === 'main') {
      clearTimeout(mainGone);
      report();
    }
    if (msg.type === 'onAir') {
      const shown = onAir();
      const same = shown?.appid === msg.onAir.appid && shown.item.shotId === msg.onAir.item.shotId;
      // P again on what's up: the caption says what it is; only an ended trailer starts over.
      if (same && !video.hidden && video.ended) video.play().catch(() => {});
      else if (!same) {
        setOnAir(msg.onAir);
        show(msg.onAir);
      }
      wake();
      report();
    }
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else root.requestFullscreen?.().catch(() => {});
  }

  // The first click (or key) here enters fullscreen and gives sound; later ones never leave fullscreen
  // (someone in the room clicking), double-click or F does.
  let activatedAt = 0;
  function activate() {
    video.muted = false;
    setSilenced(false);
    needsClick = false;
    if (!activatedAt) {
      activatedAt = Date.now();
      if (!document.fullscreenElement) toggleFullscreen();
    }
    wake();
  }
  function onDoubleClick() {
    if (Date.now() - activatedAt > 500) toggleFullscreen(); // not the activating click's second half
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
      if (e.ctrlKey || e.metaKey || e.altKey) return; // the browser's
      if (!activatedAt) return activate();
      if (e.key === 'f' || e.key === 'F') toggleFullscreen();
    };
    const bye = () => {
      post({ type: 'bye' });
      closing = true;
    };
    document.addEventListener('keydown', onKey);
    for (const type of ['play', 'pause', 'ended', 'volumechange', 'durationchange'])
      video.addEventListener(type, reportPlayback);
    // The chip's progress line: once a second is plenty.
    video.addEventListener('timeupdate', () => {
      if (Date.now() - lastTimeReport < 1000) return;
      lastTimeReport = Date.now();
      reportPlayback();
    });
    document.addEventListener('visibilitychange', keepScreenOn);
    document.addEventListener('visibilitychange', report); // hidden: main allows for throttled beats
    addEventListener('pagehide', bye);
    keepScreenOn();
    wake();
    post({ type: 'hello' });
    onCleanup(() => {
      clearInterval(heartbeat);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', keepScreenOn);
      document.removeEventListener('visibilitychange', report);
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
      onClick={activate}
      onDblClick={onDoubleClick}
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
