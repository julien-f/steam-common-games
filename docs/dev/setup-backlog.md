# Setup backlog

Proposals from `setup-review` runs about the Claude Code setup (skills, scripts, hooks, settings, CLAUDE.md, memory), so each run builds on the last instead of re-proposing. Effort S/M/L; numbered with `node scripts/backlog-next.js P`, never reusing a closed item's number.

Last reviewed: never · Transcripts read up to: never.

- **Watching**: applied, with the command that measures it, its baseline and its target. The next run re-measures: target met → remove the item; missed → move it to Open with what was learned.
- **Open**: recommended, not yet picked.
- **Declined**: with the user's reason. Not proposed again unless new evidence contradicts the reason.

## Watching

- **P1 · setup-review · S** — its description now names CLAUDE.md reviews (this repo's or ~/.claude's) and question-form asks ("shall we review the skills?"), which loaded no skill. Measure: `node scripts/skill-evals.js --repeat=3 setup-review` — 9/15 → 15/15 (15/15 when applied).
- **P2 · settings · S** — this machine's `.claude/settings.local.json` allowed `Bash(git branch *)`, pre-approving the ask-first `git branch -D`; narrowed to listing, `--show-current` and `-d`. Measure: `npm run check:setup` — 1 warning → 0 (0 when applied).

## Open

None.

## Declined

None.
