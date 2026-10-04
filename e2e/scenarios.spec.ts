// docs/dev/journeys.md's journeys, end to end against mocked data (mockApi.ts).
import { test, expect, type Page } from '@playwright/test';
import { mockApi } from './mockApi.ts';
import { asPlayer, shot } from './state.ts';
import { ALICE, BOB, BUNDLE } from './fixtures.ts';

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

test('A1: first visit — resolve my account, then open my library', async ({ page }) => {
  await page.goto('/');
  await page.getByPlaceholder('Steam name, profile URL, or 64-bit ID…').fill('alice');
  await page.getByRole('button', { name: 'Set as current account' }).click();
  await expect(page.getByRole('main')).toContainText('Owned: 6');
  await expect(page.getByText('Friends (private)')).toBeVisible(); // the mock's friends lists are private

  await page.getByRole('main').getByRole('link', { name: 'Owned', exact: true }).click();
  await expect(rows(page)).toHaveCount(6);
  await expect(row(page, 'Hades')).toContainText('44.5');

  await page.reload();
  await expect(page.getByRole('navigation')).toContainText('Alice');
  await expect(rows(page)).toHaveCount(6);
});

test('A1 edge: Owned with no account points to Home rather than showing 0 games', async ({ page }) => {
  await page.goto('/lists/owned');
  await expect(page.getByText('No account selected')).toBeVisible();
  await expect(page.locator('.list-hero')).not.toContainText('Games');
  await page.getByRole('link', { name: 'pick one on Home' }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('A2.1-2,4: explore a friend, then switch back to my ★ account from the nav chip', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/');
  await page.getByPlaceholder('Steam name, profile URL, or 64-bit ID…').fill('bob');
  await page.getByRole('button', { name: 'Set as current account' }).click();
  await expect(page.getByRole('navigation')).toContainText('Bob');

  await page.getByRole('navigation').getByText('Bob', { exact: true }).click();
  const back = page.getByRole('button', { name: /Alice/ }).filter({ has: page.getByTitle(/Your account/) });
  await expect(back).toBeVisible();
  await back.click();
  await expect(page.getByRole('navigation')).toContainText('Alice');
});

test('S3 edge: an unknown path says so and links Home', async ({ page }) => {
  await page.goto('/compare');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await page.getByRole('link', { name: 'Go to Home' }).click();
  await expect(page).toHaveURL('/');
});

test("S3 edge: another browser's list link explains lists are local", async ({ page }) => {
  await page.goto('/lists/not-in-this-browser');
  await expect(page.getByText("This list isn't in this browser")).toBeVisible();
  await expect(page.getByText('Share list')).toBeVisible();
});

test('A1 edge: an account stored without its name picks it up from Home', async ({ page }) => {
  await asPlayer(page, ALICE, { withLabel: false });
  await page.goto('/');
  await expect(page.getByRole('navigation')).toContainText('Alice');
  await page.reload();
  await expect(page.getByRole('navigation')).toContainText('Alice');
});

test('F3 edge: the Played (h) filter range reads in rounded hours', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  await expect(rows(page)).toHaveCount(6);
  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  await page.locator('.dt-filter-cols-search').fill('Played');
  await page.locator('[data-filter-col-key="playtime"]').click();
  const bounds = () =>
    page.locator('.dt-range-input').evaluateAll((inputs) => inputs.map((i) => (i as HTMLInputElement).value));
  await expect.poll(bounds).toEqual(['0', '20']);
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
  const more = page.getByRole('button', { name: 'More actions' }); // a phone folds Save behind ⋯
  if (await more.isVisible()) await more.click();
  await page.getByRole('button', { name: 'Save as a list' }).click();
  await expect(page).toHaveURL(/\/lists\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'Alice vs. Bob' })).toBeVisible();
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

test('L1.1-3: select games, add them to a new list, open it', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  await row(page, 'Portal 2').getByRole('checkbox').check();
  await row(page, 'Terraria').getByRole('checkbox').check();

  const toolbar = page.locator('.selection-toolbar');
  await toolbar.getByRole('combobox').selectOption({ label: '+ Create new list…' });
  await page.getByRole('textbox', { name: 'New list name' }).fill('To play with Bob');
  await page.keyboard.press('Enter');

  const toast = page.getByRole('status').filter({ hasText: 'Added 2 games to new list "To play with Bob"' });
  await expect(toast).toBeVisible();
  await toast.getByRole('link', { name: 'Open list' }).click();
  await expect(page.getByRole('heading', { name: 'To play with Bob' })).toBeVisible();
  await expect(rows(page)).toHaveCount(2);
});

test("L1 edge: the new list's toast stays while pointed at", async ({ page }) => {
  await page.clock.install();
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  await row(page, 'Portal 2').getByRole('checkbox').check();
  await page.locator('.selection-toolbar').getByRole('combobox').selectOption({ label: '+ Create new list…' });
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
  page.once('dialog', (d) => d.accept('Shortlist'));
  await page.getByRole('button', { name: '+ New list' }).click();
  page.once('dialog', (d) => d.accept('Weekend'));
  await page.getByRole('button', { name: '+ New folder' }).click();

  const move = page.getByRole('combobox', { name: 'Move Shortlist to…' });
  await expect(move).toHaveValue(''); // showing "Move to…", so picking the folder is a change
  await move.selectOption({ label: '📁 Weekend' });
  await expect(move.locator('option')).toContainText(['Move to…', 'Top level']); // now inside Weekend
  await expect(move).toHaveValue('');
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
    await page.getByRole('button', { name: 'Close', exact: true }).click(); // a phone's panel covers the search
  }
  await page.goto('/game');
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).first()).toContainText('Valheim');
  await expect(page.locator('.list-hero')).toContainText('last 10');
});

