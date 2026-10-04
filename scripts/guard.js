'use strict';

// The UX-workflow pilot's guard: judges a branch against its base, run from main's checkout so the
// branch can't change its own judge. Prints a Markdown report; exits 1 when a proof fails.
//   - ★ proofs: a test newly mapped to a ◇ step must fail on the base and pass on the head
//     (`--run` runs them, in throwaway worktrees; without it they're only listed);
//   - yardstick changes, which need a human's `viewed`: protected files, existing tests modified
//     or removed, package.json scripts, Done-when lines, a test newly mapped to a built step.
// Not yet: rerunning findings' proofs (no /ship briefs yet) and the bot-identity check (no bot).
//
// Usage: node scripts/guard.js --base=<ref> --head=<ref> [--run]

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { parseJourneys, parseTitle } = require('./journey-coverage');

const ROOT = path.join(__dirname, '..');
const JOURNEYS = 'docs/dev/journeys.md';
const PROTECTED = [
  /^CLAUDE\.md$/,
  /^\.(claude|githooks|github)\//,
  /^(eslint\.config\.\w+|tsconfig[^/]*\.json|playwright\.config\.ts|\.prettierrc\.json)$/,
  /^e2e\/(fixtures|mockApi|state)\.ts$/,
  /^scripts\/(guard|journey-coverage)\.js$/,
  /^docs\/decisions\//,
];
const TESTS = /^(e2e\/.+\.spec\.ts|test\/.+\.test\.[jt]s)$/;

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
const show = (ref, file) => {
  try {
    return git('show', `${ref}:${file}`);
  } catch {
    return null;
  }
};

