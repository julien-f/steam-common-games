// The pure parts of the side panel's achievements fetch — kept out of panel.tsx so they can be
// unit-tested without a DOM or a panel (same reasoning as mediaItems.ts/panelNav.ts).
//
// Achievement *progress* is per Steam account, so everything here is a function of the account
// whose lists are currently being browsed: `getEffectiveCurrentAccount()`'s members (see
// accountsStore.ts — a `?u=` link being explored wins over the stored account, exactly as the
// panel's own ownership badges already behave). With no account at all, the achievement list is
// still worth fetching and showing — names, descriptions, icons, community rarity are store
// metadata, not anyone's progress — so an empty member list is a normal case here, not an error.

// Identifies which account a cached result belongs to, so a result fetched for one account is
// re-fetched rather than shown for another (switching accounts, or following a `?u=` link).
// Sorted, so member order can't produce two keys for the same slot. '' means "no account".
export function achievementsAccountKey(memberIds: string[]): string {
  return memberIds.slice().sort().join(',');
}

export function achievementsRequestUrl(appid: number, memberIds: string[], { force = false } = {}): string {
  const qs = new URLSearchParams();
  if (memberIds.length) qs.set('steamids', memberIds.join(','));
  if (force) qs.set('refresh', '1');
  const query = qs.toString();
  return `/api/achievements/${appid}${query ? `?${query}` : ''}`;
}

// Links out to one specific account's own Steam achievements page for this game. A slot can
// merge a whole Steam Family, and Steam has no "these accounts together" page, so this picks
// whichever member comes first — the same "first-seen wins" convention the owned-games union
// uses — rather than trying to represent every member at once. null with no account loaded:
// there's no progress being claimed, so there's nothing to link to.
export function achievementsSteamUrl(appid: number, memberIds: string[]): string | null {
  if (!memberIds.length) return null;
  return `https://steamcommunity.com/profiles/${memberIds[0]}/stats/${appid}/achievements/`;
}