test("R1 edge: a ranking card's HLTB time is the table's, rounded and labelled", async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  await expect(page.locator('thead th').filter({ hasText: /^HLTB \(h\)/ })).toHaveCount(1);
  await expect(row(page, 'Hades')).toContainText('44.5');
  for (const name of ['Portal 2', 'Hades']) await row(page, name).getByRole('checkbox').check();
  await page.getByRole('button', { name: '🏆 Rank 2 games' }).click();
  await expect(page.locator('.rank-route')).toContainText('44.5 h to beat');
});

test('R1.1,3-6: rank chosen games, stop, resume on the same ones', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  for (const name of ['Portal 2', 'Terraria', 'Hades']) await row(page, name).getByRole('checkbox').check();
  await page.getByRole('button', { name: '🏆 Rank 3 games' }).click();

  await expect(page.getByText('Comparing 3 chosen games.')).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Escape');

  const resume = page.getByRole('button', { name: /^Continue: \d+ chosen left$/ });
  await expect(resume).toBeVisible();
  await resume.click();
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
  await expect(share).toBeDisabled();
  await expect(share).toHaveAttribute('title', /can't be shared/);
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
  await page.locator('summary', { hasText: /Rank this list/ }).click();
  const menu = page.locator('.rank-menu-panel');
  await expect(menu.getByRole('button', { name: /Ranking of Alice — Wishlist/ })).toBeVisible();
  await menu.getByRole('textbox', { name: 'What are you ranking by?' }).fill('co-op');
  await menu.getByRole('button', { name: '+ New ranking' }).click();
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

test("B3 edge: a list built from a bundle says how many of its games aren't on Steam", async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto(`/lists/bundle/${BUNDLE.id}`);
  await expect(rows(page)).toHaveCount(4);
  const more = page.getByRole('button', { name: 'More actions' }); // a phone folds it behind ⋯
  if (await more.isVisible()) await more.click();
  await page.getByRole('link', { name: 'What does this add?' }).click();
  await expect(page.locator('.list-formula')).toContainText('1 not on Steam');
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

test('B1 edge: with no ITAD key, Bundles says why it is empty', async ({ page }) => {
  await mockApi(page, { states: ['no-itad'] }); // registered last, so it answers first
  await asPlayer(page, ALICE);
  await page.goto('/bundles');
  await expect(page.getByRole('main')).toContainText("Bundles and prices aren't available on this instance");
  await expect(page.getByRole('main')).not.toContainText(/ITAD_API_KEY|Error:/);
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
});

test('D1 edge: Updated ↻ keeps the rows and the selection while it refreshes', async ({ page }) => {
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
  await page.locator('.list-stat', { hasText: 'Updated' }).click();
  await expect(page.locator('.list-stat', { hasText: 'Updated' })).toContainText('Refreshing');
  await expect(rows(page)).toHaveCount(6);
  await expect(row(page, 'Hades')).toContainText('44.5'); // details still on screen
  release();
  await expect(page.locator('.list-stat', { hasText: 'Updated' })).not.toContainText('Refreshing');
  await expect(rows(page)).toHaveCount(6);
  await expect(row(page, 'Portal 2').getByRole('checkbox')).toBeChecked();
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

test('F1 edge: the panel closes from its × after scrolling it', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  await row(page, 'Hades').getByText('Hades').click();
  await expect(page.locator('#panel-title')).toHaveText('Hades');
  await page.locator('#panel-body').evaluate((el) => el.scrollTo(0, 400));
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('#game-panel')).toBeHidden();
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

  // Esc closes the panel; a second one leaves the search box, so shortcuts work again.
  await page.keyboard.press('/');
  await page.keyboard.type('zz');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('INPUT');
});

test("I1 edge: on a phone, a bundle's table starts high, its other actions behind ⋯", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'phone layout only');
  await asPlayer(page, ALICE);
  await page.goto(`/lists/bundle/${BUNDLE.id}`);
  await expect(rows(page)).toHaveCount(4);
  const top = await rows(page)
    .first()
    .evaluate((el) => el.getBoundingClientRect().top + scrollY);
  expect(top).toBeLessThan(520); // 761 with the hero's tiles and actions wrapping
  await expect(page.getByRole('link', { name: '← All bundles' })).toBeHidden();
  await page.getByRole('button', { name: 'More actions' }).click();
  await expect(page.getByRole('link', { name: '← All bundles' })).toBeVisible();
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

test('I2.1: into a list from the keyboard — skip link, and R with no panel open', async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  await expect(rows(page)).toHaveCount(6);

  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to table' })).toBeFocused();
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => document.activeElement?.closest('tbody') != null)).toBe(true);

  // The closed shortcuts dialog isn't a Tab stop; open, it is.
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts', includeHidden: true });
  await expect(dialog).toHaveAttribute('inert', '');
  await page.keyboard.press('?');
  await expect(dialog).not.toHaveAttribute('inert');
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
