# Code backlog

Code findings from `code-audit` runs, judged against CLAUDE.md's conventions and the docs each dimension names. Severity: **critical** (exploitable, or loses or corrupts data) · **major** · **minor** · **cleanup** (no behaviour change); effort S/M/L. Fix items with the `code-fix` skill; remove an item once it ships.

Last audited: simplify 2026-10-11 · correctness 2026-10-11 · security 2026-10-10 · perf 2026-10-10 · reliability 2026-10-10 · compliance 2026-10-10 · tests 2026-10-10 · docs 2026-10-12.

- [Simplify](#simplify)
- [Correctness](#correctness)
- [Security](#security)
- [Performance](#performance)
- [Reliability](#reliability)
- [Compliance](#compliance)
- [Tests](#tests)
- [Docs](#docs)

## Simplify

- **C157 · cleanup · S** — `onEnterOnFocusedRow` (`public/AppShell.tsx:60`, `public/panelKeyboard.ts:12`) is registered by no route, so its Enter branch always returns false. Remove the hook and its plumbing.
- **C158 · cleanup · S** — stale code comments: `vite.config.js:52` (names a `dev:web` script that doesn't exist; `npm run dev` runs both), `server.js:1271` ("line 113"), `server.js:352`/`:920` (`public/panel.js`, now `panelData.ts`), `lib/metrics.js:282` (`resolve:` is 180 days, not 90), `lib/steam.js` 482/575/664/696/746 (meta tier is 365 days, not 60), `lib/itad.js:35` (`itad-shop:` uses `ITAD_ID_CACHE_TTL_MINUTES`), `lib/itad.js:189-195` (wrong lookup endpoints; a null mapping is cached on the miss TTL) and `lib/itad.js:5-7` (calls ITAD untrusted; integrations.md puts it in the sanctioned tier). Fix each, pointing at `default.env` instead of repeating numbers.

## Correctness

- **C155 · major · M** — a user list's table view is saved into the synced `lists` pref on every view change, transient fields included: `bindViewPersistence` (`public/tableViewPrefs.ts:54`) → `setListTableView` (`public/listsStore.ts:375`) → `setPref('lists')`, pushed at once (`public/prefs.ts:86`), `page`/`searchQuery` not stripped as `TRANSIENT_VIEW_FIELDS` (`public/tableViewSync.ts:37`) are for shared keys. Typing a search or paging fires `PUT /api/me/prefs/lists` per change against `authLimit`'s 20/min; the 429 is swallowed (`pushPrefToServer` ignores `res.ok`), dropping other keys' pushes in that window, and each push bumps `lists`' updatedAt so a view tweak can win last-write-wins over a real list edit on another device. The comment at `public/ListRoute.tsx:3217` ("that one isn't synced") is wrong. Strip transient fields and skip unchanged writes; debounce `lists` like `ranking:` or move user-list views out of `lists`.
- **C154 · minor · S** — the panel's ↻ Refresh does nothing on `/search`: `public/SearchRoute.tsx:252` registers no `refreshGame` (`public/AppShell.tsx:202` calls `routeHandlers.refreshGame?.`), so the spinner-less click is silently dropped. Register one that refetches `/api/game-details/:appid?refresh=1` and updates the shown result, sharing RankRoute's once its follow-up lands.

## Security

None open.

## Performance

None open.

## Reliability

- **C156 · minor · S** — `vite.config.js:65`/`:74` hard-code the dev proxy target `http://127.0.0.1:3000`, so a `PORT`/`HOST` override in `.env` leaves `npm run dev`'s `/api` and `/auth/` proxying to a dead port, while `docs/user/configuration.md:13` presents them as freely settable. Build the target from `HOST`/`PORT`, loading `.env` as `lib/config.js` does.
- **C1 · minor · M** — dependency updates wait on a manual `dependency-audit` run. Dependabot or Renovate could open them, since CI (`.github/workflows/ci.yml`) runs `check` and the e2e suite on PRs, but their PRs lack the `CHANGELOG.md` entry the pre-commit hook requires (CI doesn't check it) and skip `npm run build`, so each still needs a local pass through dependency-audit's Applying.

## Compliance

- **C40 · minor · S** — players `GetPlayerSummaries` omits are never cached (`lib/steam.js` `fetchPlayerBatch`), so a deleted or invalid account in a friends list is re-requested on every load. Cache the omission briefly once it's confirmed Steam omits only ids that really don't exist (not transiently); record that in integrations.md.

## Tests

None open.

## Docs

- **C159 · minor · S** — `docs/user/features.md` misses shipped features: the screenshot lightbox and its keys (Enter, ↑/↓, F, Z, Space/M, swipe — `public/lightbox.tsx`, `public/ShortcutsModal.tsx:51`); per-player Played columns and the "never played" preset in comparisons (`public/ListRoute.tsx:263`, `:271`); chat link previews (Sharing, ~line 108); the bundle browser's Include expired (`public/BundlesBrowseRoute.tsx:472`). Line 36's "never stored, never stale" contradicts line 127 and the Updated tile (server-cached, with an age); line 82's "switch it to Intersect" undersells the mode menu's four operations. Add each in its section.
- **C160 · minor · S** — `docs/dev/frontend.md` drift: line 331's Known gap (panel self-prices every game) is fixed (`public/panel.tsx:491`); lines 153–163 miss recent's Looked up column and default sort (`public/ListRoute.tsx:339`, `:2244`), compare's Played columns and price columns on user lists with a priced source (`:475`); lines 207/217/225 put a Prices tile on owned lists (it shows only when `hasPrices()`, `:2638`); line 276's panel section order is wrong and omits the description card and bundle lines (`public/panel.tsx:2304`–`2410`); line 56 misses RankRoute and the 404 page navigating to `/game/:appid`; lines 54/224/310 miss recent rewriting the path instead of `?game=` (`public/ListRoute.tsx:1302`); line 133's "one deliberate exception" ignores `public/BundlesBrowseRoute.tsx:308`; the module map lacks AccountFriends, authStore, bundleSnapshots, CombineForm, fanaticalPicks, syncedPrefKeys, currency and membershipColumn.
- **C161 · minor · S** — `docs/dev/lists-and-accounts.md`: line 151's pref keys miss `region` (`public/syncedPrefKeys.ts:11`); line 133 names neither `steam.isonoe.net:prefs` nor the unsynced `prefs-synced:<steamid>` flag that gates line 120's first-sync rule (`public/authStore.ts:28`), nor the `{ value, updatedAt }` v2 entry shape and v1 upgrade at `updatedAt: 0` (`public/prefs.ts:21`); line 65's ranking shape lacks `focus?` (`public/ranking.ts:26`); lines 124–127 imply views stay local until saved, but a user list's view syncs within `lists` (see C155).
- **C162 · minor · S** — `docs/dev/integrations.md`: line 3 claims every upstream but omits keyed `ResolveVanityURL` and `GetOwnedGames` (`lib/steam.js:93`, `:113`) and Steam OpenID's `check_authentication` (`lib/auth.js:94`) — add them as sanctioned; line 111 lists three ITAD routes returning 503, `requireItad` guards five (`server.js:787`, `:892` too); line 10's store 429 backoff is 2/4/8 s, with `Retry-After` taken uncapped (`lib/steam.js:73`).
- **C164 · minor · S** — `docs/dev/architecture.md:66`: "every route" is rate-limited with a cache `skip`, but health, metrics, `/api/me`, logout and `/opensearch.xml` have no limiter, `bundlesByIdLimit` and `authLimit` (fixed `max: 20`, not in `default.env`) have no skip, and the stream route always counts, capped by `STREAM_MAX_PER_IP` (`server.js:1068`), which Request flow omits. Line 26 lists internal `GROUPS` as exported by `lib/cache.js`; `isCached` and `getCacheEntryCounts` are the ones routes use.
- **C165 · minor · S** — `docs/dev/decisions.md`: line 10 says the Weighted Rating isn't groupable, but every score column groups into 5-point buckets (`public/gameColumns.ts:791`); line 13's panel "reviews line" is one Weighted chip captioned "Weighted · 99% of 465k" (`public/panel.tsx:865`); lines 23–27 miss that a paid game with no price gets no tier (`public/utils.ts:101`).
- **C166 · minor · S** — `docs/dev/testing.md:36` says pre-commit checks only the staged content, but `.githooks/pre-commit:9` sets aside tracked edits only: an untracked file can make a commit pass that lacks it. Line 32: `node_modules` is reflinked only for `--dry-run` (`scripts/skill-evals.js`). `docs/dev/pitfalls.md:35`'s symptom names port 58992, now unused (servers are on 58991/58993). Correct the doc; setting untracked files aside too is an M hook change.
- **C167 · minor · S** — `docs/user/configuration.md:16` says the rest of `default.env` is limits and cache lifetimes, missing `TRUST_PROXY` (needed behind a proxy, `lib/config.js:34`) and `SESSION_TTL_DAYS`; it and `README.md:23` link ITAD's `/apps/new/` where `default.env:9` says `/apps/my/` (check which is live); README's setup never states Node ≥22.13 (`package.json` `engines`).
