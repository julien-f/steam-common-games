import type { Page } from '@playwright/test';

// What a test needs the presentation window to do or report. Injected into its HTML by a context
// route: init scripts miss a popup's first document about one run in four.
export interface PresentationHooks {
  // A window nobody has clicked yet (Playwright's popups sometimes report one already activated).
  neverActivated?: boolean;
  // A browser refusing a trailer's sound until a click in that window.
  refusedSound?: boolean;
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
  if (hooks.refusedSound) {
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      return this.muted ? play.call(this) : Promise.reject(new DOMException('No sound yet', 'NotAllowedError'));
    };
  }
}
