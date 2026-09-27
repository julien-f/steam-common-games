---
name: ux-review
description: Run a UX/UI design review of the app by walking the user journeys in docs/dev/scenarios.md in a real browser, and report ranked findings with screenshots. Use when asked for a design, usability, UX or UI review, or to re-check a flow after a UI change.
---

# UX review

Judges the app against [docs/dev/scenarios.md](../../../docs/dev/scenarios.md), not general taste. A finding is friction on a scenario's path, or a broken **Expect**/**Edges** line.

## Scope

- Default: every scenario. A named scenario, group or route narrows it.
- A scenario that's wrong about the app (a step that doesn't exist, a stale expectation) is a finding against the doc, not the UI.

## Setup

1. `npm run dev` if not already running; review at `http://localhost:58991`.
2. Demo state only — same rule and mechanism as the `screenshots` skill: `node scripts/demo-prefs.js seed`, run the printed function with `browser_evaluate`, reload. Never type a real account's identifier.
3. Stay inside `integrations.md`'s trust tiers: one pass per scenario, no repeated refreshes or large-library loops against Steam/HLTB/ProtonDB.

## Walk each scenario

At **1440×900** and **390×844** (phone), following its steps as a user would — mouse first, then keyboard only.

Check at each step:

- **Clarity** — is the next action obvious? Are labels and icons self-explanatory without the docs?
- **Feedback** — loading, progress, success and failure all visible; the "how fresh is this?" ages present.
- **Empty and error states** — private profile, no results, missing `ITAD_API_KEY`, upstream failure: does the screen say what happened and what to do?
- **Consistency** — same action, same name and place across routes.
- **Keyboard and accessibility** — focus visible and in a sensible order, Esc/arrow shortcuts as in `?`, names on icon-only buttons (check `browser_snapshot`), contrast.
- **Layout** — no horizontal page scroll on phone, nothing clipped or overlapping, touch targets usable.
- **Console** — `browser_console_messages` errors and warnings.

Screenshot every finding into `.playwright-mcp/` (gitignored scratch — never `docs/images/`).

## Teardown

`node scripts/demo-prefs.js restore`, run the printed function, reload. Refuse to finish while the backup key is still present.

## Report

One table, ranked by severity, then one line of anything that went well enough to keep:

| # | Severity | Scenario | Where | Finding | Suggestion |
|---|---|---|---|---|---|

- **Severity**: *blocker* (the goal can't be reached) · *major* (reached with real confusion or a workaround) · *minor* (friction) · *polish*.
- Findings only — fix nothing. The user picks what to fix; each fix is its own commit.
