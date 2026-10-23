// docs/dev/journeys.md's journeys, end to end against mocked data (mockApi.ts).
import { test, expect, type Locator, type Page } from '@playwright/test';
import { DEMO_OF, LIMITED, mockApi, respond } from './mockApi.ts';
import { asPlayer, shot } from './state.ts';
import { ALICE, BOB, BUNDLE, PICK_BUNDLE, SIGNED_IN, SYNCED_LIST, signedInPrefs } from './fixtures.ts';

let pageErrors: string[];
test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await mockApi(page);
});
test.afterEach(() => {
  expect(pageErrors, 'uncaught page errors').toEqual([]);
});

const rows = (page: Page) => page.locator('tbody tr:not(.dt-group-row)');
const row = (page: Page, name: string) => rows(page).filter({ hasText: name });
const groupRows = (page: Page) => page.locator('.dt-group-row');
// A Home tree row's ⋯, which holds its Move, Rename and Delete.
const rowMenu = (page: Page, name: string) => page.getByRole('button', { name: `More actions for ${name}` });

test('A1: first visit — resolve my account, then open my library', async ({ page }) => {
  await page.goto('/');
  await page.getByPlaceholder('Steam name, profile URL, or 64-bit ID…').fill('alice');
  await page.getByRole('button', { name: 'Look up', exact: true }).click();
  await expect(page.getByRole('main')).toContainText('Owned: 6');
  await expect(page.getByText('Friends (private)')).toBeVisible(); // the mock's friends lists are private

  await page.getByRole('main').getByRole('link', { name: 'Owned', exact: true }).click();
  await expect(rows(page)).toHaveCount(6);
  await expect(row(page, 'Hades')).toContainText('44.5');

  await page.reload();
  await expect(page.getByRole('banner')).toContainText('Alice');
  await expect(rows(page)).toHaveCount(6);
});

test('A1 edge: a first visit says what the app does, and the account field looks it up', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.home-intro')).toContainText('ratings, completion times and prices');
  await expect(page.getByRole('button', { name: 'Look up', exact: true })).toBeVisible();
});

test('A1 edge: Look up keeps focus while it resolves', async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/common-games', async (route) => {
    await held;
    await route.fallback();
  });
  await page.goto('/');
  await page.getByPlaceholder('Steam name, profile URL, or 64-bit ID…').fill('alice');
  await page.getByRole('button', { name: 'Look up', exact: true }).click();
  const busy = page.getByRole('button', { name: 'Looking up…' });
  await expect(busy).toHaveAttribute('aria-disabled', 'true');
  await expect(busy).toBeFocused();
  release();
  await expect(page.getByRole('main')).toContainText('Owned: 6');
});

test('A1 edge: an Explore card opens its list from anywhere on the card', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/');
  const card = page.locator('.explore-card').filter({ has: page.getByRole('link', { name: 'Wishlist', exact: true }) });
  // At the description, which the link's stretched ::after covers.
  const box = (await card.getByText("The current account's wishlist").boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page).toHaveURL(/\/lists\/wishlist$/);
});

test('A1 edge: native controls render dark, like the page around them', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator(':root')).toHaveCSS('color-scheme', 'dark');
});

const heroContrast = (label: Locator) =>
  label.evaluate((el) => {
    const rgb = (c: string) =>
      c
        .match(/\d+(\.\d+)?/g)!
        .slice(0, 3)
        .map(Number);
    const lum = (c: string) => {
      const [r, g, b] = rgb(c).map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    // The hero draws no ground of its own: the first opaque one behind the label.
    let ground: Element = el;
    while (ground.parentElement && Number(getComputedStyle(ground).backgroundColor.match(/[\d.]+/g)![3] ?? 1) < 1)
      ground = ground.parentElement;
    const fg = lum(getComputedStyle(el).color);
    const bg = lum(getComputedStyle(ground).backgroundColor);
    return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
  });

test("A1 edge: a list's stat labels meet AA contrast on the hero", async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  const label = page.locator('.list-stat-label').first();
  await expect(label).toBeVisible();
  expect(await heroContrast(label)).toBeGreaterThanOrEqual(4.5);
});

test("A1 edge: a pressed stat tile's label still meets AA contrast on the hero", async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/bundles');
  const toggle = page.locator('.list-stat-btn[aria-pressed="false"]').first();
  await toggle.click();
  const pressed = page.locator('.list-stat-btn[aria-pressed="true"]').first();
  await expect(pressed).toBeVisible();
  const label = page.locator('.list-stat', { has: pressed }).locator('.list-stat-label');
  // Still hovered after the click: pressed must not look like plain hover, or the click shows no change.
  const hoveredPressed = await label.evaluate((el) => getComputedStyle(el).color);
  await page.mouse.move(0, 0);
  await pressed.evaluate((el) => (el as HTMLElement).blur());
  expect(await heroContrast(label)).toBeGreaterThanOrEqual(4.5);
  const other = page.locator('.list-stat-btn[aria-pressed="false"]').first();
  await other.hover();
  const otherLabel = page.locator('.list-stat', { has: other }).locator('.list-stat-label');
  expect(await otherLabel.evaluate((el) => getComputedStyle(el).color)).not.toBe(hoveredPressed);
});

test("B1 edge: /bundles' filter tiles look like toggles, unlike the plain figures beside them", async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/bundles');
  const chrome = (loc: Locator) =>
    loc.evaluate((el) => {
      const s = getComputedStyle(el);
      return { border: s.borderTopWidth, borderColor: s.borderTopColor, background: s.backgroundColor };
    });
  const toggle = page.locator('.list-stat-btn[aria-pressed="false"]').first();
  await expect(toggle).toBeVisible();
  const plain = await chrome(page.locator('.list-stat', { hasText: 'Updated' }).locator('.list-stat-btn'));
  const off = await chrome(toggle);
  expect(plain.border).toBe('0px');
  expect(off.border).not.toBe('0px');
  await toggle.click();
  await page.mouse.move(0, 0);
  const pressed = page.locator('.list-stat-btn[aria-pressed="true"]').first();
  await expect(pressed).toHaveCSS('border-top-color', 'rgb(76, 194, 255)'); // --accent
  // A thicker edge, not only a colour: forced colors repaint colours and drop shadows.
  expect(Number.parseFloat((await chrome(pressed)).border)).toBeGreaterThan(Number.parseFloat(off.border));
  // Hover shows on a pressed chip too.
  const pressedRest = (await chrome(pressed)).background;
  await pressed.hover();
  await expect.poll(async () => (await chrome(pressed)).background).not.toBe(pressedRest);
});

test('A1 edge: Owned with no account points to Home rather than showing 0 games', async ({ page }) => {
  await page.goto('/lists/owned');
  await expect(page.getByText('No account selected')).toBeVisible();
  await expect(page.locator('.list-hero')).not.toContainText('Games');
  await page.getByRole('link', { name: 'pick one on Home' }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("A1 edge: a wishlist that didn't load says so on Home, rather than 0", async ({ page }) => {
  await page.route('**/api/wishlist', (route) =>
    route.fulfill({ status: 502, json: { error: 'Steam request failed' } }),
  );
  await asPlayer(page, ALICE);
  await page.goto('/');
  await expect(page.locator('.account-counts')).toContainText("Owned: 6 · Wishlisted: couldn't load");
});

test('A2.1-2,4: explore a friend, then switch back to my ★ account from the nav chip', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/');
  await page.getByPlaceholder('Steam name, profile URL, or 64-bit ID…').fill('bob');
  await page.getByRole('button', { name: 'Look up', exact: true }).click();
  await expect(page.getByRole('banner')).toContainText('Bob');

  await page.getByRole('banner').getByText('Bob', { exact: true }).click();
  const back = page.getByRole('button', { name: /Alice/ }).filter({ has: page.getByTitle(/Your account/) });
  await expect(back).toBeVisible();
  await back.click();
  await expect(page.getByRole('banner')).toContainText('Alice');
});

test('A2 edge: the nav chip reads as an account, not as a second selected route', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  const chip = page.locator('.account-chip-btn');
  await expect(chip.locator('.account-chip-initial')).toHaveText('A'); // no avatar in the fixtures
  await chip.hover();
  await expect(chip).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  const route = page.locator('.site-nav-link.active');
  await expect(route).toHaveText('Owned');
  expect(await chip.evaluate((el) => getComputedStyle(el).borderColor)).not.toBe('rgba(0, 0, 0, 0)');
});

test("A2 edge: the account card's star names, and says on hover, what clicking it does", async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Unstar Alice' })).toHaveAttribute('title', 'Unstar Alice');
  await page.getByPlaceholder('Steam name, profile URL, or 64-bit ID…').fill('bob');
  await page.getByRole('button', { name: 'Look up', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Star Bob as mine' })).toHaveAttribute('title', 'Star Bob as mine');
});

test('A2 edge: accounts list mine first, then by name; starring moves one first', async ({ page }) => {
  await asPlayer(page, BOB, { otherAccounts: ['dave', 'Carol'] });
  await page.goto('/');
  const tiles = page.locator('.account-tiles .account-tile');
  await expect(tiles).toHaveText([/Bob.*\(yours\)/, /Carol/, /dave/]);
  await expect(tiles.first()).toHaveAttribute('aria-current', 'true');

  await tiles.filter({ hasText: 'dave' }).click();
  await page.getByRole('button', { name: 'Star dave as mine' }).click();
  await expect(tiles).toHaveText([/dave.*\(yours\)/, /Bob/, /Carol/]);
  await expect(tiles.first()).toHaveAttribute('aria-current', 'true');
});

test('A2 edge: many accounts can be filtered by name, and Esc clears the filter', async ({ page }) => {
  const others = ['Bea', 'Cid', 'Dee', 'Eve', 'Fay', 'Gus', 'Hal', 'Ida'];
  await asPlayer(page, ALICE, { otherAccounts: others });
  await page.goto('/');
  const tiles = page.locator('.account-tiles li');
  await expect(tiles).toHaveCount(9);
  const filter = page.getByRole('searchbox', { name: 'Filter accounts' });
  await filter.fill('e');
  await expect(tiles).toHaveText([/Alice/, /Bea/, /Dee/, /Eve/]);
  await filter.fill('zz');
  await expect(page.locator('.home-recents')).toContainText('No account matches “zz”.');
  await page.getByRole('button', { name: 'Clear filter' }).click();
  await expect(tiles).toHaveCount(9);
  await expect(filter).toBeFocused();
  await filter.fill('e');
  await page.keyboard.press('Escape');
  await expect(tiles).toHaveCount(9);
});

test('A2 edge: Edit shows every Remove and Clear all; Esc and Done leave it', async ({ page }) => {
  await asPlayer(page, ALICE, { otherAccounts: ['Bea'] });
  await page.goto('/');
  const remove = page.getByRole('button', { name: 'Remove Bea' });
  await expect(remove).toHaveCSS('opacity', '0');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(remove).toHaveCSS('opacity', '1');
  await expect(page.getByRole('button', { name: 'Clear all' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Clear all' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Clear all' }).click();
  await expect(page.locator('.home-recents')).toContainText('No accounts yet');
  await expect(page.getByRole('button', { name: /^(Edit|Done)$/ })).toHaveCount(0);
});

test('A2 edge: removing a recent account moves focus to the next one, the last to the lookup field', async ({
  page,
}) => {
  await asPlayer(page, ALICE);
  await page.goto('/');
  await page.getByPlaceholder('Steam name, profile URL, or 64-bit ID…').fill('bob');
  await page.getByRole('button', { name: 'Look up', exact: true }).click();
  await expect(page.locator('.account-tiles li')).toHaveCount(2);
  // Hidden until hovered or focused: keyboard focus reveals it.
  await page.getByRole('button', { name: 'Remove Alice' }).focus();
  await expect(page.getByRole('button', { name: 'Remove Alice' })).toHaveCSS('opacity', '1');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Remove Bob' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.account-tiles li')).toHaveCount(0);
  await expect(page.getByPlaceholder('Steam name, profile URL, or 64-bit ID…')).toBeFocused();
});

test('A2 edge: switching account from the nav chip leaves focus on the chip', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/');
  await page.getByPlaceholder('Steam name, profile URL, or 64-bit ID…').fill('bob');
  await page.getByRole('button', { name: 'Look up', exact: true }).click();
  await expect(page.getByRole('banner')).toContainText('Bob');

  await page.locator('.account-chip-btn').click();
  await page
    .getByRole('button', { name: /Alice/ })
    .filter({ has: page.getByTitle(/Your account/) })
    .click();
  await expect(page.getByRole('banner')).toContainText('Alice');
  await expect(page.locator('.account-chip-btn')).toBeFocused();
});

test("A2 edge: the nav chip marks my account with Home's filled star", async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/');
  const homeFill = await page
    .getByRole('button', { name: 'Unstar Alice' })
    .locator('svg')
    .evaluate((el) => getComputedStyle(el).fill);
  await page.getByPlaceholder('Steam name, profile URL, or 64-bit ID…').fill('bob');
  await page.getByRole('button', { name: 'Look up', exact: true }).click();
  await expect(page.getByRole('banner')).toContainText('Bob');
  await page.locator('.account-chip-btn').click();
  const mine = page.getByTitle('Your account', { exact: true });
  await expect(mine).toBeVisible();
  expect(await mine.locator('svg').evaluate((el) => getComputedStyle(el).fill)).toBe(homeFill);
  expect(homeFill).not.toBe('none');
});

test('A3 edge: Add Steam Family account focuses the field it adds', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add Steam Family account' }).click();
  const fields = page.getByPlaceholder('Steam name, profile URL, or 64-bit ID…');
  await expect(fields).toHaveCount(2);
  await expect(fields.nth(1)).toBeFocused();
});

test('A2 edge: an account picked mid-refresh does not read "Refreshing…" while it loads', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/');
  await expect(page.locator('.account-counts')).toContainText('Owned: 6');
  // Holds Alice's refresh and Bob's load (not the resolve, sent by name), so both are in flight.
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/common-games', async (route) => {
    const body = route.request().postData() ?? '';
    if (body.includes(ALICE.steamid) || body.includes(BOB.steamid)) await held;
    await route.fallback();
  });
  const updated = page.locator('.account-updated-btn');
  await updated.click();
  await expect(updated).toContainText('Refreshing');

  await page.getByPlaceholder('Steam name, profile URL, or 64-bit ID…').fill('bob');
  await page.getByRole('button', { name: 'Look up', exact: true }).click();
  await expect(page.getByRole('banner')).toContainText('Bob');
  await expect(updated).not.toContainText('Refreshing');
  release();
  await expect(page.locator('.account-counts')).toContainText('Owned: 4');
});

test("A2 edge: a picked account whose library fails doesn't show the previous one's age", async ({ page }) => {
  await mockApi(page, { states: ['stale'] });
  await asPlayer(page, ALICE);
  await page.goto('/');
  const updated = page.locator('.account-updated-btn');
  await expect(updated).toContainText('12 days ago');
  await page.route('**/api/common-games', (route) =>
    route.request().postData()?.includes(BOB.steamid)
      ? route.fulfill({ status: 502, json: { error: 'Steam request failed' } })
      : route.fallback(),
  );

  await page.getByPlaceholder('Steam name, profile URL, or 64-bit ID…').fill('bob');
  await page.getByRole('button', { name: 'Look up', exact: true }).click();
  await expect(page.locator('.account-counts')).toContainText("Owned: couldn't load");
  await expect(updated).not.toContainText('12 days ago');
});

test('S3 edge: an unknown path says so and links Home', async ({ page }) => {
  await page.goto('/compare');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await page.getByRole('link', { name: 'Go to Home' }).click();
  await expect(page).toHaveURL('/');
});

test('S3 edge: the page carries its own icon, so the browser asks for no favicon.ico', async ({ page }) => {
  await page.goto('/about');
  await expect(page.locator('link[rel="icon"]').first()).toHaveAttribute('href', '/favicon.svg');
  const icon = await page.request.get('/favicon.svg');
  expect(icon.status()).toBe(200);
  expect(icon.headers()['content-type']).toContain('image/svg+xml');
});

test('S3 edge: About names every data source, ProtonDB included', async ({ page }) => {
  await page.goto('/about');
  const sources = page.locator('section', { hasText: 'Data sources' });
  for (const name of ['Steam Web API', 'Steam Store', 'HowLongToBeat', 'ProtonDB', 'IsThereAnyDeal'])
    await expect(sources.getByText(name, { exact: true })).toBeVisible();
});

test('S3 edge: a first game link in a fresh browser lists that game under Recently Looked Up', async ({ page }) => {
  await page.goto('/game/620');
  await expect(rows(page)).toHaveCount(1);
  await expect(row(page, 'Portal 2')).toBeVisible();
  await expect(page.getByText('No games in this list.')).toHaveCount(0);
});

test('S3 edge: a shared layout with a wrongly typed field still applies the rest of it', async ({ page }) => {
  await asPlayer(page, ALICE);
  // An older or hand-edited link: `filters.name` should be a list of values.
  const tv = JSON.stringify({ sorts: [{ key: 'name', dir: 'desc' }], filters: { name: 5 } });
  await page.goto(`/lists/owned?tv=${encodeURIComponent(tv)}`);
  await expect(rows(page)).toHaveCount(6);
  await expect(rows(page).first()).toContainText('Valheim');
});

test("S3 edge: editing a shared layout warns it's lost on reload unless kept", async ({ page }) => {
  const tv = JSON.stringify({ sorts: [{ key: 'name', dir: 'desc' }] });
  await page.goto(`/lists/compare?u=alice&u=bob&tv=${encodeURIComponent(tv)}`);
  const banner = page.getByRole('status').filter({ hasText: 'shared' });
  await expect(banner).toContainText('for this visit only');
  await expect(rows(page).first()).toBeVisible();
  const toggle = page.locator('.dt-group-row').first().locator('.dt-group-colname');
  await toggle.click(); // collapse a group
  await expect(banner).toContainText("You've changed this shared layout — it's lost on reload unless you keep it");
  await expect(banner.getByRole('button', { name: 'Keep as my layout' })).toBeVisible();
  // Back to the link's own layout: nothing of the viewer's is left to lose.
  await toggle.click();
  await expect(banner).toContainText('for this visit only');
});

test("S3 edge: another browser's list link explains lists are local", async ({ page }) => {
  await page.goto('/lists/not-in-this-browser');
  await expect(page.getByText("This list isn't in this browser")).toBeVisible();
  await expect(page.getByText('Share list')).toBeVisible();
});

test('A1 edge: an account stored without its name picks it up from Home', async ({ page }) => {
  await asPlayer(page, ALICE, { withLabel: false });
  await page.goto('/');
  await expect(page.getByRole('banner')).toContainText('Alice');
  await page.reload();
  await expect(page.getByRole('banner')).toContainText('Alice');
});

test('F3 edge: the Played (h) filter range reads in rounded hours', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  await expect(rows(page)).toHaveCount(6);
  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  await page.locator('.dt-filter-cols-search').fill('Played');
  await page.locator('[data-filter-col-key="playtime"]').click();
  // Empty until a bound is set; the column's bounds show as placeholders in its own format (0 h is "—").
  const bounds = () =>
    page.locator('.dt-range-input').evaluateAll((inputs) => inputs.map((i) => (i as HTMLInputElement).placeholder));
  await expect.poll(bounds).toEqual(['—', '20.0']);
});

test("F3 edge: the table's digits all have one width, so numbers line up", async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  await expect(row(page, 'Hades').locator('td', { hasText: '44.5' })).toHaveCSS('font-variant-numeric', 'tabular-nums');
});

test("F3 edge: a game's thumbnail falls back to its smaller capsule, then hides", async ({ page }, testInfo) => {
  await page.route('**/capsule_231x87.jpg', (route) => route.fulfill({ status: 404 }));
  await page.route('**/capsule_184x69.jpg', (route) =>
    route.request().url().includes('/620/')
      ? route.fulfill({ status: 404 })
      : route.fulfill({
          contentType: 'image/svg+xml',
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="184" height="69"/>',
        }),
  );
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  const thumb = row(page, 'Hades').locator('img.game-thumb');
  await expect(thumb).toHaveAttribute('src', /capsule_184x69/);
  await expect(thumb).toBeVisible();
  // The same box either way, so the row doesn't move as the image loads or fails (2px each side clipped off).
  expect(await thumb.boundingBox()).toMatchObject(
    testInfo.project.name === 'phone' ? { width: 100, height: 40 } : { width: 164, height: 64 },
  );
  await expect(row(page, 'Portal 2').locator('img.game-thumb')).toHaveCSS('visibility', 'hidden');
});

test("F3 edge: the open game's row keeps its bar under forced colors, where a tint or shadow is dropped", async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned?game=1145360');
  const current = row(page, 'Hades');
  await expect(current).toHaveAttribute('aria-current', 'true');
  const bar = () =>
    current
      .locator('td')
      .first()
      .evaluate((el) => getComputedStyle(el, '::before').borderLeftWidth);
  expect(await bar()).toBe('3px');
});

test('F3 edge: the Played (h) filter has a "never played" preset', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  await expect(rows(page)).toHaveCount(6);
  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  await page.locator('.dt-filter-cols-search').fill('Played');
  await page.locator('[data-filter-col-key="playtime"]').click();
  await page.getByRole('button', { name: 'never played' }).click();
  await expect(rows(page)).toHaveCount(3);
  await expect(page.getByRole('button', { name: /Played \(h\): never played/ })).toBeVisible();
});

test('F3.5: the table toolbar picks a random game from the filtered rows', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  await expect(rows(page)).toHaveCount(6);
  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  await page.locator('.dt-filter-cols-search').fill('Played');
  await page.locator('[data-filter-col-key="playtime"]').click();
  await page.getByRole('button', { name: 'never played' }).click();
  await expect(rows(page)).toHaveCount(3);
  await page.keyboard.press('Escape');
  await page.locator('.dt-toolbar').getByRole('button', { name: 'Pick a random game' }).click();
  await expect(page.locator('#panel-title')).not.toBeEmpty();
  await expect(row(page, await page.locator('#panel-title').innerText())).toHaveCount(1); // one of the 3
});

test("F3 edge: a column header's filter lists values as the cells write them", async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  await expect(rows(page)).toHaveCount(6);
  const menuButton = page.getByRole('button', { name: 'Genres options' });
  // the menu closes when the table scrolls, so scroll to it before opening, as a finger would
  await menuButton.scrollIntoViewIfNeeded();
  await menuButton.click();
  await page.getByRole('dialog', { name: 'Genres options' }).getByRole('button', { name: 'Filter' }).click();
  // innerText, unlike textContent, applies CSS text-transform
  const labels = () =>
    page.locator('.dt-th-filter-flyout label').evaluateAll((ls) => ls.map((l) => (l as HTMLElement).innerText));
  await expect.poll(labels).toContain('Action\n5');
});

test('C5 edge: the ProtonDB filter names games with no report apart from Borked ones', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/wishlist');
  await expect(rows(page)).toHaveCount(4);
  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  await page.locator('.dt-filter-cols-search').fill('ProtonDB');
  await page.locator('[data-filter-col-key="protondb"]').click();
  const values = page.locator('.dt-dd');
  await expect(values).toContainText('Borked');
  await expect(values).toContainText('No report');
});

test("C4 edge: on a comparison, the panel's Owned by lists every player who owns the game", async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/compare?u=alice&u=bob&u=carol');
  await row(page, 'Portal 2').getByText('Portal 2').click();
  const owners = page.locator('#panel-section-owners .panel-owner-name');
  await expect(owners).toHaveCount(3);
  expect((await owners.allInnerTexts()).sort()).toEqual(['Alice', 'Bob', 'Carol']);
});

test('C1 edge: a tag filter ranks games by how strongly they carry the tag, until cleared', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  await expect(rows(page)).toHaveCount(6);
  const names = () =>
    rows(page)
      .getByRole('checkbox')
      .evaluateAll((boxes) => boxes.map((b) => b.getAttribute('aria-label')!.replace('Select row ', '')));
  const byRating = await names();
  await row(page, 'Portal 2').getByText('Portal 2').click();
  const coop = page.locator('.panel-tags').getByRole('button', { name: 'Co-op, tag', exact: true });
  await coop.click();
  await expect(page.getByRole('columnheader', { name: /Tag match/ })).toBeVisible();
  await expect.poll(names).toEqual(['Valheim', 'Terraria', 'Stardew Valley', 'Portal 2']);
  await coop.click();
  await expect(page.getByRole('columnheader', { name: /Tag match/ })).toHaveCount(0);
  await expect.poll(names).toEqual(byRating);
});

test("C1 edge: the panel's Steam tags show how strongly players tagged the game with each", async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  await row(page, 'Portal 2').getByText('Portal 2').click();
  const coop = page.locator('.panel-tags').getByRole('button', { name: 'Co-op, tag', exact: true });
  await expect(coop).toHaveAttribute('title', "30% of the top tag's votes");
  const ratio = await coop.evaluate(
    (el) => el.querySelector('.tag-weight')!.getBoundingClientRect().width / el.getBoundingClientRect().width,
  );
  expect(ratio).toBeCloseTo(0.3, 1);
});

test("B2 edge: the panel lists the account's owned games closest by Steam tags, each opening its own panel", async ({
  page,
}) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/wishlist');
  await row(page, 'It Takes Two').getByText('It Takes Two').click();
  const similar = page.locator('#panel-section-similar');
  await expect(similar.locator('.panel-section-title')).toHaveText(/^Similar in Alice's library/);
  await expect(similar.getByRole('link', { name: /More like this on Steam/ })).toHaveAttribute(
    'href',
    'https://store.steampowered.com/recommended/morelike/app/1426210/',
  );
  await similar.getByRole('link', { name: "Alice's Owned list" }).click();
  await expect(rows(page)).toHaveCount(6);
  // On Owned itself, a row's closest owned games are the list's own similarity sort.
  await row(page, 'Valheim').getByText('Valheim').click();
  await expect(similar.locator('.panel-similar-item')).toHaveCount(0);
  await expect(similar.getByRole('button', { name: 'Sort list by similarity' })).toBeVisible();

  await page.goto('/lists/wishlist');
  await row(page, 'It Takes Two').getByText('It Takes Two').click();
  await expect(similar.locator('.panel-similar-item').first()).toBeVisible();
  const first = (await similar.locator('.panel-similar-name').first().textContent())!;
  await similar.locator('.panel-similar-item').first().click();
  await expect(page.locator('#panel-title')).toHaveText(first);
});

test('C1 edge: the panel sorts the list by similarity to its game, until stopped', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  await expect(rows(page)).toHaveCount(6);
  const names = () =>
    rows(page)
      .getByRole('checkbox')
      .evaluateAll((boxes) => boxes.map((b) => b.getAttribute('aria-label')!.replace('Select row ', '')));
  const byRating = await names();
  await row(page, 'Valheim').getByText('Valheim').click();
  await page.getByRole('button', { name: 'Sort list by similarity' }).click();
  await expect(page.getByRole('columnheader', { name: /Similarity/ })).toBeVisible();
  // Terraria's tags match Valheim's as closely as Valheim's own, so the two 100% tie.
  await expect
    .poll(async () => (await names()).slice(0, 4))
    .toEqual([...byRating.filter((n) => n === 'Valheim' || n === 'Terraria'), 'Stardew Valley', 'Portal 2']);
  await page.getByRole('button', { name: 'Stop sorting by similarity' }).click();
  await expect(page.getByRole('columnheader', { name: /Similarity/ })).toHaveCount(0);
  await expect.poll(names).toEqual(byRating);
  // Not kept across a reload: its target game was only this visit's.
  await page.getByRole('button', { name: 'Sort list by similarity' }).click();
  await expect(page.getByRole('columnheader', { name: /Similarity/ })).toBeVisible();
  await page.reload();
  await expect(rows(page)).toHaveCount(6);
  await expect(page.getByRole('columnheader', { name: /Similarity/ })).toHaveCount(0);
  await expect.poll(names).toEqual(byRating);
});

