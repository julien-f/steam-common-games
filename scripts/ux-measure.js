'use strict';

// Writes .playwright-mcp/measure.js, a browser_run_code_unsafe script (pass it as `filename`)
// that opens each route at desktop and phone widths on `npm run dev:mock`, measures the layout
// a UI check usually needs and screenshots it — instead of hand-writing that snippet each time.
//   node scripts/ux-measure.js [--fresh] [--state=<mock states>] [--name=<prefix>] <route>...
//   --fresh    clear the mock's storage first, then set alice as the current account
//   --state    the `mock` cookie (e.g. upstream-down,untiered — see e2e/mockApi.ts); cleared otherwise
//   --name     screenshot prefix (default "measure"): .playwright-mcp/<name>-<route>-<width>.png
// Returns, per route and width: where the first table row starts, the heights of the blocks
// above it, horizontal page overflow, and console errors (favicon.ico aside).

const fs = require('node:fs');
const path = require('node:path');

const BASE = 'http://localhost:58993'; // mock only: the real server needs demo-prefs.js first
const SIZES = [
  [1440, 900],
  [390, 844],
];
const BLOCKS = ['.list-hero', '.list-view-actions', '.dt-toolbar', '.dt-active-bar', '.panel-header-sticky'];

function measureScript({ fresh, state, name, routes }) {
  return `async (page) => {
  const base = ${JSON.stringify(BASE)};
  const context = page.context();
  await context.clearCookies();
  ${state ? `await context.addCookies([{ name: 'mock', value: ${JSON.stringify(state)}, url: base }]);` : ''}
  if (${fresh}) {
    await page.goto(base + '/about');
    await page.evaluate(() => localStorage.clear());
    await page.goto(base + '/');
    await page.getByPlaceholder('Steam name, profile URL, or 64-bit ID…').fill('alice');
    await page.getByRole('button', { name: 'Set as current account' }).click();
    await page.waitForTimeout(500);
  }
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && !/favicon/.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  const out = {};
  for (const [w, h] of ${JSON.stringify(SIZES)}) {
    await page.setViewportSize({ width: w, height: h });
    for (const route of ${JSON.stringify(routes)}) {
      errors.length = 0;
      await page.goto(base + route);
      await page.locator('tbody tr, main h1').first().waitFor({ timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(800);
      const m = await page.evaluate((blocks) => {
        const top = (el) => (el ? Math.round(el.getBoundingClientRect().top + scrollY) : null);
        const heights = {};
        for (const s of blocks) {
          const el = document.querySelector(s);
          if (el && el.getBoundingClientRect().height) heights[s] = Math.round(el.getBoundingClientRect().height);
        }
        const row = document.querySelector('tbody tr');
        return { firstRowTop: top(row), viewport: innerHeight, heights, overflow: document.documentElement.scrollWidth > innerWidth };
      }, ${JSON.stringify(BLOCKS)});
      const slug = route.replace(/^\\//, '').replace(/[^\\w]+/g, '_').slice(0, 40) || 'home';
      await page.screenshot({ path: \`.playwright-mcp/${name}-\${slug}-\${w}.png\` });
      out[\`\${route} @\${w}\`] = { ...m, errors: [...errors] };
    }
  }
  ${state ? 'await context.clearCookies();' : ''}
  return out;
}`;
}

const args = process.argv.slice(2);
const opt = (key) => args.find((a) => a.startsWith(`--${key}=`))?.split('=')[1];
const routes = args.filter((a) => !a.startsWith('--'));
if (!routes.length || routes.some((r) => !r.startsWith('/'))) {
  console.error('Usage: node scripts/ux-measure.js [--fresh] [--state=<mock states>] [--name=<prefix>] /route...');
  process.exit(1);
}
const dir = path.join(__dirname, '..', '.playwright-mcp');
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, 'measure.js');
fs.writeFileSync(
  file,
  measureScript({ fresh: args.includes('--fresh'), state: opt('state'), name: opt('name') || 'measure', routes }),
);
console.log(path.relative(process.cwd(), file));
