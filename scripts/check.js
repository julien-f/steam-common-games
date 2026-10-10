'use strict';

// `npm run check`: every check in parallel, one line each, full output only for the ones that fail —
// so nobody has to filter the output to find what broke.

const { spawn } = require('node:child_process');

const STEPS = [
  ['format', 'format:check'],
  ['changelog', 'check:changelog'],
  ['test', 'test', { NODE_OPTIONS: '--test-reporter=dot' }],
  ['typecheck', 'typecheck'],
  ['lint', 'lint'],
  ['css', 'check:css'],
  ['doc-refs', 'check:doc-refs'],
  ['journeys', 'check:journeys'],
];

// Runs each `[name, command, args, env]` in parallel; resolves to `{ name, ok, ms, output }` in order.
function runAll(steps) {
  return Promise.all(
    steps.map(
      ([name, command, args, env]) =>
        new Promise((resolve) => {
          const start = Date.now();
          const child = spawn(command, args, { env: { ...process.env, ...env } });
          let output = '';
          child.stdout.on('data', (d) => (output += d));
          child.stderr.on('data', (d) => (output += d));
          child.on('error', (err) => (output += err.message));
          child.on('close', (code) => resolve({ name, ok: code === 0, ms: Date.now() - start, output }));
        }),
    ),
  );
}

async function main() {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const results = await runAll(STEPS.map(([name, script, env]) => [name, npm, ['run', '-s', script], env]));
  for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.name} (${(r.ms / 1000).toFixed(1)} s)`);
  for (const r of results.filter((r) => !r.ok)) console.log(`\n── ${r.name} failed ──\n${r.output.trimEnd()}`);
  if (results.some((r) => !r.ok)) process.exit(1);
}

if (require.main === module) main();

module.exports = { runAll };