test('F3 edge: Owned says which tags the account plays most, each filtering the list', async ({ page }) => {
  await asPlayer(page, ALICE);
  // 10 h on every game: Alice's own fixture has too few played games for a profile.
  await page.route('**/api/common-games', (route) => {
    const req = route.request();
    const body = JSON.parse(respond(req.method(), new URL(req.url()), req.postData()).body);
    for (const perPlayer of Object.values(body.playtime) as Record<string, number>[])
      for (const id of Object.keys(perPlayer)) perPlayer[id] = 600;
    return route.fulfill({ json: body });
  });
  await page.goto('/lists/owned');
  await expect(rows(page)).toHaveCount(6);
  const note = page.locator('.list-plays-mostly');
  const tags = note.locator('.list-plays-mostly-tag');
  // Singleplayer: on fewer games, so rarer here than Action and Co-op.
  await expect(tags).toHaveText(['Singleplayer', 'Action', 'Co-op']);
  await expect(tags.first()).toHaveAttribute('title', /· the top tag$/);

  const why = note.getByRole('button', { name: 'Why these?' });
  const breakdown = page.locator('#plays-mostly-breakdown');
  await expect(breakdown).toBeHidden();
  await why.click();
  await expect(why).toHaveAttribute('aria-expanded', 'true');
  await expect(breakdown.getByRole('listitem').first()).toContainText(/^Singleplayer\d+%.+ 10h/);
  await why.click();
  await expect(breakdown).toBeHidden();

  const coop = note.getByRole('button', { name: 'Co-op' });
  await coop.click();
  await expect(rows(page)).toHaveCount(4);
  await expect(page.getByRole('columnheader', { name: /Tag match/ })).toBeVisible();
  await expect(coop).toHaveAttribute('aria-pressed', 'true');
});

test("B2 edge: Taste fit scores the wishlist by the account's taste, once Owned has been opened", async ({ page }) => {
  await asPlayer(page, ALICE);
  // 10 h on every game, so Owned has enough played games to learn a taste from.
  await page.route('**/api/common-games', (route) => {
    const req = route.request();
    const body = JSON.parse(respond(req.method(), new URL(req.url()), req.postData()).body);
    for (const perPlayer of Object.values(body.playtime) as Record<string, number>[])
      for (const id of Object.keys(perPlayer)) perPlayer[id] = 600;
    return route.fulfill({ json: body });
  });
  const note = page.locator('.list-score-note');
  await page.goto('/lists/wishlist');
  await expect(page.getByRole('columnheader', { name: /Taste fit/ })).toBeVisible();
  await expect(note).toHaveText("Taste fit needs Alice's Owned list opened on this device");

  await page.goto('/lists/owned');
  await expect(page.locator('.list-plays-mostly')).toBeVisible();
  await page.goto('/lists/wishlist');
  await expect(note).toHaveText(/^Taste fit: Alice's taste as of \d{4}-\d{2}-\d{2}$/);
  await expect(
    rows(page)
      .first()
      .getByRole('cell', { name: /^\d+%$/ }),
  ).toBeVisible();
});

test('B2 edge: Taste fit says an opened Owned has too few games played, and stays quiet on a link', async ({
  page,
}) => {
  // Alice's own fixture has too few played games for a profile.
  await asPlayer(page, ALICE);
  const note = page.locator('.list-score-note');
  await page.goto('/lists/owned');
  // Learned once every row's details are in.
  await expect
    .poll(() => page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('steam.isonoe.net:taste:'))))
    .toBe(true);
  await page.goto('/lists/wishlist');
  await expect(page.getByRole('columnheader', { name: /Taste fit/ })).toBeVisible();
  await expect(note).toHaveText('Taste fit: Alice has too few games played');
  await page.goto('/lists/wishlist?u=alice');
  await expect(rows(page)).toHaveCount(ALICE.wishlist!.length);
  await expect(note).toHaveText('Taste fit: Alice has too few games played');

  // Someone else's wishlist from a link: nothing for the viewer to open about the sender.
  await page.goto('/lists/wishlist?u=bob');
  await expect(rows(page)).toHaveCount(BOB.wishlist!.length);
  await expect(page.getByRole('columnheader', { name: /Taste fit/ })).toBeVisible();
  await expect(note).toHaveCount(0);

  // Once the viewer has opened that account's Owned here, its taste is on this device.
  await page.goto('/lists/owned?u=bob');
  await expect(rows(page)).toHaveCount(BOB.owned.length);
  await expect
    .poll(() => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('steam.isonoe.net:taste:'))))
    .toHaveLength(2);
  await page.goto('/lists/wishlist?u=bob');
  await expect(rows(page)).toHaveCount(BOB.wishlist!.length);
  await expect(note).toHaveText('Taste fit: Bob has too few games played');
});

test("B2 edge: a link to my own ★ account still says to open its Owned, whoever's current", async ({ page }) => {
  await asPlayer(page, ALICE);
  // No current account: only the ★ one says the link is the viewer's own.
  await page.addInitScript(() => {
    const prefs = JSON.parse(localStorage.getItem('steam.isonoe.net:prefs')!);
    delete prefs.currentAccount;
    localStorage.setItem('steam.isonoe.net:prefs', JSON.stringify(prefs));
  });
  await page.goto('/lists/wishlist?u=alice');
  await expect(rows(page)).toHaveCount(ALICE.wishlist!.length);
  await expect(page.locator('.list-score-note')).toHaveText("Taste fit needs Alice's Owned list opened on this device");
});

test('C1 edge: Tag match averages the filtered tags, or with All takes the weakest', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  await expect(rows(page)).toHaveCount(6);
  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  await page.locator('.dt-filter-cols-search').fill('Tags');
  await page.locator('[data-filter-col-key="tags"]').click();
  await page.getByRole('checkbox', { name: 'Action', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Co-op', exact: true }).click();
  // Portal 2: Action 100%, Co-op 30%.
  await expect(row(page, 'Portal 2').getByRole('cell', { name: '65%' })).toBeVisible();
  const chip = page.locator('.dt-chip--filter', { hasText: 'Tags' });
  await expect(chip).toContainText('Action, Co-op');
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await expect(row(page, 'Portal 2').getByRole('cell', { name: '30%' })).toBeVisible();
  // The chip tells All from Any.
  await expect(chip).toContainText('Action & Co-op');
});

test("C1 edge: a game looked up outside the list can't sort the list by similarity to it", async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  await expect(rows(page)).toHaveCount(6);
  await page.getByPlaceholder('Look up any game…').fill('apex');
  await page.getByRole('option', { name: /Apex Legends/ }).click();
  const similar = page.locator('#panel-section-similar');
  await expect(similar.locator('.panel-similar-item').first()).toBeVisible();
  await expect(similar.getByRole('button', { name: /Sort list by similarity/ })).toHaveCount(0);
});

test('C1 edge: a Tag match range keeps the games strongly tagged, and goes with the tag filter', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  await expect(rows(page)).toHaveCount(6);
  const coop = page.locator('.panel-tags').getByRole('button', { name: 'Co-op, tag', exact: true });
  await row(page, 'Portal 2').getByText('Portal 2').click();
  await coop.click();
  await expect(rows(page)).toHaveCount(4);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  await page.locator('.dt-filter-cols-search').fill('Tag match');
  await page.locator('[data-filter-col-key="tagMatch"]').click();
  await page.getByRole('textbox', { name: 'Tag match Min' }).fill('60');
  await expect(rows(page)).toHaveCount(3);
  await expect(row(page, 'Portal 2')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await row(page, 'Valheim').getByText('Valheim').click();
  await coop.click();
  await expect(rows(page)).toHaveCount(6);
});

test("C1 edge: a comparison's Group fit scores games for its least suited player", async ({ page }) => {
  await asPlayer(page, ALICE);
  // 10 h on every game: Alice gets a profile; Bob's 4 games stay too few for one.
  await page.route('**/api/common-games', (route) => {
    const req = route.request();
    const body = JSON.parse(respond(req.method(), new URL(req.url()), req.postData()).body);
    for (const perPlayer of Object.values(body.playtime) as Record<string, number>[])
      for (const id of Object.keys(perPlayer)) perPlayer[id] = 600;
    return route.fulfill({ json: body });
  });
  await page.goto('/lists/compare?u=alice&u=bob');
  await expect(page.getByRole('columnheader', { name: /Group fit/ })).toBeVisible();
  const fit = row(page, 'Valheim').locator('span[title^="Alice "]');
  await expect(fit).toHaveText(/^\d+% · Alice$/);
  await expect(fit).toHaveAttribute('title', /· Bob: too few games played to tell$/);
  await expect(page.locator('.list-score-note')).toHaveText('Group fit leaves out Bob: too few games played here');
});

test('C6 edge: a comparison has a Played column per player', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/compare?u=alice&u=bob');
  await expect(row(page, 'Portal 2')).toBeVisible();
  const headers = await page.locator('thead th').allInnerTexts();
  const col = (name: string) => headers.findIndex((h) => h.includes(name));
  expect(col('Played (h) · Alice')).toBeGreaterThan(-1);
  expect(col('Played (h) · Bob')).toBeGreaterThan(-1);
  const portal = row(page, 'Portal 2').locator('td');
  await expect(portal.nth(col('Played (h) · Alice'))).toHaveText('10.0');
  await expect(portal.nth(col('Played (h) · Bob'))).toHaveText('—');
});

test('C1.4: compare three players — one table grouped from "all" to "only one"', async ({ page }) => {
  await page.goto('/lists/compare?u=alice&u=bob&u=carol');
  await expect(groupRows(page)).toHaveCount(6);
  const labels = await groupRows(page).allInnerTexts();
  expect(labels.map((l) => l.replace(/\s+/g, ' '))).toEqual([
    expect.stringContaining('All 3'),
    expect.stringContaining('Alice + Bob — not Carol'),
    expect.stringContaining('Bob + Carol — not Alice'),
    expect.stringContaining('Only Alice'),
    expect.stringContaining('Only Bob'),
    expect.stringContaining('Only Carol'),
  ]);
  // One toolbar, and the comparison lives in the URL alone (nothing stored as "my" account).
  await expect(page.getByRole('button', { name: 'Columns' })).toHaveCount(1);
  expect(await page.evaluate(() => localStorage.getItem('steam.isonoe.net:prefs') ?? '')).not.toContain(
    'currentAccount',
  );
});

test('C1 edge: reverting to a saved ungrouped layout keeps the comparison grouped', async ({ page }) => {
  await mockApi(page, { states: ['signed-in'] });
  // The account's saved comparison view, with the grouping removed.
  const now = Date.now();
  const compareListView = { value: { groupBy: [], sorts: [{ key: 'name', dir: 'asc' }] }, updatedAt: now };
  const prefs = { ...signedInPrefs(now), compareListView };
  await page.route('**/api/me', (route) => route.fulfill({ json: { steamid: SIGNED_IN.steamid, prefs } }));
  await page.goto('/lists/compare?u=alice&u=bob');
  await expect(groupRows(page)).toHaveCount(3);
  await page.getByRole('button', { name: 'Revert' }).click();
  await expect(row(page, 'Hades')).toBeVisible(); // the reverted name sort applies…
  await expect(groupRows(page)).toHaveCount(3); // …but the comparison stays grouped
});

test('C1 edge: the unsaved-view banner shows when sign-in lands after the table', async ({ page }) => {
  await mockApi(page, { states: ['signed-in'] });
  const bundlesBrowseView = { value: { sorts: [{ key: 'title', dir: 'desc' }] }, updatedAt: Date.now() };
  // Delayed so the banner mounts signed out: its `when` must still pick up the user arriving.
  await page.route('**/api/me', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.fulfill({ json: { steamid: SIGNED_IN.steamid, prefs: { bundlesBrowseView } } });
  });
  await page.goto('/bundles');
  await expect(page.locator('.pref-unsaved-banner')).toContainText('Unsaved changes to this view');
});

test('C1 edge: my account comes first, is prefilled, and only once', async ({ page }) => {
  await asPlayer(page, BOB); // Bob's steamid sorts after Alice's
  await page.goto('/lists/compare?u=alice&u=bob');
  await expect(page.getByRole('heading', { name: 'Bob vs. Alice' })).toBeVisible();

  await page.goto('/lists/compare?u=bob&u=bob');
  await expect(page.getByRole('main')).toContainText('Bob is in two player boxes');

  await page.goto('/lists/compare');
  await expect(page.locator('.compare-form')).toContainText('Bob');
});

test('C1 edge: the comparison states its mode once, in its select', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/compare?u=alice&u=bob');
  await expect(page.getByRole('heading', { name: 'Alice vs. Bob' })).toBeVisible();
  await expect(page.locator('.list-hero select')).toHaveValue('group-by-membership');
  await expect(page.locator('.list-hero-chip', { hasText: 'Grouped by membership' })).toHaveCount(0);
});

test('C3 edge: a saved comparison keeps the name its page had', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/compare?u=alice&u=bob');
  await expect(page.getByRole('heading', { name: 'Alice vs. Bob' })).toBeVisible();
  const more = page.getByRole('button', { name: 'More actions' }); // a phone folds Save behind More actions
  if (await more.isVisible()) await more.click();
  await page.getByRole('button', { name: 'Save as a list' }).click();
  await expect(page).toHaveURL(/\/lists\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'Alice vs. Bob' })).toBeVisible();
});

test('C3 edge: a saved comparison offers Share list only, not a Share view that only opens here', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/compare?u=alice&u=bob');
  await expect(groupRows(page)).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Share view' })).toHaveCount(1);
  const more = page.getByRole('button', { name: 'More actions' }); // a phone folds Save behind More actions
  if (await more.isVisible()) await more.click();
  await page.getByRole('button', { name: 'Save as a list' }).click();
  await expect(page).toHaveURL(/\/lists\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('button', { name: /Share list/ })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Default view' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Share view' })).toHaveCount(0);
});

test('C3 edge: Save as a list moves focus into the saved list, not to the page', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/compare?u=alice&u=bob');
  await expect(groupRows(page)).toHaveCount(3);
  const more = page.getByRole('button', { name: 'More actions' }); // a phone folds Save behind More actions
  if (await more.isVisible()) await more.click();
  await page.getByRole('button', { name: 'Save as a list' }).click();
  await expect(page).toHaveURL(/\/lists\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('main')).toBeFocused();
});

test('C1 edge: Add player focuses the player box it adds', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/compare');
  await page.getByRole('button', { name: 'Add player' }).click();
  const boxes = page.locator('.compare-form').getByRole('combobox');
  await expect(boxes).toHaveCount(3);
  await expect(boxes.nth(2)).toBeFocused();
});

test('C1 edge: Enter in an empty player box compares, once two players are in', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/compare');
  const box = page.locator('.compare-form').getByRole('combobox').nth(1);
  await box.fill('bob');
  await box.press('Enter'); // commits Bob's chip
  await expect(page.locator('.compare-form')).toContainText('bob');
  await box.press('Enter');
  await expect(page.getByRole('heading', { name: 'Alice vs. Bob' })).toBeVisible();
});

test('C1 edge: Enter in an empty player box adds the suggestion pointed at, not compares', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/');
  await page.getByPlaceholder('Steam name, profile URL, or 64-bit ID…').fill('bob');
  await page.getByRole('button', { name: 'Look up', exact: true }).click();
  await expect(page.locator('.account-tiles li')).toHaveCount(2); // Bob is now a known account
  await page.goto('/lists/compare');
  const boxes = page.locator('.compare-form').getByRole('combobox');
  await boxes.nth(1).fill('carol');
  await boxes.nth(1).press('Enter');
  await page.getByRole('button', { name: 'Add player' }).click();
  await page.getByRole('option', { name: /Bob/ }).hover();
  await boxes.nth(2).press('Enter');
  await expect(page.locator('.compare-form')).toContainText('Bob');
  await expect(page).toHaveURL(/\/lists\/compare$/);
});

test('C1 edge: an empty player box highlights no suggestion until one is pointed at, and Enter follows that', async ({
  page,
}) => {
  await asPlayer(page, ALICE);
  await page.goto('/');
  await page.getByPlaceholder('Steam name, profile URL, or 64-bit ID…').fill('bob');
  await page.getByRole('button', { name: 'Look up', exact: true }).click();
  await expect(page.locator('.account-tiles li')).toHaveCount(2); // Bob is now a known account
  await page.goto('/lists/compare');
  const box = page.locator('.compare-form').getByRole('combobox').nth(1);
  await box.focus();
  const bob = page.getByRole('option', { name: /Bob/ });
  await expect(bob).toHaveAttribute('aria-selected', 'false');
  await expect(box).not.toHaveAttribute('aria-activedescendant');
  const chips = page.locator('.compare-token');
  await box.press('Enter');
  await expect(chips).toHaveCount(1); // Alice only
  await box.press('ArrowDown');
  await expect(bob).toHaveAttribute('aria-selected', 'true');
  await expect(box).toHaveAttribute('aria-activedescendant', (await bob.getAttribute('id'))!);
  await box.press('Enter');
  await expect(chips.filter({ hasText: 'Bob' })).toHaveCount(1);
});

test('C1 edge: ArrowDown steps through every player suggestion', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/');
  for (const name of ['bob', 'carol']) {
    await page.getByPlaceholder('Steam name, profile URL, or 64-bit ID…').fill(name);
    await page.getByRole('button', { name: 'Look up', exact: true }).click();
  }
  await expect(page.locator('.account-tiles li')).toHaveCount(3);
  await page.goto('/lists/compare');
  const box = page.locator('.compare-form').getByRole('combobox').nth(1);
  await box.focus();
  const options = page.getByRole('option');
  await expect(options).toHaveCount(2);
  await box.press('ArrowDown');
  await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');
  await box.press('ArrowDown');
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
  await box.press('ArrowDown');
  await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true'); // wraps
});

test('C1 edge: the players form offers no More actions with nothing to fold', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'phone layout only');
  await asPlayer(page, ALICE);
  await page.goto('/lists/compare');
  await expect(page.locator('.compare-form')).toBeVisible();
  await expect(page.getByRole('button', { name: 'More actions' })).toHaveCount(0);
});

test('C1 edge: a disabled Compare libraries says why', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/compare');
  const submit = page.getByRole('button', { name: 'Compare libraries' });
  // aria-disabled, not disabled: a disabled button is skipped by Tab, so its reason was never announced.
  await expect(submit).toHaveAttribute('aria-disabled', 'true');
  await submit.focus();
  await expect(submit).toBeFocused();
  await expect(submit).toHaveAccessibleDescription('Add a second player');
  await expect(page.locator('.compare-form-actions').getByText('Add a second player')).toBeVisible();
  const box = await submit.boundingBox();
  await page.locator('.compare-form').getByRole('combobox').nth(1).fill('bob');
  await expect(submit).not.toHaveAttribute('aria-disabled');
  await expect(page.locator('.compare-form-actions').getByText('Add a second player')).toBeHidden();
  expect(await submit.boundingBox()).toEqual(box);
});

test('C1 edge: with my account listed first, each group still names the right players', async ({ page }) => {
  await asPlayer(page, BOB); // Bob sorts after Alice in the URL, but reads first
  await page.goto('/lists/compare?u=alice&u=bob');
  const onlyBob = groupRows(page).filter({ hasText: 'Only Bob' });
  await expect(onlyBob).toContainText('2 rows'); // Bob owns 2 games Alice doesn't
  await expect(groupRows(page).filter({ hasText: 'Only Alice' })).toContainText('4 rows');
});

test('C1 edge: an unknown player is named, and the others still compare', async ({ page }) => {
  await page.goto('/lists/compare?u=alice&u=bob&u=nobody-here');
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('nobody-here');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Alice vs. Bob vs. nobody-here');

  await alert.getByRole('button', { name: 'Edit players' }).click();
  await expect(page.locator('.compare-token.is-invalid')).toHaveText(/nobody-here/);
  await page.getByRole('button', { name: 'Cancel' }).first().click();

  await page.getByRole('button', { name: 'Compare the other 2' }).click();
  // Checked by what's gone: the route also rewrites players to canonical steam64 ids.
  await expect(page).not.toHaveURL(/nobody-here/);
  await expect(groupRows(page)).toHaveCount(3);
});

test('C1 edge: the bare Compare link after an unknown player starts clean', async ({ page }) => {
  await page.goto('/lists/compare?u=alice&u=nobody-here');
  await expect(page.getByRole('alert')).toContainText('nobody-here');
  await page.getByRole('navigation', { name: 'Main', exact: true }).getByRole('link', { name: 'Compare' }).click();
  await expect(page.locator('.compare-form')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.compare-token.is-invalid')).toHaveCount(0);
});

test('L1 edge: following a formula link from Edit sources opens the source closed', async ({ page }) => {
  const list = (id: string, fields: object) => ({
    id,
    parentId: null,
    order: 0,
    createdAt: 0,
    updatedAt: 0,
    ...fields,
  });
  const lists = [
    list('picks', { name: 'Picks', kind: 'manual', appids: [620, 105600] }),
    list('inner', { name: 'Inner', kind: 'dynamic', op: 'union', sources: [{ kind: 'user', listId: 'picks' }] }),
    list('outer', { name: 'Outer', kind: 'dynamic', op: 'union', sources: [{ kind: 'user', listId: 'inner' }] }),
  ];
  await page.addInitScript(
    (blob) => {
      if (!sessionStorage.getItem('e2e-seeded')) localStorage.setItem('steam.isonoe.net:prefs', blob);
      sessionStorage.setItem('e2e-seeded', '1');
    },
    JSON.stringify({ schemaVersion: 2, lists: { value: lists, updatedAt: 0 } }),
  );
  await page.goto('/lists/outer');
  await page.getByRole('button', { name: 'Edit sources' }).click();
  await page.locator('.list-formula').getByRole('link', { name: 'Inner' }).click();
  await expect(page.getByRole('heading', { name: 'Inner' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit sources' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel' })).toHaveCount(0);
});

test('L1.1-3: select games, add them to a new list, open it', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  await row(page, 'Portal 2').getByRole('checkbox').check();
  await row(page, 'Terraria').getByRole('checkbox').check();

  const toolbar = page.locator('.selection-toolbar');
  await toolbar.getByRole('combobox').selectOption({ label: 'Create new list…' });
  await page.getByRole('textbox', { name: 'New list name' }).fill('To play with Bob');
  await page.keyboard.press('Enter');

  const toast = page.getByRole('status').filter({ hasText: 'Added 2 games to new list "To play with Bob"' });
  await expect(toast).toBeVisible();
  await toast.getByRole('link', { name: 'Open list' }).click();
  await expect(page.getByRole('heading', { name: 'To play with Bob' })).toBeVisible();
  await expect(rows(page)).toHaveCount(2);
});

test('L1 edge: Add hands focus to the row it added as the selection bar goes', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  const added = rows(page).last();
  await added.getByRole('checkbox').check();
  const toolbar = page.locator('.selection-toolbar');
  await toolbar.getByRole('combobox').selectOption({ label: 'Create new list…' });
  await page.getByRole('textbox', { name: 'New list name' }).fill('Later');
  await toolbar.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('status').getByRole('link', { name: 'Open list' })).toBeVisible();
  await expect(added).toBeFocused();
});

test('L1 edge: Add hands focus to an added row still on screen, not back to the first', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.setViewportSize({ width: page.viewportSize()!.width, height: 360 });
  await page.goto('/lists/owned');
  await rows(page).first().getByRole('checkbox').check();
  const onScreen = rows(page).last();
  await onScreen.scrollIntoViewIfNeeded();
  await onScreen.getByRole('checkbox').check();
  await expect(rows(page).first()).not.toBeInViewport();
  const toolbar = page.locator('.selection-toolbar');
  await toolbar.getByRole('combobox').selectOption({ label: 'Create new list…' });
  await page.getByRole('textbox', { name: 'New list name' }).fill('Later');
  await toolbar.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(onScreen).toBeFocused();
});

test("L1 edge: the new list's toast stays while pointed at", async ({ page }) => {
  await page.clock.install();
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  await row(page, 'Portal 2').getByRole('checkbox').check();
  await page.locator('.selection-toolbar').getByRole('combobox').selectOption({ label: 'Create new list…' });
  await page.getByRole('textbox', { name: 'New list name' }).fill('Later');
  await page.keyboard.press('Enter');

  const toast = page.getByRole('status').filter({ hasText: 'new list "Later"' });
  await toast.hover();
  await page.clock.runFor(10_000);
  await expect(toast).toBeVisible();
  await page.mouse.move(0, 0);
  await page.clock.runFor(7_000);
  await expect(toast).toBeHidden();
});

test('L1.4: a list moves into the only folder', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/');
  await page.getByRole('button', { name: 'New list' }).click();
  await page.getByRole('textbox', { name: 'List name' }).fill('Shortlist');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'New folder' }).click();
  await page.getByRole('textbox', { name: 'Folder name' }).fill('Weekend');
  await page.keyboard.press('Enter');

  await rowMenu(page, 'Shortlist').click();
  const move = page.getByRole('combobox', { name: 'Move Shortlist to…' });
  await expect(move).toHaveValue(''); // showing "Move to…", so picking the folder is a change
  await move.selectOption({ label: 'Weekend' });
  await rowMenu(page, 'Shortlist').click();
  await expect(move.locator('option')).toContainText(['Move to…', 'Top level']); // now inside Weekend
  await expect(move).toHaveValue('');
});

test('L1 edge: folders and lists are named in place, not in a dialog', async ({ page }) => {
  page.on('dialog', (d) => {
    throw new Error(`unexpected ${d.type()} dialog`);
  });
  await asPlayer(page, ALICE);
  await page.goto('/');
  const tree = page.locator('.home-tree');
  const newFolder = page.getByRole('button', { name: 'New folder' });
  await newFolder.click();
  const field = page.getByRole('textbox', { name: 'Folder name' });
  await expect(field).toBeFocused();
  await field.fill('Weekend');
  await page.keyboard.press('Enter');
  await expect(tree.getByText('Weekend', { exact: true })).toBeVisible();
  await expect(newFolder).toBeFocused();

  // Esc cancels, and focus goes back to the row's ⋯.
  const menu = rowMenu(page, 'Weekend');
  await menu.click();
  await page.getByRole('button', { name: 'Rename Weekend' }).click();
  await expect(field).toBeFocused();
  await expect(field).toHaveValue('Weekend');
  await field.fill('Later');
  await page.keyboard.press('Escape');
  await expect(tree.getByText('Weekend', { exact: true })).toBeVisible();
  await expect(menu).toBeFocused();

  // Leaving the field saves it; an empty name cancels.
  await menu.click();
  await page.getByRole('button', { name: 'Rename Weekend' }).click();
  await field.fill('Co-op');
  await page.getByRole('heading', { name: 'Your lists' }).click();
  await expect(tree.getByText('Co-op', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New list' }).click();
  await page.getByRole('textbox', { name: 'List name' }).fill('  ');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: 'List name' })).toHaveCount(0);
  await expect(tree.locator('.list-tree li')).toHaveCount(1);
});

