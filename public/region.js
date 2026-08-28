'use strict';

// Shared by both bundles.js and library.js's Wishlist price columns — both need "what region's
// prices am I looking at" and there's no reason for the curated list, the detection heuristic,
// or the persisted preference to drift between the two. Loaded as a plain script (not a
// module) on both pages, same esc()/reorderUrlParams() convention as utils.js/urlState.js — a
// module reaches these off the global scope rather than importing them.

// Curated rather than the full ISO 3166-1 list — these are the regions with meaningfully
// distinct Steam pricing/currency; ITAD's `country` param accepts any 2-letter code, but a
// bare dropdown of ~250 countries is worse UX than a short, deliberate list for a feature
// that only exists to compare prices at a glance. The EU/Eurozone entry deliberately leads
// with "Europe" in its own label (rather than "Germany / EU") — `DE` is just the ISO code
// Steam/ITAD happen to key Eurozone pricing off, an implementation detail nobody picking a
// region cares about; the concept being selected is "Europe", not specifically Germany.
const COUNTRY_OPTIONS = [
  { code: 'US', label: 'United States (USD)' },
  { code: 'GB', label: 'United Kingdom (GBP)' },
  { code: 'DE', label: 'Europe / Germany (EUR)' },
  { code: 'CA', label: 'Canada (CAD)' },
  { code: 'AU', label: 'Australia (AUD)' },
  { code: 'JP', label: 'Japan (JPY)' },
  { code: 'BR', label: 'Brazil (BRL)' },
  { code: 'RU', label: 'Russia (RUB)' },
  { code: 'TR', label: 'Turkey (TRY)' },
  { code: 'UA', label: 'Ukraine (UAH)' },
  { code: 'AR', label: 'Argentina (ARS)' },
  { code: 'IN', label: 'India (INR)' },
  { code: 'CN', label: 'China (CNY)' },
  { code: 'KR', label: 'South Korea (KRW)' },
  { code: 'MX', label: 'Mexico (MXN)' },
];

// IANA timezone → curated COUNTRY_OPTIONS code, used by detectCountry below as a stronger
// location signal than `navigator.language` (see its own comment). Deliberately not
// exhaustive — same "curated, not the full list" reasoning as COUNTRY_OPTIONS itself — just
// enough well-known zones per country to cover the common case; a zone that isn't listed here
// simply falls through to the language-based guess rather than being misclassified. Zones that
// don't unambiguously identify one of these countries (e.g. many "America/*" zones are shared
// between the US and Canada) are deliberately left out rather than guessed. The DE bucket
// covers Eurozone countries generally since Steam prices the euro itself, not each Eurozone
// country individually — but only actual euro-using EU countries; EU members with their own
// currency (Sweden/Poland/Czechia/Hungary/Denmark, etc.) are left unmapped rather than
// incorrectly bucketed into EUR pricing.
const TIMEZONE_COUNTRY = {
  'Europe/London': 'GB',
  'Europe/Berlin': 'DE', 'Europe/Paris': 'DE', 'Europe/Madrid': 'DE', 'Europe/Rome': 'DE',
  'Europe/Amsterdam': 'DE', 'Europe/Brussels': 'DE', 'Europe/Vienna': 'DE', 'Europe/Dublin': 'DE',
  'Europe/Lisbon': 'DE', 'Europe/Helsinki': 'DE', 'Europe/Luxembourg': 'DE', 'Europe/Athens': 'DE',
  'America/Toronto': 'CA', 'America/Vancouver': 'CA', 'America/Edmonton': 'CA',
  'America/Winnipeg': 'CA', 'America/Halifax': 'CA', 'America/St_Johns': 'CA',
  'Australia/Sydney': 'AU', 'Australia/Melbourne': 'AU', 'Australia/Brisbane': 'AU',
  'Australia/Perth': 'AU', 'Australia/Adelaide': 'AU', 'Australia/Darwin': 'AU', 'Australia/Hobart': 'AU',
  'Asia/Tokyo': 'JP',
  'America/Sao_Paulo': 'BR', 'America/Manaus': 'BR', 'America/Bahia': 'BR', 'America/Fortaleza': 'BR',
  'Europe/Moscow': 'RU', 'Asia/Yekaterinburg': 'RU', 'Asia/Novosibirsk': 'RU',
  'Asia/Vladivostok': 'RU', 'Asia/Krasnoyarsk': 'RU', 'Asia/Irkutsk': 'RU',
  'Europe/Istanbul': 'TR',
  'Europe/Kyiv': 'UA', 'Europe/Kiev': 'UA', // Kiev is the older alias for the same zone
  'America/Argentina/Buenos_Aires': 'AR', 'America/Argentina/Cordoba': 'AR',
  'Asia/Kolkata': 'IN', 'Asia/Calcutta': 'IN', // Calcutta is the older alias for the same zone
  'Asia/Shanghai': 'CN', 'Asia/Urumqi': 'CN',
  'Asia/Seoul': 'KR',
  'America/Mexico_City': 'MX', 'America/Tijuana': 'MX', 'America/Cancun': 'MX',
};

