'use strict';

// `npm run dev:mock` in the background, for checking UI changes from an agent session.
//   node scripts/mock-server.js up     reuse the running server, or start one; returns once the
//                                      app's modules load (not just its HTML: right after startup
//                                      Vite can 403 a dependency while it optimizes — pitfalls.md)
//   node scripts/mock-server.js down   stop the server this script started
// Logs to .playwright-mcp/mock-server.log.

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PORT = 58993; // package.json's dev:mock
const BASE = `http://localhost:${PORT}`;
const DIR = path.join(__dirname, '..', '.playwright-mcp');
const PID_FILE = path.join(DIR, 'mock-server.pid');
const TIMEOUT_MS = 60_000;
const MAX_MODULES = 400;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function status(url) {
  try {
    const res = await fetch(url);
    return { ok: res.ok, text: res.ok ? await res.text() : '' };
  } catch {
    return { ok: false, text: '' };
  }
}

// Fetches the entry module and everything it imports, so every module the first page load
// needs has been served once.
async function warm(deadline) {
  const html = await status(BASE);
  const entry = /<script type="module" src="([^"]+)"/.exec(html.text)?.[1];
  if (!entry) return false;
  const seen = new Set([entry]);
  const queue = [entry];
  while (queue.length && seen.size <= MAX_MODULES) {
    const url = queue.shift();
    let res = await status(BASE + url);
    while (!res.ok) {
      if (Date.now() > deadline) throw new Error(`${url} still failing`);
      await sleep(500);
      res = await status(BASE + url);
    }
    for (const [, dep] of res.text.matchAll(/(?:from|import)\s*["'](\/[^"']+)["']/g)) {
      if (!seen.has(dep)) {
        seen.add(dep);
        queue.push(dep);
      }
    }
  }
  return true;
}

async function up() {
  const deadline = Date.now() + TIMEOUT_MS;
  if (!(await status(BASE)).ok) {
    fs.mkdirSync(DIR, { recursive: true });
    const log = fs.openSync(path.join(DIR, 'mock-server.log'), 'w');
    const child = spawn('npm', ['run', 'dev:mock'], {
      cwd: path.join(__dirname, '..'),
      detached: true,
      stdio: ['ignore', log, log],
    });
    fs.writeFileSync(PID_FILE, String(child.pid));
    child.unref();
    while (!(await status(BASE)).ok) {
      if (Date.now() > deadline) throw new Error(`no answer on ${BASE}; see .playwright-mcp/mock-server.log`);
      await sleep(300);
    }
  }
  if (!(await warm(deadline))) throw new Error(`no module entry found in ${BASE}`);
  console.log(`${BASE} up`);
}

function down() {
  if (!fs.existsSync(PID_FILE)) {
    console.log('not started by this script; stop it with: pkill -f "vite --port 5899[3]"');
    return;
  }
  const pid = Number(fs.readFileSync(PID_FILE, 'utf8'));
  try {
    process.kill(-pid); // the whole group: npm, then vite
  } catch (err) {
    if (err.code !== 'ESRCH') throw err;
  }
  fs.rmSync(PID_FILE);
  console.log('stopped');
}

const cmd = process.argv[2];
if (cmd === 'up')
  up().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
else if (cmd === 'down') down();
else {
  console.error('Usage: node scripts/mock-server.js up|down');
  process.exit(1);
}