test("L1 edge: a row's ⋯ menu works from the keyboard and hands focus back", async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/');
  for (const [button, label, name] of [
    ['New folder', 'Folder name', 'Weekend'],
    ['New list', 'List name', 'Shortlist'],
    ['New list', 'List name', 'Later'],
  ]) {
    await page.getByRole('button', { name: button }).click();
    await page.getByRole('textbox', { name: label }).fill(name);
    await page.keyboard.press('Enter');
  }
  const menu = rowMenu(page, 'Shortlist');

  // Enter opens it, Tab goes into it, Esc closes it back onto ⋯.
  await menu.focus();
  await page.keyboard.press('Enter');
  const move = page.getByRole('combobox', { name: 'Move Shortlist to…' });
  await expect(move).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(move).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(move).toBeHidden();
  await expect(menu).toBeFocused();

  // Rename closes the menu, then the field takes focus; Enter saves and returns to ⋯.
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Rename Shortlist' }).press('Enter');
  const field = page.getByRole('textbox', { name: 'List name' });
  await expect(field).toBeFocused();
  await expect(page.locator('.tree-menu-panel:popover-open')).toHaveCount(0);
  await field.fill('Picks');
  await page.keyboard.press('Enter');
  await expect(rowMenu(page, 'Picks')).toBeFocused();

  // Move lands on the moved row's ⋯.
  await page.keyboard.press('Enter');
  await page.getByRole('combobox', { name: 'Move Picks to…' }).selectOption({ label: 'Weekend' });
  await expect(rowMenu(page, 'Picks')).toBeFocused();

  // Delete: a cancelled confirm leaves focus on ⋯, an accepted one moves it to the next row's.
  page.once('dialog', (d) => d.dismiss());
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Delete Picks' }).press('Enter');
  await expect(rowMenu(page, 'Picks')).toBeFocused();
  page.once('dialog', (d) => d.accept());
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Delete Picks' }).press('Enter');
  await expect(rowMenu(page, 'Picks')).toHaveCount(0);
  await expect(rowMenu(page, 'Later')).toBeFocused();

  // The last row deleted: focus goes to the section's heading.
  page.once('dialog', (d) => d.accept());
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Delete Later' }).press('Enter');
  await expect(rowMenu(page, 'Weekend')).toBeFocused();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Delete Weekend' }).press('Enter');
  await expect(page.getByRole('heading', { name: 'Your lists' })).toBeFocused();
});

test("L1 edge: a list edit the browser can't store says so", async ({ page }) => {
  await asPlayer(page, ALICE);
  // Refuses the prefs blob once the test sets the flag, as a full storage would.
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if ((window as { storageFull?: boolean }).storageFull && key === 'steam.isonoe.net:prefs')
        throw new DOMException('full', 'QuotaExceededError');
      setItem.call(this, key, value);
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'New list' }).click();
  await page.getByRole('textbox', { name: 'List name' }).fill('Shortlist');
  await page.keyboard.press('Enter');
  const alert = page.getByRole('alert').filter({ hasText: "didn't save" });
  await expect(alert).toHaveCount(0);

  await page.evaluate(() => ((window as { storageFull?: boolean }).storageFull = true));
  await rowMenu(page, 'Shortlist').click();
  await page.getByRole('button', { name: 'Rename Shortlist' }).click();
  await page.getByRole('textbox', { name: 'List name' }).fill('Picks');
  await page.keyboard.press('Enter');
  await expect(alert).toHaveText("This browser didn't save your last change on this device.Dismiss");

  // Dismiss hands focus back to where it was.
  const focused = await page.evaluateHandle(() => document.activeElement);
  expect(await focused.evaluate((el) => el !== document.body)).toBe(true);
  await alert.getByRole('button', { name: 'Dismiss' }).click();
  await expect(alert).toHaveCount(0);
  expect(await focused.evaluate((el) => el === document.activeElement)).toBe(true);
});

test("L1 edge: clearing a ranking's name hands it back its default label", async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/wishlist');
  await page.getByRole('button', { name: /Rank this list/ }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Ranking of Alice — Wishlist' })).toBeVisible();
  await page.goto('/');
  await rowMenu(page, 'Ranking of Alice — Wishlist').click();
  await page.getByRole('button', { name: 'Rename Ranking of Alice — Wishlist' }).click();
  await page.getByRole('textbox', { name: 'List name' }).fill('Top picks');
  await page.keyboard.press('Enter');
  await rowMenu(page, 'Top picks').click();
  await page.getByRole('button', { name: 'Rename Top picks' }).click();
  await page.getByRole('textbox', { name: 'List name' }).fill('');
  await page.keyboard.press('Enter');
  await expect(page.locator('.list-tree').getByRole('link', { name: /Ranking of Alice — Wishlist/ })).toBeVisible();
});

test('L1 edge: confirming an IME candidate with Enter keeps the name field open', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/');
  await page.getByRole('button', { name: 'New list' }).click();
  const field = page.getByRole('textbox', { name: 'List name' });
  await field.fill('にほ');
  await field.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
  await expect(field).toBeVisible();
  await expect(page.locator('.list-tree').getByRole('link', { name: /にほ/ })).toHaveCount(0);
});

test("L1 edge: the name field looks like the app's other text fields", async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/');
  await page.getByRole('button', { name: 'New folder' }).click();
  const look = (el: Element) => {
    const s = getComputedStyle(el);
    return [s.backgroundColor, s.borderTopStyle, s.borderTopWidth, s.borderRadius, s.color, s.fontSize];
  };
  const search = await page.locator('.app-search-wrap > input').evaluate(look);
  expect(await page.getByRole('textbox', { name: 'Folder name' }).evaluate(look)).toEqual(search);
});

test('L2 edge: creating a combined list opens it', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/');
  await page.getByRole('button', { name: 'New combined list' }).click();
  const form = page.locator('.combine-form');
  const sources = form.locator('.combine-sources input[type="checkbox"]');
  await sources.nth(0).check();
  await sources.nth(1).check();
  await form.getByRole('button', { name: 'Create combined list' }).click();
  await expect(page).toHaveURL(/\/lists\/[^/?]+$/);
  await expect(page.getByRole('button', { name: 'Edit sources' })).toBeVisible();
});

test("L2 edge: a combined list created under a link's account opens under it", async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/?u=bob');
  await page.getByRole('button', { name: 'New combined list' }).click();
  const sources = page.locator('.combine-form .combine-sources input[type="checkbox"]');
  await sources.nth(0).check();
  await sources.nth(1).check();
  await page.getByRole('button', { name: 'Create combined list' }).click();
  await expect(page).toHaveURL(/\/lists\/[^/?]+\?u=bob$/);
});

test('L2 edge: Edit sources has one Cancel, which hands focus back', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/');
  await page.getByRole('button', { name: 'New combined list' }).click();
  const sources = page.locator('.combine-form .combine-sources input[type="checkbox"]');
  await sources.nth(0).check();
  await sources.nth(1).check();
  await page.getByRole('button', { name: 'Create combined list' }).click();
  const edit = page.getByRole('button', { name: 'Edit sources' });
  await edit.click();
  await expect(page.getByRole('button', { name: 'Cancel' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('.combine-form')).toHaveCount(0);
  await expect(edit).toBeFocused();
});

test('L2 edge: on a phone, the combine form fits the page width', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'phone layout');
  await asPlayer(page, ALICE);
  await page.goto('/');
  const pageWidth = () => page.evaluate(() => document.documentElement.scrollWidth);
  const viewport = page.viewportSize()!;
  await page.getByRole('button', { name: 'New combined list' }).click();
  const sources = page.locator('.combine-form .combine-sources input[type="checkbox"]');
  await expect(sources.first()).toBeVisible();
  expect(await pageWidth()).toBeLessThanOrEqual(viewport.width);
  await sources.nth(0).check();
  await sources.nth(1).check();
  await page.getByRole('button', { name: 'Create combined list' }).click();
  await page.getByRole('button', { name: 'Edit sources' }).click();
  await expect(page.locator('.combine-form')).toBeVisible();
  expect(await pageWidth()).toBeLessThanOrEqual(viewport.width);
});

test('L1 edge: a list under 2 games says ranking needs 2', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/');
  await page.getByRole('button', { name: 'New list' }).click();
  await page.getByRole('textbox', { name: 'List name' }).fill('Empty');
  await page.keyboard.press('Enter');
  await page.locator('.list-tree').getByRole('link', { name: /Empty/ }).click();
  const rank = page.getByRole('button', { name: /Rank this list/ });
  await expect(rank).toHaveAttribute('aria-disabled', 'true');
  await expect(rank).toHaveAccessibleDescription('Ranking needs at least 2 games');
  await expect(page.getByText('Ranking needs at least 2 games')).toBeVisible();
  await rank.click({ force: true }); // aria-disabled reads as disabled to Playwright
  await expect(page).toHaveURL(/\/lists\/[^/]+$/); // stayed: no ranking made
});

test('L1 edge: one selected game is too few to rank, and says so', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/wishlist');
  await row(page, 'It Takes Two').getByRole('checkbox').check();
  const rank = page.getByRole('button', { name: 'Rank 1 game', exact: true });
  await expect(rank).toHaveAttribute('aria-disabled', 'true');
  await expect(rank).toHaveAccessibleDescription('Ranking needs at least 2 games');
  await rank.click({ force: true });
  await expect(page).toHaveURL(/\/lists\/wishlist/);

  // A list already ranked once gates "New ranking" the same way.
  await row(page, 'It Takes Two').getByRole('checkbox').uncheck();
  await page.getByRole('button', { name: /Rank this list/ }).click();
  await page.keyboard.press('Escape');
  await page.goto('/lists/wishlist');
  await row(page, 'It Takes Two').getByRole('checkbox').check();
  await page.getByRole('button', { name: /Rank 1 game/ }).click();
  const create = page.locator('.rank-menu-panel').getByRole('button', { name: 'New ranking' });
  await expect(create).toHaveAttribute('aria-disabled', 'true');
  await expect(create).toHaveAccessibleDescription('Ranking needs at least 2 games');
  await create.click({ force: true });
  await expect(page).toHaveURL(/\/lists\/wishlist/);
});

test("L3 edge: the toolbar's two resets say what they do", async ({ page }) => {
  await asPlayer(page, ALICE);
  for (const route of ['/lists/owned', '/bundles']) {
    await page.goto(route);
    // The library's "× Clear all" (sort, filters, grouping, search) beside ours, which restores the defaults.
    await expect(page.getByRole('button', { name: '× Clear all' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Default view' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reset view' })).toHaveCount(0);
  }
});

test("L3 edge: the toolbar's buttons share one font and one height, the library's and ours", async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  const style = (name: string) =>
    page.getByRole('button', { name }).evaluate((el) => ({
      font: getComputedStyle(el).fontFamily,
      height: el.getBoundingClientRect().height,
    }));
  expect(await style('Default view')).toEqual(await style('× Clear all'));
});

test('L3 edge: the column menu undoes the group and filter it set', async ({ page }, testInfo) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  const menu = page.getByRole('button', { name: /^Weighted Rating options/ });
  const dialog = page.getByRole('dialog', { name: /^Weighted Rating options/ });

  // On a phone the button is past the table's edge. The scroll click() does to reach it can land
  // after the menu opens, and the table closes its menu on scroll: scroll first, here and below.
  await menu.scrollIntoViewIfNeeded();
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await menu.click();
  await dialog.getByRole('button', { name: 'Group by this column' }).click();
  // Grouping widens the table further.
  await menu.scrollIntoViewIfNeeded();
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await menu.click();
  await dialog.getByRole('button', { name: 'Remove group' }).click();
  await menu.click();
  await expect(dialog.getByRole('button', { name: 'Group by this column' })).toBeVisible();

  await dialog.getByRole('button', { name: 'Filter ▸' }).click();
  await dialog.getByRole('textbox', { name: 'Weighted Rating Min' }).fill('95');
  await expect(menu).toHaveAccessibleName('Weighted Rating options, filtered');
  // A phone opens the filter as its own page of the menu.
  if (testInfo.project.name === 'phone') await dialog.getByRole('button', { name: '‹ Weighted Rating' }).click();
  await dialog.getByRole('button', { name: 'Clear filter' }).click();
  await expect(menu).toHaveAccessibleName('Weighted Rating options');
});

test('L4 edge: Recently Looked Up lists the latest lookup first, and says it keeps 10', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  await expect(rows(page)).toHaveCount(6);
  // Portal 2 rates higher than Valheim, so a rating sort would put it first.
  for (const name of ['Portal 2', 'Valheim']) {
    await page.getByPlaceholder('Look up any game…').fill(name);
    await page.locator('.game-search-result', { hasText: name }).first().click();
    await expect(page.locator('#panel-title')).toHaveText(name);
    // A phone's panel covers the search. Closing steps history back over the panel's own entry,
    // asynchronously: a goto issued before that lands is aborted (net::ERR_ABORTED).
    const steppedBack = page.evaluate(() => new Promise((r) => addEventListener('popstate', r, { once: true })));
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await steppedBack;
  }
  await page.goto('/game');
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).first()).toContainText('Valheim');
  await expect(page.locator('.list-hero')).toContainText('last 10');
  // A number column whose cells read as text ("Latest") stays start-aligned.
  await expect(page.locator('.dt-td[data-col-key="lookedUp"]').first()).toHaveCSS('text-align', 'start');
});

test("R1 edge: a ranking card's HLTB time is the table's, rounded and labelled", async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  await expect(page.locator('thead th').filter({ hasText: /^HLTB \(h\)/ })).toHaveCount(1);
  await expect(row(page, 'Hades')).toContainText('44.5');
  for (const name of ['Portal 2', 'Hades']) await row(page, name).getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Rank 2 games' }).click();
  await expect(page.locator('.rank-route')).toContainText('44.5 h to beat');
});

test("R1 edge: the ranking's keyboard hints show only with a mouse", async ({ page }, testInfo) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  for (const name of ['Portal 2', 'Hades']) await row(page, name).getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Rank 2 games' }).click();
  await expect(page.locator('.rank-question')).toBeVisible();
  await expect(page.locator('.rank-hint')).toBeVisible({ visible: testInfo.project.name !== 'phone' });
});

test("R1 edge: the ranking's side panel offers similar owned games, with no list to sort", async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  for (const name of ['Portal 2', 'Hades']) await row(page, name).getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Rank 2 games' }).click();
  await page.getByRole('button', { name: 'Details', exact: true }).first().click();
  const similar = page.locator('#panel-section-similar');
  await expect(similar.locator('.panel-section-title')).toHaveText(/^Similar in Alice's library/);
  await expect(similar.locator('.panel-similar-item').first()).toBeVisible();
  await expect(similar.getByRole('button', { name: /Sort list by similarity/ })).toHaveCount(0);
});

test("R1 edge: the ranking's side panel shows tags as plain pills and its Refresh re-fetches", async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  for (const name of ['Portal 2', 'Hades']) await row(page, name).getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Rank 2 games' }).click();
  await page.getByRole('button', { name: 'Details', exact: true }).first().click();

  const panel = page.locator('.panel-tags');
  await expect(panel.locator('.panel-tag').first()).toBeVisible();
  await expect(panel.getByRole('button')).toHaveCount(0);

  // The refreshed game updates in place: no reopen, so no jump to the top or focus move to the hero.
  const body = page.locator('#panel-body');
  await body.evaluate((el) => (el.scrollTop = 120));
  const scrollTop = await body.evaluate((el) => el.scrollTop);
  expect(scrollTop).toBeGreaterThan(0);
  const refetch = page.waitForResponse((res) => /\/api\/game-details\/\d+\?refresh=1$/.test(res.url()));
  await page.getByRole('button', { name: 'Refresh details' }).click();
  await refetch;
  await expect(page.getByRole('button', { name: 'Refresh details' })).toBeEnabled();
  expect(await body.evaluate((el) => el.scrollTop)).toBe(scrollTop);
  expect(await page.evaluate(() => document.activeElement?.closest('#panel-hero') == null)).toBe(true);
});

test("R1 edge: a failed Refresh on the ranking's side panel says so", async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  for (const name of ['Portal 2', 'Hades']) await row(page, name).getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Rank 2 games' }).click();
  await page.getByRole('button', { name: 'Details', exact: true }).first().click();
  await page.route(/\/api\/game-details\/\d+\?refresh=1$/, (route) =>
    route.fulfill({ status: 502, json: { error: 'Steam did not answer' } }),
  );
  await page.getByRole('button', { name: 'Refresh details' }).click();
  await expect(page.locator('.rank-route .list-status')).toHaveText('Refresh failed: Steam did not answer');
});

test('I1 edge: on desktop the nav starts on the content edge, close above it', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'desktop app bar');
  await asPlayer(page, ALICE);
  for (const width of [1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/lists/owned');
    const nav = (await page.locator('.site-nav').boundingBox())!;
    const first = (await page.locator('.site-brand').boundingBox())!;
    const hero = (await page.locator('.list-hero').boundingBox())!;
    expect(Math.round(first.x), `at ${width}px`).toBe(Math.round(hero.x));
    expect(hero.y - (nav.y + nav.height), `at ${width}px`).toBeLessThanOrEqual(28);
  }
  // The search fills the middle on a wide screen, and gives way so the bar stays one row on a narrow one.
  await page.setViewportSize({ width: 1440, height: 900 });
  const search = page.locator('.app-search-wrap');
  expect((await search.boundingBox())!.width).toBe(
    await search.evaluate((el) => parseFloat(getComputedStyle(el).maxWidth)),
  );
  await page.setViewportSize({ width: 800, height: 900 });
  expect((await page.locator('.site-nav').boundingBox())!.height).toBeLessThan(60);
});

test('I1 edge: on a phone, the ranking shows both cards and its Tie/Skip/Undo without scrolling, inside a gutter, down to 320px wide', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'phone layout');
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  for (const name of ['Portal 2', 'Hades']) await row(page, name).getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Rank 2 games' }).click();
  await expect(page.locator('.rank-card-name').nth(1)).not.toHaveText(/^App /);

  const viewport = page.viewportSize()!;
  const actions = (await page.locator('.rank-actions').boundingBox())!;
  expect(actions.y + actions.height).toBeLessThanOrEqual(viewport.height);
  for (const box of [
    await page.locator('.rank-pair').boundingBox(),
    await page.locator('.rank-header').boundingBox(),
  ]) {
    expect(box!.x).toBeGreaterThanOrEqual(12);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width - 12);
  }

  // The narrowest phones: the cards' action buttons wrap rather than push the page sideways.
  await page.setViewportSize({ width: 320, height: viewport.height });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test("I1 edge: on a phone, Home keeps the list pages' 16px gutter and the account tiles inside the card", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'phone layout');
  await asPlayer(page, ALICE);
  await page.goto('/');
  await page.getByPlaceholder('Steam name, profile URL, or 64-bit ID…').fill('bob');
  await page.getByRole('button', { name: 'Look up', exact: true }).click();
  await expect(page.locator('.account-tiles li')).toHaveCount(2);

  const viewport = page.viewportSize()!;
  expect((await page.locator('.app-search-wrap').boundingBox())!.x).toBe(16);
  const card = (await page.locator('.home-account').boundingBox())!;
  expect(card.x).toBe(16);
  expect(card.x + card.width).toBe(viewport.width - 16);
  expect((await page.locator('.home-account h3').boundingBox())!.x).toBeLessThanOrEqual(29);

  for (const li of await page.locator('.account-tiles li').all()) {
    const box = (await li.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(card.x);
    expect(box.x + box.width).toBeLessThanOrEqual(card.x + card.width);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
  await expect(page.getByRole('button', { name: 'Star Bob as mine' })).toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Remove Bob' }).click();
  await expect(page.locator('.account-tiles li')).toHaveCount(1);
});

test("I1 edge: on a phone with no account yet, the nav's search, account and preferences share one row", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'phone layout');
  await page.goto('/about');
  await expect(page.locator('.site-nav-account')).toContainText('No account');
  const search = (await page.locator('.app-search-wrap').boundingBox())!;
  const prefs = (await page.locator('.site-nav-prefs').boundingBox())!;
  expect(prefs.y).toBeLessThan(search.y + search.height);
});

test('R1.1,3-6: rank chosen games, stop, resume on the same ones', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  for (const name of ['Portal 2', 'Terraria', 'Hades']) await row(page, name).getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Rank 3 games' }).click();

  await expect(page.getByText('Comparing 3 chosen games.')).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Escape');

  const resume = page.getByRole('button', { name: /^Continue: \d+ chosen left$/ });
  await expect(resume).toBeVisible();
  await resume.click();
  await expect(page.getByText('Comparing 3 chosen games.')).toBeVisible();
});

test("R1 edge: closing the ranking's side panel returns focus to its Details button", async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  for (const name of ['Portal 2', 'Hades']) await row(page, name).getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Rank 2 games' }).click();
  const details = page.getByRole('button', { name: 'Details', exact: true }).first();
  await details.click();
  await expect(page.locator('.game-panel')).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('.game-panel')).toBeHidden();
  await expect(details).toBeFocused();

  // Opened from the keyboard, with nothing focused: focus lands on the shown game's Details button.
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  await page.keyboard.press('i');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.game-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.game-panel')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Details', exact: true }).nth(1)).toBeFocused();
});

test('R1 edge: Esc closing a nav popover stays on the ranking', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  for (const name of ['Portal 2', 'Terraria', 'Hades']) await row(page, name).getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Rank 3 games' }).click();
  await expect(page.getByText('Comparing 3 chosen games.')).toBeVisible();

  await page.getByLabel('Preferences').click();
  await expect(page.locator('.site-nav-prefs-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.site-nav-prefs-panel')).toBeHidden();
  await expect(page.getByText('Comparing 3 chosen games.')).toBeVisible();
});

test("R3 edge: a ranked list's Share view says why it can't be shared", async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/wishlist');
  await page.getByRole('button', { name: /Rank this list/ }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: /^Ranking of/ })).toBeVisible();
  // Its /lists/<id> link only opens in this browser.
  const share = page.getByRole('button', { name: 'Share view' });
  await expect(share).toHaveAttribute('aria-disabled', 'true');
  await expect(share).toHaveCSS('opacity', '0.5');
  await expect(share).toHaveCSS('cursor', 'not-allowed');
  await expect(share).toHaveAccessibleDescription(/can't be shared/);
  // Said on press rather than beside it: an always-on note made the toolbar wrap on every saved list.
  const toolbarHeight = (await page.locator('.dt-toolbar').boundingBox())!.height;
  await expect(page.getByRole('status').filter({ hasText: "can't be shared" })).toHaveCount(0);
  // Playwright won't click an aria-disabled button; a key press is what a keyboard user does anyway.
  await share.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: "can't be shared" })).toBeVisible();
  expect((await page.locator('.dt-toolbar').boundingBox())!.height).toBe(toolbarHeight);
});

test("R2 edge: ranking games you don't own offers 'Not interested', not 'Haven't played'", async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/wishlist');
  await page.getByRole('button', { name: /Rank this list/ }).click();
  await expect(page.getByRole('button', { name: 'Not interested — exclude' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: "Haven't played — exclude" })).toHaveCount(0);
});

test('R2 edge: ranking a list again offers its rankings, or a new one by a criterion', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/wishlist');
  await page.getByRole('button', { name: /Rank this list/ }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Ranking of Alice — Wishlist' })).toBeVisible();

  await page.goto('/lists/wishlist');
  await page.getByRole('button', { name: /Rank this list/ }).click();
  const menu = page.locator('.rank-menu-panel');
  await expect(menu.getByRole('button', { name: /Ranking of Alice — Wishlist/ })).toBeVisible();
  await menu.getByRole('textbox', { name: 'What are you ranking by?' }).fill('co-op');
  await menu.getByRole('button', { name: 'New ranking' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Ranking of Alice — Wishlist (co-op)' })).toBeVisible();
});

test('R1 edge: a ranked list resumes with "Continue ranking", not the nav\'s Compare', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/wishlist');
  await page.getByRole('button', { name: /Rank this list/ }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Ranking of Alice — Wishlist' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue ranking' })).toBeVisible();
  await expect(page.getByRole('main').getByRole('button', { name: /^Compare/ })).toHaveCount(0);
});

test('R2 edge: a Wishlist ranking keeps its price columns', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/wishlist');
  await page.getByRole('button', { name: /Rank this list/ }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: /^Ranking of/ })).toBeVisible();
  await expect(page.locator('thead th').filter({ hasText: /^Best Deal/ })).toHaveCount(1);
  await expect(page.locator('.list-hero')).toContainText(/Prices/i);
});

test('B1.1,3-4: a bundle, then what it adds to my library', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/bundles');
  await page.getByRole('cell', { name: 'Test Co-op Pack' }).click();
  await expect(page.getByRole('heading', { name: 'Test Co-op Pack' })).toBeVisible();
  await expect(rows(page)).toHaveCount(4);
  // Alice owns two of the four: what the bundle adds, and at what price.
  await expect(page.locator('.list-hero')).toContainText(/New to you\s*2 of 4\s*≈ .+ at best deals/i);
  // A game with no Steam listing is listed apart, not dropped.
  await page.getByRole('button', { name: /1 more in this bundle, not on Steam/ }).click();
  await expect(page.getByText('Test Soundtrack')).toBeVisible();

  // The answer opens right away, unsaved; keeping it is one more click.
  await page.getByRole('link', { name: 'What does this add?' }).click();
  await expect(page).toHaveURL(/\/lists\/shared\?f=/);
  await expect(rows(page)).toHaveCount(2);
  await expect(row(page, 'Overcooked! 2')).toHaveCount(1);
  await expect(row(page, 'It Takes Two')).toHaveCount(1);
  await page.getByRole('button', { name: 'Save as a list' }).click();
  await expect(page.getByRole('heading', { name: 'Test Co-op Pack − Alice — Owned' })).toBeVisible();
  await expect(rows(page)).toHaveCount(2);
});

test("B1 edge: a bundle's hero keeps All bundles by its previous/next buttons, and one primary action among ghost ones", async ({
  page,
}) => {
  await asPlayer(page, ALICE);
  await page.goto(`/lists/bundle/${BUNDLE.id}`);
  await expect(rows(page)).toHaveCount(4);
  const titlebar = page.locator('.list-hero-titlebar');
  await expect(titlebar.getByRole('button', { name: 'Previous bundle' })).toBeVisible();
  await expect(titlebar.getByRole('link', { name: 'All bundles' })).toBeVisible();
  const more = page.getByRole('button', { name: 'More actions' }); // a phone folds the rest behind More actions
  if (await more.isVisible()) await more.click();
  const classes = await page
    .locator('.list-hero-actions')
    .locator(':is(a, button, summary):visible')
    .evaluateAll((els) => els.map((el) => el.className));
  expect(classes.filter((c) => /\bbtn-primary\b/.test(c))).toHaveLength(1);
  expect(classes.filter((c) => !/\bbtn\b/.test(c))).toEqual([]);
});

test("B1 edge: a bundle's All bundles link keeps the account being explored, without reloading", async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto(`/lists/bundle/${BUNDLE.id}?u=bob`);
  await expect(rows(page)).toHaveCount(4);
  await page.evaluate(() => ((window as unknown as { e2eSamePage: boolean }).e2eSamePage = true));
  await page.locator('.list-hero-titlebar').getByRole('link', { name: 'All bundles' }).click();
  await expect(page).toHaveURL(/\/bundles\?u=bob$/);
  expect(await page.evaluate(() => (window as unknown as { e2eSamePage?: boolean }).e2eSamePage)).toBe(true);
});

