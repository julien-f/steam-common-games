'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { similarGames, topPlayedTags, playerFits, tasteOf, fitTo } = require('../public/similarity.ts');

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

const owned = (appid, playtime, tagWeights) => ({ appid, playtime, details: { tagWeights } });

test('topPlayedTags: the tags most played for, ignoring unplayed games and tags every game has', () => {
  const games = [
    owned(1, 500, { Roguelike: 1, Singleplayer: 0.5 }),
    owned(2, 100, { Roguelike: 1, Deckbuilder: 0.8, Singleplayer: 0.5 }),
    owned(3, 10, { Farming: 1, Singleplayer: 0.5 }),
    owned(4, 5, { Racing: 1, Singleplayer: 0.5 }),
    owned(5, 2, { Puzzle: 1, Singleplayer: 0.5 }),
    owned(6, 0, { Horror: 1, Singleplayer: 0.5 }),
  ];
  const top = topPlayedTags(games, 3);
  assert.deepEqual(top.slice(0, 2), ['Roguelike', 'Deckbuilder']);
  assert.ok(!top.includes('Singleplayer'));
  assert.ok(!topPlayedTags(games, 10).includes('Horror'));
});

test('topPlayedTags: no profile from fewer than 5 played games', () => {
  const games = [1, 2, 3, 4].map((id) => owned(id, 10, { A: 1 }));
  assert.deepEqual(topPlayedTags([...games, owned(5, 0, { B: 1 })], 5), []);
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
  assert.ok(!topPlayedTags([...games, owned(6, 0, { X: 1 })], 10).some((t) => t.startsWith('tier:')));
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
  assert.equal(tasteOf(library.slice(0, 4), 0), null);
});
