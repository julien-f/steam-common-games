import type { JSX } from 'solid-js';
import { dismissPrefsWriteFailure } from './prefs.ts';

// Shown while setPref's writes fail (prefs.ts): the edit would otherwise look kept, then snap back.
export function StorageFullBanner(): JSX.Element {
  // Where focus was before it came into the banner, to hand it back on Dismiss.
  let returnTo: Element | null = null;
  return (
    <div
      class="storage-full-banner"
      role="alert"
      onFocusIn={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) returnTo = e.relatedTarget as Element | null;
      }}
    >
      This browser's storage is full: your last change wasn't saved on this device.
      <button
        type="button"
        class="btn"
        onClick={(e) => {
          const hadFocus = e.currentTarget === document.activeElement;
          dismissPrefsWriteFailure();
          if (!hadFocus) return;
          const target = returnTo instanceof HTMLElement && returnTo.isConnected ? returnTo : null;
          (target ?? document.querySelector<HTMLElement>('main.app-content'))?.focus();
        }}
      >
        Dismiss
      </button>
    </div>
  );
}
