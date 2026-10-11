'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { parseItems, planLanes, doneTimes, laneStatus, unionConflicts, closeItems } = require('../scripts/batch');

const BACKLOG = [
  '- **C1 · major · S** — bug at `public/a.ts:3` and `server.js:9`. Fix.',
  '- **C2 · minor · M** — bug at `public/a.ts:40`. Fix.',
  '- **C3 · minor · L** — bug at `lib/b.js:1`. Fix.',
  '- **U4 · polish · F1** — the chip reads wrong. Fix.',
].join('\n');

test('parseItems: effort from a C-item, M for a U-item, the files each one names', () => {
  const items = parseItems(BACKLOG);
  assert.deepEqual(items.get('C1'), { id: 'C1', severity: 'major', effort: 'S', files: ['public/a.ts', 'server.js'] });
  assert.equal(items.get('U4').effort, 'M');
  assert.deepEqual(items.get('U4').files, []);
});

test('parseItems: a bare file name counts when it names exactly one tracked file', () => {
  const text = '- **C5 · minor · S** — in `panel.tsx:12` and `index.ts`, see `CopyButton.tsx`. Fix.';
  const items = parseItems(text, ['public/panel.tsx', 'public/index.ts', 'lib/index.ts']);
  assert.deepEqual(items.get('C5').files, ['public/panel.tsx']);
});

test('planLanes: items sharing a file share a lane; an item naming none is left to place by hand', () => {
  const items = [...parseItems(BACKLOG).values()];
  const { lanes, unplaced } = planLanes(items, 4);
  assert.deepEqual(lanes.map((l) => l.items.map((it) => it.id).sort()).sort(), [['C1', 'C2'], ['C3']]);
  assert.deepEqual(
    unplaced.map((it) => it.id),
    ['U4'],
  );
  assert.equal(planLanes(items, 1).lanes.length, 1, 'packed into the lanes allowed');
});

test('doneTimes: the first commit since the start naming an item, whole word only', () => {
  const log = '\x1e100\nFix a\n\nCloses C1.\n\x1e50\nOld C2\n\x1e200\nFix b\n\nC10 and C1\n';
  const done = doneTimes(['C1', 'C2'], 60, log);
  assert.deepEqual([...done], [['C1', 100]]);
});

test("laneStatus: a lane's own pace once it has finished an item, the history's before", () => {
  const manifest = {
    start: 0,
    lanes: [
      {
        name: 'A',
        items: [
          { id: 'C1', effort: 'S' },
          { id: 'C2', effort: 'S' },
        ],
      },
      { name: 'B', items: [{ id: 'C3', effort: 'M' }] },
    ],
  };
  const [a, b] = laneStatus(manifest, new Map([['C1', 240]]), 240, { minPerUnit: 3 });
  assert.deepEqual(a, { name: 'A', done: 1, total: 2, minLeft: 4 });
  assert.deepEqual(b, { name: 'B', done: 0, total: 1, minLeft: 2 });
});

test('unionConflicts: keeps both sides, plain or diff3', () => {
  const plain = '## X\n<<<<<<< HEAD\n- a\n=======\n- b\n>>>>>>> lane\n- c\n';
  assert.equal(unionConflicts(plain), '## X\n- a\n- b\n- c\n');
  const diff3 = '<<<<<<< HEAD\n- a\n||||||| base\n=======\n- b\n>>>>>>> lane\n';
  assert.equal(unionConflicts(diff3), '- a\n- b\n');
});

test('closeItems: drops exactly the named items', () => {
  assert.equal(closeItems(BACKLOG, ['C1', 'U4']).split('\n').length, 2);
  assert.match(closeItems(BACKLOG, ['C1']), /C2/);
});
