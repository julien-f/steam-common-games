# Code backlog

Code findings from `code-audit` runs, judged against CLAUDE.md's conventions and the docs each dimension names. Severity: **critical** (exploitable, or loses or corrupts data) · **major** · **minor** · **cleanup** (no behaviour change); effort S/M/L. Fix items with the `code-fix` skill; remove an item once it ships.

Last audited: simplify 2026-10-11 · correctness 2026-10-11 · security 2026-10-10 · perf 2026-10-10 · reliability 2026-10-10 · compliance 2026-10-10 · tests 2026-10-10 · docs 2026-10-11.

- [Simplify](#simplify)
- [Correctness](#correctness)
- [Security](#security)
- [Performance](#performance)
- [Reliability](#reliability)
- [Compliance](#compliance)
- [Tests](#tests)
- [Docs](#docs)

## Simplify

- **C126 · cleanup · M** — about 390 lines of `public/style.css` (`:338-760`, `:997`, `:1040-1172`, `:1333-1382` and their phone overrides) style classes nothing renders any more, left from the pre-redesign pages: `.user-row`, `.btn-remove`, `.results-header`, `.progress-wrap`, `.td-thumb`, `.game-group`, `.group-header`, `.player-slot`, `.family-row`, `.how-it-works`, the `.filter-*` rules, `.site-footer`, `.slot-link` and others (none appears in `public/`, `e2e/` or `@vates/data-table-solid`'s dist). Delete them, keeping the live selectors in `:1357`'s mixed list and `@keyframes spin`.
- **C127 · cleanup · M** — 19 cached getters (`lib/steam.js`, 16 × `return withDedup(`; `lib/itad.js:39`, `:92`, `:461`) repeat the getCached → hit → dedup → fetch → `res.ok` or `upstreamError` → setCache skeleton, so a change to how `force` or a miss works is 19 edits. One cached-getter helper in `lib/upstream.js`, the per-outcome TTL left to each fetch function.
- **C128 · cleanup · S** — the 10 s outbound timeout is hand-written in four modules: `TIMEOUT_MS` plus `signal()` in `lib/steam.js:18` and `lib/itad.js:26` (19 `signal: signal()` sites), `AbortSignal.timeout(TIMEOUT_MS)` in `lib/hltb.js:12`, a bare `AbortSignal.timeout(10000)` in `lib/auth.js:96`. `trackedFetch`, which every outbound call goes through, could default `opts.signal`; `lib/fanatical.js` keeps its 3 s.
- **C129 · cleanup · S** — `lib/itad.js:228`, `:323` and `:377` (and `getPlayerSummaries`, `lib/steam.js:229`) each split a batch into cache hits and an `uncached` list with the same loop. A partition-by-cache helper returning both.
- **C130 · cleanup · S** — `server.js:120`'s `STEAM64_RE` and `cachedSteamIds` repeat `resolveSteamId`'s fast path (`lib/steam.js:79`: the same regex, the same `resolve:` key), so the id format and the key live in two modules. Export a cache-only peek from `lib/steam.js` and build `cachedSteamIds` on it.
- **C131 · cleanup · S** — `server.js` route boilerplate left after C120: the same two-line catch (`routeErrorStatus` then `res.status(status).json({ error })`) 12 times; the members check copied in `cachedSteamIds` (`:124`) and `parseMembers` (`:275`); the `steamids` query split in both `achievementsLimit`'s skip (`:398`) and its route (`:964`); the five details sources and their cache prefixes listed in both `detailsLimit`'s skip (`:336`) and `fetchedAts` (`:729`), which then re-does `oldestCachedAt`. One send-error helper, one members predicate, one steamids parser, one map of details sources.
- **C132 · cleanup · S** — small `lib/` leftovers: `lib/circuitBreaker.js:19` and `lib/metrics.js:75` hand-build what `upstreamError` (`lib/upstream.js`) returns; `lib/metrics.js` defines both `WINDOW_MS` (`:19`) and `HOUR_MS` (`:39`) as one hour, and its since-restart entries (`:310`) rebuild `summarizeWindow`'s shape (`:179`); `SEMAPHORE_MAX_QUEUE` is exported only for callers to pass back (default `maxQueue` to it; `itad-info`'s `Infinity`, `lib/itad.js:169`, has no stated reason); `getCacheStats` (`lib/cache.js:182`) only wraps `getCacheEntryCounts` for `/api/health`; `getBundles`, `bundlesCacheKey` and `gameBundlesCacheKey`'s defaults (`lib/itad.js:88`, `:457`) repeat `parseBundlesQuery`'s and no production caller relies on them.
- **C137 · cleanup · S** — `public/ListRoute.tsx`: "the rows a filter left visible" is computed in both `rankThisListFocus` (`:799`) and `filteredUnranked` (`:902`), and "unranked and not excluded" in both `filteredUnranked` and `selectedUnranked` (`:889`); the `?game=` restore (`:2371`) re-implements `handleOpenGameRequest` (`:1478`), and `'Invalid game id.'` is checked in two places (`:1387`, `:1444`). Two small helpers, a call to `handleOpenGameRequest`.
- **C138 · cleanup · S** — `panelHandleEscape` (`public/panel.tsx:319`) has one caller, inside `if (isLightboxOpen())` (`public/panelKeyboard.ts:20`), so its `panelClose()` fallback never runs and the check runs twice; the fullscreen test (`document.fullscreenElement || webkitDoc().webkitFullscreenElement`) is written five times across `public/lightbox.tsx:198`, `:204`, `:220`, `:1118` and `panel.tsx`, and exiting fullscreen twice. A lightbox-side Escape handler and two fullscreen helpers in `lightbox.tsx`.
- **C139 · cleanup · S** — `public/lightbox.tsx` repeats itself: the wheel and pinch handlers (`:648`, `:795`) and `resetLbZoom`/`lbZoomTowardPoint` reset pan and cursor that `applyLbTransform` (`:335`) already resets; the zoom toggle is written three times (`:374`, `:693`, `:863`); the neighbour preload recomputes its sources for the keep set (`:1295-1328`); `stepGameFromLightbox(() => _onGameNav(dir), dir)` appears four times (`:556`, `:557`, `:615`, `:848`); whether a video is showing is read from `lbVideoEl.isConnected`, `.lb-vctrls`' inline display (`:592`) and a leftover `vid.style.display = 'block'` (`:1225`) with its `.lb-video` CSS rule, and the `.lb-img` display test six times. Delete the redundant writes; one helper each.
- **C140 · cleanup · S** — `public/panel.tsx`: `PanelSubnav` (`:2216`) restates the HLTB, news and achievements sections' show conditions (`HltbSection.present()` at `:1934`, `:1340`, `:1222`), kept equal only by hand; `PanelHero.items()` (`:603`) is a null-safe copy of `getPanelItems`, `HeroMain` repeats its clamped `idx()` (`:1840`), and its click and key handlers duplicate the open-lightbox body (`:1799`). Shared predicates and accessors.
- **C141 · cleanup · S** — two modules whose reason is gone: `public/achievementsRequest.ts` exists to be testable without a DOM, which `panelData.ts` (its main user, with its own test) already is; `public/lightboxTime.ts` holds only `fmtTime`, beside the formatters in `utils.ts`. Fold each into its user's module and merge the tests.
- **C142 · cleanup · S** — exports nothing else imports: `clearAccountOverride` (`public/accountOverride.ts:109`), `UnavailableError` (`public/bundleData.ts:98`), `wouldCreateCycle` (`public/listsStore.ts:117`), and the types `PanelKeyboardOptions`, `SwipeAction`, `Overlay`, `StatusTier`, `GameAssets`, `BundleUrgency`, `BundleTier`, `BrowsedBundle`, `PriceLookup`, `ListHeroProps`, `ComparePlayersFormProps`. Drop the `export`s (`noUnusedLocals` doesn't see an unused export).
- **C143 · cleanup · S** — `public/tableViewPrefs.ts`: `restoreTableView` (`:27`) and `resetTableView` (`:88`) hard-wire a pref key, so ListRoute's user-list branch re-implements both by hand (`ListRoute.tsx:2335`, `:1773`); both resets strip `tv` from the URL, which `takeSharedView` (`:34`) already did; `DataTableLike` (`:14`) copies `ViewStateApi`, which `@vates/data-table-solid` exports, forcing two casts. Take a load/save pair, strip `tv` once in `takeSharedView`, use `ViewStateApi`/`TableViewState`.
- **C144 · cleanup · S** — account plumbing after C105: `toAccountSlot` (`public/AccountFriends.tsx:23`) copies `accountSlotFromSummary` field by field; `resolveAccountSummary` (`public/accountData.ts:301`) re-derives labels, vanities and trivia that `toAccountPlayer` (`:90`) and `accountInfoFrom` (`:108`) compute, already differently for placeholders, and every caller wraps it in `accountSlotFromSummary` with the same ids; the refresh calls right after `adoptAccount` (`HomeRoute.tsx:238`, `AccountChip.tsx:81`) repeat what its `ACCOUNT_CHANGED_EVENT` already triggers. One resolve-to-slot function, reuse the builders, drop the refreshes.
- **C145 · cleanup · S** — `public/gameColumns.ts`: 12 near-identical column definitions (4 score columns `:801-869`, 4 HLTB `:902-945`, the Steam-price and low columns `:1163-1266`) and the price-tier group pair repeated five times. Local column factories and one price-tier group helper shaped like the library's `numericRangeGroup` (`BundlesBrowseRoute.tsx:230` takes its region-currency variant).
- **C146 · cleanup · S** — small duplications in the routes and shared modules: the JSON POST around `fetchJson` written six times (`public/accountData.ts:155`, `:198`, `:262`, `:302`, `priceLoading.ts:84`, `bundleData.ts:175`); `setBaseTitle` plus its cleanup hand-rolled in six routes (`AboutRoute.tsx:7`, `NotFoundRoute.tsx:7`, `SearchRoute.tsx:88`, `BundlesBrowseRoute.tsx:471`, `HomeRoute.tsx:208`); `RankRoute.tsx`'s set-state/pair/ranking triple four times (`:57`, `:103`, `:157`, `:171`); `tile().onClick && !tile().subOnClick` five times in `ListHero.tsx:96`; `Bundle` (`bundleData.ts:39`) redeclaring seven `BundleListItem` fields (`bundleRows.ts:29`). A JSON POST helper, a base-title helper, local helpers, `extends Omit<…>`.
- **C147 · cleanup · S** — `public/currency.ts:26`'s `REGION_CURRENCY` is a second table keyed like `COUNTRY_OPTIONS` (`public/region.ts:21`), whose labels type each currency a third time, and `test/currency.test.js` exists to keep them in sync; `peekMyPlaytime` (`public/myOwnership.ts:164`) re-reduces playtime that `fetchAccountOverview` computes (`accountData.ts:172`) and `fetchAccountOwnedData` throws away. A currency field on each region option; keep the per-game playtime from the owned fetch.
- **C148 · cleanup · S** — `public/prefsPopover.ts` builds the region `<select>` as an HTML string plus imperative wiring (its comments still name a `nav.js` that's gone), costing `AppShell.tsx` an `innerHTML` wrapper with an eslint-disable, an init call and a `querySelector`. A small Solid component; keep `openPrefsPopover`.
- **C149 · cleanup · S** — dead branches and parameters: `fmtH`'s falsy branch (`public/utils.ts:246`) can't run, since its only caller renders under `<Show when={…}>` (`panel.tsx:1969`), and would print its markup as text; the `isDescendantFolder` and `isAccountReferenced` defaults and `etaSeconds`' `windowMs` (`listsStore.ts:143`, `:166`, `loadProgress.ts:11`) no caller uses; `addAppidsToList`/`removeAppidsFromList` (`listsStore.ts:311`) repeat `setListAppids`' guard before calling it. Drop them; one private update helper.

## Correctness

- **C150 · minor · S** — the lightbox's Retry (`retryCurrentShot`, `public/lightbox.tsx:300`) loads the image without `renderLightbox`'s `lbImgToken` stale guard, so a retry that finishes after the viewer has stepped on paints the old shot over the new one. Share one guarded image load with `renderLightbox`.
- **C70 · minor · S** — narrowed: a failed refresh now keeps the Updated tile for every kind, but a dynamic or shared list that failed before it ever fetched still shows no tile, since `public/ListRoute.tsx` only renders it without an age for owned, wishlist and comparison lists. Render it for any list built from account sources (walking its sources), as frontend.md's "rendered unconditionally" asks.
- **C91 · minor · S** — a comparison's 🔗 Share view link never applies its layout: `load()`'s compare branch rewrites the URL to `compareUrl(...)` (`public/ListRoute.tsx:2065`), which has no `tv` param, so the replace drops `?tv=` before `takeSharedView` runs at table build. Carry the view param over into the canonical URL (or take it before the rewrite).
- **C124 · minor · S** — on `/rank` the side panel's tag pills look like filter toggles but do nothing, and ↻ Refresh spins without re-fetching the game's details: `RankRoute.tsx:139` opens the panel but registers no `routeHandlers`, so AppShell's `onTagClick`/`onRefresh` relays (`public/AppShell.tsx:200`) no-op. Register the handlers RankRoute can honour (a details refresh), and render tags as plain pills when no route filters them.

## Security

None open.

## Performance

None open.

## Reliability

- **C151 · minor · S** — an exhausted outbound budget throws an `isUpstream` error (`lib/metrics.js:75`), so `routeErrorStatus` (`server.js:190`) and `fetchGameDetails`' logging print it on every refused request, undoing `chargeBudget`'s warn-once; its `isBudgetExhausted` flag is set but never read. Skip logging on it, as for `isCircuitOpen`.
- **C1 · minor · M** — dependency updates wait on a manual `dependency-audit` run. Dependabot or Renovate could open them, since CI (`.github/workflows/ci.yml`) runs `check` and the e2e suite on PRs, but their PRs lack the `CHANGELOG.md` entry the pre-commit hook requires (CI doesn't check it) and skip `npm run build`, so each still needs a local pass through dependency-audit's Applying.

## Compliance

- **C40 · minor · S** — players `GetPlayerSummaries` omits are never cached (`lib/steam.js` `fetchPlayerBatch`), so a deleted or invalid account in a friends list is re-requested on every load. Cache the omission briefly once it's confirmed Steam omits only ids that really don't exist (not transiently); record that in integrations.md.

## Tests

- **C92 · minor · S** — the F1 "Price card says when ITAD didn't answer" e2e test's route `/\/api\/(health|prices)$/` (`e2e/scenarios.spec.ts:873`) never matches `/api/prices?country=…`, so only the health failure is exercised and the price-lookup failure path isn't. Match the query string too and check the test still fails without the fix it locks.

## Docs

None open.
