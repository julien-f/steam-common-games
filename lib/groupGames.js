'use strict';

function groupByOwnership(libraries) {
  const maps = libraries.map(lib => new Map(lib.map(g => [g.appid, g])));

  const ownership = new Map();
  for (let i = 0; i < maps.length; i++) {
    for (const [appid, game] of maps[i]) {
      const e = ownership.get(appid);
      if (e) e.owners.push(i);
      else ownership.set(appid, { appid, name: game.name, owners: [i] });
    }
  }

  const minOwners = Math.min(2, maps.length);
  const groupMap = new Map();
  for (const { appid, name, owners } of ownership.values()) {
    if (owners.length < minOwners) continue;
    const key = owners.join(',');
    if (!groupMap.has(key)) groupMap.set(key, { userIndices: owners, games: [] });
    groupMap.get(key).games.push({ appid, name });
  }

  return [...groupMap.values()]
    .sort((a, b) => b.userIndices.length - a.userIndices.length || a.userIndices[0] - b.userIndices[0])
    .map(({ userIndices, games }) => ({
      userIndices,
      games: games.sort((a, b) => a.name.localeCompare(b.name)),
    }));
}

module.exports = { groupByOwnership };
