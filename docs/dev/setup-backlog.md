# Setup backlog

Proposals from `setup-review` runs about the Claude Code setup (skills, scripts, hooks, settings, CLAUDE.md, memory), so each run builds on the last instead of re-proposing. Effort S/M/L; numbered with `node scripts/backlog-next.js P`, never reusing a closed item's number.

Last reviewed: 2026-10-11 · Transcripts read up to: 2026-10-11T19:36:55Z.

- **Watching**: applied, with the command that measures it, its baseline and its target. The next run re-measures: target met → remove the item; missed → move it to Open with what was learned.
- **Open**: recommended, not yet picked.
- **Declined**: with the user's reason. Not proposed again unless new evidence contradicts the reason.

## Watching

- **P6 · code-audit · S** — a **docs** dimension audits each doc's claims against the code; code-fix closes its items without a test. Measure: the next `/code-audit docs` — about 15 drifts found by hand on 2026-10-11 → under 5.
- **P12 · code-audit · S** — no argument now audits the dimension audited longest ago instead of asking. The question came in 4 of 5 runs, once dismissed then interrupted. Measure: the next `--transcripts` digest's code-audit dimension questions — 4 → 0.
- **P19 · code-fix BATCH · S** — no Monitor on `batch.js status --watch` (deleted): the lead posts one line per lane report or block. Each tick woke the lead, which posted "nothing finished yet" anyway. Measure: Monitor-triggered lead turns in the next batch's transcript — about 10 → 0.
- **P20 · code-fix BATCH · S** — lanes re-run only the failed e2e tests (`-- --last-failed`) until green, then the full suite once. e2e was the top tool in every lane. Measure: the next batch's `node scripts/setup-facts.js --agents`, e2e time per lane — max 215 s, 4 lanes over 100 s → max 90 s.

## Open

- **P13 · code-fix BATCH · S** — the lead posts a line only when a lane finishes or is blocked. Relay turns fell from about 25 to about 10, target 5: a prose rule can't stop the Monitor waking the lead. Superseded by P19; close when P19 is met.
- **P15 · hook · M** — a Stop hook blocking a final message that ends with a prose question, pointing to `AskUserQuestion`: proposals left in prose got "go ahead with your proposal" six times in two sessions. Needs explicit approval as a new hook.
- **P18 · code-fix BATCH · M** — 6 default lanes, lanes run only their item's test, merges defer e2e, a background `/code-review` per merged lane. First batch after (2026-10-11, 16 items): `lanesMin` 12 → 7 and 0 hand-resolved conflicts (met); `afterLanesMin` 10 → 18 and gate share 16–36% (target ≤ 5 and ≤ 15%, missed). The per-lane reviews found real bugs that took six follow-up lanes; `--agents` shows tools at 38–79% of lane time, e2e on top in all 12 agents (P20 targets that).

## Declined

None.
