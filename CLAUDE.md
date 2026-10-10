# CLAUDE.md

Working conventions for this repo. Documentation lives in `docs/` — keep it there, not here (see Where things belong below).

## Project context

- **Stack**: Node >=22.13 + Express 5 backend, Solid + TypeScript frontend bundled by Vite, `node:sqlite` for `db.sqlite`; npm. Setup, dev servers and ports are in [README.md](README.md).
- **Tests**: `node:test` + `supertest`, flat in `test/*.test.{js,ts}`; `npm test` (~4 s) runs with `DB_FILE=` so no real database is touched. Single file: `npm run test:one test/<name>.test.js` (same env as `npm test`, which hardcodes its glob). End-to-end: `npm run test:e2e` (~20 s; Playwright, `e2e/`, against a production build) runs the tests of [journeys.md](docs/dev/journeys.md)'s journeys (`node scripts/journey-coverage.js` shows which steps they lock) at desktop (1440×900) and phone (390×844) widths, with every `/api` call mocked in the browser — no backend, no upstream traffic; fixtures use made-up accounts only. The pre-commit hook runs it when `public/`, `e2e/` or a frontend config is staged, skipping it when the build (sourcemaps aside), `e2e/` and the test config match the last full passing run (`scripts/e2e.js`). To look at a UI change without touching real prefs, `E2E_SHOTS=1 npm run test:e2e` keeps each test's final screen, plus any `shot(page, name)` (`e2e/state.ts`), under `test-results/`, one folder per test and width.
- **Looking at the UI**: `npm run dev:mock` (`:58993`) serves the app against the e2e fixtures — no backend or upstream traffic, and its own localStorage, so no demo-prefs seed/restore; the `mock` cookie switches on error and slow states (`e2e/mockApi.ts`). From an agent session, `node scripts/mock-server.js up|down` starts or reuses it in the background, and `node scripts/ux-measure.js [--fresh] [--state=…] /route…` writes a Playwright file measuring those routes at both widths. Use the real dev server only for real data or real loading times; `node scripts/dev-server.js up|down` runs it the same way. Its pages write the user's real prefs (every route but `/about`, `/game/:appid` included), so before the first load run `node scripts/demo-prefs.js seed --file` (or `empty`, for a first visit) and its `.playwright-mcp/demo-seed.js` with `browser_run_code_unsafe`'s `filename`; afterwards `restore --file` and `demo-restore.js`, then confirm `steam.isonoe.net:prefs.backup` is gone. Seeding refuses while a backup exists: restore that one first, never overwrite it.

## Where things are documented

- [README.md](README.md) — what the app is, setup, dev commands
- [docs/user/features.md](docs/user/features.md) · [docs/user/configuration.md](docs/user/configuration.md) — user-facing: what it does, every setting
- [docs/dev/architecture.md](docs/dev/architecture.md) — backend modules, build/dev setup, API routes, request flow
- [docs/dev/frontend.md](docs/dev/frontend.md) — SPA routes, module map, **reactivity rules**, the game table, the side panel, URL state
- [docs/dev/lists-and-accounts.md](docs/dev/lists-and-accounts.md) — the account/list data model and its localStorage schema
- [docs/dev/integrations.md](docs/dev/integrations.md) — Steam/HLTB/ITAD/ProtonDB, including which endpoints are undocumented and the compliance notes on them
- [docs/dev/data.md](docs/dev/data.md) — `db.sqlite`, cache tiers and TTLs, the three refresh paths
- [docs/dev/observability.md](docs/dev/observability.md) — `GET /api/metrics`, outbound budgets, proactive log warnings
- [docs/dev/journeys.md](docs/dev/journeys.md) — user journeys (goal, numbered steps, done-when); the basis for design reviews and end-to-end tests
- [docs/dev/ui-guidelines.md](docs/dev/ui-guidelines.md) — UI conventions where scenarios and feature docs are silent, and the checklist for a new UI feature
- [docs/dev/improvements.md](docs/dev/improvements.md) — UX backlog from design reviews, keyed to scenarios
- [docs/dev/code-backlog.md](docs/dev/code-backlog.md) — code backlog from `code-audit` runs (simplify, security, perf, reliability, compliance, tests)
- [docs/dev/decisions.md](docs/dev/decisions.md) — Weighted Rating vs. Wilson score, the Production Tier heuristic
- [docs/dev/pitfalls.md](docs/dev/pitfalls.md) — surprising behaviors, misleading errors and their fixes; check it when something fails or behaves unexpectedly
- [docs/images/](docs/images) — the screenshots the docs embed; shooting them is the `screenshots` skill

