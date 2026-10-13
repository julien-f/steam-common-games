# Setup backlog

Proposals from `setup-review` runs about the Claude Code setup (skills, scripts, hooks, settings, CLAUDE.md, memory), so each run builds on the last instead of re-proposing. Effort S/M/L; numbered with `node scripts/backlog-next.js P`, never reusing a closed item's number.

Last reviewed: 2026-10-13 · Transcripts read up to: 2026-10-13T12:24:17Z.

- **Watching**: applied, with the command that measures it, its baseline and its target. The next run re-measures: target met → remove the item; missed → move it to Open with what was learned.
- **Open**: recommended, not yet picked.
- **Declined**: with the user's reason. Not proposed again unless new evidence contradicts the reason.

## Watching

- **P27 · skill-evals.js · S** — routing scores and dry-run results are kept; the routing line names the last comparable score. Speculative: eval run frequency unknown. Measure: the next eval run prints the last score — none → shown.
- **P29 · code-fix BATCH · S** — each lane runs `/code-review medium` on its own commits and fixes confirmed findings before reporting; the lead still reviews each merge for where lanes meet. 2026-10-12: 10 follow-up commits over 7 lane merges; the first batch with lane self-review at `low` found 0 in lanes (one tool call each) against 10 in the lead's `medium` review, so lanes now run `medium`. Measure: confirmed findings in the lead's merge review per batch — 10 → ≤ 2.
- **P30 · batch.js · S** — `merge <branch>` takes the closed items from the branch's own backlog diff; a line the lane rewrote is kept as rewritten. 2026-10-12: narrowed items dropped by a hand-listed merge, U163–U165 re-added by hand. Measure: narrowed items re-added by hand in the next batch — 3 → 0.
- **P31 · mock-server.js · S** — `up` restarts the server when git HEAD moved since it started. 2026-10-12: one stale measurement (search box full width, nav 94 px) after commits in the main checkout. Measure: stale-server measurements in the next ux-fix — 1 → 0.
- **P32 · css-overrides.js · S** — every media block, not only narrow-screen ones, is checked for rules a later same-selector rule silently overrides. 2026-10-12: two desktop `min-width` rules lost that way, caught only in review. Measure: that class in the next merge reviews — 2 → 0.
- **P33 · ux-fix · S** — visual or layout items get a before/after mockup page (CSS injected on dev:mock) approved before building. Evidence: one session, mockups asked for twice at go-ahead. Measure: mockup requests at a ux-fix go-ahead — 2 → 0.
- **P34 · check.js · M** — flags comment blocks of two or more lines added in staged `public/` files (CLAUDE.md's one-line rule). 2026-10-12: 4 of 6 merge reviews flagged long comments. Measure: merge reviews flagging long comments — 4/6 → 0.

- **P36 · settings · S** — this machine's `settings.local.json` lost `Bash(git *)` (back, wider than P2's `git branch *`), `gh issue *`, `npm install *` and 25 dead one-offs (old scratchpad paths, a pid, the renamed playwright plugin's tools). Measure: `npm run check:setup` — 8 warnings → 0 (0 when applied).
- **P37 · testing.md · S** — the pre-commit hook's quoted time is gone, pointing to `setup-facts --cost` instead (P35 missed: "~18 s with e2e" quoted, median 31.3 s measured). Measure: `--cost` against the times docs quote — 1 stale → 0.
- **P39 · CLAUDE.md · S** — a UI commit is preceded by the phone e2e only, the hook running desktop and pre-push both. Measure: `setup-facts --transcripts` pair `npm run test:e2e → git commit` — 7 full runs in 2 sessions → phone-only runs.
- **P40 · integrations.md · S** — the live site serving other people moved from this machine's memory to the trust tiers; the memory entry is deleted. Measure: project facts in this repo's Claude memory — 1 → 0.

## Open

- **P6 · code-audit · S** — a **docs** dimension audits each doc's claims against the code. The 2026-10-12 run found 36 drifts in 9 docs (target under 5, missed): the audit catches drift, but nothing stops it accruing. features.md lacked features shipped in the last two days (link previews, Played columns), so Development workflow step 2 (update affected docs) is skipped on feature commits. Next: a check that catches it at commit time, e.g. a user-facing `Added` changelog entry staged without a `docs/user/` change.
- **P15 · hook · M** — a Stop hook blocking a final message that ends with a prose question, pointing to `AskUserQuestion`: proposals left in prose got "go ahead with your proposal" six times in two sessions. Needs explicit approval as a new hook.
- **P18 · code-fix BATCH · M** — 6 default lanes, lanes run only their item's test, merges defer e2e, a background `/code-review` per merged lane. First batch after (2026-10-11, 16 items): `lanesMin` 12 → 7 and 0 hand-resolved conflicts (met); `afterLanesMin` 10 → 18 and gate share 16–36% (target ≤ 5 and ≤ 15%, missed). The per-lane reviews found real bugs that took six follow-up lanes; `--agents` shows tools at 38–79% of lane time, e2e on top in all 12 agents (P20 targets that).
- **P38 · ~/.claude/CLAUDE.md · S** — offering to act after an answer, brainstorm or review recommends a set and asks for the go-ahead, asking which only when the top options are close (and why). 2 sessions: a menu dismissed, then "Est-ce que tu recommande ?" and "fais tes recommendations, demande moi s'il y a des vrais choix". Measure: answers asking for a recommendation or dismissing the question — 4 → 0. Left for later at the 2026-10-13 review.
- **P41 · ux-fix · M** — also takes a new feature request: record it as a U-item, then the usual loop. Speculative: 2 sessions built features with an improvised brainstorm → ask → implement flow, no friction beyond P38's.

## Declined

None.
