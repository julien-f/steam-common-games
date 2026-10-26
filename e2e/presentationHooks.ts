import type { Page } from '@playwright/test';
import { PRESENTATION_CHANNEL } from '../public/presentationProtocol.ts';

// What a test needs the presentation window to do or report. Injected into its HTML by a context
// route: init scripts miss a popup's first document about one run in four.
export interface PresentationHooks {
  // A window nobody has clicked yet (Playwright's popups sometimes report one already activated).
  neverActivated?: boolean;
  // Trailers "play" without a stream (none in the fixtures, no H.264 decoder in Playwright's
  // Chromium): HLS taken as native, play()/pause() only flipping `paused` and firing their events, a
  // 90 s `duration`, seeks firing `seeking`/`seeked`; `window.presTest.stall()`/`resume()` fire `waiting`/`playing`.
  fakePlayback?: boolean;
  // A browser refusing a trailer's sound until a click in that window.
  refusedSound?: boolean;
  // `window.presTest.hide()`: the window occluded, so throttled that its heartbeats stop coming.
  occludable?: boolean;
  // `window.mediaKeys`: the Media Session handlers set, to press as the OS keys would.
  mediaKeys?: boolean;
  // A laptop and a TV ("LG TV", at x 1920) under the Window Management API, its permission in this
  // state (a prompt answers yes); `window.placed` records fullscreen requests and moves.
  screens?: { permission: 'granted' | 'prompt' | 'denied'; count: number };
}

// `window.presTest` in the presentation window. `heard`: every message on the presentation channel, both ways.
export interface PresTest {
  heard: { type: string; [key: string]: unknown }[];
  hide(): void;
  stall(): void;
  resume(): void;
}

export async function hookPresentation(page: Page, hooks: PresentationHooks): Promise<void> {
  await page.context().route('**/present.html*', async (route) => {
    const response = await route.fetch();
    const script = `<script>(${install.toString()})(${JSON.stringify(hooks)}, ${JSON.stringify(PRESENTATION_CHANNEL)})</script>`;
    await route.fulfill({ response, body: (await response.text()).replace('<head>', `<head>${script}`) });
  });
}

// Runs in the presentation window, before its own scripts.
function install(hooks: PresentationHooks, channelName: string) {
  const presTest = {} as PresTest;
  (window as unknown as { presTest: PresTest }).presTest = presTest;
  // Another channel object hears both sides: main's messages and this window's own.
  presTest.heard = [];
  new BroadcastChannel(channelName).onmessage = (e) => presTest.heard.push(e.data);
  if (hooks.neverActivated)
    Object.defineProperty(Navigator.prototype, 'userActivation', {
      get: () => ({ hasBeenActive: false, isActive: false }),
    });
  if (hooks.fakePlayback) {
    HTMLMediaElement.prototype.canPlayType = () => 'maybe';
    HTMLMediaElement.prototype.load = () => {};
    Object.defineProperty(HTMLMediaElement.prototype, 'src', {
      get(this: HTMLMediaElement) {
        return this.dataset.src ?? '';
      },
      set(this: HTMLMediaElement, src: string) {
        this.dataset.src = src; // never loaded: nothing to fail
        if (src) queueMicrotask(() => this.dispatchEvent(new Event('loadedmetadata')));
      },
    });
    const playing = new WeakSet<HTMLMediaElement>();
    Object.defineProperty(HTMLMediaElement.prototype, 'paused', {
      get(this: HTMLMediaElement) {
        return !playing.has(this);
      },
    });
    HTMLMediaElement.prototype.play = async function (this: HTMLMediaElement) {
      playing.add(this);
      this.dispatchEvent(new Event('play'));
    };
    HTMLMediaElement.prototype.pause = function (this: HTMLMediaElement) {
      if (playing.delete(this)) this.dispatchEvent(new Event('pause'));
    };
    const at = new WeakMap<HTMLMediaElement, number>();
    Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
      configurable: true,
      get(this: HTMLMediaElement) {
        return at.get(this) ?? 0;
      },
      set(this: HTMLMediaElement, t: number) {
        at.set(this, t);
        this.dispatchEvent(new Event('seeking'));
        queueMicrotask(() => this.dispatchEvent(new Event('seeked')));
      },
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'duration', { configurable: true, get: () => 90 });
    Object.defineProperty(HTMLMediaElement.prototype, 'ended', {
      configurable: true,
      get(this: HTMLMediaElement) {
        return (at.get(this) ?? 0) >= 90;
      },
    });
    const video = () => document.querySelector('video')!;
    presTest.stall = () => video().dispatchEvent(new Event('waiting'));
    presTest.resume = () => video().dispatchEvent(new Event('playing'));
  }
  if (hooks.occludable) {
    let silent = false;
    const post = BroadcastChannel.prototype.postMessage;
    BroadcastChannel.prototype.postMessage = function (this: BroadcastChannel, msg: { type?: string }) {
      if (!silent || msg?.type !== 'state') post.call(this, msg);
    };
    presTest.hide = () => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange')); // says so, once
      silent = true;
    };
  }
  if (hooks.mediaKeys) {
    const keys: Record<string, (() => void) | null> = {};
    (window as unknown as { mediaKeys: typeof keys }).mediaKeys = keys;
    MediaSession.prototype.setActionHandler = function (action: string, handler: (() => void) | null) {
      keys[action] = handler;
    } as MediaSession['setActionHandler'];
  }
  if (hooks.screens) {
    const { count } = hooks.screens;
    let permission = hooks.screens.permission;
    const laptop = { label: 'Laptop', left: 0, top: 0, availLeft: 0, availTop: 0, availWidth: 1920, availHeight: 1050 };
    const tv = {
      label: 'LG TV',
      left: 1920,
      top: 0,
      availLeft: 1920,
      availTop: 0,
      availWidth: 1920,
      availHeight: 1080,
    };
    const placed: { fullscreen: string[]; moves: number[][] } = { fullscreen: [], moves: [] };
    (window as unknown as { placed: typeof placed }).placed = placed;
    Object.defineProperty(Screen.prototype, 'isExtended', { get: () => count > 1 });
    (window as unknown as { getScreenDetails: () => Promise<unknown> }).getScreenDetails = async () => {
      if (permission === 'denied') throw new DOMException('Denied', 'NotAllowedError');
      permission = 'granted';
      return { screens: count > 1 ? [laptop, tv] : [laptop], currentScreen: laptop };
    };
    const query = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = ((d: PermissionDescriptor) =>
      d.name === ('window-management' as PermissionName)
        ? Promise.resolve({ state: permission } as PermissionStatus)
        : query(d)) as Permissions['query'];
    HTMLElement.prototype.requestFullscreen = function (options?: { screen?: { label: string } }) {
      placed.fullscreen.push(options?.screen?.label ?? 'this screen');
      return Promise.resolve();
    } as HTMLElement['requestFullscreen'];
    window.moveTo = (x: number, y: number) => void placed.moves.push([x, y]);
    window.resizeTo = () => {};
  }
  if (hooks.refusedSound) {
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      return this.muted ? play.call(this) : Promise.reject(new DOMException('No sound yet', 'NotAllowedError'));
    };
  }
}