test("B3 edge: a list built from a bundle says how many of its games aren't on Steam", async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto(`/lists/bundle/${BUNDLE.id}`);
  await expect(rows(page)).toHaveCount(4);
  const more = page.getByRole('button', { name: 'More actions' }); // a phone folds it behind More actions
  if (await more.isVisible()) await more.click();
  await page.getByRole('link', { name: 'What does this add?' }).click();
  await expect(page.locator('.list-formula')).toContainText('1 not on Steam');
});

test("B3 edge: what a bundle adds keeps the bundle's prices and links back to it", async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto(`/lists/bundle/${BUNDLE.id}`);
  await expect(rows(page)).toHaveCount(4);
  const more = page.getByRole('button', { name: 'More actions' }); // a phone folds it behind More actions
  if (await more.isVisible()) await more.click();
  await page.getByRole('link', { name: 'What does this add?' }).click();
  await expect(rows(page)).toHaveCount(2);
  await expect(page.locator('thead th').filter({ hasText: /^Tier Price/ })).toHaveCount(1);
  await expect(page.locator('thead th').filter({ hasText: /^Best Deal/ })).toHaveCount(1);
  await expect(row(page, 'Overcooked! 2')).toContainText('12.00');
  await page.locator('.list-hero-actions').getByRole('link', { name: BUNDLE.title }).click();
  await expect(page).toHaveURL(new RegExp(`/lists/bundle/${BUNDLE.id}`));
  await expect(page.getByRole('heading', { name: BUNDLE.title })).toBeVisible();
});

const sharedUrl = (formula: string) => `/lists/shared?f=${encodeURIComponent(formula)}`;

const saveWhatBundleAdds = async (page: Page) => {
  // The mock only prices in EUR; answer a US request in USD, as ITAD does.
  await page.route(/\/api\/bundles\/\d+\?/, (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const { body } = respond(req.method(), url, req.postData());
    return route.fulfill({
      json: JSON.parse(url.searchParams.get('country') === 'US' ? body.replaceAll('"EUR"', '"USD"') : body),
    });
  });
  await page.goto(sharedUrl(`subtract:(b:${BUNDLE.id};o:${ALICE.steamid})`));
  await expect(rows(page)).toHaveCount(2);
  const more = page.getByRole('button', { name: 'More actions' }); // a phone folds Save behind More actions
  if (await more.isVisible()) await more.click();
  await page.getByRole('button', { name: 'Save as a list' }).click();
  await expect(page).toHaveURL(/\/lists\/(?!shared)/);
  await expect(row(page, 'Overcooked! 2')).toContainText('€12.00');
};

test("B3 edge: what a bundle adds, once saved, keeps the bundle's Tier Price, in a newly picked region too", async ({
  page,
}) => {
  await asPlayer(page, ALICE);
  await saveWhatBundleAdds(page);
  await expect(page.locator('thead th').filter({ hasText: /^Tier Price/ })).toHaveCount(1);
  await page.getByTitle('Preferences').click();
  await page.locator('#nav-region-select').selectOption({ label: 'United States (USD)' });
  await expect(row(page, 'Overcooked! 2')).toContainText('$12.00');
});

test("B3 edge: a region picked while a saved list's bundle is still loading prices its Tier Price there", async ({
  page,
}) => {
  await asPlayer(page, ALICE);
  await saveWhatBundleAdds(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(/\/api\/bundles\/\d+\?(?!.*country=US)/, async (route) => {
    await held;
    await route.fallback();
  });
  const asked = page.waitForRequest(/\/api\/bundles\/\d+\?/);
  await page.reload();
  await asked;
  await page.getByTitle('Preferences').click();
  await page.locator('#nav-region-select').selectOption({ label: 'United States (USD)' });
  release();
  await expect(row(page, 'Overcooked! 2')).toContainText('$12.00');
});

test("B3 edge: a ranking of a list with a bundle source only re-prices on a new region, it doesn't reload", async ({
  page,
}) => {
  await asPlayer(page, ALICE);
  await saveWhatBundleAdds(page);
  await page.getByRole('button', { name: /Rank this list/ }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: /^Ranking of/ })).toBeVisible();
  await expect(rows(page)).toHaveCount(2);
  const bundleAsks: string[] = [];
  page.on('request', (req) => {
    if (/\/api\/bundles\/\d+/.test(req.url())) bundleAsks.push(req.url());
  });
  await page.getByTitle('Preferences').click();
  const repriced = page.waitForResponse(/\/api\/prices\?country=US/);
  await page.locator('#nav-region-select').selectOption({ label: 'United States (USD)' });
  await repriced;
  expect(bundleAsks).toEqual([]);
});

test("B3 edge: a saved list whose bundle didn't answer only re-prices on a new region, it doesn't reload", async ({
  page,
}) => {
  await asPlayer(page, ALICE);
  await saveWhatBundleAdds(page);
  await page.route(/\/api\/bundles\/\d+\?/, (route) => route.fulfill({ status: 502, json: { error: 'Bad gateway' } }));
  await page.reload();
  await expect(rows(page)).toHaveCount(2); // from the bundle's last good load, with no Tier Price
  await expect(page.locator('thead th').filter({ hasText: /^Tier Price/ })).toHaveCount(0);
  const bundleAsks: string[] = [];
  page.on('request', (req) => {
    if (/\/api\/bundles\/\d+/.test(req.url())) bundleAsks.push(req.url());
  });
  await page.getByTitle('Preferences').click();
  const repriced = page.waitForResponse(/\/api\/prices\?country=US/);
  await page.locator('#nav-region-select').selectOption({ label: 'United States (USD)' });
  await repriced;
  expect(bundleAsks).toEqual([]);
});

test("B3 edge: a saved list from a pick-and-mix bundle claims no per-game rate it can't know", async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto(sharedUrl(`subtract:(b:90002;o:${BOB.steamid})`));
  await expect(row(page, 'Hades')).toContainText('Varies');
  const more = page.getByRole('button', { name: 'More actions' }); // a phone folds Save behind More actions
  if (await more.isVisible()) await more.click();
  await page.getByRole('button', { name: 'Save as a list' }).click();
  await expect(page).toHaveURL(/\/lists\/(?!shared)/);
  await expect(row(page, 'Hades')).toContainText('Varies');
  await expect(rows(page).filter({ hasText: '/game' })).toHaveCount(0);
});

test("B3 edge: what a bundle adds shows the bundle's prices in a newly picked region", async ({ page }) => {
  await asPlayer(page, ALICE);
  // The mock only prices in EUR; answer a US request in USD, as ITAD does.
  await page.route(/\/api\/bundles\/\d+\?/, (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const { body } = respond(req.method(), url, req.postData());
    return route.fulfill({
      json: JSON.parse(url.searchParams.get('country') === 'US' ? body.replaceAll('"EUR"', '"USD"') : body),
    });
  });
  await page.goto(sharedUrl(`subtract:(b:${BUNDLE.id};o:${ALICE.steamid})`));
  await expect(row(page, 'Overcooked! 2')).toContainText('€12.00');
  await page.getByTitle('Preferences').click();
  await page.locator('#nav-region-select').selectOption({ label: 'United States (USD)' });
  await expect(row(page, 'Overcooked! 2')).toContainText('$12.00');
});

test("B3 edge: a shared list left before its bundle answers doesn't link the next one to it", async ({ page }) => {
  await asPlayer(page, ALICE);
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(/\/api\/bundles\/\d+/, async (route) => {
    await held;
    await route.fallback();
  });
  await page.goto(sharedUrl(`subtract:(o:${ALICE.steamid};w:${ALICE.steamid})`));
  await expect(rows(page)).toHaveCount(6);
  const bundleAsked = page.waitForRequest(/\/api\/bundles\/\d+/);
  await page.evaluate(
    (url) => {
      history.pushState(null, '', url);
      dispatchEvent(new PopStateEvent('popstate'));
    },
    sharedUrl(`subtract:(b:${BUNDLE.id};o:${ALICE.steamid})`),
  );
  await bundleAsked;
  await page.goBack();
  await expect(rows(page)).toHaveCount(6);
  release();
  await page.waitForResponse(/\/api\/bundles\/\d+/);
  await page.waitForTimeout(200); // let the late answer land, if it would
  await expect(page.locator('.list-hero-actions').getByRole('link', { name: BUNDLE.title })).toHaveCount(0);
});

test('B3 edge: a list left with none of its bundle source has no Tier Price, but still links back', async ({
  page,
}) => {
  await asPlayer(page, ALICE);
  await page.goto(sharedUrl(`subtract:(o:${ALICE.steamid};b:${BUNDLE.id})`));
  await expect(rows(page)).toHaveCount(4);
  await expect(page.locator('thead th').filter({ hasText: /^Best Deal/ })).toHaveCount(1);
  await expect(page.locator('thead th').filter({ hasText: /^Tier Price/ })).toHaveCount(0);
  await expect(page.locator('.list-hero-actions').getByRole('link', { name: BUNDLE.title })).toBeVisible();
});

test("B3 edge: what a pick-and-mix bundle adds claims no per-game rate it can't know", async ({ page }) => {
  await asPlayer(page, ALICE);
  // Alice owns the package's lead game (Hollow Knight), so its mate is left on its own.
  await page.goto(sharedUrl(`subtract:(b:90002;o:${ALICE.steamid})`));
  await expect(rows(page)).toHaveCount(1);
  await expect(row(page, "Don't Starve Together")).not.toContainText('included');
  await expect(row(page, "Don't Starve Together")).toContainText('Varies');
  // Bob owns neither Hades nor Hollow Knight: no entry rate passed off as theirs.
  await page.goto(sharedUrl(`subtract:(b:90002;o:${BOB.steamid})`));
  await expect(row(page, 'Hades')).toContainText('Varies');
  await expect(rows(page).filter({ hasText: '/game' })).toHaveCount(0);
});

test("B3 edge: the link back to a bundle keeps the link's account", async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto(`${sharedUrl(`subtract:(b:${BUNDLE.id};o:${BOB.steamid})`)}&u=bob`);
  await expect(page.locator('.list-hero-actions').getByRole('link', { name: BUNDLE.title })).toHaveAttribute(
    'href',
    /[?&]u=bob/,
  );
});

test('B1 edge: a bundle game whose Steam lookup failed says so, rather than reading as not on Steam', async ({
  page,
}) => {
  await asPlayer(page, ALICE);
  await mockApi(page, { states: ['resolve-failed'] }); // registered last, so it answers first
  await page.goto(`/lists/bundle/${BUNDLE.id}`);
  await expect(rows(page)).toHaveCount(3);
  await expect(page.getByText("Steam didn't answer for 1 of this bundle's games")).toBeVisible();
  await expect(page.getByRole('button', { name: /1 more in this bundle, not on Steam/ })).toBeVisible();
});

test("B1 edge: on a phone, every game's name stays in view while the table scrolls sideways", async ({
  page,
}, testInfo) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/bundle/90002'); // owned, wishlisted and unowned games
  await expect(rows(page)).toHaveCount(5);
  if (testInfo.project.name !== 'phone') {
    // A desktop table has room for the figures: the name scrolls with them.
    await expect(row(page, 'Hades').locator('td', { hasText: 'Hades' }).first()).toHaveCSS('position', 'static');
    // Pinned or not, the name cell is unstriped like the rest of its row.
    const backgrounds = await page
      .locator('.dt-td.dt-pinned')
      .evaluateAll((cells) => cells.map((c) => getComputedStyle(c).backgroundColor));
    expect(new Set(backgrounds).size).toBe(1);
    return;
  }
  const wrap = page.locator('.dt-table-wrap');
  await wrap.evaluate((el) => (el.scrollLeft = 400));
  const wrapLeft = (await wrap.boundingBox())!.x;
  for (const name of ['Hades', "Don't Starve Together"]) {
    const cell = row(page, name).locator('td', { hasText: name }).first();
    expect(Math.round((await cell.boundingBox())!.x), name).toBe(Math.round(wrapLeft));
  }
});

test('B1 edge: figures line up: number columns align to the end, text to the start', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/bundle/90002');
  await expect(rows(page)).toHaveCount(5);
  for (const key of ['tierPrice', 'bestDealCut', 'steamdbRating'])
    await expect(page.locator(`.dt-td[data-col-key="${key}"]`).first()).toHaveCSS('text-align', 'end');
  await expect(page.locator('.dt-td[data-col-key="name"]').first()).not.toHaveCSS('text-align', 'end');
});

test('B1 edge: an expired bundle is dimmed as a whole row', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.route('**/api/bundles?*', (route) => {
    const req = route.request();
    const body = JSON.parse(respond(req.method(), new URL(req.url()), req.postData()).body);
    body.bundles[0].expiry = new Date(Date.now() - 86400_000).toISOString();
    return route.fulfill({ json: body });
  });
  await page.goto('/bundles');
  await expect(page.locator('.dt-tr.bundle-row--expired')).toHaveCount(1);
  await expect(page.locator('.dt-tr.bundle-row--expired')).toHaveCSS('opacity', '0.45');
});

test('B1 edge: a pick-and-mix bundle prices the selected games', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/bundles');
  await expect(page.getByRole('cell', { name: '1 for $2.00' })).toBeVisible();
  await page.getByRole('cell', { name: 'Test Build Your Own Bundle' }).click();
  await expect(rows(page)).toHaveCount(5);
  // USD-only on a EUR region, so each price carries its estimate, as in the bundle list.
  await expect(page.locator('.bundle-tier-chip')).toHaveText([/^1 for \$2\.00 \(≈ €[\d.]+\)$/, /^3 for \$3\.50 \(≈ €/]);
  await expect(row(page, 'Hades')).toContainText('$2.00/game');

  await row(page, 'Portal 2').getByRole('checkbox').check();
  await expect(page.locator('.selection-pick-total')).toHaveText(/^\$2\.00 \(≈ €[\d.]+\)$/);
  await expect(page.locator('.selection-pick-detail')).toHaveText('1 pick · 1-game tier');
  await expect(page.locator('.selection-pick-savings')).toHaveText(/^(saves .+|.+ more|same as best deals)$/);
  // Two picks cost less at the 3-game tier than bought one at a time.
  await row(page, 'Hades').getByRole('checkbox').check();
  await expect(page.locator('.selection-pick-total')).toHaveText(/^\$3\.50 \(≈ €/);
  await expect(page.locator('.selection-pick-detail')).toHaveText('2 picks · 3-game tier · 1 more free');
  await expect(page.locator('.bundle-tier-chip--active')).toHaveText(/^3 for \$3\.50/);
  await expect(row(page, 'Hades')).toContainText('$1.17/game');

  // A package's two rows are one pick, ticked and unticked together.
  const pack = rows(page).filter({ has: page.locator('.tier-package') });
  await expect(pack).toHaveText([/Hollow Knight/, /Don't Starve Together/]);
  await expect(pack.filter({ hasText: 'included' })).toHaveCount(1);
  await pack.nth(0).getByRole('checkbox').check();
  await expect(pack.nth(1).getByRole('checkbox')).toBeChecked();
  await expect(page.locator('.selection-pick-detail')).toHaveText('3 picks · 3-game tier');
  await shot(page, 'pick-and-mix-package-selected');

  // Buying carries the picks, by Fanatical's names, on ITAD's link.
  const buy = page.getByRole('link', { name: 'Buy 3 on Fanatical ↗' });
  const href = new URL((await buy.getAttribute('href')) ?? '');
  expect(href.origin + href.pathname).toBe('https://example.invalid/bundle');
  expect(JSON.parse(href.searchParams.get('scg') ?? '')).toEqual(['Portal 2', 'Hades', 'Test Survival Pack']);
  await expect(page.getByRole('link', { name: 'Add to Fanatical' })).toHaveAttribute('href', /^javascript:/);
  await row(page, 'Terraria').getByRole('checkbox').check();
  await expect(page.locator('.selection-fanatical-by-hand')).toHaveText('1 to pick by hand');
  await expect(page.getByRole('link', { name: 'Buy 4 on Fanatical ↗' })).toBeVisible();
  await row(page, 'Terraria').getByRole('checkbox').uncheck();

  await pack.nth(1).getByRole('checkbox').uncheck();
  await expect(pack.nth(0).getByRole('checkbox')).not.toBeChecked();

  // A game's panel gives the bundle's best rate rather than "Varies".
  await page.goto('/lists/owned?game=620');
  await expect(page.locator('.panel-bundle').filter({ hasText: 'Test Build Your Own Bundle' })).toContainText(
    /from \$1\.17\/game \(≈ €[\d.]+\)/,
  );
});

test('B1 edge: picking a region reloads Bundles in it', async ({ page }) => {
  await page.goto('/bundles');
  await expect(rows(page).first()).toBeVisible();
  const asked = page.waitForRequest(/\/api\/bundles\?.*country=US/);
  await page.getByLabel('Preferences').click();
  await page.locator('#nav-region-select').selectOption({ label: 'United States (USD)' });
  await asked;
});

test('F1 edge: the panel prices a game, and its bundles, in a newly picked region', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.route('**/api/prices?country=US', async (route) => {
    const req = route.request();
    const json = JSON.parse(respond(req.method(), new URL(req.url()), req.postData()).body);
    for (const info of Object.values<Record<string, { currency: string }>>(json.prices))
      for (const field of Object.values(info)) if (field && typeof field === 'object') field.currency = 'USD';
    await route.fulfill({ json });
  });
  await page.goto('/lists/owned?game=892970');
  const amount = page.locator('#game-panel .panel-price-amount');
  await expect(amount).toContainText('€');
  await page.keyboard.press('Escape');
  await expect(page.locator('#game-panel')).toBeHidden();

  await page.getByLabel('Preferences').click();
  await page.locator('#nav-region-select').selectOption({ label: 'United States (USD)' });
  await page.keyboard.press('Escape');
  const bundlesAsked = page.waitForRequest(/\/api\/game-bundles\/892970\?.*country=US/);
  await row(page, 'Valheim').getByText('Valheim').click();
  await expect(amount).toContainText('$');
  await bundlesAsked;
});

test("A2 edge: a cold link to someone's Owned list loads theirs once it resolves", async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned?u=bob');
  await expect(rows(page)).toHaveCount(BOB.owned.length);
});

test("B3 edge: a link's account, resolving after the bundle loaded, re-marks what it owns", async ({ page }) => {
  await asPlayer(page, ALICE);
  // Bob's resolve lands after the bundle has been marked with Alice's library.
  await page.route('**/api/common-games', async (route) => {
    if (route.request().postData()?.includes('bob')) await new Promise((resolve) => setTimeout(resolve, 800));
    await route.fallback();
  });
  await page.goto(`/lists/bundle/${BUNDLE.id}?u=bob&game=728880`);
  await expect(row(page, 'Overcooked! 2').locator('.name-status-badge.owned')).toBeVisible();
  await expect(row(page, 'Hades').locator('.name-status-badge.owned')).toHaveCount(0);
  await expect(page.locator('#game-panel .panel-ownership-badge.owned')).toBeVisible();
  await expect(page.getByRole('link', { name: 'What does this add?' })).toHaveAttribute(
    'href',
    new RegExp(BOB.steamid),
  );
});

test('B1 edge: with no ITAD key, Bundles says why it is empty', async ({ page }) => {
  await mockApi(page, { states: ['no-itad'] }); // registered last, so it answers first
  await asPlayer(page, ALICE);
  await page.goto('/bundles');
  await expect(page.getByRole('main')).toContainText("Bundles and prices aren't available on this instance");
  await expect(page.getByRole('main')).not.toContainText(/ITAD_API_KEY|Error:/);
});

test('O1 edge: with no ITAD key, Bundles is one card saying how to turn it on, not an empty table', async ({
  page,
}) => {
  await mockApi(page, { states: ['no-itad'] }); // registered last, so it answers first
  await asPlayer(page, ALICE);
  await page.goto('/bundles');
  const card = page.locator('.list-hero');
  await expect(card).toContainText('IsThereAnyDeal API key');
  await expect(card.locator('.list-stat')).toHaveCount(0);
  await expect(page.getByLabel('Include expired')).toHaveCount(0);
  await expect(page.locator('.table-container')).toHaveCount(0);
});

test('O1 edge: once the instance is known to have no ITAD key, Bundles opens on its card without asking ITAD', async ({
  page,
}) => {
  await mockApi(page, { states: ['no-itad'] }); // registered last, so it answers first
  await asPlayer(page, ALICE);
  await page.goto('/lists/wishlist');
  await expect(page.getByRole('main')).toContainText("Prices aren't available on this instance");
  await page.route('**/api/bundles?*', () => {}); // never answers: the card can't wait on its 503
  await page.getByRole('navigation', { name: 'Main', exact: true }).getByRole('link', { name: 'Bundles' }).click();
  await expect(page.locator('.list-hero')).toContainText('IsThereAnyDeal API key');
  await expect(page.getByLabel('Include expired')).toHaveCount(0);
  await expect(page.locator('.table-container')).toHaveCount(0);
});

test('B1 edge: stepping onto the last bundle keeps focus on › Next bundle, marked unavailable', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/bundles');
  await page.getByRole('cell', { name: BUNDLE.title }).click();
  const next = page.getByRole('button', { name: 'Next bundle' });
  await next.focus();
  await next.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/lists/bundle/${PICK_BUNDLE.id}(\\?|$)`));
  await expect(next).toHaveAttribute('aria-disabled', 'true');
  await expect(next).toBeFocused();
  await next.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/lists/bundle/${PICK_BUNDLE.id}(\\?|$)`));
});

test('B1 edge: a deep-linked bundle with no browsed list around it disables ‹/› outright', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto(`/lists/bundle/${BUNDLE.id}`);
  await expect(page.getByRole('heading', { level: 1, name: BUNDLE.title })).toBeVisible();
  // `disabled`, not just aria-disabled: no dead Tab stops.
  await expect(page.getByRole('button', { name: 'Previous bundle' })).toHaveJSProperty('disabled', true);
  await expect(page.getByRole('button', { name: 'Next bundle' })).toHaveJSProperty('disabled', true);
});

test("B1 edge: a failed ‹/› step doesn't pull focus back to it on a later load", async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.route(`**/api/bundles/${PICK_BUNDLE.id}*`, (route) =>
    route.fulfill({ status: 502, json: { error: 'ITAD is down' } }),
  );
  await page.goto('/bundles');
  await page.getByRole('cell', { name: BUNDLE.title }).click();
  const hero = page.getByRole('heading', { level: 1, name: BUNDLE.title });
  await expect(hero).toBeVisible();
  const next = page.getByRole('button', { name: 'Next bundle' });
  await next.focus();
  await next.press('Enter');
  await expect(page.getByRole('main')).toContainText('ITAD is down');
  await page.goBack();
  await expect(hero).toBeVisible();
  await expect(next).not.toBeFocused();
});

test('B1 edge: games ITAD lists under the first tier only show the tier range', async ({ page }) => {
  await mockApi(page, { states: ['untiered'] });
  await asPlayer(page, ALICE);
  await page.goto(`/lists/bundle/${BUNDLE.id}`);
  await expect(rows(page)).toHaveCount(4);
  // The pricier tier lists no games, so any of them may sit in it.
  const price = row(page, 'Overcooked! 2').getByTitle(/doesn't say which tier/);
  await expect(price).toHaveText('€5.00–€12.00');
  // The side panel's Price card says the same.
  await row(page, 'Overcooked! 2').getByText('Overcooked! 2').click();
  await expect(page.locator('#panel-body').getByTitle(/doesn't say which tier/)).toHaveText('€5.00–€12.00 tier');
});

test("B2 edge: another region's prices state their own age, not the previous region's", async ({ page }) => {
  await asPlayer(page, ALICE);
  const threeDaysAgo = Date.now() - 3 * 86400_000;
  await page.route(/\/api\/prices\?/, (route) => {
    const req = route.request();
    const { body } = respond(req.method(), new URL(req.url()), req.postData());
    return route.fulfill({ json: { ...JSON.parse(body), fetchedAt: threeDaysAgo } });
  });
  await page.goto('/lists/wishlist');
  const prices = page.locator('.list-stat', { hasText: 'Prices' });
  await expect(prices).toContainText('3 days ago');

  await page.unroute(/\/api\/prices\?/);
  await page.getByTitle('Preferences').click();
  await page.locator('#nav-region-select').selectOption({ label: 'United States (USD)' });
  await expect(prices).toContainText('United States');
  await expect(prices).toContainText('just now');
});

test("B2 edge: a long wishlist's Prices age is its stalest chunk's, whatever the order", async ({ page }) => {
  await asPlayer(page, ALICE);
  // 501 games: two price calls of up to 500, the first served from a 3-day-old cache, the second fresh.
  const items = Array.from({ length: 501 }, (_, i) => ({ appid: 900000 + i, priority: 0, dateAdded: '2026-01-01' }));
  await page.route(/\/api\/wishlist/, (route) => route.fulfill({ json: { items, players: [], fetchedAt: null } }));
  await page.route(/\/api\/game-details\/stream/, (route) =>
    route.fulfill({ contentType: 'text/event-stream', body: 'data: {"done":true}\n\n' }),
  );
  const ages = [Date.now() - 3 * 86400_000, null];
  await page.route(/\/api\/prices/, (route) =>
    route.fulfill({ json: { prices: {}, fetchedAt: ages.shift() ?? null } }),
  );
  let priceCalls = 0;
  const secondChunk = page.waitForResponse((res) => /\/api\/prices/.test(res.url()) && ++priceCalls === 2);
  await page.goto('/lists/wishlist');
  // Only the second chunk can get it wrong, so read the readout once it has landed, not before.
  await secondChunk;
  await page.evaluate(() => new Promise(requestAnimationFrame));
  expect(await page.locator('.list-stat', { hasText: 'Prices' }).textContent()).toContain('3 days ago');
});

test("B4 edge: a friend's empty wishlist says it may be private, where the table would be", async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/wishlist?u=carol'); // Carol has no wishlist in the fixtures
  const empty = page.getByText("Carol's wishlist is empty, or private on Steam.");
  await expect(empty).toBeVisible();
  await expect(page.locator('.dt-toolbar')).toBeHidden();
});

test('B2 edge: with no ITAD key, the Wishlist hides prices and says why', async ({ page }) => {
  await mockApi(page, { states: ['no-itad'] }); // registered last, so it answers first
  await asPlayer(page, ALICE);
  await page.goto('/lists/wishlist');
  await expect(rows(page)).toHaveCount(4);
  const unavailable = "Prices aren't available on this instance: it isn't connected to IsThereAnyDeal.";
  await expect(page.getByRole('main')).toContainText(unavailable);
  await expect(page.locator('thead th').filter({ hasText: /^Best Deal/ })).toHaveCount(0);
  await expect(page.locator('.list-stat-label').filter({ hasText: 'Prices' })).toHaveCount(0);
  await row(page, 'It Takes Two').getByText('It Takes Two').click();
  await expect(page.locator('#panel-section-price')).toContainText(unavailable);
  await expect(page.locator('.panel-bundles')).toHaveCount(0); // the line above already says why
});

test("B2 edge: a health check that didn't answer doesn't hide the Wishlist's prices", async ({ page }) => {
  await page.route('**/api/health', (route) => route.fulfill({ status: 502, json: { error: 'Bad gateway' } }));
  await asPlayer(page, ALICE);
  await page.goto('/lists/wishlist');
  await expect(rows(page)).toHaveCount(4);
  await expect(page.locator('thead th').filter({ hasText: /^Best Deal/ })).toHaveCount(1);
  await expect(page.getByRole('main')).not.toContainText("Prices aren't available on this instance");
});

test('D1 edge: the Updated tile keeps the rows and the selection while it refreshes', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  await expect(rows(page)).toHaveCount(6);
  await row(page, 'Portal 2').getByRole('checkbox').check();
  // Holds the library refresh, so the table can be checked mid-way.
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/common-games', async (route) => {
    await held;
    await route.fallback();
  });
  await page.getByRole('button', { name: /^Updated\b/ }).click();
  await expect(page.locator('.list-stat', { hasText: 'Updated' })).toContainText('Refreshing');
  await expect(rows(page)).toHaveCount(6);
  await expect(row(page, 'Hades')).toContainText('44.5'); // details still on screen
  release();
  await expect(page.locator('.list-stat', { hasText: 'Updated' })).not.toContainText('Refreshing');
  await expect(rows(page)).toHaveCount(6);
  await expect(row(page, 'Portal 2').getByRole('checkbox')).toBeChecked();
});