// Titles declared with test('…') / test.skip('…'); skipped ones are reported apart.
function testTitles(source) {
  const run = new Set();
  const skipped = new Set();
  for (const m of source.matchAll(/^\s*test(\.skip)?\((['"`])((?:\\.|(?!\2).)*)\2/gm))
    (m[1] ? skipped : run).add(m[3].replace(/\\(.)/g, '$1'));
  return { run, skipped };
}

// Removed lines per file from a -U0 diff; additions alone never touch the yardstick.
function removedLines(diff) {
  const out = new Map();
  let file = null;
  for (const line of diff.split('\n')) {
    if (line.startsWith('--- ')) file = line.slice(4) === '/dev/null' ? null : line.slice(6);
    else if (file && line.startsWith('-')) out.set(file, [...(out.get(file) ?? []), line.slice(1)]);
  }
  return out;
}

// changed: files the branch touched; read(ref, file) → text or null.
function yardstick({ changed, removed, read, base, head }) {
  const flags = [];
  for (const file of changed) {
    if (PROTECTED.some((re) => re.test(file))) flags.push(`\`${file}\` is protected`);
    else if (TESTS.test(file) && removed.has(file)) flags.push(`\`${file}\`: existing test lines changed or removed`);
    else if (file === 'package.json') {
      const scripts = (ref) => JSON.stringify(JSON.parse(read(ref, file) ?? '{}').scripts ?? {});
      if (scripts(base) !== scripts(head)) flags.push('`package.json`: scripts changed');
    }
  }
  if ((removed.get(JOURNEYS) ?? []).some((l) => l.startsWith('- **Done when**')))
    flags.push(`\`${JOURNEYS}\`: a Done-when line changed`);
  return flags;
}

// Tests that exist on the base but don't run on the head.
function droppedTests(baseTests, headTests) {
  return [...baseTests.run].filter((t) => !headTests.run.has(t));
}

// [journeys, titles] per side → { proofs: [{ title, step }], remapped: [...] }: (journey, step) pairs a
// head title maps to that no base title did, split by whether the step was ◇ on the base.
function newMappings(base, head) {
  const pairs = ([journeys, titles]) => {
    const out = new Map();
    for (const title of titles) {
      const ref = parseTitle(title);
      const journey = ref && !ref.edge && journeys.get(ref.id);
      if (!journey) continue;
      const steps = ref.steps ?? [...journey.steps].filter(([, s]) => !s.target).map(([n]) => n);
      for (const n of steps) out.set(`${ref.id}.${n}`, [...(out.get(`${ref.id}.${n}`) ?? []), title]);
    }
    return out;
  };
  const before = pairs(base);
  const proofs = [];
  const remapped = [];
  for (const [step, titles] of pairs(head)) {
    const fresh = titles.filter((t) => !(before.get(step) ?? []).includes(t));
    if (!fresh.length) continue;
    const [id, n] = step.split('.');
    const wasTarget = base[0].get(id)?.steps.get(Number(n))?.target ?? true; // a new step is a target too
    for (const title of fresh) (wasTarget ? proofs : remapped).push({ title, step });
  }
  return { proofs, remapped };
}

// Runs `title` from the head's e2e/ against `ref`'s app, in a throwaway worktree; true if it passed.
function runTest(ref, head, title, port) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-'));
  try {
    git('worktree', 'add', '--quiet', '--detach', dir, ref);
    execFileSync('git', ['checkout', head, '--', 'e2e'], { cwd: dir });
    fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'));
    // --grep matches "<project> <file> <title>"
    const grep = `(^| )${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;
    execFileSync(
      process.execPath,
      [require.resolve('@playwright/test/cli'), 'test', '--grep', grep, '--reporter=dot'],
      {
        cwd: dir,
        env: { ...process.env, E2E_PORT: String(port) },
        stdio: 'ignore',
      },
    );
    return true;
  } catch {
    return false;
  } finally {
    git('worktree', 'remove', '--force', dir);
  }
}

function main() {
  const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
  const head = git('rev-parse', arg('head')).trim();
  const base = git('merge-base', arg('base'), head).trim();
  const changed = git('diff', '--name-only', base, head).split('\n').filter(Boolean);
  const removed = removedLines(git('diff', '-U0', base, head));

  const titles = (ref) => {
    const all = { run: new Set(), skipped: new Set() };
    for (const file of git('ls-tree', '-r', '--name-only', ref)
      .split('\n')
      .filter((f) => TESTS.test(f))) {
      const { run, skipped } = testTitles(show(ref, file));
      run.forEach((t) => all.run.add(t));
      skipped.forEach((t) => all.skipped.add(t));
    }
    return all;
  };
  const baseTests = titles(base);
  const headTests = titles(head);
  const journeys = (ref) => parseJourneys(show(ref, JOURNEYS) ?? '');
  const { proofs, remapped } = newMappings([journeys(base), baseTests.run], [journeys(head), headTests.run]);

  const flags = [
    ...yardstick({ changed, removed, read: show, base, head }),
    ...droppedTests(baseTests, headTests).map((t) => `test no longer runs: "${t}"`),
    ...remapped.map(({ title, step }) => `"${title}" newly locks built step ${step}`),
  ];
  const lines = [`## Guard: ${head.slice(0, 7)} against ${base.slice(0, 7)}`, ''];
  let failed = false;
  if (proofs.length) {
    lines.push('### ★ proofs (fail on base, pass on head)', '');
    for (const { title, step } of proofs) {
      if (!process.argv.includes('--run')) {
        lines.push(`- ${step} "${title}": not run (pass --run)`);
        continue;
      }
      const onBase = runTest(base, head, title, 28993);
      const onHead = runTest(head, head, title, 28994);
      const ok = !onBase && onHead;
      failed ||= !ok;
      lines.push(
        `- ${ok ? '✓' : '✗'} ${step} "${title}": base ${onBase ? 'passes' : 'fails'}, head ${onHead ? 'passes' : 'fails'}`,
      );
    }
    lines.push('');
  }
  lines.push('### Needs `viewed`', '', ...(flags.length ? flags.map((f) => `- ${f}`) : ['- nothing']));
  console.log(lines.join('\n'));
  if (failed) process.exit(1);
}

if (require.main === module) main();

module.exports = { testTitles, removedLines, yardstick, droppedTests, newMappings };
