'use strict';

// Generic, per-key user-preference store — the single localStorage-backed mechanism every
// global preference (region.js's own region choice, and any future one) and every persisted
// table view (library.js/bundles.js — see their own comments) reads and writes through, so
// there's one place a future Steam-auth-backed server sync attaches to rather than a rewrite at
// every call site. Loaded as a plain script (not a module), same esc()/reorderUrlParams
// convention as utils.js/urlState.js — modules reach getPref/setPref off the global scope.
//
// One JSON blob under one key (rather than one localStorage key per preference) so the whole
// set can be enumerated at once later (e.g. a settings page, or the initial payload a synced
// account pulls down) without needing to know every individual key up front. This is purely a
// local-storage convenience, though — it does NOT mean sync itself works on the whole blob (see
// setPref below).
const PREFS_STORAGE_KEY = 'steam-common-games:prefs';

function readPrefsBlob() {
  try {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch { return {}; } // unavailable storage, or a corrupted/foreign value
}

// Returns `fallback` when the key was never set, storage is unavailable (private browsing,
// cleared site data), or the stored blob itself is corrupted — never throws.
function getPref(key, fallback) {
  const blob = readPrefsBlob();
  return key in blob ? blob[key] : fallback;
}

function setPref(key, value) {
  try {
    const blob = readPrefsBlob();
    blob[key] = value;
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(blob));
  } catch { /* not persisted this session — private browsing, quota, storage unavailable */ }
  // Sync hook for once Steam auth exists: pushing `key`/`value` to the server happens here,
  // per-key — deliberately never a whole-blob PUT, so two preferences changing around the same
  // time (different tabs/devices) can't race each other's writes. No-op today.
}

if (typeof module !== 'undefined') module.exports = { PREFS_STORAGE_KEY, getPref, setPref };
