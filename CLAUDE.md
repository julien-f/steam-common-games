# CLAUDE.md

Working conventions for this repo. Documentation lives in `docs/` — keep it there, not here (see Where things belong below).

## Project context

- **Stack**: Node >=22.13 + Express 5 backend, Solid + TypeScript frontend bundled by Vite, `node:sqlite` for `db.sqlite`; npm. Setup, dev servers and ports are in [README.md](README.md).
- **Tests**: `npm test` (~4 s, no real database), one file with `npm run test:one test/<name>.test.js`; end-to-end `npm run test:e2e` (~20 s, every `/api` call mocked). Details, and the hooks: [testing.md](docs/dev/testing.md).
- **Looking at the UI**: `npm run dev:mock` (or `node scripts/mock-server.js up` from an agent session), not the real dev server — that one writes the user's real prefs, so follow [testing.md](docs/dev/testing.md)'s seed/restore steps before using it.

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
- [docs/dev/testing.md](docs/dev/testing.md) — unit and e2e tests, the mocked server, the real dev server's prefs seed/restore, the git hooks
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

These add to the user-level `~/.claude/CLAUDE.md` working style.

- Concision extends to code comments and doc prose:
  - Code comments: one line, stating the _why_, only when it isn't obvious from the code; skip the comment entirely if the code speaks for itself. This governs new comments; leave the long-form ones already in the tree alone.
  - Doc prose (this file, `README.md`, `CHANGELOG.md`): short bullets over paragraphs; no preamble, no summary section, lead with the point.
- Saying something is done includes where to see it: the route and steps for a UI change, the link to a posted comment or issue after checking it exists.
- When code models an upstream's behavior (pricing, limits, matching rules) from inference rather than its docs, state the assumption in the plan and confirm it before building on it; record confirmed rules and remaining assumptions in [integrations.md](docs/dev/integrations.md).

## Ask first

- Anything destructive or hard to reverse: `git reset --hard`, `git push --force`, deleting files, deleting or hand-editing `db.sqlite` (`npm run cache:clear` empties its cache tables without touching the file), overwriting the `steam.isonoe.net:prefs` localStorage backup a screenshot run left behind.
- **Environments**: local dev servers, `dev:mock` and the test suites are safe; the live site (steam.isonoe.net) and its server need explicit approval.
- Committing: approving a multi-step plan is the go-ahead to commit each step.
- Adding a new dependency.
- Adding a skill, hook, plugin or agent.

## Where things belong

- Project conventions, workflow rules, architecture decisions: this file — version-controlled and binding on every machine and session. Substantial detail goes in a `docs/` file linked from Where things are documented above, not duplicated here.
- Multi-step procedures invoked on demand: `.claude/skills/`. Check there first and invoke a matching skill rather than improvising; it is the source of truth for its procedure, but if it contradicts this file, this file wins — flag the conflict. Move deterministic steps into scripts the skill runs.
- Automated behaviors ("always run X after Y"): hooks in `.claude/settings.json`; instructions here cannot guarantee them.
- Facts specific to one person (role, working-style preferences, machine setup, session context): `~/.claude/CLAUDE.md` or Claude's memory.
- Secrets, credentials, API keys, `.env` values, ephemeral state: nowhere — never committed. `.env` is gitignored; `default.env` documents every setting.

## Git workflow

- Make commits atomic: each commit represents one logical change and passes the tests on its own.
- Write descriptive commit messages that explain the _why_, not just the _what_ — a short subject line, with a body when context is needed.
- **Message format**: a plain imperative subject, no Conventional Commits prefix — the `feat:`/`fix:` prefixes in older history were dropped; don't reintroduce them.
- Ordinary changes commit directly to `main` — this is a solo repo with no PR/review process. A complex feature (multiple concerns, significant refactoring, a new subsystem) spanning more than one commit gets a dedicated branch instead.
- Chasing a CI-only failure: experiment on a branch and run CI there (`gh workflow run CI --ref <branch>`), never by pushing to `main`.
- Close such a branch with a real merge commit (`git merge --no-ff`), never a fast-forward or a rebase onto `main` — the branch is the unit of work and the merge commit is what shows it.

## Development workflow

After making changes:

1. Update or add tests to cover the change: the single-file command while iterating, then `npm run format`.
2. Update any affected documentation — see Where things belong above — and `CHANGELOG.md` (see Changelog below).
3. Record what was surprising, misleading or broken, and its fix: as a comment or test when tied to specific code, otherwise in [pitfalls.md](docs/dev/pitfalls.md); machine-specific ones in Claude's memory. Symptom first (exact error text), then cause and fix. Delete entries once obsolete.
4. Verify with `npm run check` (format check, CHANGELOG structure, tests, typecheck, lint, phone CSS rules a later rule overrides, stale doc references — identifiers, links, npm scripts, script flags — in docs, skills, README.md and this file, journey test titles). When committing, the `pre-commit` hook runs its relevant steps on what's staged (plus desktop e2e on UI changes) and blocks on failure, so don't also run it by hand; the `pre-push` hook runs what CI runs (see [testing.md](docs/dev/testing.md#hooks)). Report actual results, not assumptions, and fix what it reports. Never skip, disable or weaken tests or assertions to get green, and never bypass hooks (`--no-verify`) — report the failure instead.

## Changelog

Every code change updates `CHANGELOG.md`, in the same commit as the code it documents. The pre-commit hook enforces it for `public/`, `lib/` and `server.js`; `SKIP_CHANGELOG=1 git commit` only for one that genuinely needs no entry (a pure refactor). Add entries with `node scripts/changelog-add.js <Section> "<entry>"` (it files them under `## [Unreleased]`), in [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) sections (Added / Changed / Fixed / Removed) plus a last `### Development` for changes only contributors see (tooling, checks, mock data). One user-facing line per entry, no implementation detail; `npm run check` enforces the structure and length.