test('D1 edge: the Updated tile keeps focus while it refreshes', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  await expect(rows(page)).toHaveCount(6);
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/common-games', async (route) => {
    await held;
    await route.fallback();
  });
  const tile = page.getByRole('button', { name: /^Updated/ });
  await tile.click();
  await expect(tile).toContainText('Refreshing');
  await expect(tile).toBeFocused();
  release();
  await expect(tile).not.toContainText('Refreshing');
  await expect(tile).toBeFocused();
});

test('D1 edge: a failed Updated refresh leaves the tile there to try again', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/compare?u=alice&u=bob');
  await expect(groupRows(page)).toHaveCount(3);
  await page.route('**/api/common-games', (route) =>
    route.fulfill({ status: 502, json: { error: 'Steam request failed' } }),
  );
  const updated = page.locator('.list-stat', { hasText: 'Updated' });
  const updatedBtn = page.getByRole('button', { name: /^Updated\b/ });
  await updatedBtn.click();
  await expect(page.getByRole('main')).toContainText('Steam request failed');
  await expect(updated).not.toContainText('Refreshing');
  await expect(page.locator('.list-formula')).toBeVisible();

  await page.unroute('**/api/common-games');
  await updatedBtn.click();
  await expect(page.getByRole('main')).not.toContainText('Steam request failed');
});

test('D1 edge: an Owned list that failed to load still offers the Updated tile', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.route('**/api/common-games', (route) =>
    route.fulfill({ status: 502, json: { error: 'Steam request failed' } }),
  );
  await page.goto('/lists/owned');
  await expect(page.getByRole('main')).toContainText('Steam request failed');
  await page.unroute('**/api/common-games');
  await page.getByRole('button', { name: /^Updated\b/ }).click();
  await expect(rows(page)).toHaveCount(6);
});

test('D2.1-2: with upstreams down, every game is still listed', async ({ page }) => {
  await mockApi(page, { states: ['upstream-down'] });
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  await expect(rows(page)).toHaveCount(6);
  await expect(row(page, 'Hades')).toContainText('0.8'); // playtime comes from the library, not an upstream
  // A failed source is marked apart from "no data", and counted where the list says how it loaded.
  await expect(row(page, 'Hades').getByTitle(/HowLongToBeat didn't answer/)).toBeVisible();
  await expect(page.locator('.list-status')).toContainText(
    "Steam reviews, HowLongToBeat and ProtonDB didn't answer for 6 games",
  );
  await row(page, 'Hades').getByText('Hades').click();
  await expect(page.locator('.panel-glance-chip').filter({ hasText: 'HLTB' })).toContainText("didn't answer");
});

test("D2 edge: with ITAD down, the Wishlist's price cells and Price card say it didn't answer", async ({ page }) => {
  await mockApi(page, { states: ['upstream-down'] });
  await asPlayer(page, ALICE);
  await page.goto('/lists/wishlist');
  await expect(rows(page)).toHaveCount(4);
  await expect(row(page, 'Overcooked! 2').getByTitle(/IsThereAnyDeal didn't answer/)).not.toHaveCount(0);
  await row(page, 'Overcooked! 2').getByText('Overcooked! 2').click();
  const card = page.locator('#panel-section-price');
  await expect(card).toContainText("IsThereAnyDeal didn't answer");
  await expect(card).not.toContainText('No pricing data available');
});

test('D2 edge: failed prices warn like the other sources, in plain words', async ({ page }) => {
  await mockApi(page, { states: ['upstream-down'] });
  await asPlayer(page, ALICE);
  await page.goto('/lists/wishlist');
  await expect(rows(page)).toHaveCount(4);
  const status = page.locator('.price-status');
  await expect(status).toHaveText("IsThereAnyDeal didn't answer for prices — refresh them on the Prices tile");
  const warnColor = await page.locator('.list-status .list-failed').evaluate((el) => getComputedStyle(el).color);
  await expect(status).toHaveCSS('color', warnColor);
});

test('D2 edge: past its share of lookups, the list says so once, as do the Price and Achievements cards', async ({
  page,
}) => {
  await mockApi(page, { states: ['client-limited'] });
  await asPlayer(page, ALICE);
  await page.goto('/lists/wishlist');
  await expect(rows(page)).toHaveCount(4);
  const status = page.locator('.list-status');
  await expect(status.locator('.list-failed')).toHaveText(LIMITED);
  await expect(status).not.toContainText("didn't answer");
  await expect(page.locator('.price-status')).toHaveText(LIMITED);
  await expect(page.locator('.price-status')).toHaveClass(/list-failed/);
  await page.goto('/lists/owned?game=1145360');
  await expect(page.locator('#panel-section-price')).toContainText(LIMITED);
  await expect(page.locator('#panel-section-achievements')).toContainText(LIMITED);
});

test("D2.3: once the upstream is back, the panel's Refresh details fills in what didn't answer", async ({ page }) => {
  await mockApi(page, { states: ['upstream-down'] });
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  await row(page, 'Hades').getByText('Hades').click();
  const hltb = page.locator('.panel-glance-chip').filter({ hasText: 'HLTB' });
  await expect(hltb).toContainText("didn't answer");

  await mockApi(page); // the upstream is back: routes registered last take precedence
  await page.locator('.panel-refresh-btn').click();
  await expect(hltb).not.toContainText("didn't answer");
  await expect(row(page, 'Hades').getByTitle(/HowLongToBeat didn't answer/)).toHaveCount(0);
});

test('D2 edge: a failed Steam store page is marked, not shown as missing data', async ({ page }, testInfo) => {
  await mockApi(page, { states: ['store-down'] });
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  await expect(rows(page)).toHaveCount(6);
  await expect(page.locator('.list-status')).toContainText("Steam store didn't answer for 6 games");
  // The phone layout hides the store columns; the status line above still says it.
  if (testInfo.project.name === 'desktop')
    await expect(
      row(page, 'Hades')
        .getByTitle(/Steam store didn't answer/)
        .first(),
    ).toBeVisible();
});

test('D2 edge: a refused details stream marks every game failed, not loading forever', async ({ page }) => {
  await page.route('**/api/game-details/stream', (route) =>
    route.fulfill({ status: 429, json: { error: 'Too many requests. Please wait a minute and try again.' } }),
  );
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  await expect(rows(page)).toHaveCount(6);
  await expect(page.locator('.list-status')).toContainText('Too many requests');
  await expect(page.locator('.list-status')).toContainText("Steam store and Steam tags didn't answer for 6 games");
  await expect(page.locator('.list-status')).not.toContainText('/ 6 games loaded');
  await expect(row(page, 'Hades').getByTitle(/HowLongToBeat didn't answer/)).toBeVisible();
});

test('D2 edge: a details stream cut short marks the games it never sent failed', async ({ page }) => {
  await page.route('**/api/game-details/stream', (route) => {
    const req = route.request();
    const full = respond(req.method(), new URL(req.url()), req.postData());
    // The first two games' events only, and no `done`: the connection dropped.
    return route.fulfill({ ...full, body: full.body.split('\n\n').slice(0, 2).join('\n\n') + '\n\n' });
  });
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  await expect(rows(page)).toHaveCount(6);
  await expect(page.locator('.list-status')).toContainText("didn't answer for 4 games");
  await expect(page.locator('.list-status')).not.toContainText('/ 6 games loaded');
});

test("F1 edge: the Price card says when a game is in no bundle, and when ITAD didn't answer", async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned?game=892970');
  await expect(page.locator('.panel-bundles')).toHaveText('Not in any current bundle.');

  await mockApi(page, { states: ['upstream-down'] }); // registered last, so it answers first
  await page.goto('/lists/owned?game=1145360');
  await expect(page.locator('.panel-bundles')).toHaveText("Bundles: IsThereAnyDeal didn't answer.");
});

test("B1 edge: a bundle's Add-on and Base pills are outlined alike, a fact rather than a state", async ({ page }) => {
  await page.route(new RegExp(`/api/bundles/${BUNDLE.id}(\\?|$)`), (route) => {
    const req = route.request();
    const body = JSON.parse(respond(req.method(), new URL(req.url()), req.postData()).body);
    body.bundle.tiers.at(-1).addon = true;
    return route.fulfill({ json: body });
  });
  await asPlayer(page, ALICE);
  await page.goto(`/lists/bundle/${BUNDLE.id}`);
  await expect(rows(page)).toHaveCount(4);
  await page.getByRole('button', { name: 'Columns', exact: true }).click();
  await page
    .locator('.dt-dd')
    .getByRole('button', { name: /^Classification/ })
    .click();
  await page.locator('.dt-dd').getByRole('button', { name: 'Add-on' }).click();
  await page.keyboard.press('Escape');
  const pill = (name: string) => row(page, name).locator('.status-badge');
  await expect(pill('Overcooked! 2')).toHaveText('Add-on');
  await expect(pill('Portal 2')).toHaveText('Base');
  for (const name of ['Overcooked! 2', 'Portal 2']) {
    await expect(pill(name)).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(pill(name)).toHaveCSS('color', 'rgb(195, 204, 217)'); // --text-body
  }
});

test('F1 edge: a free demo shows as a neutral Demo pill and a Try the Free Demo button', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/wishlist');
  const pill = row(page, 'It Takes Two').locator('.status-badge');
  await expect(pill).toHaveText('Demo');
  await expect(pill).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)'); // outlined, not the accent
  await expect(row(page, 'Overcooked! 2').locator('.status-badge')).toHaveCount(0);
  await row(page, 'It Takes Two').getByText('It Takes Two').click();
  const demo = page.getByRole('link', { name: 'Try the Free Demo' });
  await expect(demo).toHaveAttribute('href', `https://store.steampowered.com/app/${DEMO_OF[1426210]}`);
  await expect(demo).not.toHaveClass(/btn-primary/);
});

test('F1 edge: the Price card names its ★ and 🔥 records in visible text, not only in a tooltip', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned?game=892970');
  await expect(page.locator('.panel-price-line')).toContainText(/★\s*1-year low/);
  await expect(page.locator('.panel-price-low')).toHaveText(/^all-time low €\d+\.\d\d 🔥$/);
});

test("F1 edge: the Achievements card says when Steam didn't answer for rarity", async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned?game=1145360');
  const card = page.locator('#panel-section-achievements');
  await card.getByRole('button', { name: /Achievements/ }).click();
  await expect(card).toContainText('71.5%');
  await expect(card).not.toContainText("Rarity: Steam didn't answer.");

  await mockApi(page, { states: ['upstream-down'] }); // registered last, so it answers first
  await page.reload();
  await card.getByRole('button', { name: /Achievements/ }).click();
  await expect(card).toContainText("Rarity: Steam didn't answer.");
});

test("F1 edge: the panel doesn't link an upstream URL that isn't http(s)", async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned?game=892970');
  const chip = page.locator('.panel-glance-chip', { hasText: 'Metacritic' });
  await expect(chip).toBeVisible();
  await expect(chip).not.toHaveAttribute('href', /.*/);
});

test("F1 edge: Tags & details names each chip's kind, and draws each kind's dot its own shape", async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned?game=620');
  const chips = page.locator('.panel-tags').getByRole('button');
  await expect(chips.first()).toBeVisible();
  for (const name of ['Co-op, tag', 'Co-op, category'])
    await expect(page.locator('.panel-tags').getByRole('button', { name, exact: true })).toBeVisible();
  const names = await chips.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
  expect(new Set(names).size).toBe(names.length);
  const shapes = await page.locator('.panel-tag-legend .panel-tag-dot').evaluateAll((dots) =>
    dots.map((d) => {
      const s = getComputedStyle(d);
      return `${s.borderRadius} ${s.rotate} ${s.clipPath}`;
    }),
  );
  expect(shapes.length).toBeGreaterThanOrEqual(3);
  expect(new Set(shapes).size).toBe(shapes.length);
  const colours = await page
    .locator('.panel-tag-legend .panel-tag-dot')
    .evaluateAll((dots) => dots.map((d) => getComputedStyle(d).backgroundColor));
  expect(colours).not.toContain('rgba(0, 0, 0, 0)');
  expect(new Set(colours).size).toBe(colours.length);
});

// A failed health check stops the panel before its price lookup, so each failure gets its own run.
for (const failing of ['health', 'prices']) {
  test(`F1 edge: the Price card says when ITAD didn't answer its ${failing} call, and the panel's Refresh details retries it`, async ({
    page,
  }) => {
    let down = true;
    await page.route(new RegExp(`/api/${failing}(\\?|$)`), (route) =>
      down ? route.fulfill({ status: 502, json: { error: 'IsThereAnyDeal request failed' } }) : route.fallback(),
    );
    await asPlayer(page, ALICE);
    await page.goto('/lists/owned?game=1145360');
    const card = page.locator('#panel-section-price');
    await expect(card).toContainText("IsThereAnyDeal didn't answer");
    await expect(card).not.toContainText('No pricing data available');

    down = false;
    await page.getByRole('button', { name: 'Refresh details' }).click();
    await expect(card).toContainText('Buy at Test Shop');
  });
}

test("F1 edge: a DLC's capsule that fails to load hides, keeping its box", async ({ page }) => {
  await page.route('**/900001/capsule_231x87.jpg', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="231" height="87"/>',
    }),
  );
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned?game=1145360');
  const card = page.locator('#panel-section-dlc');
  await card.getByRole('button', { name: /DLC · 25 available/ }).click();
  const capsule = (name: string) =>
    card.locator('.panel-dlc-item', { hasText: new RegExp(`^${name}$`) }).locator('img');
  await expect(capsule('Expansion 1')).toHaveCSS('visibility', 'visible');
  await expect(capsule('Expansion 2')).toHaveCSS('visibility', 'hidden');
  expect(await capsule('Expansion 2').boundingBox()).toMatchObject({ width: 80, height: 30 });
});

test("F1 edge: a loading video's ▶ stays put while the hero shimmers", async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned?game=1145360');
  await expect(page.locator('#panel-title')).toHaveText('Hades');
  // The hero as it stands while a trailer's poster loads.
  const pseudo = await page.locator('#panel-hero .panel-hero-main').evaluate((el) => {
    el.classList.add('is-video', 'panel-hero-main--loading');
    const style = (which: string) => {
      const s = getComputedStyle(el, which);
      return { content: s.content, animation: s.animationName };
    };
    return { before: style('::before'), after: style('::after') };
  });
  expect(pseudo.before).toEqual({ content: '"▶"', animation: 'none' });
  expect(pseudo.after.animation).toBe('shimmer');
});

test('F1 edge: DLC entries streamed in stay put, not redrawn, once the rest arrive', async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/game-meta/900020', async (route) => {
    await held;
    await route.fallback();
  });
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned?game=1145360');
  const card = page.locator('#panel-section-dlc');
  await card.getByRole('button', { name: /DLC · 25 available/ }).click();
  await expect(card.getByText('Loading 1 more…')).toBeVisible();
  const order = () => card.locator('.panel-dlc-name').allTextContents();
  const before = await order();
  await card.locator('.panel-dlc-item').evaluateAll((items) => items.forEach((el) => el.setAttribute('data-seen', '')));
  release();
  await expect(card.getByText('Loading 1 more…')).toHaveCount(0);
  await expect(card.locator('.panel-dlc-item')).toHaveCount(20);
  // Every entry already on screen is the same element, in the same order: no remount, no reload of its capsule.
  await expect(card.locator('.panel-dlc-item[data-seen]')).toHaveCount(19);
  expect((await order()).filter((name) => before.includes(name))).toEqual(before);
});

test('F1 edge: the DLC card lists 20 entries from store metadata, then more on request', async ({ page }) => {
  const requested: string[] = [];
  page.on('request', (req) => {
    if (/\/api\/game-(details|meta)\/9000\d\d/.test(req.url())) requested.push(new URL(req.url()).pathname);
  });
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned?game=1145360');
  const card = page.locator('#panel-section-dlc');
  await card.getByRole('button', { name: /DLC · 25 available/ }).click();
  await expect(card.locator('.panel-dlc-item')).toHaveCount(20);
  expect(requested.every((p) => p.startsWith('/api/game-meta/'))).toBe(true);
  expect(requested).toHaveLength(20);

  await card.getByRole('button', { name: 'Show 5 more' }).click();
  await expect(card.locator('.panel-dlc-item')).toHaveCount(25);
  await expect(card.getByRole('button', { name: /Show \d+ more/ })).toHaveCount(0);
  expect(requested).toHaveLength(25);
});

test('F1 edge: the panel section nav highlights the section it jumped to', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  await row(page, 'Hades').getByText('Hades').click();
  await expect(page.locator('#panel-title')).toHaveText('Hades');
  const nav = page.locator('.panel-subnav');
  await nav.getByRole('button', { name: 'Achievements' }).click();
  await expect(nav.getByRole('button', { name: 'Achievements' })).toHaveClass(/active/);
  await expect(nav.getByRole('button', { name: 'Overview' })).not.toHaveClass(/active/);
});

test("F1 edge: on a narrow phone, the panel's tabs stay one row and scroll to the current one", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'phone layout');
  await page.setViewportSize({ width: 320, height: 844 });
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned?game=1145360');
  const list = page.locator('.panel-subnav-list');
  const last = list.getByRole('button', { name: 'DLC' });
  await expect(last).toBeAttached();
  const tops = await list.locator('li').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().top));
  expect(new Set(tops).size).toBe(1);

  await page.locator('#panel-body').evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await expect(last).toHaveClass(/active/);
  await expect
    .poll(() =>
      last.evaluate((el) => {
        const [b, l] = [el.getBoundingClientRect(), el.closest('ul')!.getBoundingClientRect()];
        return b.left >= l.left && b.right <= l.right + 1;
      }),
    )
    .toBe(true);
});

test('F1 edge: the panel closes from its Close button after scrolling it', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  await row(page, 'Hades').getByText('Hades').click();
  await expect(page.locator('#panel-title')).toHaveText('Hades');
  await page.locator('#panel-body').evaluate((el) => el.scrollTo(0, 400));
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('#game-panel')).toBeHidden();
});

test('F1 edge: fullscreen media turns a phone to landscape, and keeps it there', async ({ page }) => {
  // Desktop browsers reject the lock, so record the calls instead.
  await page.addInitScript(() => {
    const w = window as Window & { locks?: string[] };
    w.locks = [];
    screen.orientation.lock = async (type: string) => void w.locks!.push(type);
  });
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  await row(page, 'Hades').getByText('Hades').click();
  await page.getByRole('button', { name: 'Open in lightbox' }).click();
  await page.getByRole('button', { name: 'Enter fullscreen' }).click();
  const locks = () => page.evaluate(() => (window as Window & { locks?: string[] }).locks);
  await expect.poll(locks).toEqual(['landscape']);

  // Firefox for Android drops the lock when a trailer stops; the orientation change re-locks it.
  await page.evaluate(() => screen.orientation.dispatchEvent(new Event('change')));
  await expect.poll(locks).toEqual(['landscape', 'landscape']);
});

test('F1 edge: on a phone, a double-tap zooms a screenshot and another zooms back out', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'touch only');
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned?game=1145360&shot=s1');
  const img = page.locator('#screenshot-lightbox .lb-img');
  await expect(img).toBeVisible();
  const box = (await img.boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const doubleTap = async () => {
    for (let i = 0; i < 2; i++) {
      const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }
  };
  await doubleTap();
  await expect(img).toHaveAttribute('style', /scale\(2\)/);
  await doubleTap();
  await expect(img).not.toHaveAttribute('style', /scale/);
});

// The fixture trailer has no stream: play()/pause() only flip `paused` and fire their events.
async function fakePlayback(page: Page) {
  await page.addInitScript(() => {
    const playing = new WeakSet<HTMLMediaElement>();
    Object.defineProperty(HTMLMediaElement.prototype, 'paused', {
      get(this: HTMLMediaElement) {
        return !playing.has(this);
      },
    });
    HTMLMediaElement.prototype.play = async function (this: HTMLMediaElement) {
      playing.add(this);
      this.dispatchEvent(new Event('play'));
    };
    HTMLMediaElement.prototype.pause = function (this: HTMLMediaElement) {
      if (!playing.delete(this)) return;
      queueMicrotask(() => this.dispatchEvent(new Event('pause'))); // queued, as a real pause event is
    };
  });
}

test('F1 edge: stepping games in the lightbox on Recently Looked Up shows the game stepped to', async ({ page }) => {
  await asPlayer(page, ALICE, { recentGames: [620, 1145360, 892970] });
  await page.goto('/game/1145360?shot=s1');
  await expect(page.locator('.lb-caption-text')).toHaveText('Hades');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.lb-caption-text')).toHaveText('Valheim');
  await expect(page.locator('#panel-title')).toHaveText('Valheim');
  await expect(page).toHaveURL(/\/game\/892970\?shot=banner$/);
  await expect(page.locator('#screenshot-lightbox')).toContainText('Game 3 of 3');
  expect(
    await page.evaluate(() => document.getElementById('screenshot-lightbox')!.contains(document.activeElement)),
  ).toBe(true);
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('.lb-caption-text')).toHaveText('Portal 2');
});

for (const [route, next] of [
  ['/lists/owned?game=1145360', { name: 'Terraria', url: /\/lists\/owned\?game=105600$/ }],
  ['/game/1145360', { name: 'Valheim', url: /\/game\/892970$/ }],
] as const) {
  test(`F1 edge: closing the lightbox after stepping games keeps the game stepped to (${route.split('/')[1]})`, async ({
    page,
  }) => {
    await asPlayer(page, ALICE, { recentGames: [620, 1145360, 892970] });
    await page.goto(route);
    for (const close of ['button', 'back'] as const) {
      await page.getByRole('button', { name: 'Open in lightbox' }).click();
      await page.keyboard.press(close === 'button' ? 'ArrowDown' : 'ArrowUp');
      await expect(page.locator('#panel-title')).toHaveText(close === 'button' ? next.name : 'Hades');
      if (close === 'button') await page.getByRole('button', { name: 'Close lightbox' }).click();
      else await page.goBack();
      await expect(page.locator('#screenshot-lightbox')).not.toHaveClass(/\bopen\b/);
      await expect(page.locator('#panel-title')).toHaveText(close === 'button' ? next.name : 'Hades');
      if (close === 'button') await expect(page).toHaveURL(next.url);
      else await expect(page).toHaveURL(new RegExp(`${route.replace('?', '\\?')}$`));
    }
  });
}

test('F1 edge: closing the lightbox leaves the panel on the last item looked at', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned?game=1145360');
  await page.getByRole('button', { name: 'Open in lightbox' }).click();
  await page.getByRole('button', { name: 'Next screenshot' }).click();
  await page.getByRole('button', { name: 'Next screenshot' }).click();
  await expect(page.locator('.lb-counter')).toHaveText('Screenshot 1 of 3');
  await page.getByRole('button', { name: 'Close lightbox' }).click();
  await expect(page.locator('.panel-film-item[aria-current="true"]')).toHaveAccessibleName('Screenshot 1 of 3');
});

test("F1 edge: the panel's thumbnails are named as the lightbox counts them", async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned?game=1145360');
  const names = () => page.locator('.panel-film-item').evaluateAll((items) => items.map((e) => e.ariaLabel));
  await expect
    .poll(names)
    .toEqual(['Cover', 'Trailer 1 of 1', 'Screenshot 1 of 3', 'Screenshot 2 of 3', 'Screenshot 3 of 3']);
});

test("F1 edge: the panel's hero never shows the previous item while the next one loads", async ({ page }) => {
  await mockApi(page, { states: ['slow-media'] });
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned?game=1145360');
  const main = page.locator('#panel-hero .panel-hero-main');
  const img = main.locator('.panel-hero-img');
  await expect(img).not.toHaveClass(/loading/); // the cover, loaded
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  // Screenshot 1's full image is on its way: the cover/trailer is hidden, its thumbnail stands in.
  await expect(img).toHaveAttribute('src', /Screenshot%201\.svg\?full/);
  await expect(img).toHaveClass(/loading/);
  await expect(img).toHaveCSS('opacity', '0');
  await expect(main).toHaveAttribute('style', /Screenshot%201\.svg\?thumb/);
  await expect(img).not.toHaveClass(/loading/);

  // Another game: its title doesn't sit over this game's picture.
  await page.getByRole('button', { name: 'Next game' }).click();
  await expect(page.locator('#panel-title')).not.toHaveText('Hades');
  await expect(img).toHaveCSS('opacity', '0');
  await expect(img).not.toHaveClass(/loading/);
  await expect(img).toHaveCSS('opacity', '1');
});

test('F1 edge: a slow screenshot shows its thumbnail and a spinner until it has loaded', async ({ page }) => {
  await mockApi(page, { states: ['slow-media'] });
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned?game=1145360');
  // The panel's filmstrip has the thumbnails by the time the full image is asked for.
  await expect
    .poll(() =>
      page.locator('.panel-film-thumb').evaluateAll((imgs) => imgs.every((i) => (i as HTMLImageElement).complete)),
    )
    .toBe(true);
  await page.getByRole('button', { name: 'Open in lightbox' }).click();
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  const lb = page.locator('#screenshot-lightbox');
  const img = lb.locator('.lb-img');
  await expect(lb.locator('.lb-counter')).toHaveText('Screenshot 1 of 3');
  await expect(lb).toHaveClass(/lb--loading/);
  await expect(img).toHaveAttribute('src', /Screenshot%201\.svg\?thumb/);
  await expect(img).toHaveAttribute('src', /Screenshot%201\.svg\?full/);
  await expect(lb).not.toHaveClass(/lb--loading/);
});

test("F1 edge: a lightbox Retry that lands after a step doesn't paint over the shot stepped to", async ({ page }) => {
  await mockApi(page, { states: ['slow-media'] });
  // Screenshot 1's full image fails; its retry answers only after the viewer has moved on.
  let retried!: () => void;
  const retryDone = new Promise<void>((resolve) => (retried = resolve));
  await page.route(/Screenshot%201\.svg\?full/, async (route) => {
    if (!route.request().url().includes('_retry=')) return route.abort();
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"/>' });
    retried();
  });
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned?game=1145360&shot=s1');
  const lb = page.locator('#screenshot-lightbox');
  const img = lb.locator('.lb-img');
  await page.getByRole('button', { name: 'Retry' }).click();
  await page.getByRole('button', { name: 'Next screenshot' }).click();
  await expect(lb.locator('.lb-counter')).toHaveText('Screenshot 2 of 3');
  await expect(img).toHaveAttribute('src', /Screenshot%202\.svg\?full/);
  await retryDone;
  await page.waitForTimeout(300); // the stale onload's turn
  await expect(img).toHaveAttribute('src', /Screenshot%202\.svg\?full/);
});

