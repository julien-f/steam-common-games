// Shared "Owned by" panel-card markup — extracted from app.js's buildOwnersHtml and library.js's
// buildLibraryOwnersHtml, which were byte-identical from here down; only how each page resolves
// its own `owners` array differed (a comparison group's multiple slots vs. a Library Explorer
// search's one flat player list) and stays local to each page's own small resolver.
import { esc, fmtPlaytime, fmtLastPlayed } from './utils.js';

// `owners`: [{ name, minutes, lastPlayedSec }]. Returns '' for an empty list (a standalone
// lookup, or a game nobody in the current owners actually owns).
export function renderOwnersHtml(owners) {
  if (!owners.length) return '';
  // Most recently played first — someone who's never launched it (lastPlayedSec 0) sorts last,
  // alphabetically among themselves so the order stays deterministic rather than depending on
  // slot/list iteration order.
  owners = [...owners].sort((a, b) => b.lastPlayedSec - a.lastPlayedSec || a.name.localeCompare(b.name));
  const maxMinutes = Math.max(...owners.map(o => o.minutes), 1);
  return `<div class="panel-section panel-card">
    <div class="panel-section-title">Owned by <span class="panel-section-subtitle">most recently played first</span></div>
    <div class="panel-owners">${owners.map(o => {
      const lp = fmtLastPlayed(o.lastPlayedSec);
      const pt = fmtPlaytime(o.minutes);
      // Playtime also gets a meter (single hue, width proportional to the max among these
      // owners) — a secondary cue for relative investment, never the only signal: the number
      // itself stays the primary, always-visible value.
      return `<div class="panel-owner">
        <div class="panel-owner-top">
          <span class="panel-owner-name">${esc(o.name)}</span>
          <span class="panel-owner-lastplayed">${lp ? esc(lp) : 'never played'}</span>
        </div>
        <div class="panel-owner-meter-track"><div class="panel-owner-meter-fill" style="width:${Math.round(o.minutes / maxMinutes * 100)}%"></div></div>
        <span class="panel-owner-playtime">${pt ? `${esc(pt)} played` : 'not played'}</span>
      </div>`;
    }).join('')}</div>
  </div>`;
}
