'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  parseItems,
  planLanes,
  doneTimes,
  laneStatus,
  unionConflicts,
  closeItems,
  laneBacklogChanges,
  applyLaneChanges,
  mergeHint,
} = require('../scripts/batch');

const BACKLOG = [
  '- **C1 · major · S** — bug at `public/a.ts:3` and `server.js:9`. Fix.',
  '- **C2 · minor · M** — bug at `public/a.ts:40`. Fix.',
  '- **C3 · minor · L** — bug at `lib/b.js:1`. Fix.',
  '- **U4 · polish · F1** — the chip reads wrong. Fix.',
].join('\n');

test('parseItems: effort from a C-item, M for a U-item, the files each one names', () => {
  const items = parseItems(BACKLOG);
  assert.deepEqual(items.get('C1'), {
    id: 'C1',
    severity: 'major',
    effort: 'S',
    files: ['public/a.ts', 'server.js'],
    lines: { 'public/a.ts': [3], 'server.js': [9] },
  });
  assert.equal(items.get('U4').effort, 'M');
  assert.deepEqual(items.get('U4').files, []);
});

test('parseItems: a U-item with several scenarios or none', () => {
  const items = parseItems('- **U1 · minor · I1, R1** — `public/a.ts`.\n- **U2 · polish** — `public/b.ts`.\n');
  assert.deepEqual([...items.keys()], ['U1', 'U2']);
  assert.equal(items.get('U2').effort, 'M');
});

test('parseItems: a bare file name counts when it names exactly one tracked file', () => {
  const text = '- **C5 · minor · S** — in `panel.tsx:12` and `index.ts`, see `CopyButton.tsx`. Fix.';
  const items = parseItems(text, ['public/panel.tsx', 'public/index.ts', 'lib/index.ts']);
  assert.deepEqual(items.get('C5').files, ['public/panel.tsx']);
});

test('parseItems: the lines each file is cited at, null for a file only mentioned without one', () => {
  const text = '- **C6 · minor · S** — `public/a.ts:10` (`:200`), `b.ts:5,30`, `lib/c.js:7-9` and `public/d.ts`. Fix.';
  const items = parseItems(text, ['public/b.ts']);
  assert.deepEqual(items.get('C6').lines, {
    'public/a.ts': [10, 200],
    'public/b.ts': [5, 30],
    'lib/c.js': [7, 9],
    'public/d.ts': null,
  });
});

