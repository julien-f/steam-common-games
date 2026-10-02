'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fanaticalBuyUrl, addFanaticalPicks, FANATICAL_BOOKMARKLET } = require('../public/fanaticalPicks.ts');

const AWIN =
  'https://www.awin1.com/cread.php?awinmid=118821&awinaffid=235265&ued=https%3A%2F%2Fwww.fanatical.com%2Fen%2Fpick-and-mix%2Fbyo';

// The few DOM calls addFanaticalPicks makes, over cards Fanatical renders as
// article.PickAndMixCard > img[alt] + button.select-btn (toggling .btn-selected).
// `lateBasket` games are in the basket but still render unselected, so a first click removes them.
function fakePage(names, { inBasket = [], lateBasket = [], soldOut = [], search, hash } = {}) {
  const cards = names.map((name) => {
    const classes = new Set(inBasket.includes(name) ? ['btn-selected'] : []);
    let hidden = lateBasket.includes(name);
    const btn = {
      clicks: 0,
      classList: { contains: (c) => classes.has(c) },
      click() {
        btn.clicks++;
        if (hidden) hidden = false;
        else if (classes.has('btn-selected')) classes.delete('btn-selected');
        else classes.add('btn-selected');
      },
    };
    return {
      btn,
      textContent: `${soldOut.includes(name) ? 'SOLD OUT\n' : ''}${name}\nAdd`,
      querySelector: (sel) => (sel === 'img' ? { getAttribute: () => name } : sel === 'button.select-btn' ? btn : null),
    };
  });
  return {
    cards,
    doc: {
      location: { search: search ?? '', hash: hash ?? '' },
      querySelector: () => cards[0] ?? null,
      querySelectorAll: () => cards,
    },
  };
}

async function run(page) {
  const reports = [];
  await addFanaticalPicks(
    page.doc,
    async () => {},
    (m) => reports.push(m),
  );
  return reports;
}

const scgOf = (url) => JSON.parse(new URL(url).searchParams.get('scg'));

test('fanaticalBuyUrl: adds the names inside the Awin destination, the rest of the link untouched', () => {
  const url = fanaticalBuyUrl(`${AWIN}&clickref=a%20b`, ['Rain World', 'A & B: "C"']);
  const outer = new URL(url);
  assert.ok(url.startsWith(AWIN.split('&ued=')[0]));
  assert.ok(url.endsWith('&clickref=a%20b'));
  assert.equal(outer.searchParams.get('awinaffid'), '235265');
  assert.deepEqual(scgOf(outer.searchParams.get('ued')), ['Rain World', 'A & B: "C"']);
  assert.ok(outer.searchParams.get('ued').startsWith('https://www.fanatical.com/en/pick-and-mix/byo?scg='));
});

test('fanaticalBuyUrl: a link without ued, or with a query already, gets the parameter itself', () => {
  assert.deepEqual(scgOf(fanaticalBuyUrl('https://www.fanatical.com/en/pick-and-mix/byo', ['X'])), ['X']);
  const withQuery = fanaticalBuyUrl('https://www.fanatical.com/en/pick-and-mix/byo?a=1#top', ['X']);
  assert.match(withQuery, /\?a=1&scg=.*#top$/);
});

test('addFanaticalPicks: adds each named game once, case-insensitively, and reports what it could not', async () => {
  const page = fakePage(['Rain World', 'RoboCop: Rogue City', 'Other'], {
    hash: `#scg=${encodeURIComponent(JSON.stringify(['rain world', 'RoboCop: Rogue City', 'Missing Game']))}`,
  });
  const [report] = await run(page);
  assert.deepEqual(
    page.cards.map((c) => c.btn.clicks),
    [1, 1, 0],
  );
  assert.match(report, /Added 2 games/);
  assert.match(report, /• Missing Game/);
});

test('addFanaticalPicks: reads the names from the query, where Awin delivers them', async () => {
  const page = fakePage(['Rain World'], { search: `?scg=${encodeURIComponent('["Rain World"]')}&awc=1_2` });
  const [report] = await run(page);
  assert.equal(page.cards[0].btn.clicks, 1);
  assert.match(report, /Added 1 game to/);
});

test('addFanaticalPicks: skips a sold-out game and says so', async () => {
  const names = ['Rain World', 'Caput Mortum'];
  const page = fakePage(names, {
    soldOut: ['Caput Mortum'],
    hash: `#scg=${encodeURIComponent(JSON.stringify(names))}`,
  });
  const [report] = await run(page);
  assert.deepEqual(
    page.cards.map((c) => c.btn.clicks),
    [1, 0],
  );
  assert.match(report, /Added 1 game to the bundle\.\nSold out on Fanatical:\n• Caput Mortum$/);
});

test('addFanaticalPicks: leaves a game already in the basket alone', async () => {
  const page = fakePage(['Rain World'], {
    inBasket: ['Rain World'],
    hash: `#scg=${encodeURIComponent('["Rain World"]')}`,
  });
  const [report] = await run(page);
  assert.equal(page.cards[0].btn.clicks, 0);
  assert.match(report, /Added 0 games.*\n1 already in it/);
});

test('addFanaticalPicks: re-adds a game a click removed because the basket loaded late', async () => {
  const page = fakePage(['Rain World'], {
    lateBasket: ['Rain World'],
    hash: `#scg=${encodeURIComponent('["Rain World"]')}`,
  });
  const [report] = await run(page);
  assert.equal(page.cards[0].btn.clicks, 2);
  assert.match(report, /Added 1 game to/);
});

test('addFanaticalPicks: says how to get a selection when the page has none', async () => {
  for (const hash of ['', '#scg=not-json']) {
    const [report] = await run(fakePage(['Rain World'], { hash }));
    assert.match(report, /No selection here/);
  }
});

test('FANATICAL_BOOKMARKLET: one self-contained, percent-encoded javascript: URL', () => {
  assert.ok(FANATICAL_BOOKMARKLET.startsWith('javascript:'));
  const code = decodeURIComponent(FANATICAL_BOOKMARKLET.slice('javascript:'.length));
  assert.doesNotThrow(() => new Function(code));
  assert.ok(!/[#\s]/.test(FANATICAL_BOOKMARKLET.slice('javascript:'.length)));
});
