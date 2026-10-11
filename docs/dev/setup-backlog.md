# Setup backlog

Proposals from `setup-review` runs about the Claude Code setup (skills, scripts, hooks, settings, CLAUDE.md, memory), so each run builds on the last instead of re-proposing. Effort S/M/L; numbered with `node scripts/backlog-next.js P`, never reusing a closed item's number.

Last reviewed: never · Transcripts read up to: never.

- **Watching**: applied, with the command that measures it, its baseline and its target. The next run re-measures: target met → remove the item; missed → move it to Open with what was learned.
- **Open**: recommended, not yet picked.
- **Declined**: with the user's reason. Not proposed again unless new evidence contradicts the reason.

## Watching

None.

## Open

- **P1 · setup-review · S** — two of its five routing cases miss: "Review our CLAUDE.md and ~/.claude/CLAUDE.md…" and "Shall we review the skills before committing the new ones?" load no skill (the agent starts reading files). Name CLAUDE.md reviews and question-form asks in the description's "Use when". Measure: `node scripts/skill-evals.js --repeat=3 setup-review` — 9/15 → 15/15.
- **P2 · settings · S** — `Bash(git branch *)` in this machine's `.claude/settings.local.json` pre-approves `git branch -D`, an ask-first action. Narrow it to the forms used (listing, `-d`). Measure: `npm run check:setup` — 1 warning → 0.

## Declined

None.
