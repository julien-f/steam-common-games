// The side panel's DLC/base-game browsing trail — the "← Back to <game>" button's stack.
//
// Only the *rule* lives here, not the state: `panel.tsx` holds the trail in a signal and calls
// this to work out what the next one should be. Kept as its own plain-`.ts` sibling so it can be
// unit-tested without a DOM or a panel, the same convention `panelNav.ts`/`lightboxTime.ts`/
// `achievementsRequest.ts` already follow for panel-adjacent pure logic.
export interface PanelHistoryEntry {
  appid: number;
  name: string;
}

// Where the trail goes when the open game (`from`) follows a link to `toAppid` — a DLC entry, or
// a piece of DLC's own "DLC for <base game>" link.
//
// If the target is whatever's already on top of the stack, this is a there-and-back-again hop
// (base game → DLC → that same base game's "DLC for" link) reached via a forward link rather than
// the explicit ← Back button, so it *pops* instead of pushing: bouncing between a base game and
// its DLC entries shouldn't grow a stack of duplicate consecutive appids that then takes as many
// Back presses to unwind.
export function nextHopHistory(hist: readonly PanelHistoryEntry[], from: PanelHistoryEntry, toAppid: number): PanelHistoryEntry[] {
  if (hist.length && hist[hist.length - 1].appid === toAppid) return hist.slice(0, -1);
  return [...hist, { appid: from.appid, name: from.name }];
}
