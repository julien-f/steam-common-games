'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { convert, formatWithEstimate, RATES_PER_EUR, REGION_CURRENCY } = require('../public/currency.ts');
const { COUNTRY_OPTIONS } = require('../public/region.ts');

test('convert: same currency is exact, others go through the euro, unknown is null', () => {
  assert.equal(convert(10, 'USD', 'USD'), 10);
  assert.equal(convert(1.17, 'USD', 'EUR'), 1);
  assert.ok(Math.abs(convert(1, 'GBP', 'USD') - 1.17 / 0.87) < 1e-9);
  assert.equal(convert(1, 'XYZ', 'EUR'), null);
});

test('every region the app offers has a currency with a rate', () => {
  for (const { code } of COUNTRY_OPTIONS) {
    assert.ok(REGION_CURRENCY[code], code);
    assert.ok(RATES_PER_EUR[REGION_CURRENCY[code]], code);
  }
});

test('formatWithEstimate: the own price, plus an estimate only in another currency', () => {
  const plain = formatWithEstimate(10, 'EUR', 'EUR');
  assert.doesNotMatch(plain, /≈/);
  const hinted = formatWithEstimate(11.7, 'USD', 'EUR');
  assert.match(hinted, /≈/);
  assert.match(hinted, /10[.,]00/);
  assert.doesNotMatch(formatWithEstimate(5, 'XYZ', 'EUR'), /≈/, 'no rate, no guess');
});
