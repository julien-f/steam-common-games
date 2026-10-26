// The Steam games in PC Game Pass (GET /api/game-pass), the /lists/game-pass list's source.
import { fetchJson } from './utils.ts';

export const GAME_PASS_TITLE = 'PC Game Pass';
export const GAME_PASS_PATH = '/lists/game-pass';

// A catalog entry with no Steam listing: a Microsoft Store product id, titled when Microsoft's catalog answered.
export interface GamePassOffSteam {
  id: string;
  title: string | null;
}

export interface GamePassData {
  appids: number[];
  notOnSteam: GamePassOffSteam[];
  failed: number; // games whose Steam lookup errored: neither listed nor "not on Steam"
  fetchedAt: number | null;
}

export const xboxStoreUrl = (id: string): string => `https://www.xbox.com/games/store/_/${encodeURIComponent(id)}`;

export function fetchGamePass(country: string, { refresh = false }: { refresh?: boolean } = {}): Promise<GamePassData> {
  const qs = new URLSearchParams({ country, ...(refresh ? { refresh: '1' } : {}) });
  return fetchJson(`/api/game-pass?${qs}`, undefined, "Game Pass didn't answer");
}