test('F1 edge: a screenshot zooms from a visible button, or Z', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned?game=1145360&shot=s1');
  const zoom = page.getByRole('button', { name: 'Zoom', exact: true });
  const img = page.locator('#screenshot-lightbox .lb-img');
  await zoom.click();
  await expect(zoom).toHaveAttribute('aria-pressed', 'true');
  await expect(img).toHaveAttribute('style', /scale\(2\)/);
  await page.keyboard.press('z');
  await expect(zoom).toHaveAttribute('aria-pressed', 'false');
  await expect(img).not.toHaveAttribute('style', /scale/);
  // Nothing to zoom on a trailer.
  await page.getByRole('button', { name: 'Previous screenshot' }).click();
  await expect(zoom).toBeHidden();
});

test('F1 edge: stepping media leaves hidden controls hidden, flashing only the counter', async ({ page }) => {
  await page.clock.install();
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned?game=1145360&shot=s1');
  const lb = page.locator('#screenshot-lightbox');
  await page.clock.runFor(3500);
  await expect(lb).toHaveClass(/lb-idle/);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.lb-counter')).toHaveText('Screenshot 2 of 3');
  // Read once: a retrying assertion would just wait out the idle timer (the clock keeps running).
  expect(await lb.getAttribute('class')).toMatch(/lb-idle/);
  await expect(page.locator('.lb-counter')).toHaveCSS('opacity', '1');
  await page.clock.runFor(2000);
  await expect(page.locator('.lb-counter')).toHaveCSS('opacity', '0');
  // Tab brings the chrome back, so the focused control is never invisible.
  await page.keyboard.press('Tab');
  await expect(lb).not.toHaveClass(/lb-idle/);
});

test('F1 edge: after ↓ finds no game to step to, → still slides the next screenshot in sideways', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/wishlist?game=1145360&shot=s1'); // Hades: not on the wishlist, so no game to step to
  await expect(page.locator('.lb-counter')).toHaveText('Screenshot 1 of 3');
  await page.locator('#screenshot-lightbox .lb-img').evaluate((img) => {
    const w = window as unknown as { lbAnims: string[] };
    w.lbAnims = [];
    new MutationObserver(() => w.lbAnims.push(img.className)).observe(img, { attributeFilter: ['class'] });
  });
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.lb-counter')).toHaveText('Screenshot 2 of 3');
  const anims = await page.evaluate(() => (window as unknown as { lbAnims: string[] }).lbAnims);
  expect(anims).toContain('lb-img lb-anim-right');
});

test('F1 edge: stepping back to a game just left in the lightbox lands where it was left', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned?game=1145360&shot=s1');
  await expect(page.locator('.lb-counter')).toHaveText('Screenshot 1 of 3');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.lb-counter')).toHaveText('Screenshot 2 of 3');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.lb-caption-text')).not.toHaveText('Hades');
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('.lb-caption-text')).toHaveText('Hades');
  await expect(page.locator('.lb-counter')).toHaveText('Screenshot 2 of 3');
});

// Terraria (Hades' ↓ neighbour on /lists/owned) loads without its store metadata, so only its
// banner; Refresh details refetches it, with its media whenever `withMedia()` says so.
async function terrariaMediaOnRefresh(page: Page, withMedia: () => boolean) {
  await page.route('**/api/game-details/stream', (route) => {
    const req = route.request();
    const full = respond(req.method(), new URL(req.url()), req.postData());
    const body = full.body
      .split('\n\n')
      .map((line: string) => {
        if (!line.startsWith('data: ')) return line;
        const event = JSON.parse(line.slice(6));
        return event.appid === 105600 ? `data: ${JSON.stringify({ ...event, meta: null })}` : line;
      })
      .join('\n\n');
    return route.fulfill({ ...full, body });
  });
  await page.route('**/api/game-details/105600?refresh=1', (route) => {
    const req = route.request();
    const full = respond(req.method(), new URL(req.url()), req.postData());
    return route.fulfill(
      withMedia() ? full : { ...full, body: JSON.stringify({ ...JSON.parse(full.body), meta: null }) },
    );
  });
}

// The panel's Refresh details sits behind the lightbox; clicked there, it refreshes the game the lightbox shows.
const refreshBehindLightbox = (page: Page) =>
  page.locator('.panel-refresh-btn').evaluate((b: HTMLElement) => b.click());

test("F1 edge: a banner shown while a game's media streams isn't where paging back to it lands", async ({ page }) => {
  let media = false;
  await asPlayer(page, ALICE);
  await terrariaMediaOnRefresh(page, () => media);
  await page.goto('/lists/owned?game=1145360&shot=s1');
  const counter = page.locator('.lb-counter');
  const name = page.locator('.lb-caption-text');
  await expect(counter).toHaveText('Screenshot 1 of 3');
  await page.keyboard.press('ArrowRight');
  await expect(counter).toHaveText('Screenshot 2 of 3');
  await page.keyboard.press('ArrowDown');
  await expect(name).toHaveText('Terraria');
  await expect(counter).toHaveText('Cover');
  await page.keyboard.press('ArrowRight'); // nothing else to step to yet
  await page.keyboard.press('ArrowDown');
  await expect(name).not.toHaveText('Terraria');
  await page.keyboard.press('ArrowUp');
  await expect(name).toHaveText('Terraria');
  media = true;
  await refreshBehindLightbox(page);
  await expect(counter).toHaveText('Screenshot 1 of 2');
});

test('F1 edge: paging back to a game whose media is still loading lands where it was left once it loads', async ({
  page,
}) => {
  let media = false;
  await asPlayer(page, ALICE);
  await terrariaMediaOnRefresh(page, () => media);
  await page.goto('/lists/owned?game=1145360&shot=s1');
  const counter = page.locator('.lb-counter');
  const name = page.locator('.lb-caption-text');
  await expect(counter).toHaveText('Screenshot 1 of 3');
  await page.keyboard.press('ArrowDown');
  await expect(name).toHaveText('Terraria');
  media = true;
  await refreshBehindLightbox(page);
  await expect(counter).toHaveText('Screenshot 1 of 2');
  await page.keyboard.press('ArrowRight');
  await expect(counter).toHaveText('Screenshot 2 of 2');
  await page.keyboard.press('ArrowDown');
  await expect(name).not.toHaveText('Terraria');
  await page.keyboard.press('ArrowUp');
  await expect(counter).toHaveText('Screenshot 2 of 2');
  // Its media goes away (a refresh the store didn't answer), then comes back.
  media = false;
  await refreshBehindLightbox(page);
  await expect(counter).toHaveText('Cover');
  await page.keyboard.press('ArrowDown');
  await expect(name).not.toHaveText('Terraria');
  await page.keyboard.press('ArrowUp');
  await expect(name).toHaveText('Terraria');
  media = true;
  await refreshBehindLightbox(page);
  await expect(counter).toHaveText('Screenshot 2 of 2');
});

test('F1 edge: paging back to a game only passed through lands on the kind being left', async ({ page }) => {
  // Hollow Knight (screenshots), Hades, Terraria (a trailer).
  await asPlayer(page, ALICE, { recentGames: [367520, 1145360, 105600] });
  await page.goto('/game/367520?shot=s1');
  const counter = page.locator('.lb-counter');
  const name = page.locator('.lb-caption-text');
  await expect(page.locator('.lb-caption-pos')).toHaveText('Game 1 of 3');
  await page.keyboard.press('ArrowDown');
  await expect(name).toHaveText('Hades');
  await expect(counter).toHaveText('Screenshot 1 of 3');
  await page.keyboard.press('ArrowDown');
  await expect(name).toHaveText('Terraria');
  await expect(counter).toHaveText('Screenshot 1 of 2');
  await page.keyboard.press('ArrowLeft');
  await expect(counter).toHaveText('Trailer 1 of 1');
  await page.keyboard.press('ArrowUp');
  await expect(name).toHaveText('Hades');
  await expect(counter).toHaveText('Trailer 1 of 1');
});

test('F1 edge: paging games from the Cover keeps showing covers', async ({ page }) => {
  let media = false;
  await asPlayer(page, ALICE, { recentGames: [1145360, 105600, 367520] });
  await page.goto('/game/1145360?shot=banner');
  const counter = page.locator('.lb-counter');
  const name = page.locator('.lb-caption-text');
  await expect(page.locator('.lb-caption-pos')).toHaveText('Game 1 of 3');
  await expect(counter).toHaveText('Cover');
  for (const next of ['Terraria', 'Hollow Knight']) {
    await page.keyboard.press('ArrowDown');
    await expect(name).toHaveText(next);
    await expect(counter).toHaveText('Cover');
  }
  // Onto a game whose media is still loading: its media arriving doesn't move off the Cover.
  await terrariaMediaOnRefresh(page, () => media);
  await page.goto('/lists/owned?game=1145360&shot=banner');
  await expect(counter).toHaveText('Cover');
  await page.keyboard.press('ArrowDown');
  await expect(name).toHaveText('Terraria');
  media = true;
  await refreshBehindLightbox(page);
  await expect(page.locator('#screenshot-lightbox .lb-next')).toBeEnabled();
  await expect(counter).toHaveText('Cover');
});

test('F1 edge: stepping past the last media or game slides back in from the other side', async ({ page }) => {
  await asPlayer(page, ALICE, { recentGames: [620, 1145360, 892970] });
  await page.goto('/game/1145360?shot=s1');
  await expect(page.locator('.lb-caption-pos')).toHaveText('Game 2 of 3');
  await page.keyboard.press('End');
  await expect(page.locator('.lb-counter')).toHaveText('Screenshot 3 of 3');
  const anims = async (step: () => Promise<void>) => {
    await page.locator('#screenshot-lightbox .lb-img').evaluate((img) => {
      const w = window as unknown as { lbAnims: string[] };
      w.lbAnims = [];
      new MutationObserver(() => w.lbAnims.push(img.className)).observe(img, { attributeFilter: ['class'] });
    });
    await step();
    return page.evaluate(() => (window as unknown as { lbAnims: string[] }).lbAnims);
  };
  expect(
    await anims(async () => {
      await page.keyboard.press('ArrowRight');
      await expect(page.locator('.lb-counter')).toHaveText('Cover');
    }),
  ).toContain('lb-img lb-anim-left');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.lb-caption-pos')).toHaveText('Game 3 of 3');
  expect(
    await anims(async () => {
      await page.keyboard.press('ArrowDown');
      await expect(page.locator('.lb-caption-pos')).toHaveText('Game 1 of 3');
    }),
  ).toContain('lb-img lb-anim-top');
});

test('F1 edge: on a phone, a swipe past the last media or game slides in with the finger', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'touch only');
  await asPlayer(page, ALICE, { recentGames: [620, 1145360, 892970] });
  await page.goto('/game/1145360?shot=s3');
  await expect(page.locator('.lb-counter')).toHaveText('Screenshot 3 of 3');
  const img = page.locator('#screenshot-lightbox .lb-img');
  const cdp = await page.context().newCDPSession(page);
  const swipe = async (points: [number, number][]) => {
    await img.evaluate((el) => {
      const w = window as unknown as { lbAnims: string[] };
      w.lbAnims = [];
      new MutationObserver(() => w.lbAnims.push(el.className)).observe(el, { attributeFilter: ['class'] });
    });
    const [[x0, y0], ...moves] = points;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
    for (const [x, y] of moves)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const anims = () => page.evaluate(() => (window as unknown as { lbAnims: string[] }).lbAnims);
  const box = (await img.boundingBox())!;
  const cx = box.x + box.width / 2,
    cy = box.y + box.height / 2;
  // Left, past the last screenshot: the Cover comes in from the right, under the finger.
  await swipe([
    [cx + 80, cy],
    [cx + 40, cy],
    [cx - 20, cy],
    [cx - 100, cy],
  ]);
  await expect(page.locator('.lb-counter')).toHaveText('Cover');
  expect(await anims()).toContain('lb-img lb-anim-right');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.lb-caption-pos')).toHaveText('Game 3 of 3');
  // Up, past the last game: game 1 comes in from the bottom.
  await swipe([
    [cx, cy + 60],
    [cx, cy + 30],
    [cx, cy - 20],
    [cx, cy - 100],
  ]);
  await expect(page.locator('.lb-caption-pos')).toHaveText('Game 1 of 3');
  expect(await anims()).toContain('lb-img lb-anim-bottom');
});

test('F1 edge: stepping games with hidden controls flashes the game name too', async ({ page }) => {
  await page.clock.install();
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned?game=1145360&shot=s1');
  const lb = page.locator('#screenshot-lightbox');
  const caption = page.locator('.lb-caption');
  await page.clock.runFor(3500);
  await expect(lb).toHaveClass(/lb-idle/);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.lb-counter')).toHaveCSS('opacity', '1');
  await expect(caption).toHaveCSS('opacity', '0');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.lb-caption-text')).toHaveText('Terraria');
  expect(await lb.getAttribute('class')).toMatch(/lb-idle/);
  await expect(caption).toHaveCSS('opacity', '1');
  // A media step before the flash ends shows the counter alone again.
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.lb-counter')).toHaveText(/^Screenshot 2 of/);
  // Read once: a retrying assertion would just wait out the flash (the clock keeps running).
  expect(await lb.getAttribute('class')).not.toMatch(/lb--stepped-game/);
  await page.clock.runFor(2000);
  await expect(caption).toHaveCSS('opacity', '0');
});

test('F1 edge: the mouse brings back only the controls near it', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'mouse only');
  await page.clock.install();
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned?game=1145360&shot=s1');
  const lb = page.locator('#screenshot-lightbox');
  await page.clock.runFor(3500);
  await expect(lb).toHaveClass(/lb-idle/);
  // Read once, after the fade: a retrying assertion would just wait out the idle timer. The
  // toolbar's right group stands for the close button, as opacity isn't inherited.
  const shown = async () => {
    await page.waitForTimeout(400);
    return page.evaluate(() =>
      ['.lb-toolbar-right', '.lb-next'].filter((sel) => getComputedStyle(document.querySelector(sel)!).opacity === '1'),
    );
  };
  await page.mouse.move(720, 450);
  expect(await shown()).toEqual([]);
  await expect(page.locator('.lb-backdrop')).toHaveCSS('cursor', 'zoom-out');
  await page.mouse.move(720, 20);
  expect(await shown()).toEqual(['.lb-toolbar-right']);
  await page.mouse.move(1420, 450);
  expect(await shown()).toEqual(['.lb-next']);
  await page.locator('.lb-next').click();
  await expect(page.locator('.lb-counter')).toHaveText('Screenshot 2 of 3');
});

test('F1 edge: on a phone, a swipe steps without bringing the controls back, and a tap does', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'touch only');
  await page.clock.install();
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned?game=1145360&shot=s1');
  const lb = page.locator('#screenshot-lightbox');
  const box = (await page.locator('#screenshot-lightbox .lb-img').boundingBox())!;
  const y = box.y + box.height / 2;
  const cdp = await page.context().newCDPSession(page);
  await page.clock.runFor(3500);
  await expect(lb).toHaveClass(/lb-idle/);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y }] });
  for (const x of [260, 200, 120])
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('.lb-counter')).toHaveText('Screenshot 2 of 3');
  expect(await lb.getAttribute('class')).toMatch(/lb-idle/); // read once, as above
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 195, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(lb).not.toHaveClass(/lb-idle/);
});

test("F1 edge: on a phone, a swipe past the panel's last item stays on it", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'touch only');
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned?game=1145360');
  const current = page.locator('.panel-film-item[aria-current="true"]');
  await page.getByRole('button', { name: 'Screenshot 3 of 3' }).click();
  await expect(current).toHaveAccessibleName('Screenshot 3 of 3');
  const box = (await page.locator('#panel-hero .panel-hero-img').boundingBox())!;
  const y = box.y + box.height / 2;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y }] });
  for (const x of [260, 200, 120])
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(current).toHaveAccessibleName('Screenshot 3 of 3');
  await page.getByRole('button', { name: 'Previous', exact: true }).click();
  await expect(current).toHaveAccessibleName('Screenshot 2 of 3');
});

test("F1 edge: on a phone, a slow right swipe on the panel's media steps it, without closing the panel", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'touch only');
  await page.clock.install();
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned?game=1145360');
  const current = page.locator('.panel-film-item[aria-current="true"]');
  await page.getByRole('button', { name: 'Screenshot 2 of 3' }).click();
  // Synthetic events: Chromium holds back real touchmoves within its slop, the ones that matter here.
  await page.locator('#panel-hero .panel-hero-img').evaluate((img) => {
    const y = img.getBoundingClientRect().top + 20;
    const fire = (type: string, x: number) => {
      const touch = new Touch({ identifier: 1, target: img, clientX: x, clientY: y });
      const touches = type === 'touchend' ? [] : [touch];
      img.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches, changedTouches: [touch] }));
    };
    fire('touchstart', 100);
    // 7 px decides the panel's own swipe (6 px) before the hero's (8 px).
    for (const x of [107, 115, 160, 220]) fire('touchmove', x);
    fire('touchend', 220);
  });
  await expect(current).toHaveAccessibleName('Screenshot 1 of 3');
  await page.clock.runFor(500);
  await expect(page.locator('#panel-title')).toBeVisible();
});

test('F1 edge: on a phone, the previous/next media buttons sit clear of the media and its controls', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'phone layout');
  await fakePlayback(page);
  await asPlayer(page, ALICE);
  const clear = async (media: string) => {
    const m = (await page.locator(media).boundingBox())!;
    for (const name of ['Previous screenshot', 'Next screenshot']) {
      const b = (await page.getByRole('button', { name }).boundingBox())!;
      expect(b.y >= m.y + m.height || b.y + b.height <= m.y, `${name} vs ${media}`).toBe(true);
    }
  };
  await page.goto('/lists/owned?game=1145360&shot=s1');
  await clear('#screenshot-lightbox .lb-img');
  await page.goto('/lists/owned?game=1145360&shot=v1');
  await page.getByRole('button', { name: 'Play trailer' }).click();
  await clear('#screenshot-lightbox .lb-vctrls');
});

test("F1 edge: the viewer's toolbar holds only fullscreen, zoom and close", async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned?game=1145360&shot=s1');
  // The address bar already holds the media's link (`?shot=`), so there is no copy button.
  const buttons = page.locator('.lb-toolbar-left button, .lb-toolbar-right button');
  await expect(buttons.first()).toBeVisible();
  expect(await buttons.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')))).toEqual([
    'Enter fullscreen',
    'Zoom',
    'Close lightbox',
  ]);
});

test('F1 edge: on desktop, a trailer sits between the toolbar and its controls, not under them', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'desktop layout');
  await fakePlayback(page);
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned?game=1145360&shot=v1');
  await page.getByRole('button', { name: 'Play trailer' }).click();
  const video = (await page.locator('#screenshot-lightbox .lb-video').boundingBox())!;
  const toolbar = (await page.locator('.lb-toolbar').boundingBox())!;
  const controls = (await page.locator('.lb-vctrls').boundingBox())!;
  expect(video.y).toBeGreaterThanOrEqual(toolbar.y + toolbar.height);
  expect(video.y + video.height).toBeLessThanOrEqual(controls.y);
});

test("F3 edge: the panel's ↑/↓ follow the table's current search, and hide once the game is out of it", async ({
  page,
}) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned?game=1145360');
  const pos = page.locator('.panel-nav-pos');
  await expect(pos).toHaveText(/ \/ 6$/);
  const search = page.locator('.dt-search-input');

  await search.fill('Hollow');
  await expect(pos).toHaveText(''); // Hades isn't in the search any more
  await expect(page.getByRole('button', { name: 'Next game' })).toBeHidden();

  await search.fill('Ha');
  await expect(pos).toHaveText('1 / 1');
  await page.getByRole('button', { name: 'Next game' }).click(); // the search's only game: itself
  await expect(page.locator('#panel-title')).toHaveText('Hades');
});

test("F1 edge: the viewer's game stepper shows with its other controls, not only on hover", async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned?game=1145360&shot=s1');
  await page.mouse.move(720, 450);
  for (const sel of ['.lb-caption-pos', '.lb-game-prev', '.lb-game-next'])
    await expect(page.locator(`#screenshot-lightbox ${sel}`)).toHaveCSS('opacity', '1');
  // Tab reaches the stepper too.
  const prev = page.locator('#screenshot-lightbox .lb-game-prev');
  for (let i = 0; i < 10 && !(await prev.evaluate((el) => el === document.activeElement)); i++)
    await page.keyboard.press('Tab');
  await expect(prev).toBeFocused();
});

test("F1 edge: the viewer's ↑/↓ game buttons stay put from game to game", async ({ page }) => {
  await asPlayer(page, ALICE);
  // Hades with 24 screenshots, for a counter as long as a real game's.
  await page.route('**/api/game-details/stream', (route) => {
    const req = route.request();
    const full = respond(req.method(), new URL(req.url()), req.postData());
    const body = full.body
      .split('\n\n')
      .map((line: string) => {
        if (!line.startsWith('data: ')) return line;
        const event = JSON.parse(line.slice(6));
        if (event.appid !== 1145360) return line;
        const [shot] = event.meta.screenshots;
        const screenshots = Array.from({ length: 24 }, (_, i) => ({ ...shot, id: i + 1 }));
        return `data: ${JSON.stringify({ ...event, meta: { ...event.meta, screenshots } })}`;
      })
      .join('\n\n');
    return route.fulfill({ ...full, body });
  });
  await page.goto('/lists/owned?game=1145360&shot=s1');
  const boxes = () =>
    page.evaluate(() =>
      ['.lb-game-prev', '.lb-game-next'].map((sel) => {
        const r = document.querySelector(`#screenshot-lightbox ${sel}`)!.getBoundingClientRect();
        return [Math.round(r.x), Math.round(r.y)];
      }),
    );
  await expect(page.locator('.lb-caption-pos')).toHaveText(/^Game \d+ of 6$/);
  const first = await boxes();
  const names = new Set<string>();
  for (let i = 0; i < 6; i++) {
    const name = (await page.locator('.lb-caption-text').textContent())!;
    names.add(name);
    expect(await boxes()).toEqual(first);
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.lb-caption-text')).not.toHaveText(name);
  }
  expect(names.size).toBe(6);
  // Nor from one media counter to the next, short or long.
  for (const [key, label] of [
    ['Home', 'Cover'],
    ['End', 'Screenshot 24 of 24'],
  ]) {
    await page.keyboard.press(key);
    await expect(page.locator('.lb-counter')).toHaveText(label);
    expect(await boxes()).toEqual(first);
  }
});

test('F1 edge: nothing of the page shows around the media', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned?game=1145360&shot=s1');
  await expect(page.locator('#screenshot-lightbox .lb-backdrop')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
});

test("F1 edge: the lightbox's counters say what they count", async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned?game=1145360&shot=v1');
  await expect(page.locator('.lb-caption-pos')).toHaveText(/^Game \d+ of 6$/);
  // Each kind is numbered on its own: the banner, then trailers, then screenshots.
  await expect(page.locator('.lb-counter')).toHaveText('Trailer 1 of 1');
  await page.getByRole('button', { name: 'Next screenshot' }).click();
  await expect(page.locator('.lb-counter')).toHaveText('Screenshot 1 of 3');
  await page.getByRole('button', { name: 'Previous screenshot' }).click();
  await page.getByRole('button', { name: 'Previous screenshot' }).click();
  await expect(page.locator('.lb-counter')).toHaveText('Cover');
});

test('F1 edge: a paused trailer offers a large play button', async ({ page }) => {
  await fakePlayback(page);
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned?game=1145360&shot=v1');
  const bigPlay = page.getByRole('button', { name: 'Play trailer' });
  await expect(bigPlay).toBeVisible();
  await bigPlay.click();
  await expect(bigPlay).toBeHidden();
  await expect(page.locator('.lb-vc-play')).toHaveAccessibleName('Pause');
  // The control draws its state: Pause while playing, not Play.
  await expect(page.locator('.lb-vc-play .lucide-pause')).toBeVisible();
  await expect(page.locator('.lb-vc-play .lucide-play')).toBeHidden();
});

test('F1 edge: a trailer not yet played shows its large play button, not the control bar', async ({ page }) => {
  await fakePlayback(page);
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned?game=1145360&shot=v1');
  await expect(page.getByRole('button', { name: 'Play trailer' })).toBeVisible();
  await expect(page.locator('.lb-vctrls')).toBeHidden();
  await page.getByRole('button', { name: 'Play trailer' }).click();
  await expect(page.locator('.lb-vctrls')).toBeVisible();
});

test("F1 edge: a paused trailer's controls idle out, leaving its large play button", async ({ page }) => {
  await page.clock.install();
  await fakePlayback(page);
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned?game=1145360&shot=v1');
  await page.getByRole('button', { name: 'Play trailer' }).click();
  await page.locator('.lb-vc-play').click(); // pause
  const lb = page.locator('#screenshot-lightbox');
  await page.clock.runFor(3500);
  await expect(lb).toHaveClass(/lb-idle/);
  await expect(page.getByRole('button', { name: 'Play trailer' })).toBeVisible();
});

test('F1 edge: the viewer reopened after closing a playing trailer shows its controls', async ({ page }) => {
  await page.clock.install();
  await fakePlayback(page);
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned?game=1145360&shot=v1');
  await page.getByRole('button', { name: 'Play trailer' }).click();
  await page.getByRole('button', { name: 'Close lightbox' }).click();
  await page.clock.runFor(3500);
  await page.getByRole('button', { name: 'Open in lightbox' }).click();
  const lb = page.locator('#screenshot-lightbox');
  await expect(lb).toHaveClass(/\bopen\b/);
  expect(await lb.getAttribute('class')).not.toMatch(/lb-idle/); // read once: the idle timer runs again
});

test('F1 edge: on a phone, swiping off a playing trailer leaves hidden controls hidden', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'touch only');
  await page.clock.install();
  await fakePlayback(page);
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned?game=1145360&shot=v1');
  await page.getByRole('button', { name: 'Play trailer' }).click();
  const lb = page.locator('#screenshot-lightbox');
  await page.clock.runFor(3500);
  await expect(lb).toHaveClass(/lb-idle/);
  const box = (await page.locator('#screenshot-lightbox .lb-video').boundingBox())!;
  const y = box.y + box.height / 2;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y }] });
  for (const x of [260, 200, 120])
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('.lb-counter')).toHaveText('Screenshot 1 of 3');
  expect(await lb.getAttribute('class')).toMatch(/lb-idle/); // read once, as above
});

test('F1 edge: arrows seek a trailer only while it plays, and step past it otherwise', async ({ page }) => {
  await fakePlayback(page);
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned?game=1145360&shot=v1');
  const counter = page.locator('.lb-counter');
  await page.getByRole('button', { name: 'Play trailer' }).click();
  await page.keyboard.press('ArrowRight');
  await expect(counter).toHaveText('Trailer 1 of 1');
  await page.locator('.lb-vc-play').click(); // pause
  await page.keyboard.press('ArrowRight');
  await expect(counter).toHaveText('Screenshot 1 of 3');
});

