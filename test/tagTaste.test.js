'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  similarGames,
  similarInLibrary,
  topPlayedTags,
  playerFits,
  tasteOf,
  fitTo,
  isSoftware,
  commonGround,
  suggestionsFor,
} = require('../public/tagTaste.ts');

const game = (appid, tagWeights) => ({ appid, details: { tagWeights } });

test('similarGames: ranks by shared tags, ignoring those every game carries', () => {
  const target = game(1, { Roguelike: 1, Deckbuilder: 0.8, Singleplayer: 0.5 });
  const games = [
    target,
    game(2, { Roguelike: 1, Deckbuilder: 0.9, Singleplayer: 0.5 }),
    game(3, { Roguelike: 1, Shooter: 0.9, Singleplayer: 0.5 }),
    game(4, { Farming: 1, Singleplayer: 1 }),
    game(5, { Racing: 1, Singleplayer: 1 }),
  ];
  const ranked = similarGames(target, games, 10).map((s) => s.game.appid);
  assert.deepEqual(ranked, [2, 3]);
});

test('similarGames: keeps the top `limit`, scored 0–100', () => {
  const target = game(1, { A: 1, B: 1 });
  const games = [game(2, { A: 1, B: 1 }), game(3, { A: 1, C: 1 }), game(4, { D: 1 })];
  const top = similarGames(target, games, 1);
  assert.equal(top.length, 1);
  assert.equal(top[0].game.appid, 2);
  assert.equal(top[0].score, 100);
});

test("similarGames: nothing without the target's tag weights, and skips games without any", () => {
  assert.deepEqual(similarGames(game(1, null), [game(2, { A: 1 })], 5), []);
  const ranked = similarGames(game(1, { A: 1 }), [game(2, null), game(3, { A: 1 }), game(4, { B: 1 })], 5);
  assert.deepEqual(
    ranked.map((s) => s.game.appid),
    [3],
  );
});

const owned = (appid, playtime, tagWeights) => ({ appid, name: `Game ${appid}`, playtime, details: { tagWeights } });
const tagsOf = (top) => top.map((t) => t.tag);

test('topPlayedTags: the tags most played for, ignoring unplayed games and tags every game has', () => {
  const games = [
    owned(1, 500, { Roguelike: 1, Singleplayer: 0.5 }),
    owned(2, 100, { Roguelike: 1, Deckbuilder: 0.8, Singleplayer: 0.5 }),
    owned(3, 10, { Farming: 1, Singleplayer: 0.5 }),
    owned(4, 5, { Racing: 1, Singleplayer: 0.5 }),
    owned(5, 2, { Puzzle: 1, Singleplayer: 0.5 }),
    owned(6, 0, { Horror: 1, Singleplayer: 0.5 }),
  ];
  const top = tagsOf(topPlayedTags(games, 3).tags);
  assert.deepEqual(top.slice(0, 2), ['Roguelike', 'Deckbuilder']);
  assert.ok(!top.includes('Singleplayer'));
  assert.ok(!tagsOf(topPlayedTags(games, 10).tags).includes('Horror'));
});

test('topPlayedTags: weights relative to the top tag shown, even when a Production Tier scores higher', () => {
  const games = [
    owned(1, 100, { A: 1 }),
    owned(2, 50, { A: 1, B: 1 }),
    owned(3, 10, { C: 1 }),
    owned(4, 5, { D: 1 }),
    owned(5, 2, { E: 1 }),
  ].map((g) => ({ ...g, productionTier: 'Indie' }));
  const weights = topPlayedTags([...games, owned(6, 0, { F: 1 })], 5).tags.map((t) => t.weight);
  assert.equal(weights[0], 1);
  for (let i = 1; i < weights.length; i++) assert.ok(weights[i] > 0 && weights[i] <= weights[i - 1]);
});

