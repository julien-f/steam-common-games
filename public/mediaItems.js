'use strict';

export function buildMediaItems(appid, details) {
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
    ...movies.map(m => ({ type: 'video', hls: m.hls, thumb: m.thumbnail, shotId: `v${m.id}` })),
    ...screenshots.map(s => ({ type: 'image', main: s.full, thumb: s.thumbnail, shotId: `s${s.id}` })),
  ];
}

export function resolveShotIndex(shots, idxOrShotId) {
  if (typeof idxOrShotId === 'string') {
    const idx = shots.findIndex(s => s.shotId === idxOrShotId);
    return idx >= 0 ? idx : 0;
  }
  return Math.max(0, Math.min(idxOrShotId, shots.length - 1));
}