test('planLanes: items far apart in one file get separate lanes; a file cited without a line is shared whole', () => {
  const text = [
    '- **C1 · minor · S** — `public/big.ts:100`. Fix.',
    '- **C2 · minor · S** — `public/big.ts:150`. Fix.',
    '- **C3 · minor · S** — `public/big.ts:2000`. Fix.',
  ].join('\n');
  const ids = (plan) => plan.lanes.map((l) => l.items.map((it) => it.id).sort()).sort();
  assert.deepEqual(ids(planLanes([...parseItems(text).values()], 4)), [['C1', 'C2'], ['C3']]);
  const whole = text + '\n- **C4 · minor · S** — `public/big.ts`. Fix.';
  assert.deepEqual(ids(planLanes([...parseItems(whole).values()], 4)), [['C1', 'C2', 'C3', 'C4']]);
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

test('doneTimes: a later follow-up naming the item keeps the earliest commit', () => {
  const log = '\x1e300\nFollow-up\n\nAfter C1.\n\x1e100\nFix a\n\nCloses C1.\n';
  assert.deepEqual([...doneTimes(['C1'], 0, log)], [['C1', 100]]);
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
  assert.deepEqual(a, { name: 'A', done: 1, total: 2, minLeft: 4, idleMin: 0 });
  assert.deepEqual(b, { name: 'B', done: 0, total: 1, minLeft: 2, idleMin: 0 });
});

test('laneStatus: a finished lane idles until the last lane ends, not through merge/review', () => {
  const manifest = {
    start: 0,
    lanes: [
      { name: 'A', items: [{ id: 'C1', effort: 'S' }] },
      { name: 'B', items: [{ id: 'C2', effort: 'S' }] },
    ],
  };
  const [running] = laneStatus(manifest, new Map([['C1', 120]]), 720, { minPerUnit: 3 });
  assert.equal(running.idleMin, 10);
  const [a, b] = laneStatus(
    manifest,
    new Map([
      ['C1', 120],
      ['C2', 600],
    ]),
    4200,
    { minPerUnit: 3 },
  );
  assert.equal(a.idleMin, 8);
  assert.equal(b.idleMin, 0);
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

test('closeItems: a section left empty reads None open.', () => {
  const text = '## A\n\n- **C1 · minor · S** — x.\n\n## B\n\n- **C2 · minor · S** — y.\n';
  assert.equal(closeItems(text, ['C1']), '## A\n\nNone open.\n\n## B\n\n- **C2 · minor · S** — y.\n');
  assert.equal(closeItems(text, ['C2']), '## A\n\n- **C1 · minor · S** — x.\n\n## B\n\nNone open.\n');
});

test("closeItems: emptying one of a section's blank-separated blocks leaves a single blank line", () => {
  const text = '## A\n\n- **U1 · polish · F1** — x.\n\n- **U2 · polish** — y.\n';
  assert.equal(closeItems(text, ['U1']), '## A\n\n- **U2 · polish** — y.\n');
});

test('mergeHint: a merge changing app code without a CHANGELOG entry says to skip the check', () => {
  assert.match(mergeHint(['lib/metrics.js', 'test/metrics.test.js']), /SKIP_CHANGELOG=1/);
  assert.equal(mergeHint(['lib/metrics.js', 'CHANGELOG.md']), '');
  assert.equal(mergeHint(['docs/dev/data.md']), '');
});

test('laneBacklogChanges: a deleted line is closed, a rewritten one narrowed, the rest untouched', () => {
  const base = '## A\n\n- **U1 · minor · S** — a.\n- **U2 · minor · S** — b.\n- **U3 · minor · S** — c.\n';
  const branch = '## A\n\n- **U2 · polish · S** — b, what is left.\n- **U3 · minor · S** — c.\n';
  const changes = laneBacklogChanges(base, branch);
  assert.deepEqual(changes.closed, ['U1']);
  assert.deepEqual([...changes.narrowed], [['U2', '- **U2 · polish · S** — b, what is left.']]);
});

test("applyLaneChanges: replays a lane's closures and narrowings on main's backlog", () => {
  const main =
    '## A\n\n- **U1 · minor · S** — a.\n- **U2 · minor · S** — b.\n- **U9 · minor · S** — closed by another lane? no, still open.\n';
  const changes = { closed: ['U1'], narrowed: new Map([['U2', '- **U2 · polish · S** — b, what is left.']]) };
  assert.equal(
    applyLaneChanges(main, changes),
    '## A\n\n- **U2 · polish · S** — b, what is left.\n- **U9 · minor · S** — closed by another lane? no, still open.\n',
  );
});

// Runs the real script in a throwaway repo: `merge` must stage only what the lane changed.
test("merge: leaves another session's uncommitted backlog edit unstaged", (t) => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { execFileSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-merge-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  };
  for (const file of ['batch.js', 'changelog-check.js'])
    fs.cpSync(path.join(__dirname, '../scripts', file), path.join(dir, 'scripts', file));
  write(
    'docs/dev/code-backlog.md',
    '# Code\n\n## Simplify\n\n- **C1 · minor · S** — a. Fix.\n- **C2 · minor · S** — b. Fix.\n',
  );
  write('docs/dev/improvements.md', '# UX\n\n## Lists\n\n- **U1 · minor · L1** — c. Fix.\n');
  write('CHANGELOG.md', '# Changelog\n\n## [Unreleased]\n');
  git('init', '-q', '-b', 'main');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '.');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'base');
  git('checkout', '-qb', 'lane');
  write('docs/dev/code-backlog.md', '# Code\n\n## Simplify\n\n- **C2 · minor · S** — b. Fix.\n');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qam', 'Close C1');
  git('checkout', '-q', 'main');
  const otherEdit = '# UX\n\n## Lists\n\n- **U1 · minor · L1** — c. Fix.\n- **U2 · minor · L1** — new. Fix.\n';
  write('docs/dev/improvements.md', otherEdit);

  execFileSync('node', ['scripts/batch.js', 'merge', 'lane'], { cwd: dir, encoding: 'utf8' });

  assert.deepEqual(git('diff', '--cached', '--name-only').trim().split('\n'), ['docs/dev/code-backlog.md']);
  assert.equal(git('diff', '--name-only').trim(), 'docs/dev/improvements.md');
  assert.equal(fs.readFileSync(path.join(dir, 'docs/dev/improvements.md'), 'utf8'), otherEdit);
});
