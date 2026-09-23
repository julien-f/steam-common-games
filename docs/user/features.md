# What the app does

Everything the app shows is a **list of games** — an account's owned games, its wishlist, a bundle, games you looked up, or a list you made yourself — and every list opens in the same viewer: a sortable, filterable, groupable table with a detail panel beside it.

![A bundle's games in the table — tier price, best deal, weighted rating, completion time — with one game's detail panel open beside it](../images/list-table-and-panel.png)

There is no account to create and nothing is stored on the server. The accounts you look at, the lists you build and your preferences all live in your own browser.

- [Accounts](#accounts)
- [Lists](#lists)
  - [Combining lists](#combining-lists)
  - [Comparing libraries](#comparing-libraries)
- [Bundles](#bundles)
- [Prices](#prices)
- [The game panel](#the-game-panel)
- [Sharing](#sharing)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [How fresh is this?](#how-fresh-is-this)

## Accounts

Enter a Steam profile URL, vanity name or 64-bit ID on the home page to explore that account. Several identifiers at once resolve into one **Family** — their libraries are merged, so a game anyone in the family owns counts as owned.

- **Current account** — whoever you're exploring right now. The nav bar always says who that is, with one-click links to their **Owned** and **Wishlist** lists.
- **My account** — star (★) any account in the picker to pin it as your default.
- **Recent accounts** are remembered, and switchable from the nav-bar chip without going back home.
- **⧉ copies an account's Steam identifier** — its custom URL name when it has one (`gaben`), its 64-bit ID otherwise — from the home page's account card, from every account in "Recent accounts" and in the nav-bar chip (one ⧉ per member for a Family). Any remembered account's identifier is one click away, current or not. That's the identifier to hand to someone else, or to paste back into the account field here.

A private profile or wishlist looks identical to an empty one from the outside; the app shows what it can see.

## Lists

- **Owned** and **Wishlist** for the current account, and one list per **bundle** you browse, are always live — never stored, never stale.
- **Recently Looked Up** collects games you searched for, browsable like any other list.
- **Your own lists** come in three kinds: a **manual** list you add and remove games from, a **dynamic** list defined as a formula over other lists, recomputed every time you open it, and a **ranked** list that orders another list by your preferences (see [Ranking a list](#ranking-a-list)). A dynamic list can be **frozen** into a manual one, keeping its current contents and dropping the formula.
- Lists live in a **folder tree** you can rename, nest and organize.

![The home page: the current account's card, the four always-available lists, and your own folder tree of lists](../images/home-lists.png)

### Combining lists

Pick two or more lists and an operation:

- **Union** — everything in any of them.
- **Intersect** — only what they all share.
- **Subtract** — what's in the first but not the others. Pick order sets which source is "first" — the combine form shows your picks as a numbered, reorderable list whenever Subtract is chosen.
- **Group by membership** — one table per combination of sources, so you can see what all three accounts share, what only two do, and so on. Combining several accounts' Owned lists this way is how you compare libraries.

Naming the combined list is optional: leave the name empty and it's called by what it does — "Alice — Owned ∩ Bob — Owned" — in your list tree and on its own page, updating by itself if you later change its sources or rename an account. Type a name whenever you'd rather have one.

The result is a live list: save it as dynamic (it re-resolves each time), or freeze it. A dynamic list's page states its formula, names every source, and says what each contributed.

![Two lists combined with group by membership: one table per combination — in both lists, then each list's exclusive games — under the formula that produced them](../images/group-by-membership.png)

### Ranking a list

**🏆 Rank this list** (on Owned, Wishlist, a bundle or any of your lists) creates a ranked list and asks you two games at a time: *which do you prefer?*

- **← / →** pick one, **↓** Tie, **S** Skip (asked again later), **X** then **← / →** or "Haven't played" to exclude a game, **Z** Undo. All are buttons too.
- Stop whenever you like (**Esc**): every answer is saved, and **Compare** on the list's page picks up where you left off.
- Each new game is placed with as few questions as possible — about 7 for a list of 100 already-ranked games. The progress bar says roughly how many are left.
- The list's page sorts by **Rank**. Select rows to **Re-rank** a game (it's asked again) or **Exclude** it.
- To rank only some games — say, your RPGs — filter the table, select all, then **Compare N selected**: only those games are asked about, each still placed against the whole ranking. The rest wait until you compare them.
- It follows its source: games added later are queued for comparison; a removed game drops out, and gets its rank back if it returns. **Change source** keeps every answer already given.
- A ranked list can't be shared via a link yet.

### Comparing libraries

**Compare** in the nav bar asks for two or more players and shows what they own, grouped by exactly who owns what: everything all of them share first, then each smaller combination, down to what only one of them has. Add several identifiers to one player to compare a whole Steam Family as one library.

Each player is a box you drop accounts into: it offers the accounts you've already looked at as you type, and takes a Steam name, profile URL or 64-bit ID for anyone it doesn't know yet. Put two accounts in the *same* player to compare a Steam Family — or any pair of libraries — as one. Picking an account doesn't add it to your recents or change your current account.

The result is a link. Copy the address and whoever opens it sees the same comparison — it names the players, so it doesn't depend on anything saved in your browser, and it doesn't change the recipient's own account. Switch it to **Intersect** for a single flat table of what everyone owns, or **Save as a list** to keep it in your own list tree, where it re-resolves every time you open it.

## Bundles

Browse current Steam game bundles (sourced from IsThereAnyDeal, and only available if the app is configured with an ITAD key). Open one and its games become a list like any other, with the bundle's tier price alongside each game's rating, playtime estimates and current best price anywhere. Games in a bundle with no Steam listing are listed separately below the table rather than quietly dropped. The header's counts are clickable: "New" narrows the table to the bundles published in the last week, "Ending soon" to the ones ending within 48 hours, and clicking either again brings the rest back. "Updated" re-fetches the list (it replaces the old ↻ Refresh button — the same is true of the Owned and Wishlist headers), and "Prices" opens the region setting.

![The bundle browser: current bundles with shop, game count, cheapest tier, publication and end dates](../images/bundles-browse.png)

## Prices

Wishlist and bundle lists carry price columns: the best deal across every shop IsThereAnyDeal tracks, the discount against Steam's full price, and historical lows. A price at or below a record low is badged — 🔥 all-time, ★ one-year, ☆ three-month. Prices are region-specific; pick your region in the nav bar's ⚙ Preferences (it defaults to auto-detecting from your system timezone). Some shops only ever price in USD regardless of region — that's their behaviour, passed through unchanged.

## The game panel

Clicking any row opens a detail panel beside the table — not over it, so the list stays usable and clicking another row just swaps the panel's contents. It carries screenshots and trailers, the weighted rating and review counts, How Long To Beat estimates, achievements, recent news from the developer, current price, DLC and links out. ↻ refetches everything for that one game.

![A game's detail panel: media strip, weighted rating and Metacritic score, How Long To Beat estimate, ProtonDB tier, best price with record-low badges, tags, who owns it, and collapsible HLTB/news/achievements/DLC sections](../images/game-panel.png)

## Search by URL

`/search?q=<term>` searches by name and opens the closest match in the panel — useful as a browser keyword search. The site publishes an OpenSearch descriptor, so Chrome offers to add it as a search engine on its own (right-click the address bar → manage search engines) — pick it, then type its keyword followed by a game name to jump straight there. Firefox needs a manual bookmark instead: bookmark `https://<your-instance>/search?q=%s`, give it a keyword (e.g. `steam`), then type `steam half-life` in the address bar. The page has its own search box too, for refining or starting a new search without leaving it — typing there updates the list without reopening the panel until you click a result. The nav bar's own "Look up any game" box also offers a "See all results for…" link into this page once you've typed a query.

## Sharing

- A game's own link (`/game/<appid>`) opens that game for anyone, whether or not they own it.
- Add `?u=` to any list link to share the account you're exploring. It never changes the recipient's own default account, and a game link deliberately doesn't carry it.
- A comparison's link names its players the same way, one `?u=` each — including links made by older versions of this app, which still work.
- **🔗 Share view** copies a link with your current table layout — columns, sort, grouping, filters — baked in. The recipient gets it as a starting point; it doesn't override their setup permanently.

## Keyboard shortcuts

Press `?` for the full list. The essentials: `/` focuses search, `Esc` closes what's open, `↑`/`↓` move through the list, `←`/`→` through a game's media, and `R` picks a random game.

## How fresh is this?

Everything is cached, and every screen that shows cached data says how old it is — and the age itself is the button that fetches fresh. That's the account card and the friends list on the home page, the "Updated" figure in a list's header (your library, a wishlist, a comparison, a dynamic list, the bundle browser), and the ↻ beside a game's name in the panel. Prices come from a different source, so they carry their own age and their own ↻ on the second line of the "Prices" figure — the first line names the region and opens the setting. One exception: a single bundle's page states its age but can't force a re-fetch — finding one bundle means searching several pages of IsThereAnyDeal's list — so refresh its prices, or an individual game, instead.
