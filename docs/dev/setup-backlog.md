# Setup backlog

Proposals from `setup-review` runs about the Claude Code setup (skills, scripts, hooks, settings, CLAUDE.md, memory), so each run builds on the last instead of re-proposing. Effort S/M/L; numbered with `node scripts/backlog-next.js P`, never reusing a closed item's number.

Last reviewed: 2026-10-11 · Transcripts read up to: 2026-10-11T13:17:25Z.

- **Watching**: applied, with the command that measures it, its baseline and its target. The next run re-measures: target met → remove the item; missed → move it to Open with what was learned.
- **Open**: recommended, not yet picked.
- **Declined**: with the user's reason. Not proposed again unless new evidence contradicts the reason.

## Watching

- **P6 · code-audit · S** — a **docs** dimension audits each doc's claims against the code; code-fix closes its items without a test. Measure: the next `/code-audit docs` — about 15 drifts found by hand on 2026-10-11 → under 5.
- **P7 · CLAUDE.md · S** — the doc-prose rule covers `docs/`: current behavior only, each number in one place. Measure: `node scripts/setup-facts.js --cost`'s largest docs — frontend.md 49.8 KB, integrations.md 26.2 KB (73 and 43 KB before the 2026-10-11 trim) → no growth without a feature to account for it.
- **P11 · setup-lint · S** — `check:setup` fails when the ledger holds items but its header dates say "never"; eight runs left them unset, so each re-read the last 20 sessions. Measure: `npm run check:setup` on an undated ledger — passes → fails (fails when applied).
- **P12 · code-audit · S** — no argument now audits the dimension audited longest ago instead of asking. The question came in 4 of 5 runs, once dismissed then interrupted. Measure: the next `--transcripts` digest's code-audit dimension questions — 4 → 0.
- **P13 · code-fix BATCH · S** — the lead posts a line only when a lane finishes or is blocked, not on every `status --watch` change (about 25 relay turns in one batch); the stale first-run timing is gone, `batch.js plan` prints the estimate. Measure: relay turns in the next batch's transcript — ~25 → 5 or fewer.
- **P14 · ~/.claude/CLAUDE.md · S** — a recommended next step never bundles a push or a release; each is its own option. The user cut such bundles back twice. Measure: the next digests' answers trimming a push or release off a recommendation — 2 → 0.
- **P16 · ux-fix · S** — "Review the batch" links code-fix's step 4 instead of copying it. Measure: copies of that paragraph in `.claude/skills/` — 2 → 1 (1 when applied).
- **P17 · setup-facts · S** — `--agents` adds each agent's tool time, its share and top three commands, so model time (the rest) shows next to gate time. On the 2026-10-11 batches tools were 35–58% of a lane, model turns the rest. Measure: the next batch's `node scripts/setup-facts.js --agents` lines — the baseline for P18.
- **P18 · code-fix BATCH · M** — `batch.js plan` defaults to 6 lanes; lanes run only their item's test before committing (the hook runs the rest); merge commits defer e2e to one run after the last merge; a background `/code-review` per merged lane replaces the end-of-batch review. Measure: the next batch's `batch.js record` and `--agents` — `lanesMin` 12 → ≤ 9, `afterLanesMin` 10 → ≤ 5, gate share per lane 15–25% → ≤ 15%, hand-resolved merge conflicts ≤ 1. First batch after (2026-10-11, 16 items): `lanesMin` 7 and 0 conflicts (met); `afterLanesMin` 18 and gate share 16–36% (missed) — the per-lane reviews found real bugs (C153 resurrecting cleared fields, U115 losing focus off-page) that took a second round of six follow-up lanes, and lanes re-ran the full e2e to chase phone-only failures.

## Open

- **P15 · hook · M** — a Stop hook blocking a final message that ends with a prose question, pointing to `AskUserQuestion`: proposals left in prose got "go ahead with your proposal" six times in two sessions. Needs explicit approval as a new hook.

## Declined

None.
