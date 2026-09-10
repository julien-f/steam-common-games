---
name: screenshots
description: Shoot, re-shoot or remove the committed screenshots under docs/images/ that README.md and the user docs embed. Use whenever a screenshot needs adding or updating after a UI change.
---

# Screenshots

Committed screenshots live in `docs/images/`, kebab-case, referenced from `README.md` and `docs/user/`. Nothing under `.playwright-mcp/` is committable — it's gitignored scratch.

## Never shoot a real account

Only the demo account may appear: <https://steamcommunity.com/profiles/76561198070571772/>. Real profiles reach the screenshots through the account card, "Recent accounts", the nav-bar chip and the panel's "Owned by".

1. Back up `localStorage`'s `steam.isonoe.net:prefs`.
2. Clear it, then seed the demo state — demo lists/folders go straight into `localStorage` rather than being clicked together, named so they read as examples ("Couch co-op picks", "Friday shortlist").
3. Shoot.
4. Restore the backup.

## Capture

- Viewport 1440×900, downscaled to 1200px wide: `magick <in> -resize 1200x -strip <out>`.
- The side panel is an element shot of `.game-panel` instead.

## Upkeep

- Re-shoot an image when the UI it shows changes.
- Delete a screenshot no doc references.
