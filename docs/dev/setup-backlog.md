# Setup backlog

Proposals from `setup-review` runs about the Claude Code setup (skills, scripts, hooks, settings, CLAUDE.md, memory), so each run builds on the last instead of re-proposing. Effort S/M/L; numbered with `node scripts/backlog-next.js P`, never reusing a closed item's number.

Last reviewed: 2026-10-12 · Transcripts read up to: 2026-10-12T08:55:13Z.

- **Watching**: applied, with the command that measures it, its baseline and its target. The next run re-measures: target met → remove the item; missed → move it to Open with what was learned.
- **Open**: recommended, not yet picked.
- **Declined**: with the user's reason. Not proposed again unless new evidence contradicts the reason.

## Watching

- **P12 · code-audit · S** — no argument now audits the dimension audited longest ago instead of asking. The question came in 4 of 5 runs, once dismissed then interrupted. Measure: the next `--transcripts` digest's code-audit dimension questions — 4 → 0.
- **P21 · CLAUDE.md, testing.md · S** — test timings live in testing.md only, re-measured: CLAUDE.md and testing.md said e2e ~20 s, measured 39–51 s. Measure: `setup-facts --cost` against testing.md — 20 s quoted vs 32–51 s (3 runs) → within 25%.
- **P22 · setup-facts --cost · S** — gate times are kept (`scripts/dev-metrics.js`) and each run prints the change since the last, ⚠ past 25% slower; nothing kept before. Measure: the next `--cost` prints a delta per gate — none → 4 gates.
- **P23 · setup-facts commandKey · S** — a chain is keyed by its gate: 86 of 110 `git add` calls chained a commit, so commit + hook time read as "git add 27 s". Measure: `--transcripts` slowest calls — `git commit` absent → listed (27 s on 2026-10-12's re-run).
- **P24 · setup-facts --transcripts · M** — tokens per session and per skill run (main thread). Measure: the next `--transcripts` skill-runs line — no tokens → tokens per skill; baseline ux-review 4.4M in / 24K out per run.
- **P25 · setup-facts --transcripts · S** — interrupts carry the running skill, counted per skill. Measure: the next digest's interrupts — skill unknown → attributed.
- **P26 · check.js · S** — every check run (hooks included) logs step times and failures; `--cost` reports blocked commits and by which step. Measure: the next `--cost`'s check-runs line — no record → commits counted.
- **P27 · skill-evals.js · S** — routing scores and dry-run results are kept; the routing line names the last comparable score. Speculative: eval run frequency unknown. Measure: the next eval run prints the last score — none → shown.

## Open

- **P20 · code-fix BATCH · S** — lanes re-run only failed e2e tests until green, then the full suite once. 2026-10-12's batch (13 items): no lane re-ran failures, yet e2e still topped 3 of 6 lanes, max 108 s (target 90 s, missed): it was the one full run before reporting, paid by doc- and comment-only lanes too. Next: a lane whose commits touch nothing `check.js`'s UI pattern covers skips that run.
- **P6 · code-audit · S** — a **docs** dimension audits each doc's claims against the code. The 2026-10-12 run found 36 drifts in 9 docs (target under 5, missed): the audit catches drift, but nothing stops it accruing. features.md lacked features shipped in the last two days (link previews, Played columns), so Development workflow step 2 (update affected docs) is skipped on feature commits. Next: a check that catches it at commit time, e.g. a user-facing `Added` changelog entry staged without a `docs/user/` change.
- **P15 · hook · M** — a Stop hook blocking a final message that ends with a prose question, pointing to `AskUserQuestion`: proposals left in prose got "go ahead with your proposal" six times in two sessions. Needs explicit approval as a new hook.
- **P18 · code-fix BATCH · M** — 6 default lanes, lanes run only their item's test, merges defer e2e, a background `/code-review` per merged lane. First batch after (2026-10-11, 16 items): `lanesMin` 12 → 7 and 0 hand-resolved conflicts (met); `afterLanesMin` 10 → 18 and gate share 16–36% (target ≤ 5 and ≤ 15%, missed). The per-lane reviews found real bugs that took six follow-up lanes; `--agents` shows tools at 38–79% of lane time, e2e on top in all 12 agents (P20 targets that).

## Declined

None.
