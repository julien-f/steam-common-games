import { COUNTRY_OPTIONS, AUTO_COUNTRY, detectCountry, getStoredRegion, setStoredRegion } from './region.ts';

// Contents of the nav bar's ⚙ Preferences popover — public/nav.js owns the surrounding
// <details>/<summary> shell (part of the nav bar's own structure: rendering it, opening/closing
// it on outside click/Escape) and just asks this file for what goes inside the panel and how to
// wire it up, so nav.js itself stays about page navigation, not about which preferences exist.
// Only region lives here today; more are expected to land in this same panel later, each just
// adding to prefsPopoverPanelHtml/initPrefsPopover rather than nav.js needing to change at all.
// An ES module, importing from region.js and imported in turn by nav.js.

// The markup nav.js splices into its own <details> — a single `<select>` for the region
// preference (region.js), same shape the old per-page inline pickers used.
export function prefsPopoverPanelHtml(): string {
  return `
    <div class="site-nav-popover-panel site-nav-prefs-panel">
      <label class="site-nav-prefs-row">Region
        <select id="nav-region-select"></select>
      </label>
    </div>
  `;
}

// Populates the region `<select>` (COUNTRY_OPTIONS plus a leading "Auto-detect" entry, labeled
// with whatever it currently resolves to, e.g. "Auto-detect (Europe / Germany (EUR))" — so
// picking it isn't a leap of faith) and restores whatever region was last stored. Wires it to
// the shared region preference (region.js) — the one place it's picked now. `setStoredRegion`
// broadcasts `REGION_CHANGED_EVENT` on every change regardless of which UI made it, so this
// doesn't need to know anything about Bundles/library.js reacting to it (see their own comments).
export function initPrefsPopover() {
  const select = document.getElementById('nav-region-select') as HTMLSelectElement;
  const detected = detectCountry();
  const detectedLabel = COUNTRY_OPTIONS.find(c => c.code === detected)?.label ?? detected;
  select.innerHTML = '';
  const autoOpt = document.createElement('option');
  autoOpt.value = AUTO_COUNTRY;
  autoOpt.textContent = `Auto-detect (${detectedLabel})`;
  select.appendChild(autoOpt);
  for (const { code, label } of COUNTRY_OPTIONS) {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = label;
    select.appendChild(opt);
  }
  select.value = getStoredRegion();
  select.addEventListener('change', () => setStoredRegion(select.value));
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
