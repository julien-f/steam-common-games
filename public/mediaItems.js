'use strict';

function buildMediaItems(appid, details) {
  const bannerUrl = `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/header.jpg`;
  const movies = details?.movies || [];
  const screenshots = details?.screenshots || [];
  return [
    { type: 'image', main: bannerUrl, thumb: bannerUrl, shotId: 'banner' },
    ...movies.map(m => ({ type: 'video', hls: m.hls, thumb: m.thumbnail, shotId: `v${m.id}` })),
    ...screenshots.map(s => ({ type: 'image', main: s.full, thumb: s.thumbnail, shotId: `s${s.id}` })),
  ];
}

function resolveShotIndex(shots, idxOrShotId) {
  if (typeof idxOrShotId === 'string') {
    const idx = shots.findIndex(s => s.shotId === idxOrShotId);
    return idx >= 0 ? idx : 0;
  }
  return Math.max(0, Math.min(idxOrShotId, shots.length - 1));
}

if (typeof module !== 'undefined') module.exports = { buildMediaItems, resolveShotIndex };