test('topPlayedTags: the games behind a tag, by their share of it rather than by hours', () => {
  const games = [
    owned(1, 500, { Roguelike: 0.1, Shooter: 1 }),
    owned(2, 20, { Roguelike: 1 }),
    owned(3, 10, { Roguelike: 1 }),
    owned(4, 5, { Roguelike: 1 }),
    owned(5, 2, { Puzzle: 1 }),
    owned(6, 0, { Roguelike: 1 }),
  ];
  const roguelike = topPlayedTags(games, 5).tags.find((t) => t.tag === 'Roguelike');
  assert.deepEqual(roguelike.games, [
    { name: 'Game 2', hours: 20 },
    { name: 'Game 3', hours: 10 },
    { name: 'Game 4', hours: 5 },
  ]);
  const puzzle = topPlayedTags(games, 5).tags.find((t) => t.tag === 'Puzzle');
  assert.deepEqual(puzzle.games, [{ name: 'Game 5', hours: 2 }]);
});

test('topPlayedTags: no profile from fewer than 5 played games', () => {
  const games = [1, 2, 3, 4].map((id) => owned(id, 10, { A: 1 }));
  assert.deepEqual(topPlayedTags([...games, owned(5, 0, { B: 1 })], 5), { tags: [], played: 4 });
});

test("topPlayedTags: a comparison player's hours instead of the row's own playtime", () => {
  const games = [1, 2, 3, 4, 5].map((id) => owned(id, 0, { Roguelike: 1, [`T${id}`]: 0.5 }));
  assert.deepEqual(topPlayedTags(games, 3), { tags: [], played: 0 });
  const { tags, played } = topPlayedTags(games, 3, () => 10);
  assert.equal(played, 5);
  assert.equal(tags.length, 3);
});

const software = (g) => ({ ...g, genres: ['Casual', 'Utilities'] });

test('isSoftware: by Steam genre, since software comes back as type "game"', () => {
  assert.ok(isSoftware({ genres: ['Casual', 'Utilities'] }));
  assert.ok(isSoftware({ genres: ['RPG', 'Game Development'] }));
  assert.ok(!isSoftware({ genres: ['Action', 'Education'] }));
  assert.ok(!isSoftware({}));
});

test('topPlayedTags: software counts toward neither the tags nor the played count', () => {
  const games = [1, 2, 3, 4, 5].map((id) => owned(id, 10, { Roguelike: 1, [`T${id}`]: 0.5 }));
  const wallpaper = software(owned(6, 3000, { Wallpaper: 1 }));
  const { tags, played } = topPlayedTags([...games, wallpaper], 10);
  assert.equal(played, 5);
  assert.ok(!tagsOf(tags).includes('Wallpaper'));
  assert.deepEqual(topPlayedTags([...games.slice(1), wallpaper], 10), { tags: [], played: 4 });
});

test("playerFits: software doesn't make a profile", () => {
  const games = [1, 2, 3, 4].map((id) => game(id, { A: 1 })).concat(software(game(5, { B: 1 })));
  assert.equal(playerFits(games, [() => 10]), null);
});

test("tasteOf: software doesn't make a profile", () => {
  const games = [1, 2, 3, 4].map((id) => owned(id, 10, { A: 1 })).concat(software(owned(5, 10, { B: 1 })));
  assert.equal(tasteOf(games, 0).profile, null);
});

test("playerFits: each game's closeness to each player's profile, null for a player with too few played", () => {
  const games = [
    game(1, { Roguelike: 1 }),
    game(2, { Roguelike: 1, Deckbuilder: 1 }),
    game(3, { Farming: 1 }),
    game(4, { Farming: 1, Cozy: 1 }),
    game(5, { Racing: 1 }),
    game(6, { Puzzle: 1 }),
  ];
  const alice = { 1: 50, 2: 50, 5: 1, 6: 1, 3: 1 };
  const bob = { 3: 50 };
  const fits = playerFits(games, [(id) => alice[id], (id) => bob[id]]);
  assert.ok(fits.byGame.get(1)[0] > fits.byGame.get(3)[0]);
  assert.equal(fits.byGame.get(1)[1], null);
  assert.deepEqual(fits.profiled, [true, false]);
});

