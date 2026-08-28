'use strict';

// Contents of the nav bar's ⚙ Preferences popover — public/nav.js owns the surrounding
// <details>/<summary> shell (part of the nav bar's own structure: rendering it, opening/closing
// it on outside click/Escape) and just asks this file for what goes inside the panel and how to
// wire it up, so nav.js itself stays about page navigation, not about which preferences exist.
// Only region lives here today; more are expected to land in this same panel later, each just
// adding to prefsPopoverPanelHtml/initPrefsPopover rather than nav.js needing to change at all.
// Loaded as a plain script (not a module), after region.js and before nav.js.

// The markup nav.js splices into its own <details> — a single `<select>` for the region
// preference (region.js), same shape the old per-page inline pickers used.
function prefsPopoverPanelHtml() {
  return `
    <div class="site-nav-prefs-panel">
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
function initPrefsPopover() {
  const select = document.getElementById('nav-region-select');
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

if (typeof module !== 'undefined') module.exports = { prefsPopoverPanelHtml, initPrefsPopover };
