# CLAUDE.md

Working conventions for this repo. Documentation lives in `docs/` — keep it there, not here (see Knowledge sharing below).

## Project context

- **Stack**: Node >=22.13 + Express 5 backend, Solid + TypeScript frontend bundled by Vite, `node:sqlite` for `db.sqlite`; npm. Setup, dev servers and ports are in [README.md](README.md).
- **Tests**: `node:test` + `supertest`, flat in `test/*.test.{js,ts}`; `npm test` runs with `DB_FILE=` so no real database is touched.
- **Types**: `tsc --noEmit`, strict, over `public/**/*.{ts,tsx}` only — the backend is plain JS.
- **Lint**: `eslint public`, via eslint-plugin-solid.

## Where things are documented

- [README.md](README.md) — what the app is, setup, dev commands
- [docs/user/features.md](docs/user/features.md) · [docs/user/configuration.md](docs/user/configuration.md) — user-facing: what it does, every setting
- [docs/dev/architecture.md](docs/dev/architecture.md) — backend modules, build/dev setup, API routes, request flow
- [docs/dev/frontend.md](docs/dev/frontend.md) — SPA routes, module map, **reactivity rules**, the game table, the side panel, URL state
- [docs/dev/lists-and-accounts.md](docs/dev/lists-and-accounts.md) — the account/list data model and its localStorage schema
- [docs/dev/integrations.md](docs/dev/integrations.md) — Steam/HLTB/ITAD/ProtonDB, including which endpoints are undocumented and the compliance notes on them
- [docs/dev/data.md](docs/dev/data.md) — `db.sqlite`, cache tiers and TTLs, the three refresh paths
- [docs/dev/observability.md](docs/dev/observability.md) — `GET /api/metrics`, outbound budgets, proactive log warnings
- [docs/dev/decisions.md](docs/dev/decisions.md) — Weighted Rating vs. Wilson score, the Production Tier heuristic
- [docs/images/](docs/images) — the screenshots the docs embed; shooting them is the `screenshots` skill

Read the relevant one before changing that area. Two are load-bearing: **frontend.md's reactivity rules** (`npm run lint` enforces the no-reactive-`const` one), and **integrations.md's trust tiers** — several upstreams are undocumented and unsanctioned, so don't scale request volume without revisiting them.

## Working style

- Be concise and economical everywhere — responses, code comments, doc prose. No filler, no restating what was just done; favor the smallest change that satisfies the request. When more thorough work (deeper investigation, a broader refactor, extra tests) would clearly pay off, say so and let the user decide.
  - Code comments: one line, stating the *why*, only when it isn't obvious from the code; skip the comment entirely if the code speaks for itself. This governs new comments; leave the long-form ones already in the tree alone.
  - Doc prose (this file, `README.md`, `CHANGELOG.md`): short bullets over paragraphs; no preamble, no summary section, lead with the point.
- Don't re-read a file already read in the current session unless it may have changed.
- Wait for an explicit go-ahead before implementing, unless the request already states the exact change to make. Before that go-ahead: answer the question asked instead of jumping to implementation, present the options and trade-offs when there are several valid approaches, and draft a plan first for non-trivial changes (multiple files, non-obvious design decisions, refactors).
- Ask clarifying questions as soon as the request is ambiguous, batched into one round — `AskUserQuestion` when the answer is a choice between options, prose otherwise, short and visually separated rather than buried mid-paragraph.
- Stay in scope: only make the changes asked for, plus the Development workflow checklist below. Flag other issues noticed rather than fixing them unprompted.
- Match the existing code style and conventions in the file/project rather than imposing personal preference; don't reformat unrelated code.
- If a rule here is stale or contradicts the code, say so instead of silently following it.

## Ask first

- Anything destructive or hard to reverse: `git reset --hard`, `git push --force`, deleting files, deleting or hand-editing `db.sqlite` (`npm run cache:clear` empties its cache tables without touching the file), overwriting the `steam.isonoe.net:prefs` localStorage backup a screenshot run left behind.
- Committing or pushing — only when explicitly asked.
- Adding a new dependency; prefer what's already in use.
- Adding a skill, hook, plugin or agent.

## Claude Code setup

- Check `.claude/skills/` first: when a request matches a skill there, invoke it rather than improvising — it's the source of truth for the procedure it covers.
- Multi-step procedures invoked on demand belong in `.claude/skills/`, not in this file — this file is for rules that apply to every task. Suggest a skill, hook, plugin or agent when one fits the task at hand or a procedure recurs.
- Automated behaviors ("always run X after Y") need hooks in `.claude/settings.json`; instructions in this file can't guarantee them.

## Knowledge sharing

- Project conventions, workflow rules, and architecture decisions belong in this file (or docs linked from it) — they're version-controlled and apply on every machine/session this repo is worked on from, not just the current one.
- Prefer a linked doc under `docs/` over growing this file when the detail is substantial, as the `docs/dev/` files already do; link to it from here rather than duplicating its content.
- Facts specific to one person (role, personal working-style preferences, in-progress session/project context) belong in Claude's own memory, not here — this file is loaded for every session working on the repo, not a place for one contributor's personal notes.
- Secrets, credentials, and ephemeral state belong in neither: `.env` is gitignored, and `default.env` documents every setting.

## Git workflow

- Make commits atomic: each commit represents one logical change and passes the tests on its own.
- Write descriptive commit messages that explain the *why*, not just the *what* — a short subject line, with a body when context is needed.
- **Message format**: a plain imperative subject, no Conventional Commits prefix — the `feat:`/`fix:` prefixes in older history were dropped; don't reintroduce them.
- Ordinary changes commit directly to `main` — this is a solo repo with no PR/review process. A complex feature (multiple concerns, significant refactoring, a new subsystem) spanning more than one commit gets a dedicated branch instead.
- Close such a branch with a real merge commit (`git merge --no-ff`), never a fast-forward or a rebase onto `main` — the branch is the unit of work and the merge commit is what shows it. `list-centric-redesign` is the open branch this applies to.
- Never commit secrets, credentials, API keys, or `.env` values.
- If a change is accidentally left out of a commit that was just made, amend that commit (`git commit --amend`) rather than adding a separate fixup commit for it.

## Development workflow

After making changes:

1. Check whether existing tests need updating, or new ones are needed, to cover the change, then run `npm test` and report actual results — not assumptions. For any frontend change also run `npm run typecheck` **and `npm run lint`**, and fix what they report; `npm run lint` must stay at 0 problems, and the few intended violations carry a targeted `eslint-disable-next-line` with a reason.
2. Update any affected documentation — see "Knowledge sharing" above — and `CHANGELOG.md` (see "Changelog" below).
3. The `pre-commit` hook already runs `npm test` and blocks the commit on failure, so once step 1 has passed don't run it again just because a commit is about to happen. It doesn't run `npm run typecheck`/`npm run lint` — step 1 is where those happen. README's Development section has the snippet to recreate it after a fresh clone.

## Changelog

Every code change updates `CHANGELOG.md`, in the same commit as the code it documents — never a separate follow-up commit. Add entries under `## [Unreleased]` (create the section if it doesn't exist) using [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) format (Added / Changed / Fixed / Removed).