test('playerFits: nothing when no player has a profile', () => {
  assert.equal(playerFits([game(1, { A: 1 })], [() => 10]), null);
});

test('similarGames: a shared Production Tier breaks a tie between equally tagged games', () => {
  const target = { ...game(1, { Roguelike: 1 }), productionTier: 'Indie' };
  const games = [
    { ...game(2, { Roguelike: 1, Action: 1 }), productionTier: 'AAA' },
    { ...game(3, { Roguelike: 1, Action: 1 }), productionTier: 'Indie' },
    { ...game(4, { Farming: 1 }), productionTier: 'AAA' },
  ];
  assert.deepEqual(
    similarGames(target, games, 2).map((s) => s.game.appid),
    [3, 2],
  );
});

test("topPlayedTags: Production Tier shapes the profile but isn't a tag to show", () => {
  const games = [1, 2, 3, 4, 5].map((id) => ({ ...owned(id, 10, { [`T${id}`]: 1 }), productionTier: 'Indie' }));
  assert.ok(!tagsOf(topPlayedTags([...games, owned(6, 0, { X: 1 })], 10).tags).some((t) => t.startsWith('tier:')));
});

test("tasteOf/fitTo: a game outside the library scores by closeness to the account's play profile", () => {
  const library = [
    owned(1, 100, { Roguelike: 1, Deckbuilder: 0.8 }),
    owned(2, 50, { Roguelike: 1 }),
    owned(3, 5, { Farming: 1 }),
    owned(4, 5, { Racing: 1 }),
    owned(5, 5, { Puzzle: 1 }),
  ];
  const taste = tasteOf(library, 123);
  assert.equal(taste.at, 123);
  const deckbuilder = fitTo(taste, { details: { tagWeights: { Deckbuilder: 1, Roguelike: 0.7 } } });
  const shooter = fitTo(taste, { details: { tagWeights: { Shooter: 1 } } });
  assert.ok(deckbuilder > 50, `${deckbuilder}`);
  assert.equal(shooter, 0);
  assert.equal(fitTo(taste, { details: null }), null);
  const fewPlayed = tasteOf(library.slice(0, 4), 0);
  assert.equal(fewPlayed.profile, null);
  assert.equal(fitTo(fewPlayed, { details: { tagWeights: { Roguelike: 1 } } }), null);
  assert.equal(tasteOf([owned(1, 10, null)], 0), null);
});

test("similarInLibrary: the library's closest games to one outside it, leaving out the game itself", () => {
  const library = [
    { ...owned(1, 0, { Roguelike: 1, Deckbuilder: 0.9, Singleplayer: 0.5 }), name: 'Slay' },
    { ...owned(2, 0, { Roguelike: 1, Shooter: 0.9, Singleplayer: 0.5 }), name: 'Gungeon' },
    { ...owned(3, 0, { Farming: 1, Singleplayer: 1 }), name: 'Farm' },
    { ...owned(4, 0, { Racing: 1, Singleplayer: 1 }), name: 'Race' },
  ];
  const taste = tasteOf(library, 0);
  const similar = similarInLibrary(taste, game(9, { Roguelike: 1, Deckbuilder: 0.8, Singleplayer: 0.5 }), 5);
  assert.deepEqual(
    similar.map((s) => s.game.name),
    ['Slay', 'Gungeon'],
  );
  assert.ok(!similarInLibrary(taste, library[0], 5).some((s) => s.game.appid === 1));
  assert.deepEqual(similarInLibrary(taste, game(9, null), 5), []);
});

