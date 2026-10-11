# Setup backlog

Proposals from `setup-review` runs about the Claude Code setup (skills, scripts, hooks, settings, CLAUDE.md, memory), so each run builds on the last instead of re-proposing. Effort S/M/L; numbered with `node scripts/backlog-next.js P`, never reusing a closed item's number.

Last reviewed: never · Transcripts read up to: never.

- **Watching**: applied, with the command that measures it, its baseline and its target. The next run re-measures: target met → remove the item; missed → move it to Open with what was learned.
- **Open**: recommended, not yet picked.
- **Declined**: with the user's reason. Not proposed again unless new evidence contradicts the reason.

## Watching

- **P1 · setup-review · S** — its description now names CLAUDE.md reviews (this repo's or ~/.claude's) and question-form asks ("shall we review the skills?"), which loaded no skill. Measure: `node scripts/skill-evals.js --repeat=3 setup-review` — 9/15 → 15/15 (15/15 when applied).
- **P2 · settings · S** — this machine's `.claude/settings.local.json` allowed `Bash(git branch *)`, pre-approving the ask-first `git branch -D`; narrowed to listing, `--show-current` and `-d`. Measure: `npm run check:setup` — 1 warning → 0 (0 when applied).
- **P3 · code-fix BATCH · S** — lanes now close their own backlog items and message the lead when blocked, `batch.js merge` resolves backlog conflicts to main's side, `batch.js plan` resolves bare file names, and doc-refs skips node_modules. On 2026-10-11 two of four lanes ended blocked by checks red only in worktrees, and C93's overlap with two lanes went unseen. Measure: the next batch's lane reports and `node scripts/setup-facts.js --agents` — lanes ended blocked 2 → 0, hand-resolved backlog conflicts 1 → 0, hand-rebalanced lanes 1 → 0.
- **P4 · code-audit · S** — `scripts/dead-exports.js` joins Facts first; findings backtick only existing names; "one caller / always passed" claims need every route grepped. Measure: the next audit — doc-refs failures when recording 5 → 0, its batch's `/code-review` finds no audit claim missing a caller (1 → 0).

- **P5 · check · S** — `scripts/doc-lint.js` fails on history phrasing, paragraphs over 1000 characters and a doc missing from CLAUDE.md's or README.md's index; doc-refs reports HISTORY entries no doc mentions. On 2026-10-11 history made up about 40% of the four big docs and README's index missed six. Measure: `npm run check:doc-lint` — 6 → 0 (0 when applied); `npm run check:doc-refs` unused HISTORY entries 10 → 0 (0 when applied).
- **P6 · code-audit · S** — a **docs** dimension audits each doc's claims against the code; code-fix closes its items without a test. Measure: the next `/code-audit docs` — about 15 drifts found by hand on 2026-10-11 → under 5.
- **P7 · CLAUDE.md · S** — the doc-prose rule covers `docs/`: current behavior only, each number in one place. Measure: `node scripts/setup-facts.js --cost`'s largest docs — frontend.md 49.8 KB, integrations.md 26.2 KB (73 and 43 KB before the 2026-10-11 trim) → no growth without a feature to account for it.
- **P8 · setup-review · S** — `setup-facts.js --transcripts` counts doc reads (whole or narrowed, subagents included) and `--cost` lists the largest docs, for a new **Docs** check on how docs are split. Measure: the next run judges doc structure from those numbers (none before).

## Open

None.

## Declined

None.
