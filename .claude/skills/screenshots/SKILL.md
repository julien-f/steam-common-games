---
name: screenshots
description: Shoot, re-shoot or remove the committed screenshots under docs/images/ that README.md and the user docs embed. Use whenever a screenshot needs adding or updating after a UI change.
---

# Screenshots

Committed screenshots live in `docs/images/`, kebab-case, referenced from `README.md` and `docs/user/`. Nothing under `.playwright-mcp/` is committable — it's gitignored scratch.

## Never shoot a real account

Only the demo account may appear: <https://steamcommunity.com/profiles/76561198070571772/>. Real profiles reach the screenshots through the account card, "Recent accounts", the nav-bar chip and the panel's "Owned by" — including any extra account the user allowed for UX reviews.

`scripts/demo-prefs.js` holds the demo state (account with its name and avatar, example lists and folders) and the backup/restore around it: seed before opening any app page and restore after, as in [testing.md](../../../docs/dev/testing.md#looking-at-the-ui).

A shot needing more demo state (another list, a ranked list) gets it added to `demoPrefs()` rather than clicked together, named so it reads as an example.

## Capture

- Viewport 1440×900, downscaled to 1200px wide: `magick <in> -resize 1200x -strip <out>`.
- The side panel is an element shot of `.game-panel` instead.
- `fullPage` captures only the viewport — the desktop layout scrolls inside its own container. For a shot taller than 900px, set the viewport height to the content's height instead.
- Wait for the data a shot shows (ratings, HLTB, prices) to finish streaming; a first load of the demo library takes minutes while its details are uncached.

## Upkeep

- Re-shoot an image when the UI it shows changes.
- Delete a screenshot no doc references.
