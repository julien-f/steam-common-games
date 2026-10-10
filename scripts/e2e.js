'use strict';

// `npm run test:e2e`: builds the frontend once, then runs Playwright against it. A full passing run
// records a hash of everything the suite can see (the build minus its sourcemaps, e2e/, the Playwright config, the
// lockfile, Node's version); with --if-changed (the pre-commit hook), a run whose hash already
// passed is skipped, since it would test exactly what passed.
//   node scripts/e2e.js [--if-changed] [playwright args…]

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 28992;
const OUT_DIR = path.join(ROOT, 'node_modules/.cache/e2e-dist', String(PORT));
const PASS_FILE = path.join(ROOT, 'node_modules/.cache/e2e-pass');

// Args that run part of the suite: such a pass says nothing about the rest.
const NARROWING = /^(-g|--grep|--grep-invert|--project|--last-failed|--only-changed|--shard)(=|$)/;

function inputsHash() {
  const hash = crypto.createHash('sha256').update(process.version);
  const files = [
    ...[OUT_DIR, path.join(ROOT, 'e2e')].flatMap((dir) =>
      fs
        .readdirSync(dir, { recursive: true })
        .map((f) => path.join(dir, f))
        // Sourcemaps embed the sources, comments included; only stack traces read them.
        .filter((f) => fs.statSync(f).isFile() && !f.endsWith('.map'))
        .sort(),
    ),
    path.join(ROOT, 'playwright.config.ts'),
    path.join(ROOT, 'package-lock.json'),
  ];
  for (const f of files) hash.update(path.relative(ROOT, f)).update('\0').update(fs.readFileSync(f)).update('\0');
  return hash.digest('hex');
}

const readPass = () => {
  try {
    return fs.readFileSync(PASS_FILE, 'utf8').trim();
  } catch {
    return null;
  }
};

// Whether a run with these Playwright args covers the whole suite, so its pass can be recorded.
const isFullRun = (pwArgs) => !pwArgs.some((a) => NARROWING.test(a) || !a.startsWith('-'));

function main() {
  const args = process.argv.slice(2);
  const ifChanged = args.includes('--if-changed');
  const pwArgs = args.filter((a) => a !== '--if-changed');

  execFileSync('npx', ['vite', 'build', '--sourcemap', '--outDir', OUT_DIR, '--logLevel', 'error'], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  const hash = inputsHash();
  if (ifChanged && readPass() === hash) {
    console.log('e2e: same build and tests as the last passing run, skipped');
    process.exit(0);
  }

  const { status } = spawnSync('npx', ['playwright', 'test', ...pwArgs], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, E2E_BUILT: OUT_DIR },
  });
  if (status === 0 && isFullRun(pwArgs)) fs.writeFileSync(PASS_FILE, `${hash}\n`);
  process.exit(status ?? 1);
}

if (require.main === module) main();

module.exports = { isFullRun };
