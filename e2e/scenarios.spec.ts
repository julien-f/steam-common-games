// docs/dev/journeys.md's journeys, end to end against mocked data (mockApi.ts).
import { test, expect, type Page } from '@playwright/test';
import { mockApi, respond } from './mockApi.ts';
import { asPlayer, shot } from './state.ts';
import { ALICE, BOB, BUNDLE, SYNCED_LIST } from './fixtures.ts';

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

test('S3 edge: About names every data source, ProtonDB included', async ({ page }) => {
  await page.goto('/about');
  const sources = page.locator('.card', { hasText: 'Data sources' });
  for (const name of ['Steam Web API', 'Steam Store', 'HowLongToBeat', 'ProtonDB', 'IsThereAnyDeal'])
    await expect(sources.getByText(name, { exact: true })).toBeVisible();
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
  // Empty until a bound is set; the column's bounds show as placeholders in its own format (0 h is "—").
  const bounds = () =>
    page.locator('.dt-range-input').evaluateAll((inputs) => inputs.map((i) => (i as HTMLInputElement).placeholder));
  await expect.poll(bounds).toEqual(['—', '20.0']);
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

test('L3 edge: the column menu undoes the group and filter it set', async ({ page }, testInfo) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned');
  const menu = page.getByRole('button', { name: /^Weighted Rating options/ });
  const dialog = page.getByRole('dialog', { name: /^Weighted Rating options/ });

  await menu.click();
  await dialog.getByRole('button', { name: 'Group by this column' }).click();
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
  await expect(page.locator('.panel-bundles')).toHaveCount(0); // the line above already says why
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

test("F1 edge: the Price card says when ITAD didn't answer, and the panel's ↻ retries it", async ({ page }) => {
  let down = true;
  // Both the health check and the price lookup fail until the "upstream" is back.
  await page.route(/\/api\/(health|prices)$/, (route) =>
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

test('F1 edge: the panel closes from its × after scrolling it', async ({ page }) => {
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
      this.dispatchEvent(new Event('pause'));
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

test('F1 edge: on a phone, the ‹ › buttons sit clear of the media and its controls', async ({ page }, testInfo) => {
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

test("F1 edge: the viewer's game stepper shows on hover or focus with a mouse, always on touch", async ({
  page,
}, testInfo) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned?game=1145360&shot=s1');
  const pos = page.locator('.lb-caption-pos');
  const prev = page.locator('#screenshot-lightbox .lb-game-prev');
  if (testInfo.project.name === 'phone') {
    await expect(pos).toHaveCSS('opacity', '1');
    await expect(prev).toHaveCSS('opacity', '1');
    return;
  }
  await expect(pos).toHaveCSS('opacity', '0');
  await expect(prev).toHaveCSS('opacity', '0');
  await page.locator('.lb-caption-text').hover();
  await expect(pos).toHaveCSS('opacity', '1');
  await expect(prev).toHaveCSS('opacity', '1');
  await page.mouse.move(720, 450);
  await expect(pos).toHaveCSS('opacity', '0');
  await prev.focus();
  await expect(prev).toHaveCSS('opacity', '1');
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

test('F1 edge: after closing the game with ×, one Back leaves the list', async ({ page }) => {
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

test("I2 edge: the panel's current thumbnail is exposed, not only coloured", async ({ page }) => {
  await asPlayer(page, ALICE);
  await page.goto('/lists/owned?game=1145360');
  const current = page.locator('.panel-film-item[aria-current="true"]');
  await expect(current).toHaveAccessibleName('Cover');
  await page.getByRole('button', { name: 'Screenshot 2 of 3' }).click();
  await expect(current).toHaveAccessibleName('Screenshot 2 of 3');
  await expect(current).toHaveCount(1);
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
  await expect(page.getByRole('navigation')).toContainText('Alice');
  expect(pushed.recentAccounts).toContain(BOB.steamid); // a key the account lacks still goes up
  // Home may refresh Alice's slot (its vanity) and push that; never this browser's Bob.
  expect(pushed.myAccount ?? '').not.toContain(BOB.steamid);
  expect(pushed.currentAccount ?? '').not.toContain(BOB.steamid);

  await page.getByRole('navigation').getByText('Alice', { exact: true }).click();
  await expect(page.getByText('Signed in — your accounts/lists/settings sync')).toBeVisible();
});
