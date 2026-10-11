# Fix batch

Above about five items, code-fix and ux-fix run as parallel lanes: one background agent per lane, in its own worktree, merged `--no-ff`. The first run (2026-10-11, 24 C-items) took ~65 min end to end.

## 1. Plan (before any go-ahead)

- Commit the backlog first: a worktree only sees committed items.
- `node scripts/batch.js plan [--lanes=4] <items…>` groups the items into lanes that share no file, writes the manifest (`.claude/batch/`, gitignored) and prints an estimate from past batches. Place by hand what it lists as naming no file.
- Pull out of the lanes, to do yourself on `main` after the merges: an item whose fix changes what callers in other lanes read (a helper's return shape), and an item with an open fork.
- Present the recommended items (and why not the others), the lanes, the serial items and the estimate in one `AskUserQuestion`.

## 2. Launch

One `Agent` per lane, all in one message, `isolation: "worktree"`, with the lane template below. Then run `node scripts/batch.js status --watch` under `Monitor` and post its line to the user whenever it changes.

## 3. Merge each lane as it reports

- `node scripts/batch.js merge <branch> <its closed items>`: merges `--no-ff --no-commit`, keeps both sides of CHANGELOG conflicts and drops the closed items from the backlog. Narrow, rather than drop, an item the lane narrowed. Commit (`Merge lane <X>: …`, body naming the items; its hook runs the e2e the lane's commits deferred), then `git worktree remove` and `git branch -d`.
- Record what a lane reports as new problems, once verified, as backlog items.

## 4. After the lanes

The serial items, then the skill's look (ux-fix step 3; code-fix's UI-visible items), then `/code-review` over the whole batch, then `node scripts/batch.js record` (feeds the next estimate) and `node scripts/setup-facts.js --agents` (each agent's time, turns, failed calls and gate time) for the report.

## Lane template

```
You fix <items> from <backlog file> in this repo, in your own git worktree (your working directory); commit on its branch, never touch main or push. The user approved the plan, which covers one commit per item.
- First run `git merge --ff-only main`: worktrees branch from origin/main, which lags local main (pitfalls.md).
- Follow .claude/skills/<code-fix|ux-fix>/SKILL.md steps 0–<last step before the look>, one commit per item, but don't edit the backlog file (the lead closes items at merge), skip the dev:mock look and /code-review.
- A real fork (fix widens past the item, a dependency, more upstream traffic): skip the item and report it.
- Stay in your worktree: no `git -C <main checkout>`, `--prefix` or `cwd` parameter; one plain command per Bash call, no `&&`/`;` chains or heredocs.
- Commit messages: write them to <scratchpad>/msg-<lane>.txt (the scratchpad is shared, a generic name gets overwritten), then `E2E_DEFER=1 E2E_PORT=<2899x> git commit -F <file>`; prefix every e2e run with the same E2E_PORT.
- Before reporting, run `E2E_PORT=<2899x> npm run test:e2e` once (both widths) and fix what fails.
Report: item → commit → how verified; anything skipped or narrowed and why; new problems found.
```

Give each lane its own `E2E_PORT` (28993 up; 28997 for the lead).
