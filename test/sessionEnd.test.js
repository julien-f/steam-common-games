'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { leftovers } = require('../scripts/session-end');

const wt = (over) => ({ path: '/repo', branch: 'main', main: true, dirty: [], merged: false, servers: [], ...over });

test('leftovers: nothing when main is pushed, on main, clean, with no merged worktree or server', () => {
  assert.deepEqual(leftovers({ ahead: 0, behind: 0, worktrees: [wt()], mergedBranches: [] }), []);
});

test('leftovers: names each thing left, the main checkout apart from worktrees', () => {
  assert.deepEqual(
    leftovers({
      ahead: 2,
      behind: 1,
      worktrees: [
        wt({ branch: 'feat', dirty: ['a.js'], servers: ['mock-server'] }),
        wt({ path: '/repo/wt', branch: 'feat', main: false, merged: true }),
        wt({ path: '/repo/wt2', branch: 'wip', main: false, merged: false }),
      ],
      mergedBranches: ['old'],
    }),
    [
      'main: 2 commit(s) not pushed',
      'main: 1 commit(s) behind origin/main',
      'main checkout: on feat, not main',
      'main checkout: 1 uncommitted change(s): a.js',
      'main checkout: mock-server still running',
      'worktree /repo/wt: feat is merged into main, remove it',
      'branch old: merged into main, delete it',
    ],
  );
});
