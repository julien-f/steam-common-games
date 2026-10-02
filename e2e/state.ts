import { test, type Page } from '@playwright/test';
import type { Player } from './fixtures.ts';

// Seeds `player` as both my ★ account and the current one, once per tab: later reloads keep
// whatever the test did since. `withLabel: false` stores it the way an old slot was: id only.
export async function asPlayer(page: Page, player: Player, { withLabel = true } = {}): Promise<void> {
  const slot = {
    id: player.steamid,
    members: [player.steamid],
    rawInputs: [player.vanity],
    ...(withLabel ? { label: player.personaname } : {}),
    lastUsedAt: 0,
  };
  const entry = (value: unknown) => ({ value, updatedAt: 0 });
  const prefs = {
    schemaVersion: 2,
    myAccount: entry(slot),
    currentAccount: entry(slot),
    recentAccounts: entry([slot]),
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