test("tasteOf: keeps only each game's top tags, so a large library stays small", () => {
  const tags = Object.fromEntries([...Array(20)].map((_, i) => [`T${i}`, 1 - i / 20]));
  const taste = tasteOf([{ ...owned(1, 0, tags), name: 'A', productionTier: 'Indie' }], 0);
  const kept = Object.keys(taste.games[0].tags);
  assert.equal(kept.length, 10);
  assert.ok(kept.includes('tier:Indie') && kept.includes('T0') && !kept.includes('T19'));
});

// A comparison: each player owns some games and has hours on some of them.
const player = (hoursByAppid, owned = Object.keys(hoursByAppid).map(Number)) => ({
  owns: (appid) => owned.includes(appid),
  hours: (appid) => hoursByAppid[appid] ?? 0,
});
const library = (from, to, tagWeights) =>
  Array.from({ length: to - from + 1 }, (_, i) => game(from + i, tagWeights(from + i)));
const tenHours = (from, to) => Object.fromEntries(Array.from({ length: to - from + 1 }, (_, i) => [from + i, 10]));

test('commonGround: players with the same taste share all their top tags, and the ones in common', () => {
  const games = [
    ...library(1, 12, (id) => ({ Roguelike: 1, Deckbuilder: 0.8, [`T${id % 3}`]: 0.5 })),
    ...library(13, 24, (id) => ({ Farming: 1, Cozy: 0.8, [`T${id % 3}`]: 0.5 })),
  ];
  const ground = commonGround(games, [player(tenHours(1, 12)), player(tenHours(1, 12))]);
  assert.deepEqual(ground.pairs, [{ a: 0, b: 1, shared: 5 }]);
  assert.deepEqual(ground.sharedTags.slice(0, 2).sort(), ['Deckbuilder', 'Roguelike']);
  assert.deepEqual(ground.ownTags, [[], []]);
});

test('commonGround: opposite tastes share few top tags, each with tags of their own', () => {
  const games = [
    ...library(1, 12, (id) => ({ Roguelike: 1, Deckbuilder: 0.8, [`T${id % 4}`]: 0.4 })),
    ...library(13, 24, (id) => ({ Farming: 1, Cozy: 0.8, [`T${id % 4}`]: 0.4 })),
  ];
  const ground = commonGround(games, [player(tenHours(1, 12)), player(tenHours(13, 24))]);
  assert.deepEqual(ground.pairs, [{ a: 0, b: 1, shared: 4 }]); // only the T0–T3 every game carries
  assert.deepEqual(ground.ownTags[0].slice(0, 2), ['Roguelike', 'Deckbuilder']);
  assert.deepEqual(ground.ownTags[1].slice(0, 2), ['Farming', 'Cozy']);
});

test('commonGround: no count, shared tags or own tags for a player without a profile', () => {
  const games = library(1, 12, (id) => ({ [`T${id % 3}`]: 1 }));
  const ground = commonGround(games, [player(tenHours(1, 4)), player(tenHours(1, 12))]);
  assert.deepEqual(ground.pairs, [{ a: 0, b: 1, shared: null }]);
  assert.deepEqual(ground.sharedTags, []);
  assert.deepEqual(ground.ownTags, [[], []]);
});

test('commonGround: favourites are games every player has at least their median and 5 h in', () => {
  const games = library(1, 12, (id) => ({ [`T${id % 3}`]: 1 }));
  const twoHours = Object.fromEntries([...Array(9).keys()].map((i) => [i + 4, 2]));
  const a = player({ ...twoHours, 1: 100, 2: 50, 3: 4 });
  const b = player({ ...twoHours, 1: 80, 2: 30, 3: 200 });
  assert.deepEqual(commonGround(games, [a, b]).favourites, [1, 2]);
  assert.deepEqual(commonGround(games, [a, player({})]).favourites, []);
});

