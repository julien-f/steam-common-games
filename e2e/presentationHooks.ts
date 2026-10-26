import type { Page } from '@playwright/test';

// What a test needs the presentation window to do or report. Injected into its HTML by a context
// route: init scripts miss a popup's first document about one run in four.
export interface PresentationHooks {
  // A window nobody has clicked yet (Playwright's popups sometimes report one already activated).
  neverActivated?: boolean;
  // Trailers "play" without a stream (none in the fixtures, no H.264 decoder in Playwright's
  // Chromium): HLS taken as native, play()/pause() only flipping `paused` and firing their events.
  fakePlayback?: boolean;
  // A browser refusing a trailer's sound until a click in that window.
  refusedSound?: boolean;
  // `window.presTest.hide()`: the window occluded, so throttled that its heartbeats stop coming.
  occludable?: boolean;
  // `window.mediaKeys`: the Media Session handlers set, to press as the OS keys would.
  mediaKeys?: boolean;
}

export async function hookPresentation(page: Page, hooks: PresentationHooks): Promise<void> {
  await page.context().route('**/present.html*', async (route) => {
    const response = await route.fetch();
    const script = `<script>(${install.toString()})(${JSON.stringify(hooks)})</script>`;
    await route.fulfill({ response, body: (await response.text()).replace('<head>', `<head>${script}`) });
  });
}

// Runs in the presentation window, before its own scripts.
function install(hooks: PresentationHooks) {
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
  }
  if (hooks.occludable) {
    let silent = false;
    const post = BroadcastChannel.prototype.postMessage;
    BroadcastChannel.prototype.postMessage = function (this: BroadcastChannel, msg: { type?: string }) {
      if (!silent || msg?.type !== 'state') post.call(this, msg);
    };
    (window as unknown as { presTest: { hide(): void } }).presTest = {
      hide() {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        document.dispatchEvent(new Event('visibilitychange')); // says so, once
        silent = true;
      },
    };
  }
  if (hooks.mediaKeys) {
    const keys: Record<string, (() => void) | null> = {};
    (window as unknown as { mediaKeys: typeof keys }).mediaKeys = keys;
    MediaSession.prototype.setActionHandler = function (action: string, handler: (() => void) | null) {
      keys[action] = handler;
    } as MediaSession['setActionHandler'];
  }
  if (hooks.refusedSound) {
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      return this.muted ? play.call(this) : Promise.reject(new DOMException('No sound yet', 'NotAllowedError'));
    };
  }
}