test('F1 edge: a trailer pauses when the page is hidden, and stays paused', async ({ page }) => {
  await fakePlayback(page);
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned?game=1145360&shot=v1');
  await page.getByRole('button', { name: 'Play trailer' }).click();
  await expect(page.locator('.lb-vc-play')).toHaveAccessibleName('Pause');
  const setHidden = (hidden: boolean) =>
    page.evaluate((h) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
      document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
  await setHidden(true);
  await setHidden(false);
  await expect(page.locator('.lb-vc-play')).toHaveAccessibleName('Play');
  await expect(page.getByRole('button', { name: 'Play trailer' })).toBeVisible();
});

test("F1 edge: on a phone, the tap that brings back a trailer's controls leaves it playing", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'touch only');
  await page.clock.install();
  await fakePlayback(page);
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned?game=1145360&shot=v1');
  await page.getByRole('button', { name: 'Play trailer' }).tap();
  const lb = page.locator('#screenshot-lightbox');
  await page.clock.runFor(3500);
  await expect(lb).toHaveClass(/lb-idle/);
  await page.locator('.lb-video').tap();
  await expect(lb).not.toHaveClass(/lb-idle/);
  await expect(page.locator('.lb-vc-play')).toHaveAccessibleName('Pause');
  await page.locator('.lb-video').tap();
  await expect(page.locator('.lb-vc-play')).toHaveAccessibleName('Play');
});

test('F1 edge: Back closes the open game, then leaves the list', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/about');
  await page.goto('/lists/owned');
  await row(page, 'Hades').getByText('Hades').click();
  await expect(page).toHaveURL(/\?game=1145360/);
  await page.goBack();
  await expect(page.locator('#game-panel')).toBeHidden();
  await expect(page).toHaveURL(/\/lists\/owned$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/about$/);
});

test("F1 edge: Back closes the lightbox, then the game, in a tab past the browser's 50-entry history cap", async ({
  page,
}) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  // Stamped as the router stamps its pushes; Chromium stops growing `history.length` at 50.
  await page.evaluate(() => {
    for (let i = 0; i < 52; i++) history.pushState({ ...history.state, _depth: history.length - 1 }, '');
  });
  await row(page, 'Hades').getByText('Hades').click();
  await page.getByRole('button', { name: 'Open in lightbox' }).click();
  await expect(page).toHaveURL(/&shot=banner/);
  await page.goBack();
  await expect(page.locator('#screenshot-lightbox')).not.toHaveClass(/open/);
  await expect(page.locator('#game-panel')).toBeVisible();
  await expect(page).toHaveURL(/\?game=1145360$/);
  await page.goBack();
  await expect(page.locator('#game-panel')).toBeHidden();
  await expect(page).toHaveURL(/\/lists\/owned$/);
});

test('F1 edge: Back closes the lightbox before the game behind it', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  await row(page, 'Hades').getByText('Hades').click();
  await page.getByRole('button', { name: 'Open in lightbox' }).click();
  await expect(page).toHaveURL(/&shot=banner/);
  await page.goBack();
  await expect(page.locator('#screenshot-lightbox')).not.toHaveClass(/open/);
  await expect(page.locator('#game-panel')).toBeVisible();
  await expect(page).toHaveURL(/\?game=1145360$/);
});

test('F1 edge: after closing the game with its Close button, one Back leaves the list', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/about');
  await page.goto('/lists/owned');
  await row(page, 'Hades').getByText('Hades').click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('#game-panel')).toBeHidden();
  await expect(page).toHaveURL(/\/lists\/owned$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/about$/);
});

test('F1 edge: Back from a page the game panel linked to reopens that game', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/about');
  await page.goto('/lists/owned');
  await row(page, 'Hades').getByText('Hades').click();
  await page.locator('#game-panel').getByText('Test Co-op Pack').click();
  await expect(page).toHaveURL(/\/lists\/bundle\//);
  await page.goBack();
  await expect(page.locator('#panel-title')).toHaveText('Hades');
  await page.goBack();
  await expect(page.locator('#game-panel')).toBeHidden();
  await page.goBack();
  await expect(page).toHaveURL(/\/about$/);
});

test("F2 edge: a failed search says so, rather than 'No games found'", async ({ page }) => {
  await page.route('**/api/search-games?*', (route) =>
    route.fulfill({ status: 502, json: { error: 'Steam store request failed' } }),
  );
  await page.goto('/search?q=hades');
  await expect(page.getByText('Search failed — try again')).toBeVisible();
  await expect(page.getByText('No games found')).toHaveCount(0);
});

test("F2 edge: /search, About and the 404 page title themselves with the list routes' hero", async ({ page }) => {
  for (const [path, title] of [
    ['/search?q=hades', 'Search'],
    ['/about', 'About'],
    ['/compare', 'Page not found'],
  ]) {
    await page.goto(path);
    await expect(page.locator('.list-hero-title')).toHaveText(title);
    await expect(page.locator('h1')).toHaveCount(1);
  }
});

test('F2 edge: on /search, ↓ moves from the box into the results, and an opened result keeps its row focused', async ({
  page,
}) => {
  await page.goto('/search?q=hades');
  await expect(rows(page)).toHaveCount(1);
  await page.getByPlaceholder('Search for a game…').press('ArrowDown');
  await expect(rows(page).first()).toBeFocused();
  await rows(page).first().press('Enter');
  await expect(page.locator('#panel-title')).toHaveText('Hades');
  await expect(rows(page).first()).toBeFocused();
});

test('F2 edge: /search shows an image column only when a result has an image', async ({ page }) => {
  await page.route('**/api/search-games?q=portal*', (route) =>
    route.fulfill({ json: { results: [{ appid: 620, name: 'Portal 2', tinyImage: '/favicon.svg' }] } }),
  );
  await page.goto('/search?q=hades');
  await expect(rows(page)).toHaveCount(1);
  const columns = page.locator('.search-table thead th');
  await expect(columns).toHaveCount(1);

  await page.getByPlaceholder('Search for a game…').fill('portal');
  await expect(page.locator('.search-table .game-search-thumb')).toHaveCount(1);
  await expect(columns).toHaveCount(2);
  await expect(columns.last()).toHaveAttribute('data-col-key', 'name');
  // The page's own box is the search: the table shows no toolbar of its own.
  await expect(page.locator('.search-table .dt-toolbar')).toHaveCount(0);
});

test('F2 edge: /search marks an owned result even when the library lands after the results', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.route('**/api/common-games', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.fallback();
  });
  await page.goto('/search?q=hollow');
  await expect(rows(page)).toHaveCount(1);
  await expect(row(page, 'Hollow Knight').locator('.game-search-badge.owned')).toBeVisible();
});

test('F1.1-4: look up one game from the nav search, in place', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  await expect(rows(page)).toHaveCount(6);
  await page.keyboard.press('/');
  await page.keyboard.type('hollow');
  await page.getByRole('option', { name: /Hollow Knight/ }).click();
  await expect(page).toHaveURL(/\/lists\/owned\?game=367520/);
  await expect(page.locator('.game-panel')).toContainText('Hollow Knight');

  // Esc hides the dropdown, then leaves the search box, so shortcuts work again.
  await page.keyboard.press('/');
  await page.keyboard.type('zz');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('INPUT');
});

test("F1 edge: the open nav search's ✓ marks follow a link's account resolving", async ({ page }) => {
  await asPlayer(page, ALICE, { recentGames: [728880] }); // Overcooked! 2: Bob's, not Alice's
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/common-games', async (route) => {
    if (route.request().postData()?.includes('bob')) await held;
    await route.fallback();
  });
  await page.goto('/about?u=bob');
  await page.getByPlaceholder('Look up any game…').focus();
  const option = page.getByRole('option', { name: /Overcooked! 2/ });
  await expect(option).toBeVisible();
  await expect(option.locator('.game-search-badge.owned')).toHaveCount(0);
  release();
  await expect(option.locator('.game-search-badge.owned')).toBeVisible();
});

test('F1 edge: the nav search box empties after a pick and on a second Esc', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  await expect(rows(page)).toHaveCount(6);
  const box = page.getByPlaceholder('Look up any game…');
  await box.fill('hollow');
  await page.getByRole('option', { name: /Hollow Knight/ }).click();
  await expect(page.locator('.game-panel')).toContainText('Hollow Knight');
  await expect(box).toHaveValue('');

  await box.fill('zz');
  await page.keyboard.press('Escape');
  await expect(box).toHaveValue('zz');
  await page.keyboard.press('Escape');
  await expect(box).toHaveValue('');
});

test('F1 edge: the nav search box’s Clear search button empties it and keeps it focused, back on the recents', async ({
  page,
}) => {
  await asPlayer(page, ALICE, { recentGames: [728880] });
  await page.goto('/about');
  const box = page.getByPlaceholder('Look up any game…');
  const clear = page.locator('.app-search-wrap').getByRole('button', { name: 'Clear search' });
  await expect(clear).toBeHidden();
  await box.fill('hollow');
  await clear.click();
  await expect(box).toHaveValue('');
  await expect(box).toBeFocused();
  await expect(clear).toBeHidden();
  await expect(page.getByRole('option', { name: /Overcooked! 2/ })).toBeVisible();
});

test('F2 edge: the /search box’s Clear search button empties it, and refocusing it selects its text to type over', async ({
  page,
}) => {
  await page.goto('/search?q=hades');
  await expect(rows(page)).toHaveCount(1);
  await expect(page.locator('.game-panel')).toBeVisible();
  await page.keyboard.press('Escape'); // the closest match's panel covers the box on a phone
  const box = page.getByPlaceholder('Search for a game…');
  await box.click();
  expect(await box.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])).toEqual([0, 5]);
  await box.blur();

  await page.locator('.search-page-input').getByRole('button', { name: 'Clear search' }).click();
  await expect(box).toHaveValue('');
  await expect(box).toBeFocused();
  await expect(page.getByText('Type a game name to search.')).toBeVisible();
});

test('F1 edge: a first Esc with no dropdown to close leaves the nav search box but keeps its text', async ({
  page,
}) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  await expect(rows(page)).toHaveCount(6);
  const box = page.getByPlaceholder('Look up any game…');
  await box.fill('620');
  await page.keyboard.press('Escape');
  await expect(box).not.toBeFocused();
  await expect(box).toHaveValue('620');
});

test('F1 edge: a search still pending when Esc or a pick closes the nav dropdown does not reopen it', async ({
  page,
}) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  await expect(rows(page)).toHaveCount(6);
  const box = page.getByPlaceholder('Look up any game…');
  const dropdown = page.locator('#app-search-results');

  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/search-games?q=hades*', async (route) => {
    await held;
    await route.fallback();
  });
  const asked = page.waitForRequest(/search-games\?q=hades/);
  await box.fill('hades');
  await asked;
  await page.keyboard.press('Escape');
  release();
  await page.waitForResponse(/search-games\?q=hades/);
  await page.waitForTimeout(200); // let the late answer render, if it would
  await expect(dropdown).toBeHidden();

  await box.fill('hollow');
  await expect(page.getByRole('option', { name: /Hollow Knight/ })).toBeVisible();
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Enter');
  await expect(page.locator('#panel-title')).toHaveText('Hollow Knight');
  await page.waitForTimeout(500); // past the search debounce
  await expect(dropdown).toBeHidden();
});

test('F1 edge: tabbing out of the nav search box before its search answers opens no dropdown', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  await expect(rows(page)).toHaveCount(6);
  const box = page.getByPlaceholder('Look up any game…');
  await box.fill('hades');
  await page.keyboard.press('Tab');
  await expect(box).not.toBeFocused();
  await page.waitForTimeout(500); // past the search debounce
  await expect(page.locator('#app-search-results')).toBeHidden();
});

test('F1 edge: Esc closes a nav popover or the search dropdown, not the open game', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'phone', "a phone's panel covers the nav");
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned?game=620');
  await expect(page.locator('#panel-title')).toHaveText('Portal 2');

  await page.getByLabel('Preferences').click();
  await expect(page.locator('.site-nav-prefs-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.site-nav-prefs-panel')).toBeHidden();
  await expect(page.locator('#panel-title')).toBeVisible();

  await page.getByPlaceholder('Look up any game…').fill('hollow');
  await expect(page.locator('.game-search-result', { hasText: 'Hollow Knight' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#app-search-results')).toBeHidden();
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('INPUT');
  await expect(page.locator('#panel-title')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#panel-title')).toBeHidden();
});

test("F1 edge: the panel's More links menu holds only links found nowhere else, and Esc closes it before the game", async ({
  page,
}) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned?game=1145360');
  const more = page.getByRole('button', { name: 'More links' });
  await more.click();
  const menu = page.locator('.panel-icon-more-menu');
  await expect(menu.getByRole('link')).toHaveText(['Official website ↗']);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(page.locator('#panel-title')).toBeVisible();
  await expect(more).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#panel-title')).toBeHidden();
});

test("F1 edge: the panel's More links menu closes once focus leaves it", async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned?game=1145360');
  await page.getByRole('button', { name: 'More links' }).click();
  const menu = page.locator('.panel-icon-more-menu');
  await page.keyboard.press('Tab');
  await expect(menu.getByRole('link')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(menu).toBeHidden();
});

test("F1 edge: Esc goes to what's above the panel's More links menu, and to nothing once the panel is gone", async ({
  page,
}) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  await row(page, 'Hades').getByText('Hades').click();
  await page.getByRole('button', { name: 'More links' }).click();
  await page.keyboard.press('?');
  const shortcuts = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(shortcuts).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(shortcuts).toBeHidden();

  await page.getByRole('button', { name: 'More links' }).click();
  await page.goBack();
  await expect(page.locator('#game-panel')).toBeHidden();
  await page.keyboard.press('?');
  await expect(shortcuts).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(shortcuts).toBeHidden();
});

test('C1 edge: a wrapped game name keeps its ✓/☆ badge right after the last word', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'names wrap at phone width');
  await asPlayer(page, ALICE);
  await page.goto('/lists/compare?u=alice&u=bob');
  await expect(rows(page).first()).toBeVisible();
  const gaps = await page.locator('.game-name-cell').evaluateAll((cells) =>
    cells.flatMap((cell) => {
      const text = cell.firstChild!;
      const range = document.createRange();
      range.selectNodeContents(text);
      const lines = [...range.getClientRects()];
      const badge = cell.querySelector('.name-status-badge')?.getBoundingClientRect();
      if (lines.length < 2 || !badge) return [];
      return [Math.round(badge.left - lines.at(-1)!.right)];
    }),
  );
  expect(gaps.length).toBeGreaterThan(0);
  for (const gap of gaps) expect(gap).toBeLessThanOrEqual(8);
});

test('F1 edge: Enter opens the highlighted recently looked-up game', async ({ page }) => {
  await asPlayer(page, ALICE, { recentGames: [620, 1145360] });
  await page.goto('/lists/owned');
  await expect(rows(page)).toHaveCount(6);
  await page.keyboard.press('/');
  await expect(page.locator('.game-search-result')).toHaveCount(2);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/[?&]game=1145360\b/);
});

test("I1 edge: on a phone, a bundle's table starts high, its other actions behind More actions", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'phone layout only');
  await asPlayer(page, ALICE);
  await page.goto(`/lists/bundle/${BUNDLE.id}`);
  await expect(rows(page)).toHaveCount(4);
  // How many lines a row of controls takes, by the distinct tops of those shown.
  const lines = (selector: string) =>
    page
      .locator(selector)
      .evaluateAll(
        (els) =>
          new Set(els.filter((el) => el.checkVisibility()).map((el) => Math.round(el.getBoundingClientRect().top)))
            .size,
      );
  expect(await lines('.list-hero-stats > .list-stat')).toBe(1);
  expect(await lines('.list-hero-actions > *')).toBe(1);
  expect(await lines('.dt-toolbar-actions > *')).toBeLessThanOrEqual(2);
  // Room to spare: with wider text still, More actions must not drop to a line of its own.
  await page.addStyleTag({ content: '.list-hero-actions { letter-spacing: 1px }' });
  const rowY = (name: string) => page.getByRole('link', { name }).evaluate((el) => el.getBoundingClientRect().top);
  const moreY = await page
    .getByRole('button', { name: 'More actions' })
    .evaluate((el) => el.getBoundingClientRect().top);
  expect(Math.abs(moreY - (await rowY('Get this bundle ↗')))).toBeLessThan(5);
  await expect(page.getByRole('link', { name: 'View on IsThereAnyDeal ↗' })).toBeHidden();
  await page.getByRole('button', { name: 'More actions' }).click();
  await expect(page.getByRole('link', { name: 'View on IsThereAnyDeal ↗' })).toBeVisible();
});

test("C3 edge: on a phone, the hero's More actions centres its ⋯", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'phone layout only');
  await asPlayer(page, ALICE);
  await page.goto('/lists/compare?u=alice&u=bob');
  const more = page.getByRole('button', { name: 'More actions' });
  const centre = (box: { x: number; y: number; width: number; height: number } | null) => [
    box!.x + box!.width / 2,
    box!.y + box!.height / 2,
  ];
  const [bx, by] = centre(await more.boundingBox());
  const [ix, iy] = centre(await more.locator('svg').boundingBox());
  expect(Math.abs(ix - bx)).toBeLessThan(1);
  expect(Math.abs(iy - by)).toBeLessThan(1);
});

test('I1 edge: on a phone, small controls still take a 24px tap', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'phone layout only');
  // True when a tap 12px from the centre, on each side, still lands on the control.
  const takes24pxTap = async (control: Locator) => {
    await control.scrollIntoViewIfNeeded();
    return control.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const [x, y] = [r.left + r.width / 2, r.top + r.height / 2];
      const d = 11.99; // a hit test excludes a box's far edge: exactly 12 would demand 25px
      const points = [
        [x, y - d],
        [x, y + d],
        [x - d, y],
        [x + d, y],
      ];
      return points.every(([px, py]) => el.contains(document.elementFromPoint(px, py)));
    });
  };
  await asPlayer(page, ALICE);
  await page.goto('/');
  await page.getByRole('button', { name: 'New list' }).click();
  await page.getByRole('textbox', { name: 'List name' }).fill('Shortlist');
  await page.keyboard.press('Enter');
  expect(await takes24pxTap(page.locator('.list-tree').getByRole('link', { name: 'Shortlist' }))).toBe(true);
  expect(await takes24pxTap(rowMenu(page, 'Shortlist'))).toBe(true);
  await rowMenu(page, 'Shortlist').click();
  expect(await takes24pxTap(page.getByRole('button', { name: 'Rename Shortlist' }))).toBe(true);
  expect(await takes24pxTap(page.getByRole('button', { name: 'Delete Shortlist' }))).toBe(true);
  await page.keyboard.press('Escape');

  await page.goto('/lists/compare');
  expect(await takes24pxTap(page.getByRole('button', { name: 'Remove Alice' }))).toBe(true);

  await page.goto('/lists/owned');
  // A header sorts from anywhere in its cell, not just its label's button.
  const header = page.locator('.dt-th[data-col-key="releaseDate"]');
  expect(await takes24pxTap(header)).toBe(true);
  const label = (await header.locator('.dt-th-sort').boundingBox())!;
  const cell = (await header.boundingBox())!;
  await page.mouse.click(label.x + 4, cell.y + cell.height - 3);
  await expect(header).toHaveAttribute('aria-sort', /ascending|descending/);
  expect(await takes24pxTap(page.getByRole('link', { name: 'About' }))).toBe(true);
  await page.locator('.account-chip-btn').click();
  expect(await takes24pxTap(page.locator('.account-chip-panel').getByRole('link', { name: 'Wishlist' }))).toBe(true);
  await page.keyboard.press('Escape');
  await page.keyboard.press('?');
  expect(
    await takes24pxTap(page.getByRole('dialog', { name: 'Keyboard shortcuts' }).getByRole('button', { name: 'Close' })),
  ).toBe(true);

  await page.goto('/');
  const friends = page.locator('.account-friends summary');
  expect(await takes24pxTap(friends)).toBe(true);
  expect(await takes24pxTap(page.getByRole('button', { name: 'Unstar Alice' }))).toBe(true);
  expect(await takes24pxTap(page.getByRole('button', { name: 'Edit', exact: true }))).toBe(true);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  expect(await takes24pxTap(page.getByRole('button', { name: 'Remove Alice' }))).toBe(true);
  await friends.click();
  expect(await takes24pxTap(page.locator('.account-friends-refresh'))).toBe(true);

  await page.getByRole('button', { name: 'Add Steam Family account' }).click();
  const fields = page.getByPlaceholder('Steam name, profile URL, or 64-bit ID…');
  await fields.nth(0).fill('alice');
  await fields.nth(1).fill('bob');
  await page.getByRole('button', { name: 'Look up', exact: true }).click();
  expect(await takes24pxTap(page.locator('.account-members').getByRole('link', { name: 'Bob ↗' }))).toBe(true);
});

test('I2 edge: the lightbox shows its focus ring when opened from the keyboard, not from a tap', async ({
  page,
}, testInfo) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned?game=1145360');
  const hero = page.getByRole('button', { name: 'Open in lightbox' });
  const ringOnClose = () =>
    page.locator('.lb-close').evaluate((e) => e === document.activeElement && e.matches(':focus-visible'));
  if (testInfo.project.name === 'phone') {
    await hero.tap();
    await expect(page.locator('.lb-close')).toBeFocused();
    expect(await ringOnClose()).toBe(false);
    // Opaque, so the panel behind doesn't show through around the media.
    await expect(page.locator('.lb-backdrop')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
  } else {
    await hero.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.lb-close')).toBeFocused();
    expect(await ringOnClose()).toBe(true);
  }
});

test('I2 edge: Tab cycles the lightbox controls on a game with a single item', async ({ page }) => {
  // Serves the cover from localhost, so it loads instead of showing its Retry.
  await mockApi(page, { states: ['slow-media'] });
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned?game=620');
  await page.getByRole('button', { name: 'Open in lightbox' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.lb-img')).not.toHaveClass(/loading/);
  await expect(page.locator('.lb-close')).toBeFocused();
  const focused = () =>
    page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      return el.checkVisibility({ visibilityProperty: true }) ? el.ariaLabel : null;
    });
  const seen: (string | null)[] = [];
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    seen.push(await focused());
  }
  expect(seen).toEqual(['Previous game', 'Next game', 'Enter fullscreen', 'Zoom', 'Close lightbox', 'Previous game']);
});

test("I2 edge: the panel's current thumbnail is exposed, not only coloured", async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned?game=1145360');
  const current = page.locator('.panel-film-item[aria-current="true"]');
  await expect(current).toHaveAccessibleName('Cover');
  await page.getByRole('button', { name: 'Screenshot 2 of 3' }).click();
  await expect(current).toHaveAccessibleName('Screenshot 2 of 3');
  await expect(current).toHaveCount(1);
});

test("I2 edge: the open game's row is exposed as current, not only coloured", async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned?game=1145360');
  const current = page.locator('.dt-tr[aria-current="true"]');
  await expect(current).toHaveCount(1);
  await expect(current).toContainText('Hades');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(current).toHaveCount(0);
});

test('I2 edge: Esc closing the panel returns focus to the row it was showing', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned?game=1145360');
  await expect(page.locator('.game-panel')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(page).not.toHaveURL(/[?&]game=1145360\b/);
  const shown = new URL(page.url()).searchParams.get('game');
  await page.keyboard.press('Escape');
  await expect(page.locator('.game-panel')).toBeHidden();
  await expect(page.locator(`tr.dt-tr[data-row-key="${shown}"]`)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator(`tr.dt-tr[data-row-key="${shown}"]`)).not.toBeFocused();
  await expect(page.locator('tr.dt-tr:focus')).toHaveCount(1);
});

test('I2 edge: the Close button closing the panel returns focus to the row it was showing', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  await row(page, 'Hades').getByText('Hades').click();
  await expect(page.locator('#panel-title')).toHaveText('Hades');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#panel-title')).not.toHaveText('Hades');
  const shown = new URL(page.url()).searchParams.get('game');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('.game-panel')).toBeHidden();
  await expect(page.locator(`tr.dt-tr[data-row-key="${shown}"]`)).toBeFocused();
});

test("I2 edge: the panel's ground takes a trace of the game's art, and stays neutral when the art can't be read", async ({
  page,
}) => {
  await asPlayer(page, ALICE);
  const panel = page.locator('.game-panel');
  // The mock's CDN is unreachable: no tint, the plain surface.
  await page.goto('/lists/owned?game=1145360');
  await expect(page.locator('#panel-title')).toHaveText('Hades');
  const neutral = await panel.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(await panel.evaluate((el) => el.style.getPropertyValue('--panel-tint'))).toBe('');
  // A red capsule: the ground turns faintly red, dark enough to keep its text's contrast.
  await page.route(/steamstatic\.com/, (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="231" height="87"><rect width="231" height="87" fill="#d22"/></svg>',
    }),
  );
  await page.reload();
  await expect(panel).toHaveAttribute('style', /--panel-tint: oklch\(0\.17 0\.040 /);
  await expect(panel).not.toHaveCSS('background-color', neutral);
  await expect(page.locator('.panel-header-sticky')).toHaveCSS(
    'background-color',
    await panel.evaluate((el) => getComputedStyle(el).backgroundColor),
  );
});

test.describe('with motion on', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('I2 edge: the panel slides in to rest, focus on its hero', async ({ page }) => {
    await asPlayer(page, ALICE);
    await page.goto('/lists/owned');
    await row(page, 'Hades').getByText('Hades').click();
    const panel = page.locator('.game-panel');
    await expect(panel).toHaveCSS('opacity', '1');
    await expect(panel).toHaveCSS('translate', 'none');
    await expect(page.locator('#panel-title')).toHaveText('Hades');
    await expect(page.locator('.panel-hero-open')).toBeFocused();
    await expect(page.locator('.panel-hero-img')).toHaveCSS('opacity', '1');
  });

  for (const viewTransitions of [true, false]) {
    test(`I2 edge: a row click opens the panel on its hero, focused, Back closing it (View Transitions ${viewTransitions ? 'on' : 'absent'})`, async ({
      page,
    }) => {
      if (!viewTransitions)
        await page.addInitScript(() => delete (Document.prototype as Partial<Document>).startViewTransition);
      // The morph needs a loaded thumbnail; the CDN is otherwise unreachable here.
      await page.route(/steamstatic\.com/, (route) =>
        route.fulfill({
          contentType: 'image/svg+xml',
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="231" height="87"><rect width="231" height="87" fill="#468"/></svg>',
        }),
      );
      await asPlayer(page, ALICE);
      await page.goto('/lists/owned');
      await expect(rows(page)).toHaveCount(6);
      await expect(row(page, 'Hades').locator('.game-thumb')).toHaveJSProperty('complete', true);
      const started = page.evaluate(
        () =>
          new Promise<boolean>((resolve) => {
            const start = document.startViewTransition?.bind(document);
            if (!start) return resolve(false);
            document.startViewTransition = (cb) => (resolve(true), start(cb));
          }),
      );
      await row(page, 'Hades').getByText('Hades').click();
      expect(await started).toBe(viewTransitions);
      await expect(page.locator('#panel-title')).toHaveText('Hades');
      await expect(page.locator('.panel-hero-open')).toBeFocused();
      await expect(page.locator('.panel-hero-img')).toHaveCSS('opacity', '1');
      await expect(page.locator('.game-panel')).toHaveCSS('translate', 'none');
      await expect(page.locator('[style*="view-transition-name"]')).toHaveCount(0);
      await page.goBack();
      await expect(page.locator('.game-panel')).toBeHidden();
      await expect(page).not.toHaveURL(/[?&]game=/);
    });
  }

  test("F1 edge: a click on the panel's picture grows it into the lightbox, focused, Back closing only that", async ({
    page,
  }) => {
    await asPlayer(page, ALICE);
    await page.goto('/lists/owned?game=1145360');
    await page.getByRole('button', { name: 'Screenshot 1 of 3' }).click();
    await expect(page.locator('.panel-hero-img')).not.toHaveClass(/loading/);
    const started = page.evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          const start = document.startViewTransition.bind(document);
          document.startViewTransition = (cb) => (resolve(true), start(cb));
        }),
    );
    await page.getByRole('button', { name: 'Open in lightbox' }).click();
    expect(await started).toBe(true);
    await expect(page.locator('.lb-close')).toBeFocused();
    await expect(page.locator('#screenshot-lightbox')).toHaveCSS('opacity', '1');
    await expect(page.locator('.lb-img')).toHaveAttribute('src', /Screenshot%201%3C/);
    await expect(page.locator('.lb-img')).toHaveCSS('opacity', '1');
    await expect(page.locator('[style*="view-transition-name"]')).toHaveCount(0);
    await page.goBack();
    await expect(page.locator('#screenshot-lightbox')).toBeHidden();
    await expect(page.locator('#panel-title')).toHaveText('Hades');
  });

  test('I2 edge: a nav popover rises to rest and Esc hands focus back', async ({ page }) => {
    await asPlayer(page, ALICE);
    await page.goto('/lists/owned');
    const prefs = page.getByLabel('Preferences');
    await prefs.click();
    const panel = page.locator('.site-nav-prefs-panel');
    await expect(panel).toHaveCSS('opacity', '1');
    await expect(panel).toHaveCSS('translate', '0px');
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(prefs).toBeFocused();
  });
});

