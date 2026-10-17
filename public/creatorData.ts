// A developer's or publisher's games (GET /api/creator-games), the /lists/developer and
// /lists/publisher lists' source.
import { fetchJson } from './utils.ts';

export type CreatorRole = 'developer' | 'publisher';

export const creatorTitle = (role: CreatorRole, name: string): string =>
  role === 'developer' ? `Games by ${name}` : `Published by ${name}`;

export const creatorListPath = (role: CreatorRole, name: string): string =>
  `/lists/${role}?${new URLSearchParams({ name })}`;

// Steam's own search page, filtered the same way (or by a plain term).
export const steamSearchUrl = (query: Record<string, string>): string =>
  `https://store.steampowered.com/search/?${new URLSearchParams(query)}`;

export function fetchCreatorGames(
  role: CreatorRole,
  name: string,
  { refresh = false }: { refresh?: boolean } = {},
): Promise<{ appids: number[]; total: number; capped: boolean; fetchedAt: number | null }> {
  const qs = new URLSearchParams({ role, name, ...(refresh ? { refresh: '1' } : {}) });
  return fetchJson(`/api/creator-games?${qs}`, undefined, 'Store search failed');
}
