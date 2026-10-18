import { For } from 'solid-js';
import {
  COUNTRY_OPTIONS,
  AUTO_COUNTRY,
  detectCountry,
  getStoredRegion,
  regionLabel,
  setStoredRegion,
} from './region.ts';

// The ⚙ Preferences popover's panel; AppShell.tsx owns the button that opens it. Region's
// "Auto-detect" entry names what it currently resolves to, so picking it isn't a leap of faith.
export function PrefsPanel(props: { ref: HTMLDivElement | ((el: HTMLDivElement) => void) }) {
  const stored = getStoredRegion();
  return (
    <div id="nav-prefs-panel" class="site-nav-popover-panel site-nav-prefs-panel" popover ref={props.ref}>
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
// is part of the shell (AppShell.tsx) and its openness is the popover's own state, which no
// component holds.
export function openPrefsPopover(): void {
  const panel = document.getElementById('nav-prefs-panel');
  if (!panel) return;
  panel.showPopover();
  document.getElementById('nav-region-select')?.focus();
}