Read the relevant one before changing that area. Two are load-bearing: **frontend.md's reactivity rules** (`npm run lint` enforces the no-reactive-`const` one), and **integrations.md's trust tiers** — several upstreams are undocumented and unsanctioned, so don't scale request volume without revisiting them.

## Code conventions

- **Types**: `tsc --noEmit`, strict, over `public/**/*.{ts,tsx}`, plus `e2e/` via `tsconfig.e2e.json` — the backend is plain JS.
- **Error handling**: routes catch and map through `routeErrorStatus` (client error → 400, upstream → 502, timeout → 504) and reply `{ error }`. An optional source (HLTB, ProtonDB, reviews) that fails logs a `[tag]`-prefixed `console.warn` and degrades instead of failing the request; the UI then says the source didn't answer rather than showing no data.
- **Lint**: `eslint public`, via eslint-plugin-solid; stays at 0 problems, and the few intended violations carry a targeted `eslint-disable-next-line` with a reason.
- **Format**: Prettier over the whole tree (`.prettierrc.json`); `npm run format` rewrites, `npm run format:check` verifies. Let it format instead of hand-formatting, and don't fight its output.
- **Simplicity**: build for current needs only — no speculative abstractions, options or extension points. Fix root causes rather than stacking special cases (propose it if that widens the change). Delete what the change makes dead (code, params, flags, tests, docs). Temporary code (shims, flags, workarounds) states its removal condition.
- **Style**: match the existing code; don't reformat code outside the change.

## Working style

- Be concise and economical everywhere — responses, code comments, doc prose. No filler, no restating what was just done.
  - Code comments: one line, stating the _why_, only when it isn't obvious from the code; skip the comment entirely if the code speaks for itself. This governs new comments; leave the long-form ones already in the tree alone.
  - Doc prose (this file, `README.md`, `CHANGELOG.md`): short bullets over paragraphs; no preamble, no summary section, lead with the point.
- Saying something is done includes where to see it: the route and steps for a UI change, the link to a posted comment or issue after checking it exists.
- Stay in scope: make the smallest change that satisfies the request, plus the Development workflow checklist below. Flag anything else — other issues, alternative approaches with your recommendation, deeper work that would clearly pay off — instead of acting on it.
- Match the request's intent. A question or request for opinion gets an answer only — no edits or side-effecting commands, even when the fix seems obvious; offer to act instead. When unsure which it is, treat it as a question. An action request gets acted on without further go-ahead, except:
  - ambiguous request: ask clarifying questions first, batched into one round;
  - non-trivial change (multiple files, non-obvious design decisions, refactors): draft a plan and wait for approval.
