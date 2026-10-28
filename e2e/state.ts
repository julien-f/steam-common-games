import { test, type Page } from '@playwright/test';
import { game, type Player } from './fixtures.ts';

// Seeds `player` as both my ★ account and the current one, once per tab: later reloads keep
// whatever the test did since. `withLabel: false` stores it the way an old slot was: id only.
// `recentGames`: Recently Looked Up's appids, newest first. `updatedAt`: every key's last-write time.
// `otherAccounts`: names of extra known accounts (display only: they resolve to nothing).
// `listViews`: the listViews.ts pref, saved views per kind. `lists`: the user's lists (listsStore.ts).
export async function asPlayer(
  page: Page,
  player: Player,
  {
    withLabel = true,
    recentGames = [] as number[],
    updatedAt = 0,
    otherAccounts = [] as string[],
    listViews = undefined as object | undefined,
    lists = undefined as object[] | undefined,
  } = {},
): Promise<void> {
  const slot = {
    id: player.steamid,
    members: [player.steamid],
    rawInputs: [player.vanity],
    ...(withLabel ? { label: player.personaname } : {}),
  };
  const entry = (value: unknown) => ({ value, updatedAt });
  const prefs = {
    schemaVersion: 2,
    myAccount: entry(slot),
    currentAccount: entry(slot),
    recentAccounts: entry([
      slot,
      ...otherAccounts.map((label, i) => ({ id: `${9000 + i}`, members: [`${9000 + i}`], rawInputs: [label], label })),
    ]),
    ...(recentGames.length
      ? { recentGames: entry(recentGames.map((appid) => ({ appid, name: game(appid).name, tinyImage: null }))) }
      : {}),
    ...(listViews ? { listViews: entry(listViews) } : {}),
    ...(lists ? { lists: entry(lists) } : {}),
  };
  await page.addInitScript((blob) => {
    if (sessionStorage.getItem('e2e-seeded')) return;
    localStorage.setItem('steam.isonoe.net:prefs', blob);
    sessionStorage.setItem('e2e-seeded', '1');
  }, JSON.stringify(prefs));
}

// A named mid-test screenshot, kept only on an `E2E_SHOTS=1` run (see playwright.config.ts).
export async function shot(page: Page, name: string): Promise<void> {
  if (test.info().project.use.screenshot !== 'on') return;
  await page.screenshot({ path: test.info().outputPath(`${name}.png`) });
}
