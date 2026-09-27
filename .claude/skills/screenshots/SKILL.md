---
name: screenshots
description: Shoot, re-shoot or remove the committed screenshots under docs/images/ that README.md and the user docs embed. Use whenever a screenshot needs adding or updating after a UI change.
---

# Screenshots

Committed screenshots live in `docs/images/`, kebab-case, referenced from `README.md` and `docs/user/`. Nothing under `.playwright-mcp/` is committable — it's gitignored scratch.

## Never shoot a real account

Only the demo account may appear: <https://steamcommunity.com/profiles/76561198070571772/>. Real profiles reach the screenshots through the account card, "Recent accounts", the nav-bar chip and the panel's "Owned by" — including any extra account the user allowed for UX reviews.

`scripts/demo-prefs.js` holds the demo state (account with its name and avatar, example lists and folders) and the backup/restore around it. **Seed before opening any app page** — every route with a table writes prefs:

1. `node scripts/demo-prefs.js seed --file`, then run `.playwright-mcp/demo-seed.js` with `browser_run_code_unsafe`'s `filename`. It backs up `steam.isonoe.net:prefs` first and refuses if a backup already exists — restore that one first, never overwrite it.
2. Shoot.
3. `node scripts/demo-prefs.js restore --file`, run `.playwright-mcp/demo-restore.js`, and confirm the backup key is gone.

A shot needing more demo state (another list, a ranked list) gets it added to `demoPrefs()` rather than clicked together, named so it reads as an example.

## Capture

- Viewport 1440×900, downscaled to 1200px wide: `magick <in> -resize 1200x -strip <out>`.
- The side panel is an element shot of `.game-panel` instead.
- Wait for the data a shot shows (ratings, HLTB, prices) to finish streaming; a first load of the demo library takes minutes while its details are uncached.

## Upkeep

- Re-shoot an image when the UI it shows changes.
- Delete a screenshot no doc references.
