'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { similarGames } = require('../public/similarity.ts');

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
