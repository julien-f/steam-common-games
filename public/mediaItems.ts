import type { GameMeta } from './types.ts';

export interface MediaItem {
  type: 'image' | 'video';
  main?: string;
  hls?: string | null;
  thumb: string;
  shotId: string;
}
export function buildMediaItems(appid: number | string, details: Pick<GameMeta, 'banner' | 'movies' | 'screenshots'> | null | undefined): MediaItem[] {
  // `details.banner` (see extractAppDetails in lib/steam.js) is Steam's own header image
  // for this specific game, resolved once store metadata has loaded — before that (the
  // game is still `loading`, so `details` itself is absent), guess the conventional CDN
  // path as a placeholder; it's replaced by the real one as soon as metadata arrives, same
  // as every other placeholder in the panel. Guessing here unconditionally (regardless of
  // whether the real header image happens to exist at that path) used to mean a game
  // without one showed a permanently broken hero image no matter how many times the panel
  // was reopened, since the guessed URL never changes.
  const bannerUrl = details?.banner || `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/header.jpg`;
  const movies = details?.movies || [];
  const screenshots = details?.screenshots || [];
  return [
    { type: 'image', main: bannerUrl, thumb: bannerUrl, shotId: 'banner' },
    ...movies.map(m => ({ type: 'video' as const, hls: m.hls, thumb: m.thumbnail, shotId: `v${m.id}` })),
    ...screenshots.map(s => ({ type: 'image' as const, main: s.full, thumb: s.thumbnail, shotId: `s${s.id}` })),
  ];
}

export function resolveShotIndex(shots: MediaItem[], idxOrShotId: number | string): number {
  if (typeof idxOrShotId === 'string') {
    const idx = shots.findIndex(s => s.shotId === idxOrShotId);
    return idx >= 0 ? idx : 0;
  }
  return Math.max(0, Math.min(idxOrShotId, shots.length - 1));
}

// The shot to land on when the lightbox is re-pointed at *another* game (↑/↓, R) rather than
// opened on one the viewer picked out of the hero themselves. Never the banner when there's
// anything else: it's Steam's 460×215 header strip — the least rewarding thing to open
// fullscreen, and the one item with no separate thumbnail to stand in while it loads. A return
// of 0 therefore means "this game has nothing but its banner", which is also how a caller tells
// that the details simply haven't streamed in yet.
//
// Kind-preserving, so paging on from a trailer keeps landing on trailers — but in that direction
// only: the lightbox autoplays video, so promoting an image to one would start a trailer
// unasked on every step through a game that happens to have no screenshots.
export function preferredShotIndex(shots: MediaItem[], leaving: MediaItem['type']): number {
  const firstOfType = (type: MediaItem['type']) => shots.findIndex(s => s.type === type && s.shotId !== 'banner');
  const sameKind = leaving === 'video' ? firstOfType('video') : -1;
  if (sameKind >= 0) return sameKind;
  const screenshot = firstOfType('image');
  return screenshot >= 0 ? screenshot : 0;
}
