# Setup backlog

Proposals from `setup-review` runs about the Claude Code setup (skills, scripts, hooks, settings, CLAUDE.md, memory), so each run builds on the last instead of re-proposing. Effort S/M/L; numbered with `node scripts/backlog-next.js P`, never reusing a closed item's number.

Last reviewed: 2026-10-18 · Transcripts read up to: 2026-10-17T22:07:15Z.

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
- **P34 · check.js · M** — flags comment blocks of three or more lines added in staged `public/` files (CLAUDE.md: one line, two at most). 2026-10-12: 4 of 6 merge reviews flagged long comments. 2026-10-16: raised from two lines, a non-obvious _why_ squeezed into one dense line or pushed out to a doc. Measure: merge reviews flagging long comments — 4/6 → 0.
- **P46 · changelog-check.js · S** — a feature branch's commits skip the entry requirement; the `pre-merge-commit` hook checks the merge's whole diff instead. 2026-10-16: a step commit needed an entry for a half-built feature. Measure: half-feature entries rewritten at the next release consolidation — unknown → 0.
- **P47 · ~/.claude/CLAUDE.md · S** — a non-trivial plan is reviewed by specialist agents, one per area, until they agree, before the go-ahead; a multi-commit feature's plan names its branch. 2026-10-18: asked for in the user's own words at 2 go-aheads ("fais une relecture avec des agents spécialisés…"). Measure: digests' own-word answers asking for a plan review — 2 → 0.
- **P48 · ~/.claude/CLAUDE.md · S** — a problem the user raised without describing it gets one line of what was understood and room to explain, not guessed options. 2026-10-18: 3 such `AskUserQuestion` calls dismissed in 3 sessions ("attends, je vais expliquer"; one inferred). Measure: `--transcripts` dismissed answers — 3 → ≤ 1.
- **P49 · setup-facts.js · S** — doc reads count only a reader's own arguments (cat/sed/head/tail segments, `for … in` lists), not heredoc bodies, grep/wc arguments or `~/.claude/CLAUDE.md`. Measure: `--transcripts=2026-10-16T08:31:00Z` CLAUDE.md whole reads — 16 → 6 (met when applied; the 6 are real `cat CLAUDE.md` of a file already loaded).
- **P50 · setup-facts.js · S** — `--cost` doesn't record or compare a failed run (2026-10-17: e2e exit 1 from another session's port, logged as a 9.9 s baseline; that row's e2e time dropped). Measure: failed runs' times in `cost.jsonl` — 1 → 0.
- **P51 · setup-facts.js · S** — digests keep each reply's last paragraph (up to 600 characters) instead of its first 200, so P43's prose-offer half can be read. Measure: P43 digest half checkable — no → yes.
- **P43 · ~/.claude hook · M** — 2026-10-18: 0 blocked in 42 runs; digest half unreadable until P51. A user-level Stop hook sends back a reply whose last paragraph asks or offers in prose, to go through `AskUserQuestion` with the recommended set; it replaces P15 and P38, whose rule `~/.claude/CLAUDE.md` has carried since 2026-10-10 and agents still skipped (1 prose offer answered "do it if you recommend it" in 2 sessions). Measure: `"blocked":true` lines in `~/.claude/logs/prose-offer.jsonl`, and digests' last agent text ending in a prose offer — 1 in 2 sessions → 0.

## Open

- **P6 · code-audit · S** — 2026-10-18: both user-facing changes since (f57d989, 7e84e1f) updated `docs/user/features.md`; the check may not pay off. A **docs** dimension audits each doc's claims against the code. The 2026-10-12 run found 36 drifts in 9 docs (target under 5, missed): the audit catches drift, but nothing stops it accruing. features.md lacked features shipped in the last two days (link previews, Played columns), so Development workflow step 2 (update affected docs) is skipped on feature commits. Next: a check that catches it at commit time, e.g. a user-facing `Added` changelog entry staged without a `docs/user/` change.
- **P18 · code-fix BATCH · M** — 6 default lanes, lanes run only their item's test, merges defer e2e, a background `/code-review` per merged lane. First batch after (2026-10-11, 16 items): `lanesMin` 12 → 7 and 0 hand-resolved conflicts (met); `afterLanesMin` 10 → 18 and gate share 16–36% (target ≤ 5 and ≤ 15%, missed). The per-lane reviews found real bugs that took six follow-up lanes; `--agents` shows tools at 38–79% of lane time, e2e on top in all 12 agents (P20 targets that).
- **P41 · ux-fix · M** — also takes a new feature request: record it as a U-item, then the usual loop. Speculative: 2 sessions built features with an improvised brainstorm → ask → implement flow, no friction beyond P38's.

## Declined

None.
