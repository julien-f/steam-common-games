# Setup backlog

Proposals from `setup-review` runs about the Claude Code setup (skills, scripts, hooks, settings, CLAUDE.md, memory), so each run builds on the last instead of re-proposing. Effort S/M/L; numbered with `node scripts/backlog-next.js P`, never reusing a closed item's number.

Last reviewed: 2026-10-12 · Transcripts read up to: 2026-10-12T12:29:45Z.

- **Watching**: applied, with the command that measures it, its baseline and its target. The next run re-measures: target met → remove the item; missed → move it to Open with what was learned.
- **Open**: recommended, not yet picked.
- **Declined**: with the user's reason. Not proposed again unless new evidence contradicts the reason.

## Watching

- **P27 · skill-evals.js · S** — routing scores and dry-run results are kept; the routing line names the last comparable score. Speculative: eval run frequency unknown. Measure: the next eval run prints the last score — none → shown.
- **P29 · code-fix BATCH · S** — each lane runs `/code-review` (low) on its own commits and fixes confirmed findings before reporting; the lead still reviews each merge for where lanes meet. 2026-10-12: 10 follow-up commits over 7 lane merges. Measure: follow-up commits per merge in the next batch — 1.4 → ≤ 0.5.
- **P30 · batch.js · S** — `merge <branch>` takes the closed items from the branch's own backlog diff; a line the lane rewrote is kept as rewritten. 2026-10-12: narrowed items dropped by a hand-listed merge, U163–U165 re-added by hand. Measure: narrowed items re-added by hand in the next batch — 3 → 0.
- **P31 · mock-server.js · S** — `up` restarts the server when git HEAD moved since it started. 2026-10-12: one stale measurement (search box full width, nav 94 px) after commits in the main checkout. Measure: stale-server measurements in the next ux-fix — 1 → 0.
- **P32 · css-overrides.js · S** — every media block, not only narrow-screen ones, is checked for rules a later same-selector rule silently overrides. 2026-10-12: two desktop `min-width` rules lost that way, caught only in review. Measure: that class in the next merge reviews — 2 → 0.
- **P33 · ux-fix · S** — visual or layout items get a before/after mockup page (CSS injected on dev:mock) approved before building. Evidence: one session, mockups asked for twice at go-ahead. Measure: mockup requests at a ux-fix go-ahead — 2 → 0.
- **P34 · check.js · M** — flags comment blocks of two or more lines added in staged `public/` files (CLAUDE.md's one-line rule). 2026-10-12: 4 of 6 merge reviews flagged long comments. Measure: merge reviews flagging long comments — 4/6 → 0.
- **P35 · testing.md · S** — the quoted e2e time is gone; `setup-facts --cost` measures it (P21 missed: ~40 s quoted, 44–120 s measured under load). Measure: `doc-refs`/`--cost` — no doc quotes an e2e time → stays so.

## Open

- **P6 · code-audit · S** — a **docs** dimension audits each doc's claims against the code. The 2026-10-12 run found 36 drifts in 9 docs (target under 5, missed): the audit catches drift, but nothing stops it accruing. features.md lacked features shipped in the last two days (link previews, Played columns), so Development workflow step 2 (update affected docs) is skipped on feature commits. Next: a check that catches it at commit time, e.g. a user-facing `Added` changelog entry staged without a `docs/user/` change.
- **P15 · hook · M** — a Stop hook blocking a final message that ends with a prose question, pointing to `AskUserQuestion`: proposals left in prose got "go ahead with your proposal" six times in two sessions. Needs explicit approval as a new hook.
- **P18 · code-fix BATCH · M** — 6 default lanes, lanes run only their item's test, merges defer e2e, a background `/code-review` per merged lane. First batch after (2026-10-11, 16 items): `lanesMin` 12 → 7 and 0 hand-resolved conflicts (met); `afterLanesMin` 10 → 18 and gate share 16–36% (target ≤ 5 and ≤ 15%, missed). The per-lane reviews found real bugs that took six follow-up lanes; `--agents` shows tools at 38–79% of lane time, e2e on top in all 12 agents (P20 targets that).

## Declined

None.
