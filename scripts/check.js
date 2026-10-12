'use strict';

// `npm run check`: every check in parallel, one line each, full output only for the ones that fail —
// so nobody has to filter the output to find what broke. With --staged=<base> (the pre-commit hook),
// checks the commit against <base> instead: typecheck, lint, the CSS check and the e2e suite run only
// when something they cover is staged. Each run's step times and failures go to scripts/dev-metrics.js.

const { execFileSync, spawn } = require('node:child_process');
const { record } = require('./dev-metrics');

const UI =
  /^(public|e2e)\/|^(playwright\.config\.ts|vite\.config\.js|tsconfig[^/]*\.json|eslint\.config\.[^/]*|package(-lock)?\.json)$/;

// Whether `files` include anything typecheck, lint, the CSS check or the e2e suite covers.
const touchesUi = (files) => files.some((f) => UI.test(f));

// `[name, npm script args]` for a full run (`staged` undefined) or a commit against `staged`.
// `deferE2e`: a fix-batch lane commits without e2e and runs it once before reporting (BATCH.md).
function steps(staged, files = [], { deferE2e = process.env.E2E_DEFER === '1' } = {}) {
  const ui = staged === undefined || touchesUi(files);
  return [
    ['format', ['format:check']],
    ['changelog', staged === undefined ? ['check:changelog'] : ['check:changelog', '--', `--staged=${staged}`]],
    ['test', ['test']],
    ...(ui
      ? [
          ['typecheck', ['typecheck']],
          ['lint', ['lint']],
          ['css', ['check:css']],
        ]
      : []),
    ['doc-refs', ['check:doc-refs']],
    ['doc-lint', ['check:doc-lint']],
    ['journeys', ['check:journeys']],
    ['setup', ['check:setup']],
    // Desktop only: the pre-push hook runs both widths before anything reaches CI.
    ...(ui && staged !== undefined && !deferE2e
      ? [['e2e', ['test:e2e', '--', '--if-changed', '--project=desktop']]]
      : []),
  ];
}

// Runs each `[name, command, args]` in parallel; resolves to `{ name, ok, ms, output }` in order.
function runAll(steps) {
  return Promise.all(
    steps.map(
      ([name, command, args]) =>
        new Promise((resolve) => {
          const start = Date.now();
          const child = spawn(command, args);
          let output = '';
          child.stdout.on('data', (d) => (output += d));
          child.stderr.on('data', (d) => (output += d));
          child.on('error', (err) => (output += err.message));
          child.on('close', (code) => resolve({ name, ok: code === 0, ms: Date.now() - start, output }));
        }),
    ),
  );
}

// A run's metrics row: a commit's (the pre-commit hook) or a full one's, each step's seconds and the failed ones.
function runRow(staged, results) {
  return {
    run: staged === undefined ? 'full' : 'commit',
    seconds: Object.fromEntries(results.map((r) => [r.name, Number((r.ms / 1000).toFixed(1))])),
    failed: results.filter((r) => !r.ok).map((r) => r.name),
  };
}

async function main() {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const staged = process.argv
    .slice(2)
    .find((a) => a.startsWith('--staged='))
    ?.split('=')[1];
  const files =
    staged === undefined
      ? []
      : execFileSync('git', ['diff', '--cached', '--name-only', staged], { encoding: 'utf8' }).split('\n');
  const results = await runAll(steps(staged, files).map(([name, args]) => [name, npm, ['run', '-s', ...args]]));
  record('checks', runRow(staged, results));
  for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.name} (${(r.ms / 1000).toFixed(1)} s)`);
  for (const r of results.filter((r) => !r.ok)) console.log(`\n── ${r.name} failed ──\n${r.output.trimEnd()}`);
  if (results.some((r) => !r.ok)) process.exit(1);
}

if (require.main === module) main();

module.exports = { runAll, runRow, steps, touchesUi };