- When acting on a request, ask only about real choices within it (no clear winner); otherwise apply your recommendation — committing each step, if the series was approved. Every question to the user goes through `AskUserQuestion`, including open-ended ones (offer the likely answers; the user can pick _Other_) and go-ahead requests after a plan. Proposals beyond the request go in one single-select, "Apply the recommended set" first and only real alternatives after it — never a multi-select of your own recommendations. Never end a message with a question in prose.
- Reuse before writing: existing code, tests and docs first, then the standard library and dependencies already in use. For non-trivial problems with an established solution (parsing, dates, retries…), propose a library instead of hand-rolling it; adding one still needs approval (see Ask first). Flag duplication you spot, including code better moved to a shared module.
- When a dependency's bug or limitation gets in the way, first check for a newer version or an existing upstream issue. If it's a genuine upstream gap (not a misuse), flag it and propose an upstream issue or PR, with a draft, before working around it. Any interim workaround gets a one-line comment linking the upstream issue.
- When code models an upstream's behavior (pricing, limits, matching rules) from inference rather than its docs, state the assumption in the plan and confirm it before building on it; record confirmed rules and remaining assumptions in [integrations.md](docs/dev/integrations.md).
- Improve the setup on friction (a correction you'd need again, a procedure repeated by hand, a slow or output-heavy step, a rule that is stale, misleading or contradicts the code, a check better automated): propose it as a one-line option naming the target (this file, a skill, a script, a hook — see Where things belong) and the change, in the response's `AskUserQuestion` (or one of its own); prefer tightening or deleting a rule over adding one. Apply only on approval.

## Ask first

- Anything destructive or hard to reverse: `git reset --hard`, `git push --force`, deleting files, deleting or hand-editing `db.sqlite` (`npm run cache:clear` empties its cache tables without touching the file), overwriting the `steam.isonoe.net:prefs` localStorage backup a screenshot run left behind.
- **Environments**: local dev servers, `dev:mock` and the test suites are safe; the live site (steam.isonoe.net) and its server need explicit approval.
- Committing or pushing — only when explicitly asked.
- Outward-facing actions: opening PRs or issues, commenting, posting to external services.
- Adding a new dependency.
- Adding a skill, hook, plugin or agent.

## Where things belong

- Project conventions, workflow rules, architecture decisions: this file — version-controlled and binding on every machine and session. Substantial detail goes in a `docs/` file linked from Where things are documented above, not duplicated here.
- Multi-step procedures invoked on demand: `.claude/skills/`. Check there first and invoke a matching skill rather than improvising; it is the source of truth for its procedure, but if it contradicts this file, this file wins — flag the conflict. Move deterministic steps into scripts the skill runs.
- Automated behaviors ("always run X after Y"): hooks in `.claude/settings.json`; instructions here cannot guarantee them.
- Facts specific to one person (role, working-style preferences, machine setup, session context): Claude's memory.
- Secrets, credentials, API keys, `.env` values, ephemeral state: nowhere — never committed. `.env` is gitignored; `default.env` documents every setting.

## Git workflow

- Make commits atomic: each commit represents one logical change and passes the tests on its own.
- Write descriptive commit messages that explain the _why_, not just the _what_ — a short subject line, with a body when context is needed.
- **Message format**: a plain imperative subject, no Conventional Commits prefix — the `feat:`/`fix:` prefixes in older history were dropped; don't reintroduce them.
- Ordinary changes commit directly to `main` — this is a solo repo with no PR/review process. A complex feature (multiple concerns, significant refactoring, a new subsystem) spanning more than one commit gets a dedicated branch instead.
- Close such a branch with a real merge commit (`git merge --no-ff`), never a fast-forward or a rebase onto `main` — the branch is the unit of work and the merge commit is what shows it.
- When asked to commit a change that belongs to the unpushed commit just made, amend it (`git commit --amend`) rather than adding a separate fixup commit.

## Development workflow

After making changes:

1. Update or add tests to cover the change. Run the single-file command while iterating, then `npm run format` and `npm run check` (format check, CHANGELOG structure, tests, typecheck, lint, phone CSS rules a later rule overrides, stale doc references — identifiers, links, npm scripts, script flags — in docs, skills, README.md and this file, journey test titles) once at the end — when committing, the pre-commit hook is that run (step 4); report actual results, not assumptions. Fix what it reports. Never skip, disable or weaken tests or assertions to get green, and never bypass hooks (`--no-verify`) — report the failure instead.
2. Update any affected documentation — see Where things belong above — and `CHANGELOG.md` (see Changelog below).
3. Record what was surprising, misleading or broken, and its fix: as a comment or test when tied to specific code, otherwise in [pitfalls.md](docs/dev/pitfalls.md); machine-specific ones in Claude's memory. Symptom first (exact error text), then cause and fix. Delete entries once obsolete.
4. The `pre-commit` hook (`.githooks/pre-commit`, enabled by `npm install`) runs `git diff --cached --check`, then `npm run check`'s steps in parallel — typecheck, lint, the CSS check and `npm run test:e2e` only when `public/`, `e2e/` or a frontend config is staged — and blocks the commit on failure, so don't run `check` by hand before committing. A doc reference `check` reports is either stale (fix the doc) or deliberate history (add it to `HISTORY` in `scripts/doc-refs.js`).

## Changelog

Every code change updates `CHANGELOG.md`, in the same commit as the code it documents — never a separate follow-up commit. The pre-commit hook fails a commit touching `public/`, `lib/` or `server.js` without it; `SKIP_CHANGELOG=1 git commit` only for one that genuinely needs no entry (a pure refactor). Add entries with `node scripts/changelog-add.js <Section> "<entry>"`, which puts them under `## [Unreleased]` (creating it and the subsection when missing), using [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) format (Added / Changed / Fixed / Removed), plus a last `### Development` for changes only contributors see (tooling, checks, mock data), each subsection once — `npm run check` fails on a repeat. One user-facing line per entry, no implementation detail; `check` fails an entry over 400 characters.
