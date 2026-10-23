# Setup backlog

Proposals from `setup-review` runs about the Claude Code setup (skills, scripts, hooks, settings, CLAUDE.md, memory), so each run builds on the last instead of re-proposing. Effort S/M/L; numbered with `node scripts/backlog-next.js P`, never reusing a closed item's number.

Last reviewed: 2026-10-23 · Transcripts read up to: 2026-10-23T11:19:03Z.

- **Watching**: applied, with the command that measures it, its baseline and its target. The next run re-measures: target met → remove the item; missed → move it to Open with what was learned.
- **Open**: recommended, not yet picked.
- **Declined**: with the user's reason. Not proposed again unless new evidence contradicts the reason.

## Watching

- **P30 · batch.js · S** — `merge <branch>` takes the closed items from the branch's own backlog diff; a line the lane rewrote is kept as rewritten. 2026-10-12: narrowed items dropped by a hand-listed merge, U163–U165 re-added by hand. Measure: narrowed items re-added by hand in the next batch — 3 → 0.
- **P31 · mock-server.js · S** — `up` restarts the server when git HEAD moved since it started. 2026-10-12: one stale measurement (search box full width, nav 94 px) after commits in the main checkout. Measure: stale-server measurements in the next ux-fix — 1 → 0.
- **P33 · ux-fix · S** — visual or layout items get a before/after mockup page (CSS injected on dev:mock) approved before building. Evidence: one session, mockups asked for twice at go-ahead. Measure: mockup requests at a ux-fix go-ahead — 2 → 0.
- **P46 · changelog-check.js · S** — a feature branch's commits skip the entry requirement; the `pre-merge-commit` hook checks the merge's whole diff instead. 2026-10-16: a step commit needed an entry for a half-built feature. Measure: half-feature entries rewritten at the next release consolidation — unknown → 0.
- **P52 · setup-facts.js · S** — skill runs also list the sessions whose subagents read the skill's SKILL.md: fix-batch lanes follow code-fix and ux-fix without starting them. Measure: `--transcripts=2026-10-17T22:07:15Z` code-fix — never run, 0 → followed in 2 sessions (met when applied; watch that it keeps "nothing ran" from flagging a used skill).
- **P53 · setup-facts.js · S** — a background task's notification is not a prompt: skill runs run past it, and digests leave it out. Measure: `--transcripts=2026-10-17T22:07:15Z` — digest notification lines 16 (24.0 KB) → 0 (13.6 KB), code-audit's longest run 2 → 95 min (met when applied).
- **P54 · ~/.claude/CLAUDE.md · S** — a choice among visual options (colors, icons, layouts) is shown on a mockup page before asking. 2026-10-23: one redesign session, 12 questions on palette, icons and name dismissed over 3 rounds ("je ne vois pas les couleurs dans le terminal"), all answered at once on the mockup canvas. Measure: `--transcripts` dismissed questions about visual options — 12 → 0.
- **P55 · setup-review · S** — the digests are read inline under about 50 KB, one subagent above. Measure: subagents launched for digests under 50 KB per setup-review run — 1 → 0.

## Open

- **P29 · code-fix BATCH · S** — each lane runs `/code-review medium` on its own commits and fixes confirmed findings before reporting; the lead still reviews each merge for where lanes meet. 2026-10-12: 10 follow-up commits over 7 lane merges; the first batch with lane self-review at `low` found 0 in lanes (one tool call each) against 10 in the lead's `medium` review, so lanes now run `medium`. 2026-10-23, missed: the next batch (6 lanes, 13 items) still took 10 follow-up commits from the lead's merge reviews, 9 of them bug fixes (b96405b…47036ab). Next: try `/code-review high` in lanes, or accept the lead's review as the catch and drop the target. Measure: confirmed findings in the lead's merge review per batch — 10 → ≤ 2.
- **P34 · check.js · M** — flags comment blocks of three or more lines added in staged `public/` files (CLAUDE.md: one line, two at most). 2026-10-12: 4 of 6 merge reviews flagged long comments. 2026-10-16: raised from two lines, a non-obvious _why_ squeezed into one dense line or pushed out to a doc. 2026-10-23, missed but down: 1 of 6 merge reviews (604839c), and the check blocked 5 commits; one false positive fixed (d726916). Watch one more batch before changing it. Measure: merge reviews flagging long comments — 4/6 → 1/6 → 0.
- **P6 · code-audit · S** — 2026-10-18: both user-facing changes since (f57d989, 7e84e1f) updated `docs/user/features.md`; the check may not pay off. A **docs** dimension audits each doc's claims against the code. The 2026-10-12 run found 36 drifts in 9 docs (target under 5, missed): the audit catches drift, but nothing stops it accruing. features.md lacked features shipped in the last two days (link previews, Played columns), so Development workflow step 2 (update affected docs) is skipped on feature commits. Next: a check that catches it at commit time, e.g. a user-facing `Added` changelog entry staged without a `docs/user/` change.
- **P18 · code-fix BATCH · M** — 6 default lanes, lanes run only their item's test, merges defer e2e, a background `/code-review` per merged lane. First batch after (2026-10-11, 16 items): `lanesMin` 12 → 7 and 0 hand-resolved conflicts (met); `afterLanesMin` 10 → 18 and gate share 16–36% (target ≤ 5 and ≤ 15%, missed). The per-lane reviews found real bugs that took six follow-up lanes; `--agents` shows tools at 38–79% of lane time, e2e on top in all 12 agents (P20 targets that).
- **P41 · ux-fix · M** — also takes a new feature request: record it as a U-item, then the usual loop. Speculative: 2 sessions built features with an improvised brainstorm → ask → implement flow, no friction beyond P38's.

## Declined

None.
