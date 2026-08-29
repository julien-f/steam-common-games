'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  PRICE_FIELDS, applyPriceInfo, nullMissingPriceFields, nullAllPriceFields, postPrices,
} = require('../public/priceLoading');
const { discountPct } = require('../public/utils');

test('applyPriceInfo: maps an ITAD price response onto a row', () => {
  const row = {};
  applyPriceInfo(row, {
    steamRegular: { amount: 1999, currency: 'USD' },
    bestDeal: { price: { amount: 999 }, shop: 'Fanatical', url: 'https://example.com' },
    lowAll: { amount: 799 },
    lowY1: { amount: 899 },
    lowM3: { amount: 999 },
  }, discountPct);
  assert.equal(row.steamRegular, 1999);
  assert.equal(row.bestDealPrice, 999);
  assert.equal(row.bestDealShop, 'Fanatical');
  assert.equal(row.bestDealUrl, 'https://example.com');
  assert.equal(row.bestDealCut, discountPct(999, 1999));
  assert.equal(row.lowAll, 799);
  assert.equal(row.lowY1, 899);
  assert.equal(row.lowM3, 999);
  assert.equal(row.priceCurrency, 'USD');
});

test('applyPriceInfo: missing info fields resolve to null, not undefined', () => {
  const row = {};
  applyPriceInfo(row, {}, discountPct);
  for (const f of PRICE_FIELDS) assert.equal(row[f], null, f);
  assert.equal(row.priceCurrency, null);
});

test('nullMissingPriceFields: only fills fields that are still undefined', () => {
  const row = { steamRegular: 1999, bestDealPrice: undefined };
  nullMissingPriceFields(row);
  assert.equal(row.steamRegular, 1999, 'already-set field left untouched');
  assert.equal(row.bestDealPrice, null);
  for (const f of PRICE_FIELDS) assert.notEqual(row[f], undefined, f);
});

test('nullAllPriceFields: unconditionally nulls every field', () => {
  const row = { steamRegular: 1999, priceCurrency: 'USD' };
  nullAllPriceFields(row);
  for (const f of PRICE_FIELDS) assert.equal(row[f], null, f);
  assert.equal(row.priceCurrency, null);
});

test('postPrices: sends gids or appids and returns .prices on success', async (t) => {
  const restore = globalThis.fetch;
  let seenBody;
  globalThis.fetch = async (url, opts) => {
    seenBody = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ prices: { 42: { steamRegular: { amount: 100 } } } }) };
  };
  t.after(() => { globalThis.fetch = restore; });

  const prices = await postPrices({ gids: ['g1'], country: 'US' });
  assert.deepEqual(seenBody, { gids: ['g1'] });
  assert.equal(prices[42].steamRegular.amount, 100);
});

test('postPrices: throws with the server error message on a non-2xx response', async (t) => {
  const restore = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, json: async () => ({ error: 'rate limited' }) });
  t.after(() => { globalThis.fetch = restore; });

  await assert.rejects(() => postPrices({ appids: [1], country: 'US' }), /rate limited/);
});
