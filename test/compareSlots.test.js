'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  namesAccount, slotHasAccount, slotsHaveAccount, slotIdentifiers, slotsToIdentifiers,
  slotsFromIdentifiers, filterAccounts, entryIdentifiers, entryLabel,
} = require('../public/compareSlots.ts');

const account = (label, members, identifiers, extra = {}) => ({
  id: members.join('+'), label, starred: false, members, identifiers, ...extra,
});

const ALICE = account('Alice', ['76561198000000001'], ['alice']);
const BOB = account('Bob', ['76561198000000002'], ['bob']);
// No custom URL — its identifier falls back to the steam64 id, which is the case chips exist for.
const NAMELESS = account('Pixl Pixl', ['76561198000000009'], ['76561198000000009']);
const FAMILY = account('Bob + Carol', ['76561198000000002', '76561198000000003'], ['bob', 'carol']);

const KNOWN = [ALICE, BOB, NAMELESS, FAMILY];

const typed = value => ({ kind: 'typed', value });
const picked = a => ({ kind: 'account', account: a });

// ── entries ───────────────────────────────────────────────────────────────────

test('entryIdentifiers: an account contributes every member, a typed entry just itself', () => {
  assert.deepEqual(entryIdentifiers(picked(FAMILY)), ['bob', 'carol']);
  assert.deepEqual(entryIdentifiers(typed('dave')), ['dave']);
});

test('entryLabel: an account reads as its name, a typed entry as what was typed', () => {
  assert.equal(entryLabel(picked(NAMELESS)), 'Pixl Pixl');
  assert.equal(entryLabel(typed('dave')), 'dave');
});

// ── namesAccount / slotHasAccount ─────────────────────────────────────────────

test('namesAccount: matches by custom-URL name, by steam64 id, and via a pasted profile URL', () => {
  assert.equal(namesAccount(['alice'], ALICE), true);
  assert.equal(namesAccount(['76561198000000001'], ALICE), true);
  assert.equal(namesAccount(['https://steamcommunity.com/id/alice'], ALICE), true);
  assert.equal(namesAccount(['https://steamcommunity.com/profiles/76561198000000001'], ALICE), true);
});

test('namesAccount: ignores case and surrounding whitespace', () => {
  assert.equal(namesAccount(['  ALICE '], ALICE), true);
});

test('namesAccount: nothing typed names nobody', () => {
  assert.equal(namesAccount([''], ALICE), false);
  assert.equal(namesAccount([], ALICE), false);
});

test('namesAccount: a Family needs every member, not just one', () => {
  assert.equal(namesAccount(['bob', 'carol'], FAMILY), true);
  assert.equal(namesAccount(['bob'], FAMILY), false);
  assert.equal(namesAccount(['bob', '76561198000000003'], FAMILY), true);
});

test('slotHasAccount / slotsHaveAccount: look through the slot entries', () => {
  assert.equal(slotHasAccount([picked(ALICE)], ALICE), true);
  assert.equal(slotHasAccount([typed('alice')], ALICE), true);
  assert.equal(slotHasAccount([picked(BOB)], ALICE), false);
  assert.equal(slotsHaveAccount([[], [picked(ALICE)]], ALICE), true);
  assert.equal(slotsHaveAccount([[], [picked(BOB)]], ALICE), false);
});

// ── to identifiers ────────────────────────────────────────────────────────────

test('slotIdentifiers: flattens entries, dropping blanks', () => {
  assert.deepEqual(slotIdentifiers([picked(ALICE), typed(' dave '), typed('  ')]), ['alice', 'dave']);
});

test('slotsToIdentifiers: drops empty slots entirely', () => {
  assert.deepEqual(
    slotsToIdentifiers([[picked(ALICE)], [], [picked(FAMILY)]]),
    [['alice'], ['bob', 'carol']],
  );
});

// ── from identifiers — what "Edit players" reopens with ───────────────────────

test('slotsFromIdentifiers: a known account comes back as an account entry, not raw text', () => {
  const slots = slotsFromIdentifiers([['76561198000000009']], KNOWN);
  assert.deepEqual(slots, [[picked(NAMELESS)]]);
  assert.equal(entryLabel(slots[0][0]), 'Pixl Pixl', 'reads as a name, not a 17-digit id');
});

test('slotsFromIdentifiers: an unknown identifier stays typed', () => {
  assert.deepEqual(slotsFromIdentifiers([['stranger']], KNOWN), [[typed('stranger')]]);
});

test('slotsFromIdentifiers: a Family the app knows collapses to one entry', () => {
  assert.deepEqual(slotsFromIdentifiers([['bob', 'carol']], KNOWN), [[picked(FAMILY)]]);
});

test('slotsFromIdentifiers: a slot that only mentions part of a Family is not swallowed by it', () => {
  assert.deepEqual(slotsFromIdentifiers([['bob']], KNOWN), [[picked(BOB)]]);
});

test('slotsFromIdentifiers: an ad-hoc Family comes back as its own chips, not one', () => {
  assert.deepEqual(slotsFromIdentifiers([['alice', 'bob']], KNOWN), [[picked(ALICE), picked(BOB)]]);
});

test('slotsFromIdentifiers: a known Family plus an extra stays per-identifier', () => {
  // The Family accounts for only part of the slot, so collapsing it would hide the extra player.
  assert.deepEqual(
    slotsFromIdentifiers([['bob', 'carol', 'stranger']], KNOWN),
    [[picked(BOB), typed('carol'), typed('stranger')]],
  );
});

test('slotsFromIdentifiers: round-trips back to the identifiers it was built from', () => {
  const identifiers = [['alice'], ['bob', 'carol']];
  assert.deepEqual(slotsToIdentifiers(slotsFromIdentifiers(identifiers, KNOWN)), identifiers);
});

// ── the dropdown's list ───────────────────────────────────────────────────────

test('filterAccounts: everything known when nothing is typed', () => {
  assert.deepEqual(filterAccounts(KNOWN, [[]], '').map(a => a.label), ['Alice', 'Bob', 'Pixl Pixl', 'Bob + Carol']);
});

test('filterAccounts: matches on the label, case-insensitively', () => {
  assert.deepEqual(filterAccounts(KNOWN, [[]], 'pixl').map(a => a.label), ['Pixl Pixl']);
});

test('filterAccounts: matches on an identifier or a steam64 id too', () => {
  assert.deepEqual(filterAccounts(KNOWN, [[]], 'carol').map(a => a.label), ['Bob + Carol']);
  assert.deepEqual(filterAccounts(KNOWN, [[]], '76561198000000001').map(a => a.label), ['Alice']);
});

test('filterAccounts: hides accounts already placed anywhere in the form', () => {
  assert.deepEqual(
    filterAccounts(KNOWN, [[picked(ALICE)], []], '').map(a => a.label),
    ['Bob', 'Pixl Pixl', 'Bob + Carol'],
  );
});

test('filterAccounts: an account typed by hand also counts as placed', () => {
  assert.equal(filterAccounts(KNOWN, [[typed('alice')]], 'alice').length, 0);
});
