// The pure half of the panel's "Owned by" card — ordering and the playtime meter's width. Ported
// from the deleted ownerListHtml.ts (which built an HTML string; the card itself is JSX in
// panel.tsx now), keeping this part testable without a DOM.
import type { GameOwner } from './accountData.ts';

// Most recently played first. Someone who has never launched it (lastPlayedSec 0) sorts last,
// alphabetically among themselves, so the order is deterministic rather than depending on
// whatever order the slot's members happened to arrive in.
export function sortOwners(owners: GameOwner[]): GameOwner[] {
  return [...owners].sort((a, b) => b.lastPlayedSec - a.lastPlayedSec || a.name.localeCompare(b.name));
}

// Meter width as a percentage of the *most-played* owner of this game — a secondary cue for
// relative investment, never the only signal: the number itself stays the primary, always-visible
// value. Guarded against an all-zero list (nobody has played it), which would otherwise divide by
// zero and render NaN-width bars.
export function ownerMeterPct(minutes: number, maxMinutes: number): number {
  return Math.round(minutes / Math.max(maxMinutes, 1) * 100);
}
