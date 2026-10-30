'use strict';

// Measures the e2e suite's flakiness: runs it N times (scripts/e2e.js, `--repeat-each`), optionally beside
// busy-looping threads, then prints each test's failure rate and the slowest tests, and logs the run.
// The added load comes on top of other sessions', so the load sampled during the run is logged too.
//   node scripts/e2e-flakes.js [--repeat=N] [--load=THREADS] [playwright args…, e.g. --workers=12 -g <title>]

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Worker } = require('node:worker_threads');
const { record } = require('./dev-metrics');

const ROOT = path.join(__dirname, '..');
const REPORT = path.join(ROOT, 'node_modules/.cache/e2e-flakes.json');

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

// Playwright's JSON report → one entry per (test, project), its repeats grouped; skipped runs left out.
function summarize(report) {
  const byTest = new Map();
  const walk = (suite) => {
    for (const child of suite.suites ?? []) walk(child);
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests) {
        if (t.status === 'skipped') continue;
        const key = `${t.projectName}\0${spec.file}:${spec.line}`;
        const entry = byTest.get(key) ?? {
          title: spec.title,
          at: `${spec.file}:${spec.line}`,
          project: t.projectName,
          runs: 0,
          failures: 0,
          durations: [],
          error: null,
        };
        const failed = t.status === 'unexpected';
        entry.runs++;
        entry.durations.push(t.results.reduce((sum, r) => sum + r.duration, 0));
        if (failed) {
          entry.failures++;
          const message = t.results.find((r) => r.error)?.error?.message ?? '';
          // eslint-disable-next-line no-control-regex -- strips the terminal colors Playwright puts in messages
          entry.error ??= message.replace(/\x1b\[[0-9;]*m/g, '').split('\n')[0];
        }
        byTest.set(key, entry);
      }
    }
  };
  for (const suite of report.suites) walk(suite);
  return [...byTest.values()].map(({ durations, ...entry }) => ({ ...entry, median: median(durations) }));
}

// A logged run → `2026-10-30: 5 repeats, +12 threads, load 18.2 (max 25.0) on 12 cores, 312 s: 2 flaky (…)`.
function describeRun(row) {
  const flaky = row.failed.map((f) => `${f.title} [${f.project}] ${f.failures}/${f.runs}`).join(', ');
  return `${row.at.slice(0, 10)}: ${row.repeat} repeats, +${row.load} threads, load ${row.loadavg.median} (max ${row.loadavg.max}) on ${row.cores} cores, ${row.seconds} s: ${row.failed.length} flaky${flaky ? ` (${flaky})` : ''}`;
}

async function main() {
  const args = process.argv.slice(2);
  const value = (name, fallback) => Number(args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback);
  const repeat = value('repeat', 5);
  const load = value('load', 0);
  const pwArgs = args.filter((a) => !/^--(repeat|load)=/.test(a));

  const threads = Array.from({ length: load }, () => new Worker('for (;;);', { eval: true }));
  const samples = [];
  const sample = () => samples.push(os.loadavg()[0]);
  const sampler = setInterval(sample, 5000);
  sample();
  const start = Date.now();
  fs.rmSync(REPORT, { force: true });
  const status = await new Promise((resolve) =>
    spawn(
      process.execPath,
      [path.join(__dirname, 'e2e.js'), `--repeat-each=${repeat}`, '--reporter=dot,json', ...pwArgs],
      { cwd: ROOT, stdio: 'inherit', env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: REPORT } },
    ).on('exit', resolve),
  );
  const seconds = Math.round((Date.now() - start) / 1000);
  clearInterval(sampler);
  await Promise.all(threads.map((t) => t.terminate()));
  if (!fs.existsSync(REPORT)) {
    console.error(`e2e-flakes: no report (exit ${status})`);
    process.exit(status || 1);
  }

  const tests = summarize(JSON.parse(fs.readFileSync(REPORT, 'utf8')));
  const failed = tests.filter((t) => t.failures).sort((a, b) => b.failures / b.runs - a.failures / a.runs);
  const row = {
    args: pwArgs,
    repeat,
    load,
    cores: os.availableParallelism(),
    seconds,
    loadavg: { median: Number(median(samples).toFixed(1)), max: Number(Math.max(...samples).toFixed(1)) },
    failed: failed.map(({ title, at, project, failures, runs }) => ({ title, at, project, failures, runs })),
  };
  record('flakes', row);

  console.log(`\n${describeRun({ at: new Date().toISOString(), ...row })}`);
  for (const t of failed)
    console.log(`  ${t.failures}/${t.runs}  ${t.project}  ${t.title} (${t.at})\n        ${t.error}`);
  console.log('Slowest (median of the repeats):');
  for (const t of [...tests].sort((a, b) => b.median - a.median).slice(0, 15)) {
    console.log(`  ${(t.median / 1000).toFixed(1)} s  ${t.project}  ${t.title} (${t.at})`);
  }
  const total = tests.reduce((sum, t) => sum + t.median, 0);
  console.log(`Sum of medians: ${(total / 1000).toFixed(0)} s over ${tests.length} tests`);
}

if (require.main === module) main();

module.exports = { summarize, describeRun };
