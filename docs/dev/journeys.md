# Journeys

What users come to the app to get done: the input for design reviews (walk each one, judge the friction) and for end-to-end tests.

- **Goals**: explore Steam libraries as lists of games, with ratings, completion times and prices in one table; combine lists to answer what Steam can't (what friends both own, what a bundle adds, what the family already has); share a view; run it yourself for a group of friends.
- **Non-goals**: buying or trading through the app; social features beyond reading Steam's friends lists; storing anything about an account beyond its cached public data and the user's own lists.

Each journey: **Who / goal**, numbered **Steps** as a user would take them, **Done when** (what must be true at the end) and **Edges** worth checking. ◇ marks a step or outcome the app doesn't support yet: the target a design review pushes toward. Which steps `e2e/scenarios.spec.ts` locks (★) is derived, never written: `node scripts/journey-coverage.js`.

Tests map to journeys by title: `A1: …` covers A1's built steps, `A1.1,3-4: …` only those steps, `A1 edge: …` its edges.

- [Accounts](#accounts)
- [Comparing libraries](#comparing-libraries)
- [Lists](#lists)
- [Ranking](#ranking)
- [Bundles and prices](#bundles-and-prices)
- [Finding a game](#finding-a-game)
- [Sharing](#sharing)
- [Sync](#sync)
- [Freshness and failures](#freshness-and-failures)
- [Devices and input](#devices-and-input)
- [Running an instance](#running-an-instance)

## Accounts

### A1 First visit: look at my library

- **Who / goal**: a new visitor wants to see their own games with ratings and completion times.
- **Steps**:
  1. open `/`
  2. paste a profile URL, vanity name or steam64 id
  3. resolve
  4. it becomes my ★ account automatically, being the first ◇
  5. open **Owned**
- **Done when**: the account card shows avatar, name, owned/wishlist counts; the nav chip names the account; Owned streams in rows with rating/HLTB filled progressively; reloading keeps everything.
- **Edges**: unknown identifier; private profile (looks empty — does the UI say _why_ it might be?); a very large library (thousands of games); slow upstream.

### A2 Explore a friend without losing my own setup

- **Who / goal**: I want to peek at a friend's wishlist, then return to mine.
- **Steps**:
  1. nav chip
  2. pick a recent account (or resolve a new one on Home)
  3. **Wishlist**
  4. switch back to my account from the chip
- **Done when**: my ★ account is unchanged; the friend lands in Recent accounts; open lists re-load in place on switch.
- **Edges**: removing a recent account that a dynamic list still uses (soft-remove, list keeps working).

### A3 Treat a Steam Family as one account

- **Who / goal**: a household sharing a Steam Family wants one merged library.
- **Steps**:
  1. Home
  2. enter one identifier
  3. **+ add another account**
  4. resolve
  5. open Owned
- **Done when**: one account slot with several members; a game anyone owns counts as owned; ⧉ copies one identifier per member.

### A4 Reach a friend through my friends list

- **Who / goal**: explore a friend without knowing their Steam identifier.
- **Steps**:
  1. Home, on my account
  2. friends list
  3. explore one
  4. back on Home, their friends list marks mutual friends
- **Done when**: the friend becomes the current account and joins Recent accounts, so Compare's player boxes offer them next.
- **Or**: 5. select several friends 6. **Compare with me** ◇ 7. lands on C1's result with me plus them, my current account unchanged
- **Edges**: private friends list; a Family's merged friends list; the list's ↻ after adding a friend on Steam.

## Comparing libraries

### C1 What can we all play tonight?

- **Who / goal**: a group of 2–5 friends wants the games they all own, best-rated first.
- **Steps**:
  1. **Compare**
  2. one player box per friend (pick known accounts or type identifiers; or start from A4's **Compare with me** ◇)
  3. submit
  4. read the "everyone" group
  5. sort by rating, filter by tag (e.g. co-op)
- **Done when**: groups ordered from "all of them" down to "only one"; the URL alone reproduces the comparison; my current account is unchanged.
- **Edges**: one friend private/unknown; a player box holding a Family; **Intersect** in the mode select (Union / Intersect / Subtract / Grouped by membership) for a single flat table.

### C2 What would one purchase unlock?

- **Who / goal**: find games all but one friend own, to decide what that friend should buy.
- **Steps**:
  1. C1
  2. read the group missing exactly one player
  3. sort it by price ◇
- **Done when**: group labels say clearly who is _in_ and who is _missing_; a group missing players carries price columns ◇, so no panel needs opening.

### C3 Keep a comparison

- **Steps**:
  1. C1
  2. **Save as a list**
  3. later, reopen it from Home's tree
- **Done when**: it re-resolves (new purchases show up) and its page states its formula and sources.

### C4 Which of my friends own this game?

- **Who / goal**: I'm looking at one game and want to know who I could play it with.
- **Steps**:
  1. F1
  2. the panel's "Owned by"
  3. it lists my friends who own it ◇
- **Done when**: today "Owned by" covers the current account's own members, or a comparison's players; answering this needs friends' libraries, i.e. one library fetch per friend — check integrations.md's budgets first.

### C5 Can everyone actually run it?

- **Who / goal**: the group from C1 includes a Linux / Steam Deck player.
- **Steps**:
  1. C1
  2. add the ProtonDB column
  3. filter out Borked
  4. pick from what's left
- **Done when**: games with no ProtonDB report are distinguishable from Borked ones.

### C6 Co-op with one friend

- **Who / goal**: find a co-op game we both own that neither of us has worn out.
- **Steps**:
  1. Compare me and a friend
  2. **Intersect**
  3. filter tag co-op
  4. filter low playtime for _both_ of us ◇
- **Done when**: per-player playtime columns ◇; today a comparison has no Played column at all (U71), only the panel's Owned by lists each player's playtime (frontend.md, Known gaps).

## Lists

### L1 Build a manual list

- **Who / goal**: keep a "to play with Alice" shortlist.
- **Steps**:
  1. from any list, select rows
  2. add to a new manual list
  3. name it
  4. put it in a folder
  5. or, while reading one game's panel, **Add to list** there ◇
- **Done when**: the list appears in Home's tree; adding/removing games persists across reloads.
- **Edges**: delete then restore (soft-delete — no restore UI yet, frontend.md's Known gaps); a folder's "Move to…" never offers its own subfolders.

### L2 Wishlisted but already owned in the family

- **Who / goal**: prune my wishlist of games someone in my family already has.
- **Steps**:
  1. Home
  2. combine
  3. **Intersect** my Wishlist with the family's Owned
  4. save as dynamic
- **Done when**: default name reads the formula ("Me — Wishlist ∩ Family — Owned"); renaming an account updates it.
- **Edges**: **Subtract** order is visible and reorderable; freezing turns it into a manual list; a source that is itself a dynamic or ranked list; deleting a list another one uses.

### L3 Customize and keep a table view

- **Steps**:
  1. any list
  2. change columns, sort, group, filters
  3. reload
  4. **Default view**
- **Done when**: the view persists per list kind; reset restores defaults.

### L4 Turn lookups into a shortlist

- **Steps**:
  1. look up several games (F1)
  2. Home
  3. **Recently Looked Up**
  4. select the keepers
  5. add to a manual list
- **Done when**: the manual list keeps them after Recently Looked Up moves on.

## Ranking

### R1 Rank my played games

- **Who / goal**: build a personal top list from my library without ranking all of it.
- **Steps**:
  1. Owned
  2. filter (e.g. played > 5 h)
  3. **🏆 Rank N games**
  4. answer pairs with ← / → / ↓ / S / X / Z
  5. stop with Esc halfway
  6. later **Continue: N chosen left** (or **Continue ranking**, for the whole list) on the list page to resume
- **Done when**: no answer lost on stop; the progress bar's estimate shrinks; the list sorts by Rank; **ℹ Details** opens the panel without losing the pair.
- **Edges**: Re-rank a selected game; Exclude one, then bring it back; Undo right after resuming; the source gains/loses a game; Change source keeps answers.

### R2 Rank what to buy next

- **Who / goal**: order my wishlist, or a bundle's games, by how much I want them.
- **Steps**:
  1. Wishlist
  2. **🏆 Rank this list**
  3. answer using ℹ Details (trailer, rating, HLTB) since I haven't played them
  4. sort the ranked list by Rank next to price columns
- **Done when**: the ranked list shows prices and badges like its source; buying a game (it leaves the Wishlist) drops it from the ranking.
- **Edges**: the exclude option reads "Not interested" here, not "Haven't played".

### R3 Share my ranking

- **Who / goal**: send a friend my top 20.
- **Steps**:
  1. ranked list
  2. **🔗 Share view** ◇
  3. friend opens it
- **Done when**: the friend sees the order read-only, and can save it or rank the same games themselves; ranked lists can't be shared today.

## Bundles and prices

### B1 Is this bundle worth it for me?

- **Who / goal**: judge a bundle by what it adds to my library and how good those games are.
- **Steps**:
  1. **Bundles**
  2. narrow with "New" / "Ending soon"
  3. open one
  4. check tier price vs. best deals, owned badges, ratings
- **Done when**: owned games are obvious; games with no Steam listing are listed below the table, not dropped.
- **Edges**: no `ITAD_API_KEY` configured (Bundles unavailable — is that explained?); region change reprices; a Fanatical pick-and-mix bundle shows its quantity tiers, prices the selection and links to buying it (★); a tab left open for hours shows stale countdowns (frontend.md, Known gaps).

### B2 Is my wishlist on sale?

- **Steps**:
  1. Wishlist
  2. sort by discount or filter record-low badges (🔥 ★ ☆)
  3. ⚙ Preferences to set region
- **Done when**: prices state their region and age; ↻ on the Prices figure refreshes them only.

### B3 What does this bundle add for the whole household?

- **Who / goal**: judge a bundle against everything my Family or group already owns, not just my own games.
- **Steps**:
  1. open a bundle
  2. **What does this add?** (bundle minus my Owned, unsaved)
  3. **Save as a list**
  4. **Edit sources** to swap in the Family's Owned (or **Group by membership** with a friend's Owned)
- **Edges**: the bundle ends and IsThereAnyDeal stops listing it — the list keeps its last-known games and says so.
- **Done when**: the default name reads the formula; games with no Steam listing are still accounted for.

### B4 Buy a friend a gift

- **Who / goal**: pick something from a friend's wishlist within a budget.
- **Steps**:
  1. explore the friend (A2/A4)
  2. **Wishlist**
  3. sort by best price or filter record lows
  4. open one
  5. check it's not in their Family's library
- **Done when**: prices are in _my_ region, not theirs, and say so; switching back to my account is one click.

## Finding a game

### F1 Look up one game

- **Who / goal**: check a game's rating, length, Linux support and price before buying.
- **Steps**:
  1. nav search (`/`)
  2. type
  3. pick
  4. read the panel (media, rating, HLTB, ProtonDB, price, owned-by)
  5. ↑/↓ or R to wander
- **Done when**: on a list route the panel opens in place; elsewhere it goes to `/game/:appid`; the game joins Recently Looked Up.
- **Edges**: no match; DLC → base-game link; phone width (panel vs. table); Back closes the panel (and the lightbox over it) before leaving the list.

### F2 Search from the browser address bar

- **Steps**:
  1. add the OpenSearch engine (or a Firefox keyword bookmark on `/search?q=%s`)
  2. type `steam half-life`
- **Done when**: lands on `/search` with the closest match open; the on-page box refines without reopening the panel.

### F3 What should I play next?

- **Who / goal**: pick something from my backlog for tonight, short and well rated.
- **Steps**:
  1. Owned
  2. show the Played column
  3. filter to never played
  4. sort by HLTB (shortest first) or rating
  5. **🎲 Pick for me** ◇ (or **R**) for a random pick, or browse with ↑/↓
- **Done when**: HLTB and rating fill in without a reload; the random pick draws only from the filtered rows and works on a phone ◇; the filter survives a reload (L3).
- **Edges**: games with no HLTB entry (where do they sort?); a Family account (whose playtime counts?).

## Sharing

### S1 Send a friend a view

- **Who / goal**: show a friend my curated, filtered wishlist.
- **Steps**:
  1. set up the table
  2. **🔗 Share view** (carries my account on Owned/Wishlist)
  3. friend opens the link
- **Done when**: the friend sees my account's list with my layout; their own account and saved views are untouched; clicking around keeps the shared account.
- **Edges**: sharing a dynamic list (`/lists/shared?f=`) → friend saves it; on a ranked or manual-sourced list the button says why it can't share, before it's clicked ◇.

### S2 Link one game

- **Steps**:
  1. panel
  2. 🔗 copy link
  3. open elsewhere
- **Done when**: `/game/<appid>` opens for anyone and carries no account.

### S3 Open a link from a fresh browser

- **Who / goal**: the recipient of S1, C1 or S2 has never used the app.
- **Steps**:
  1. open the link in a private window
  2. change the view
  3. reload
  4. go Home
- **Done when**: the page works with no local state; their changes are theirs and the link's layout is only the starting point; Home offers no ★ account until they pick one.
- **Edges**: a `/lists/<id>` link to a list that exists only in the sender's browser (what does the dead link say?); reload with `?game=` on a route that doesn't restore it (frontend.md, Known gaps).

## Sync

### Y1 Same lists on another device

- **Who / goal**: I built lists on my desktop and want them on my laptop.
- **Steps**:
  1. sign in with Steam (nav chip) on both
  2. edit a list on one
  3. reload the other
- **Done when**: first sign-in on a new device never overwrites the account's existing prefs; later edits merge per key, last-write-wins; a changed table view shows the "unsaved changes" banner with Save / Revert instead of syncing silently.
- **Edges**: a list deleted on one device while the other edits it; signing out; signing in as a Steam account other than my ★ one.

### Y2 Losing my browser data

- **Who / goal**: I cleared site data, or switched browsers, and my lists are gone.
- **Steps**:
  1. open the app
  2. Home is empty
  3. sign in with Steam
- **Done when**: if I had synced, everything comes back; if I hadn't, did the app ever suggest syncing before it mattered? There's no export/backup path.

### Y3 Two tabs at once

- **Steps**:
  1. open the same list in two tabs
  2. add a game in one
  3. remove another in the second
  4. reload both
- **Done when**: no silent loss of either edit; today there's no cross-tab sync (lists-and-accounts.md), so this is where one tab overwrites the other.

## Freshness and failures

### D1 "I just bought it — why isn't it here?"

- **Who / goal**: a game I bought an hour ago is missing from Owned; library data is cached for up to 30 days.
- **Steps**:
  1. Owned
  2. notice the **Updated** age
  3. click it
  4. the game appears
- **Done when**: an age older than a few days is highlighted ◇, so the fix is suggested before I wonder; on a dynamic list or comparison, Updated re-fetches every source account.
- **Edges**: a single bundle's page, where the age can't be refreshed (features.md explains why).

### D2 An upstream is down

- **Who / goal**: HLTB, ProtonDB, ITAD or the Steam store fails or rate-limits partway through a large list.
- **Steps**:
  1. open a large Owned or Wishlist
  2. watch the affected column
  3. retry with ↻ in the panel once the upstream is back
- **Done when**: the failing column says it failed rather than looking empty; other columns and the rest of the table are unaffected; the ↻ retry works.

### D3 Back after a month

- **Who / goal**: I haven't opened the app in weeks; what changed that I care about?
- **Steps**:
  1. open Home
  2. see what's new since my last visit ◇: wishlist games now at a record low, new bundles containing wishlist games, owned games not yet in my ranking
- **Done when**: each item links to the list that shows it; nothing is stored server-side, so "last visit" lives in localStorage (and Sync).

## Devices and input

### I1 Phone first

- **Who / goal**: on the couch, on a phone, doing A1, C1, F3 or R1.
- **Steps**:
  1. each of those at phone width
- **Done when**: the table stays usable (columns, horizontal scroll); the panel and swipe-to-close work; ranking works by tapping cards, with no keyboard.

### I2 Keyboard only

- **Steps**:
  1. `?`
  2. `/` to search
  3. ↑/↓ through the table
  4. ←/→ through the panel's media
  5. Esc
  6. rank a pair with keys only
- **Done when**: focus is always visible and never trapped; Esc closes the innermost thing first.

## Running an instance

### O1 Self-host and keep it healthy

- **Who / goal**: someone deploying their own instance for a group of friends.
- **Steps**:
  1. set the keys in `.env` (see `default.env`; `ITAD_API_KEY` for Bundles and prices)
  2. start
  3. use it
  4. check `GET /api/metrics` and the log warnings
- **Done when**: a missing optional key disables only its feature, and the UI says so; metrics show outbound usage against its budget before an upstream starts refusing (observability.md).
