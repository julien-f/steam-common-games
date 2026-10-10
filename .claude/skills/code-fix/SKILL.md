---
name: code-fix
description: Fix items from the code backlog (docs/dev/code-backlog.md) — test first, fix, close the item, one commit each. Use when asked to fix, implement or close a C-item or a code-audit finding.
---

# Code fix

Works through the named `C<n>` items in [code-backlog.md](../../../docs/dev/code-backlog.md), in order, one commit each. Finding new problems is [code-audit](../code-audit/SKILL.md)'s job; this one fixes what's there. A UI-visible fix also follows [ux-fix](../ux-fix/SKILL.md)'s step 3 (look at it on `dev:mock`).

## 0. Before starting

- Read every requested item, the doc its dimension names in code-audit, then the code involved, callers included.
- Re-verify each item still holds; one that doesn't is closed without a commit, and said so.
- Batch the real forks into one `AskUserQuestion`, recommendation first: anything on CLAUDE.md's ask-first list (a new dependency, deleting files), a change raising upstream traffic, a fix that widens past the item. Everything else proceeds on the item's Direction.

## 1. Test first

- A test in `test/*.test.js` (backend, shared frontend logic) or `e2e/` (behaviour in the browser) that fails for the reason the item describes; run it alone and confirm it fails.
- **cleanup** items change no behaviour: the existing tests must pass before and after, no new test.
- **perf** items: measure before and after (build sizes, outbound call counts from `GET /api/metrics`, a timing) and put the numbers in the commit body.

## 2. Fix

The smallest change that closes the item, following CLAUDE.md's code conventions and [frontend.md](../../../docs/dev/frontend.md)'s reactivity rules. Delete what it makes dead. Re-run the step 1 test.

## 3. Close and commit

- Remove the item from code-backlog.md, or narrow it to what's left and say so.
- `CHANGELOG.md` via `scripts/changelog-add.js` — Fixed or Changed for anything a user or operator notices, Development for contributor-only changes; a pure refactor commits with `SKIP_CHANGELOG=1`. Update any doc the change makes stale; record a surprise in pitfalls.md.
- `npm run format`, then commit per CLAUDE.md's Development workflow: subject says what changed and why it matters, body names `C<n>`.

## Report

One table — item, commit, how it was verified (test, measurement) — then anything narrowed rather than closed.
