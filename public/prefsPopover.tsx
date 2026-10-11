import { For } from 'solid-js';
import {
  COUNTRY_OPTIONS,
  AUTO_COUNTRY,
  detectCountry,
  getStoredRegion,
  regionLabel,
  setStoredRegion,
} from './region.ts';

// The ⚙ Preferences popover's panel; AppShell.tsx owns the surrounding <details> shell. Region's
// "Auto-detect" entry names what it currently resolves to, so picking it isn't a leap of faith.
export function PrefsPanel(props: { ref: HTMLDivElement | ((el: HTMLDivElement) => void) }) {
  const stored = getStoredRegion();
  return (
    <div class="site-nav-popover-panel site-nav-prefs-panel" ref={props.ref}>
      <label class="site-nav-prefs-row">
        Region
        <select id="nav-region-select" onChange={(e) => setStoredRegion(e.currentTarget.value)}>
          <option value={AUTO_COUNTRY} selected={stored === AUTO_COUNTRY}>
            Auto-detect ({regionLabel(detectCountry())})
          </option>
          <For each={COUNTRY_OPTIONS}>
            {({ code, label }) => (
              <option value={code} selected={stored === code}>
                {label}
              </option>
            )}
          </For>
        </select>
      </label>
    </div>
  );
}

// Opens the nav bar's ⚙ popover from elsewhere in the app, for a surface that can only *report* a
// preference and has always had to end its tooltip with "change it in ⚙ Preferences" (the hero
// cards' Prices tile). Reached through the DOM rather than a prop or context because the popover
// is part of the shell (AppShell.tsx) and its openness is the `<details>`'s own state, which no
// component holds.
export function openPrefsPopover(): void {
  const details = document.querySelector<HTMLDetailsElement>('.site-nav-prefs');
  if (!details) return;
  // Deferred past the click that asked for it: bindNavPopover's outside-click listener
  // (navPopover.ts) is bound to `document`, and so is Solid's own delegated onClick, so opening
  // synchronously just has that listener close the popover again in the same event — and being
  // on the same node, stopPropagation can't prevent it.
  setTimeout(() => {
    details.open = true;
    document.getElementById('nav-region-select')?.focus();
  });
}
