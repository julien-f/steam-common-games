# CLAUDE.md

Working conventions for this repo. Documentation lives in `docs/` — keep it there, not here (see Knowledge sharing below).

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

Read the relevant one before changing that area. Two are load-bearing enough to call out: **frontend.md's reactivity section** (one reactive source of truth per row; async state in `createResource`; never capture a reactive read into a plain `const` — `npm run lint` enforces the last one), and **integrations.md's trust tiers** (several upstreams are undocumented and unsanctioned; don't scale request volume without revisiting them).

## Working style

- Be concise and economical everywhere — responses, code comments, doc prose. No filler, no restating what was just done; favor the smallest change that satisfies the request. When more thorough work (deeper investigation, a broader refactor, extra tests) would clearly pay off, say so and let the user decide.
  - Code comments: one line, stating the *why*, only when it isn't obvious from the code; skip the comment entirely if the code speaks for itself. (The long explanatory comments already in the tree are deliberate — see "Match the existing code style" below; this bullet is about what to add, not what to go trim.)
  - Doc prose (this file, `README.md`, `CHANGELOG.md`): short bullets over paragraphs; no preamble, no summary section, lead with the point.
- Suggest Claude Code plugins, skills, or agents when relevant to the task at hand.
- Don't re-read a file already read in the current session unless it may have changed.
- Wait for an explicit go-ahead before implementing, even for a trivial edit. Before that go-ahead: answer the question asked instead of jumping to implementation, ask clarifying questions **one at a time** when the request is ambiguous, present the options and trade-offs when there are several valid approaches, and draft a plan first for non-trivial changes (multiple files, non-obvious design decisions, refactors).
- Stay in scope: only make the changes asked for. Flag other issues noticed rather than fixing them unprompted.
- Match the existing code style and conventions in the file/project rather than imposing personal preference; don't reformat unrelated code.
- Ask before adding a new dependency; prefer what's already in use.

## Knowledge sharing

- Project conventions, workflow rules, and architecture decisions belong in this file (or docs linked from it) — they're version-controlled and apply on every machine/session this repo is worked on from, not just the current one.
- Prefer a linked doc under `docs/` over growing this file when the detail is substantial (e.g. `docs/list-centric-redesign.md`); link to it from here rather than duplicating its content.
- Facts specific to one person (role, personal working-style preferences, in-progress session/project context) belong in Claude's own memory, not here — this file is loaded for every session working on the repo, not a place for one contributor's personal notes.
- Secrets, credentials, and ephemeral state belong in neither — see `default.env`/`.env` above.

## Git workflow

- Make commits atomic: each commit represents one logical change and passes the tests on its own.
- Write descriptive commit messages that explain the *why*, not just the *what* — a short subject line, with a body when context is needed.
- Ordinary changes commit directly to `main` — this is a solo repo with no PR/review process. A complex feature (multiple concerns, significant refactoring, a new subsystem) spanning more than one commit gets a dedicated branch instead.
- Close such a branch with a real merge commit (`git merge --no-ff`), never a fast-forward or a rebase onto `main`: the branch is the unit of work, and the merge commit is what makes that visible in a history that has none yet — older large work (the whole Bundles subsystem) predates this rule and landed as direct commits. `list-centric-redesign` is the open branch this applies to.
- Only commit or push when explicitly asked.
- Never commit secrets, credentials, API keys, or `.env` values.
- Update `CHANGELOG.md` in the same commit as the code change it documents (see "Changelog" below) — never as a separate follow-up commit.
- If a change is accidentally left out of a commit that was just made, amend that commit (`git commit --amend`) rather than adding a separate fixup commit for it.

## Development workflow

After making changes:

1. Check whether existing tests need updating, or new ones are needed, to cover the change, then run `npm test` and report actual results — not assumptions. For any frontend change also run `npm run typecheck` **and `npm run lint`**, and fix what they report. `npm run lint` is expected to be clean (0 problems): the few genuinely-intended violations left in the tree carry a targeted `eslint-disable-next-line` with a comment saying why, so a fresh warning means new code, not background noise.
2. Update any affected documentation (this file, `README.md`, `CHANGELOG.md`) — see "Knowledge sharing" above for where things belong.
3. A `pre-commit` git hook (plain shell script at `.git/hooks/pre-commit`, not a package like Husky — this repo has no dependency for it) runs `npm test` automatically and blocks the commit on failure. It does **not** run `npm run lint`/`npm run typecheck` — step 1 above is where those happen. The hook lives under `.git/`, so it isn't version-controlled — it needs to be recreated after a fresh clone (see the snippet in this repo's own `.git/hooks/pre-commit` if you need to reproduce it elsewhere). Once step 1 above has already confirmed tests pass, don't run `npm test` again immediately before `git commit` just because a commit is about to happen — the hook already re-runs it and blocks on failure, so a run whose only purpose is "will this commit succeed" is redundant with the hook, not an extra safety margin.

## Changelog

Always update `CHANGELOG.md` before committing any code change. Add entries under `## [Unreleased]` (create the section if it doesn't exist) using [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) format (Added / Changed / Fixed / Removed).