test('I2 edge: closing a game with no row returns focus to the row it was opened from', async ({ page }) => {
  await asPlayer(page, ALICE);
  // The DLC hopped to has no fixture details; the store not answering is enough here.
  await page.route(/\/api\/game-details\/9000\d\d$/, (route) =>
    route.fulfill({ json: { appid: 900001, meta: null, failed: ['meta'] } }),
  );
  await page.goto('/lists/owned');
  await row(page, 'Hades').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#panel-title')).toHaveText('Hades');
  const card = page.locator('#panel-section-dlc');
  await card.getByRole('button', { name: /DLC · 25 available/ }).click();
  await card.locator('.panel-dlc-item').first().click();
  await expect(page.locator('#panel-title')).not.toHaveText('Hades');
  await page.keyboard.press('Escape');
  await expect(page.locator('.game-panel')).toBeHidden();
  await expect(row(page, 'Hades')).toBeFocused();
});

test("I3 edge: a DLC's panel names its way back after the game it came from", async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.route(/\/api\/game-details\/9000\d\d$/, (route) =>
    route.fulfill({ json: { appid: 900001, meta: null, failed: ['meta'] } }),
  );
  await page.goto('/lists/owned?game=1145360');
  const card = page.locator('#panel-section-dlc');
  await card.getByRole('button', { name: /DLC · 25 available/ }).click();
  await card.locator('.panel-dlc-item').first().click();
  await page.getByRole('button', { name: 'Back to Hades', exact: true }).click();
  await expect(page.locator('#panel-title')).toHaveText('Hades');
});

test('I2 edge: the shortcuts dialog says how to open the lightbox from the panel', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  await expect(rows(page)).toHaveCount(6);
  await page.keyboard.press('?');
  const section = page.locator('.shortcuts-section').filter({ hasText: 'Game panel' });
  await expect(section.locator('.shortcuts-row').filter({ hasText: 'lightbox' })).toContainText('Enter');
});

test('I2 edge: the shortcuts dialog draws all four arrow keys the same size, still read as ← → ↑ ↓', async ({
  page,
}) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  await expect(rows(page)).toHaveCount(6);
  await page.keyboard.press('?');
  const arrows = page.getByRole('dialog', { name: 'Keyboard shortcuts' }).locator('kbd', { hasText: /^[←→↑↓]$/ });
  await expect(arrows.first()).toBeVisible();
  const caps = await arrows.evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { key: el.textContent, size: `${r.width.toFixed(1)}×${r.height.toFixed(1)}` };
    }),
  );
  expect(new Set(caps.map((c) => c.key))).toEqual(new Set(['←', '→', '↑', '↓']));
  expect(new Set(caps.map((c) => c.size)).size).toBe(1);
});

test('I2 edge: every shortcut description starts at the same x', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  await expect(rows(page)).toHaveCount(6);
  await page.keyboard.press('?');
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(dialog).toBeVisible();
  const lefts = await dialog
    .locator('.shortcuts-row > dd')
    .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().left)));
  expect(lefts.length).toBeGreaterThan(10);
  expect(new Set(lefts).size).toBe(1);
  const overflowing = await dialog
    .locator('.shortcuts-keys')
    .evaluateAll((els) => els.filter((el) => el.scrollWidth > el.clientWidth).map((el) => el.textContent));
  expect(overflowing).toEqual([]);
});

test('I2 edge: the shortcuts dialog takes focus, keeps it, and gives it back on close', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  await row(page, 'Hades').focus();
  await page.keyboard.press('?');
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused();
  await page.keyboard.press('Tab');
  expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  // A click on its text drops focus to <body>; Tab must still not leave for the page behind.
  await dialog.locator('.shortcuts-row').last().click();
  await page.keyboard.press('Tab');
  expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(row(page, 'Hades')).toBeFocused();
});

test('I2 edge: controls name what they act on, and only toggles carry a pressed state', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/');
  await expect(page.locator('.account-chip-btn')).toHaveAccessibleName(/Alice/);
  await page.getByRole('button', { name: 'New list' }).click();
  await page.getByRole('textbox', { name: 'List name' }).fill('Shortlist');
  await page.keyboard.press('Enter');
  await rowMenu(page, 'Shortlist').click();
  await expect(page.getByRole('button', { name: 'Rename Shortlist' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete Shortlist' })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'New combined list' }).click();
  const form = page.locator('.combine-form');
  await form.getByRole('combobox', { name: 'How to combine the sources' }).selectOption('subtract');
  const sources = form.locator('.combine-sources input[type="checkbox"]');
  await sources.nth(0).check();
  await sources.nth(1).check();
  const ordered = form.locator('.combine-sources-ordered li');
  const first = (await ordered.nth(0).locator('.combine-source-label').innerText()).trim();
  await expect(ordered.nth(0).getByRole('button', { name: `Move ${first} down` })).toBeVisible();

  await page.goto('/lists/compare?u=alice&u=bob');
  await expect(page.getByRole('combobox', { name: "How to combine these players' libraries" })).toHaveValue(
    'group-by-membership',
  );

  await page.goto('/bundles');
  // A tile's button is named by its label and value.
  const updated = page.getByRole('button', { name: /^Updated \S/ });
  await expect(updated).toBeVisible();
  await expect(updated).not.toHaveAttribute('aria-pressed');
  await expect(page.getByRole('button', { name: /^Prices \S/ })).not.toHaveAttribute('aria-pressed');
  const ending = page.getByRole('button', { name: /^Ending soon \d/ });
  if (await ending.count()) await expect(ending).toHaveAttribute('aria-pressed', 'false');
});

test('I2 edge: icon-only controls have names', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto(`/lists/bundle/${BUNDLE.id}`);
  await expect(rows(page)).toHaveCount(4);
  await expect(page.getByRole('button', { name: 'Previous bundle' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Next bundle' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Columns', exact: true }).click();
  await expect(page.locator('.dt-dd')).toContainText('Image');
});

test('I2 edge: Esc in the lightbox closes only it, drops its shot from the URL, and one Back closes the game', async ({
  page,
}) => {
  await asPlayer(page, ALICE);
  await page.goto('/about');
  await page.goto('/lists/owned');
  await row(page, 'Hades').getByText('Hades').click();
  await page.getByRole('button', { name: 'Open in lightbox' }).click();
  await expect(page).toHaveURL(/&shot=banner/);
  await page.keyboard.press('Escape');
  await expect(page.locator('#screenshot-lightbox')).not.toHaveClass(/open/);
  await expect(page.locator('#panel-title')).toHaveText('Hades');
  await expect(page).toHaveURL(/\?game=1145360$/);
  await page.goBack();
  await expect(page.locator('#game-panel')).toBeHidden();
  await expect(page).toHaveURL(/\/lists\/owned$/);
});

test('I2 edge: a click beside the shortcuts dialog closes it', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  await expect(rows(page)).toHaveCount(6);
  await page.keyboard.press('?');
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(dialog).toBeVisible();
  await page.mouse.click(5, 5); // a corner the dialog never covers
  await expect(dialog).toBeHidden();
});

test('I2 edge: a click outside closes each nav popover, and opening one closes the other', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/wishlist');
  // The rank menu only replaces the Rank button once the list has a ranking.
  await page.getByRole('button', { name: /Rank this list/ }).click();
  await page.keyboard.press('Escape');
  await page.goto('/lists/wishlist');
  await expect(rows(page)).toHaveCount(4);

  const prefs = page.locator('.site-nav-prefs-panel');
  const account = page.locator('.account-chip-panel');
  const rank = page.locator('.rank-menu-panel');
  // In the left gutter, which no popover covers (clampPopoverLeft keeps them 12px in).
  const outside = async () => {
    const title = (await page.locator('.list-hero-title').boundingBox())!;
    await page.mouse.click(5, title.y + title.height / 2);
  };
  const triggers = [
    [prefs, () => page.getByLabel('Preferences').click()],
    [account, () => page.locator('.account-chip-btn').click()],
    [rank, () => page.getByText(/Rank this list/).click()],
  ] as const;
  for (const [panel, open] of triggers) {
    await open();
    await expect(panel).toBeVisible();
    await outside();
    await expect(panel).toBeHidden();
  }
  // The nav's popovers can cover the rank menu's trigger, so that one only opens first.
  for (const [[panel, open], [next, openNext]] of [
    [triggers[0], triggers[1]],
    [triggers[1], triggers[0]],
    [triggers[2], triggers[0]],
  ]) {
    await open();
    await expect(panel).toBeVisible();
    await openNext();
    await expect(next).toBeVisible();
    await expect(panel).toBeHidden();
    await outside();
  }
});

test('I2 edge: a hidden achievement is revealed by Enter, and by Space', async ({ page }) => {
  await page.route('**/api/achievements/**', (route) => {
    const req = route.request();
    const body = JSON.parse(respond(req.method(), new URL(req.url()), req.postData()).body);
    for (const a of body.achievements) Object.assign(a, { hidden: true, achieved: false, unlocktime: null });
    body.unlocked = 0;
    return route.fulfill({ json: body });
  });
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned?game=1145360');
  const card = page.locator('#panel-section-achievements');
  await card.getByRole('button', { name: /Achievements/ }).click();
  const hidden = card.getByRole('button', { name: /Hidden achievement/ });
  await expect(hidden).toHaveCount(2);
  await hidden.first().focus();
  await page.keyboard.press('Enter');
  await expect(card).toContainText('First steps');
  await expect(hidden).toHaveCount(1);
  await hidden.focus();
  await page.keyboard.press(' ');
  await expect(card).toContainText('Completionist');
  await expect(hidden).toHaveCount(0);
});

test("I2 edge: Enter or Space on the panel's hero opens the lightbox once", async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned?game=1145360');
  await expect(page.locator('#panel-title')).toHaveText('Hades');
  const entries = await page.evaluate(() => history.length);
  // A button takes Enter on keydown, Space on keyup: neither may also press the lightbox's Close.
  for (const key of ['Enter', ' ']) {
    await page.getByRole('button', { name: 'Open in lightbox' }).focus();
    await page.keyboard.press(key);
    await expect(page.locator('.lb-close')).toBeFocused();
    await page.waitForTimeout(200); // past a second activation's close
    await expect(page.locator('#screenshot-lightbox')).toHaveClass(/open/);
    expect(await page.evaluate(() => history.length)).toBe(entries + 1);
    await page.goBack();
    await expect(page.locator('#screenshot-lightbox')).not.toHaveClass(/open/);
    await expect(page.locator('#panel-title')).toHaveText('Hades');
  }
});

// Visible headings' levels, and the unnamed navigation/complementary landmarks.
const structure = (page: Page) =>
  page.evaluate(() => {
    const shown = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)].filter((e) => e.checkVisibility());
    const named = (e: Element) => e.hasAttribute('aria-label') || e.hasAttribute('aria-labelledby');
    return {
      levels: shown('h1, h2, h3, h4, h5, h6, [role=heading]').map((h) =>
        Number(h.getAttribute('aria-level') ?? h.tagName[1]),
      ),
      unnamedNavs: shown('nav, [role=navigation]').filter((e) => !named(e)).length,
      unnamedPanels: shown('aside, [role=complementary]').filter((e) => !named(e)).length,
    };
  });

test('I3.1-2,4: each main page and the open game have one h1, first, skip no heading level, and name every landmark', async ({
  page,
}) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/wishlist');
  await page.getByRole('button', { name: /Rank this list/ }).click();
  await expect(page).toHaveURL(/\/rank$/);
  const rank = new URL(page.url()).pathname;
  for (const [path, ready] of [
    ['/', page.getByText('Your lists')],
    ['/lists/owned', rows(page).first()],
    ['/about', page.getByRole('heading', { name: 'Contact' })],
    ['/search?q=hades', rows(page).first()],
    ['/bundles', rows(page).first()],
    [rank, page.getByText('Which do you prefer?')],
    ['/lists/owned?game=1145360', page.getByRole('complementary', { name: 'Hades' })],
  ] as const) {
    await page.goto(path);
    await expect(ready).toBeVisible();
    for (const landmark of [
      page.getByRole('banner'),
      page.getByRole('navigation', { name: 'Main', exact: true }),
      page.getByRole('search'),
      page.getByRole('main'),
    ])
      await expect(landmark, path).toBeVisible();
    const { levels, unnamedNavs, unnamedPanels } = await structure(page);
    expect(levels[0], path).toBe(1);
    expect(levels.filter((l) => l === 1).length, path).toBe(1);
    for (const [i, level] of levels.entries()) if (i) expect(level, path).toBeLessThanOrEqual(levels[i - 1] + 1);
    expect(unnamedNavs, path).toBe(0);
    expect(unnamedPanels, path).toBe(0);
  }
  // The open game's sections are headings under its name.
  const panel = page.getByRole('complementary', { name: 'Hades' });
  await expect(panel.getByRole('heading', { level: 2, name: 'Hades' })).toBeVisible();
  for (const name of ['Price', 'Owned by', /How Long To Beat/, /Achievements/])
    await expect(panel.getByRole('heading', { level: 3, name })).toBeVisible();
});

test('I3.3: each field on Home, the combine form and Compare says what it is for', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/');
  await expect(page.getByRole('search').getByRole('textbox', { name: 'Look up any game' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Steam name, profile URL, or 64-bit ID' })).toBeVisible();
  await page.getByRole('button', { name: 'New combined list' }).click();
  await expect(page.getByRole('textbox', { name: 'Combined list name (optional)' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'How to combine the sources' })).toBeVisible();
  await expect(
    page.getByRole('group', { name: 'Pick at least 2 sources:' }).getByRole('checkbox', { name: 'Alice — Owned' }),
  ).toBeVisible();

  await page.goto('/lists/compare');
  await expect(page.getByRole('combobox', { name: 'Player 1', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Player 2', exact: true })).toBeVisible();
});

test('I2.1: into a list from the keyboard — skip link, and R with no panel open', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  await expect(rows(page)).toHaveCount(6);

  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to table' })).toBeFocused();
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => document.activeElement?.closest('tbody') != null)).toBe(true);

  // The closed shortcuts dialog isn't rendered, so it's no Tab stop; open, it is.
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts', includeHidden: true });
  await expect(dialog).toBeHidden();
  await page.keyboard.press('?');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();

  await page.keyboard.press('r');
  await expect(page).toHaveURL(/[?&]game=\d+/);
  await expect(page.locator('.game-panel')).toBeVisible();
});

test("S1: share my wishlist's view; a fresh browser sees my games with my layout", async ({ page, browser }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/wishlist');
  await expect(rows(page)).toHaveCount(4);
  await page.locator('thead th').filter({ hasText: /^Name/ }).click();
  await page.evaluate(() => {
    (window as unknown as { copied: string[] }).copied = [];
    navigator.clipboard.writeText = async (text) => void (window as unknown as { copied: string[] }).copied.push(text);
  });
  await page.getByRole('button', { name: /Share view/ }).click();
  const link = await page.evaluate(() => (window as unknown as { copied: string[] }).copied[0]);
  expect(new URL(link).searchParams.get('u')).toBe(ALICE.steamid);

  const friend = await (await browser.newContext()).newPage();
  friend.on('pageerror', (err) => pageErrors.push(err.message));
  await mockApi(friend);
  await friend.goto(link);
  await expect(friend.getByRole('heading', { name: "Alice's Wishlist" })).toBeVisible();
  await expect(friend.getByText('This table uses a layout from a shared link')).toBeVisible();
  await expect(rows(friend)).toHaveCount(4);
});

test('S1 edge: sharing an unchanged layout sends no layout, so no shared-layout banner', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/wishlist');
  await expect(rows(page)).toHaveCount(4);
  await page.evaluate(() => {
    (window as unknown as { copied: string[] }).copied = [];
    navigator.clipboard.writeText = async (text) => void (window as unknown as { copied: string[] }).copied.push(text);
  });
  await page.getByRole('button', { name: /Share view/ }).click();
  const link = await page.evaluate(() => (window as unknown as { copied: string[] }).copied[0]);
  expect(new URL(link).searchParams.has('tv')).toBe(false);
});

test("S1 edge: a comparison's shared layout survives the link's rewrite to resolved players", async ({ page }) => {
  const tv = JSON.stringify({ sorts: [{ key: 'name', dir: 'desc' }] });
  await page.goto(`/lists/compare?u=alice&u=bob&tv=${encodeURIComponent(tv)}`);
  await expect(page.getByText('This table uses a layout from a shared link')).toBeVisible();
  await expect(page).not.toHaveURL(/[?&]u=alice/);
});

test("S2 edge: copying a game's link is announced, not only shown as ✓", async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned?game=1145360');
  await page.evaluate(() => {
    navigator.clipboard.writeText = async () => {};
  });
  await page.getByRole('button', { name: 'Copy link to this game' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Copied to clipboard' })).toHaveCount(1);
});

test("Y1.1,3: signed in on a new device, the account's lists win over this browser's newer ones", async ({ page }) => {
  await asPlayer(page, BOB, { updatedAt: Date.now() }); // newer than the account's prefs, still not trusted
  await mockApi(page, { states: ['signed-in'] });
  const pushed: Record<string, string> = {}; // key → every body pushed for it
  page.on('request', (req) => {
    const key = new URL(req.url()).pathname.split('/').pop()!;
    if (req.method() === 'PUT') pushed[key] = (pushed[key] ?? '') + req.postData();
  });
  await page.goto('/');

  await expect(page.getByRole('main')).toContainText(SYNCED_LIST); // adopted, then reloaded
  await expect(page.getByRole('banner')).toContainText('Alice');
  expect(pushed.recentAccounts).toContain(BOB.steamid); // a key the account lacks still goes up
  // Home may refresh Alice's slot (its vanity) and push that; never this browser's Bob.
  expect(pushed.myAccount ?? '').not.toContain(BOB.steamid);
  expect(pushed.currentAccount ?? '').not.toContain(BOB.steamid);

  await page.getByRole('banner').getByText('Alice', { exact: true }).click();
  await expect(page.getByText('Signed in — your accounts/lists/settings sync')).toBeVisible();
});

test('Y1 edge: signing out switches the account menu back to signing in', async ({ page }) => {
  await mockApi(page, { states: ['signed-in'] });
  await page.route('**/auth/logout', (route) => route.fulfill({ json: { ok: true } }));
  await page.goto('/about');
  await page.getByRole('banner').getByText('Alice', { exact: true }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('link', { name: 'Sign in with Steam' })).toBeVisible();
  await expect(page.getByText('Signed in — your accounts/lists/settings sync')).toHaveCount(0);
});

const moreFrom = (page: Page) => page.locator('#panel-section-similar .panel-similar-more');

test("F4.1-2,5: a game's publisher lists its games, the open game's panel kept, and Back returns", async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  await row(page, 'Terraria').getByText('Terraria').click();
  await moreFrom(page).getByRole('link', { name: 'All games by indie.io (publisher)' }).click();

  await expect(page).toHaveURL(
    (url) => url.pathname === '/lists/publisher' && url.searchParams.get('name') === 'indie.io',
  );
  await expect(page.locator('.list-hero-title')).toHaveText('Published by indie.io');
  await expect(page.locator('.list-hero')).toContainText('Every game on Steam whose publisher is exactly "indie.io"');
  await expect(rows(page)).toHaveCount(3);
  await expect(page.locator('#panel-title')).toHaveText('Terraria');
  // The list on screen is named, not linked.
  await expect(moreFrom(page).locator('[aria-current="page"]')).toHaveText('indie.io');

  // The panel is its own history entry, as on every list: Back closes it, then leaves.
  await page.goBack();
  await expect(page.locator('#panel-title')).toBeHidden();
  await page.goBack();
  await expect(page).toHaveURL(/\/lists\/owned/);
});

test('F4 edge: a developer that also publishes is one link, and one developer leads to another', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/game/1145360');
  await expect(moreFrom(page)).toContainText('Supergiant Games (developer & publisher)');
  await expect(moreFrom(page).getByRole('link')).toHaveCount(1);
  await moreFrom(page)
    .getByRole('link', { name: /Supergiant Games/ })
    .click();
  await expect(page.locator('.list-hero-title')).toHaveText('Games by Supergiant Games');
  await expect(rows(page)).toHaveCount(2);

  await page.goto('/lists/developer?name=Supergiant%20Games&game=367520');
  await expect(page.locator('#panel-title')).toHaveText('Hollow Knight');
  await moreFrom(page).getByRole('link', { name: 'All games by Team Cherry (developer)' }).click();
  await expect(page.locator('.list-hero-title')).toHaveText('Games by Team Cherry');
  await expect(rows(page)).toHaveCount(1);
});

test('S3 edge: a publisher\'s list link opens in a fresh browser, "/" in its name included', async ({ page }) => {
  await page.goto(`/lists/publisher?name=${encodeURIComponent('Feral Interactive (Mac/Linux)')}`);
  await expect(page.locator('.list-hero-title')).toHaveText('Published by Feral Interactive (Mac/Linux)');
  await expect(rows(page)).toHaveCount(1);
});

test("F4 edge: no game under that exact name says so and links Steam's own search", async ({ page }) => {
  await page.goto('/lists/developer?name=Nobody');
  await expect(page.locator('.list-empty')).toHaveText(
    'Steam\'s store has no games under the exact developer name "Nobody".',
  );
  await expect(page.getByRole('link', { name: 'Search the Steam store for "Nobody" ↗' })).toHaveAttribute(
    'href',
    'https://store.steampowered.com/search/?term=Nobody',
  );
});

test("F4 edge: Steam's store search down says so rather than no games, and Updated retries", async ({ page }) => {
  await mockApi(page, { states: ['store-down'] });
  await page.goto('/lists/developer?name=Re-Logic');
  await expect(page.locator('.list-status')).toContainText("Steam's store search didn't answer");
  await expect(page.locator('.list-empty')).toHaveCount(0);
  await mockApi(page);
  await page.getByRole('button', { name: /^Updated\b/ }).click();
  await expect(rows(page)).toHaveCount(1);
});

test("F4 edge: past Steam's first page, the list says only those are ranked", async ({ page }) => {
  await mockApi(page, { states: ['creator-capped'] });
  await page.goto('/lists/publisher?name=indie.io');
  await expect(rows(page)).toHaveCount(3);
  await expect(page.locator('.list-hero')).toContainText("Steam's 3 most relevant of about 523");
  await expect(page.getByRole('link', { name: 'All on Steam ↗' })).toHaveAttribute(
    'href',
    'https://store.steampowered.com/search/?publisher=indie.io',
  );
});

test("F4.3: a publisher's games I don't own open as a shared list, linked back and saved as my own", async ({
  page,
}) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/publisher?name=indie.io');
  await expect(rows(page)).toHaveCount(3);
  await page.getByRole('link', { name: "What don't I own?" }).click();

  await expect(page).toHaveURL(/\/lists\/shared\?f=/);
  await expect(page.locator('.list-hero-title')).toHaveText('Published by indie.io − Alice — Owned');
  await expect(rows(page)).toHaveCount(2);
  await expect(row(page, 'Terraria')).toHaveCount(0);
  await expect(page.locator('.list-formula').getByRole('link', { name: 'Published by indie.io' })).toHaveAttribute(
    'href',
    /\/lists\/publisher\?name=indie\.io/,
  );

  const more = page.getByRole('button', { name: 'More actions' }); // a phone folds Save behind More actions
  if (await more.isVisible()) await more.click();
  await page.getByRole('button', { name: 'Save as a list' }).click();
  await expect(page).toHaveURL(/\/lists\/(?!shared)/);
  await expect(rows(page)).toHaveCount(2);
});

const FERAL = 'p:Feral%20Interactive%20%28Mac%2FLinux%29'; // as encodeListFormula escapes it

test('S3 edge: a shared list with a publisher\'s name holding parens and "/" opens', async ({ page }) => {
  await page.goto(sharedUrl(`union:(${FERAL};r)`));
  await expect(page.locator('.list-hero-title')).toHaveText(
    'Published by Feral Interactive (Mac/Linux) ∪ Recently Looked Up',
  );
  await expect(rows(page)).toHaveCount(1);
});

test("F4 edge: Steam's store search down in a combined list names the source, and Updated retries it", async ({
  page,
}) => {
  await mockApi(page, { states: ['store-down'] });
  await asPlayer(page, ALICE);
  await page.goto(sharedUrl(`subtract:(p:indie.io;o:${ALICE.steamid})`));
  await expect(page.locator('.list-status')).toContainText('Published by indie.io: Steam store search error');
  await mockApi(page);
  const forced = page.waitForRequest((req) => /\/api\/creator-games\?.*refresh=1/.test(req.url()));
  await page.getByRole('button', { name: /^Updated\b/ }).click();
  await forced;
  await expect(rows(page)).toHaveCount(2);
});

test("F4 edge: past Steam's first page, a combined list's source says only those count", async ({ page }) => {
  await mockApi(page, { states: ['creator-capped'] });
  await asPlayer(page, ALICE);
  await page.goto(sharedUrl(`subtract:(p:indie.io;o:${ALICE.steamid})`));
  await expect(rows(page)).toHaveCount(2);
  await expect(page.locator('.list-formula')).toContainText('(first 3 of about 523)');
});

test('F4 edge: a game with no Steam tags still offers More from', async ({ page }) => {
  await mockApi(page, { states: ['tagless'] });
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned?game=105600');
  await expect(moreFrom(page).getByRole('link', { name: 'All games by Re-Logic (developer)' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sort list by similarity' })).toHaveCount(0);
});