// Best-effort location detection, falling back to US when nothing below matches or the browser
// doesn't support the APIs involved. Tries the OS timezone (via TIMEZONE_COUNTRY above) before
// `navigator.language`: language reflects a UI preference, not where the user actually is, and
// very commonly stays "en-US" (or another English variant) regardless of physical location —
// confirmed live on a machine with `LANG=en_US.UTF-8` but an OS timezone of "Europe/Paris",
// which `Intl.Locale('en-US').maximize().region` resolves straight to "US" while the timezone
// correctly implies a Eurozone country. The timezone isn't infallible either (a US expat who
// never changed their laptop's clock would still misdetect), but it's a meaningfully better
// default than a language tag that many browsers leave on its out-of-the-box value forever.
function detectCountry() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (TIMEZONE_COUNTRY[tz]) return TIMEZONE_COUNTRY[tz];
  } catch { /* Intl.DateTimeFormat unsupported */ }
  try {
    const region = new Intl.Locale(navigator.language).maximize().region;
    if (COUNTRY_OPTIONS.some(c => c.code === region)) return region;
  } catch { /* Intl.Locale unsupported or unparseable navigator.language */ }
  return 'US';
}

// Sentinel value for "always track auto-detection, don't pin a fixed region" — the region
// picker's own default entry (see initRegionSelect below) and the default when nothing has
// been explicitly chosen yet. Deliberately not one of the real 2-letter ISO codes above, so it
// can never collide with a genuine country selection.
const AUTO_COUNTRY = 'auto';

// One shared preference, not per-page — this is "what currency do I want to see prices in", a
// single user preference rather than page-specific browsing/display state (unlike e.g.
// bundles.js's own table view, which genuinely is specific to that page's table — see prefs.js).
// Picking a region on either page updates both. Stored via the shared prefs.js (getPref/setPref)
// under the 'region' key rather than its own standalone localStorage key, so it's covered by the
// same future per-key server sync every other preference will be. No migration from the old
// pre-prefs.js key (`steam-common-games:region`) — an existing user's region just resets to
// Auto-detect once, a one-time, low-stakes reset accepted in favor of not carrying that
// migration fallback forever.
const REGION_PREF_KEY = 'region';

// Whatever was last explicitly picked (a real code, or AUTO_COUNTRY), or AUTO_COUNTRY when
// nothing was ever picked, storage is unavailable (private browsing, cleared site data), or the
// stored value isn't recognized (an old/foreign value). Never throws.
function getStoredRegion() {
  const v = getPref(REGION_PREF_KEY);
  if (v === AUTO_COUNTRY || COUNTRY_OPTIONS.some(c => c.code === v)) return v;
  return AUTO_COUNTRY;
}
// Fired on `window` on every change, regardless of which UI triggered it — the nav bar's own
// ⚙ Preferences popover (public/nav.js) is the only place region is picked now (Bundles/the
// Wishlist tab dropped their own inline pickers once that existed), but this stays a plain
// broadcast rather than nav.js reaching into those pages directly, so any future picker (or a
// synced update from a future Steam-auth account) needs to know nothing about who's listening.
const REGION_CHANGED_EVENT = 'scg:region-changed';

function setStoredRegion(value) {
  setPref(REGION_PREF_KEY, value);
  try { window.dispatchEvent(new CustomEvent(REGION_CHANGED_EVENT, { detail: { region: value } })); } catch { /* no window (tests) */ }
}

// Resolves whatever the picker is currently set to (a real code, or AUTO_COUNTRY) to an actual
// 2-letter country code to send upstream — the one place `detectCountry()` gets consulted for
// a *live* value, so "Auto-detect" always tracks the current OS/browser signals rather than
// freezing whatever they happened to resolve to at picker-population time.
function resolveRegion(selected) {
  return selected === AUTO_COUNTRY ? detectCountry() : selected;
}

// Populates `selectEl` with COUNTRY_OPTIONS plus a leading "Auto-detect" entry — labeled with
// whatever it currently resolves to (e.g. "Auto-detect (Europe / Germany (EUR))") so picking it
// isn't a leap of faith, and restores whatever region was last stored (getStoredRegion above).
// Returns the resolved (never AUTO_COUNTRY) country code to use immediately, so a caller
// doesn't need its own separate resolveRegion() call right after.
function initRegionSelect(selectEl) {
  const detected = detectCountry();
  const detectedLabel = COUNTRY_OPTIONS.find(c => c.code === detected)?.label ?? detected;
  selectEl.innerHTML = '';
  const autoOpt = document.createElement('option');
  autoOpt.value = AUTO_COUNTRY;
  autoOpt.textContent = `Auto-detect (${detectedLabel})`;
  selectEl.appendChild(autoOpt);
  for (const { code, label } of COUNTRY_OPTIONS) {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = label;
    selectEl.appendChild(opt);
  }
  selectEl.value = getStoredRegion();
  return resolveRegion(selectEl.value);
}

if (typeof module !== 'undefined') {
  module.exports = {
    COUNTRY_OPTIONS, TIMEZONE_COUNTRY, detectCountry,
    AUTO_COUNTRY, REGION_PREF_KEY, REGION_CHANGED_EVENT, getStoredRegion, setStoredRegion, resolveRegion, initRegionSelect,
  };
}