test('commonGround: with three players, the closest pair and the odd one out, only when clear-cut', () => {
  const games = [
    ...library(1, 12, (id) => ({ Roguelike: 1, Deckbuilder: 0.8, [`T${id % 4}`]: 0.4 })),
    ...library(13, 24, (id) => ({ Farming: 1, Cozy: 0.8, [`T${id % 4}`]: 0.4 })),
  ];
  const rogue = () => player(tenHours(1, 12));
  const ground = commonGround(games, [rogue(), rogue(), player(tenHours(13, 24))]);
  assert.deepEqual(ground.closest, { a: 0, b: 1, shared: 6 });
  // In all three top 10s: only the T0–T3 every game carries, though In common shows 3.
  assert.equal(ground.sharedCount, 4);
  assert.equal(ground.sharedTags.length, 3);
  assert.equal(ground.oddOneOut, 2);
  const same = commonGround(games, [rogue(), rogue(), rogue()]);
  assert.equal(same.closest, null);
  assert.equal(same.oddOneOut, null);
});

test("commonGround: a tag shared by everyone isn't also one player's own", () => {
  const games = library(1, 24, (id) => ({ Shared: 1, [id <= 12 ? 'Mine' : 'Yours']: 0.8, [`T${id % 4}`]: 0.3 }));
  const ground = commonGround(games, [player({ ...tenHours(1, 12), 13: 1 }), player(tenHours(1, 24))]);
  for (const own of ground.ownTags) for (const tag of ground.sharedTags) assert.ok(!own.includes(tag));
});

test("suggestionsFor: what others played a lot that the player never has, closest to the player's taste first", () => {
  const games = [
    ...library(1, 12, (id) => ({ Roguelike: 1, Deckbuilder: 0.8, [`T${id % 4}`]: 0.4 })),
    ...library(13, 24, (id) => ({ Farming: 1, Cozy: 0.8, [`T${id % 4}`]: 0.4 })),
  ];
  const me = player(
    tenHours(1, 10),
    [...Array(12).keys()].map((i) => i + 1),
  ); // owns 11 and 12, never played
  const friend = player({ ...tenHours(13, 24), 11: 40, 12: 3, 13: 50 });
  const suggested = suggestionsFor(games, [me, friend], 0);
  // 11: a roguelike the friend played a lot, first. 12: too few hours. Farming games fit less.
  assert.deepEqual(suggested[0], { appid: 11, from: 1, hours: 40, owns: true });
  assert.ok(!suggested.some((s) => s.appid === 12));
  assert.ok(suggested.slice(1).every((s) => s.appid >= 13 && !s.owns));
  // Mine to them: at most 5, all from me, and never one they played.
  const theirs = suggestionsFor(games, [me, friend], 1);
  assert.ok(theirs.length <= 5 && theirs.every((s) => s.from === 0 && s.appid <= 10));
});

test("suggestionsFor: ranks among the player's unplayed games, not against those their profile is made of", () => {
  const games = library(1, 30, (id) => ({
    Shooter: id <= 20 ? 1 : 0.2,
    Puzzle: id <= 20 ? 0.2 : 1,
    [`T${id % 5}`]: 0.5,
  }));
  const me = player(tenHours(1, 20));
  const friend = player({ 21: 40, 22: 40, 23: 40, 24: 40, 25: 40, 26: 40 });
  assert.ok(suggestionsFor(games, [me, friend], 0).length > 0);
});

test('suggestionsFor: nothing for a player without a profile, and never software', () => {
  const games = library(1, 12, (id) => ({ Roguelike: 1, [`T${id % 4}`]: 0.4 }));
  assert.equal(suggestionsFor(games, [player(tenHours(1, 3)), player(tenHours(1, 12))], 0), null);
  const tool = { ...game(13, { Roguelike: 1, T1: 0.4 }), genres: ['Utilities'] };
  const suggested = suggestionsFor(
    [...games, tool],
    [player(tenHours(1, 10)), player({ ...tenHours(1, 12), 13: 900 })],
    0,
  );
  assert.ok(!suggested.some((s) => s.appid === 13));
});
