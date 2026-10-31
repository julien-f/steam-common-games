'use strict';

// Preloaded by `npm test`: hooks and `git rebase -x` export GIT_DIR/GIT_INDEX_FILE, which would point a
// test's git calls in its temp repo at the real one (core.bare=true, stray commits).
for (const key of Object.keys(process.env)) if (key.startsWith('GIT_')) delete process.env[key];
