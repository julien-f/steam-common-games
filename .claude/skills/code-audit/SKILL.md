---
name: code-audit
description: Audit the codebase (not a diff) for simplification, security, performance, reliability, upstream-compliance and test-coverage issues, record verified findings in docs/dev/code-backlog.md, and report them ranked. Use when asked to review, audit or assess the code or app as a whole, or one dimension of it (e.g. "security review of the app", "where can the code be simpler").
---

# Code audit

Judges the code against this repo's own rules and docs, not general taste. A diff goes to `/code-review`, `/simplify` or `/security-review` instead; dependencies go to [dependency-audit](../dependency-audit/SKILL.md). Findings only, no fixes: [code-fix](../code-fix/SKILL.md) fixes them.

## Scope

- **Argument**: one dimension (below), optionally a path (`lib/`, `public/panel.tsx`). No argument: ask which dimension through `AskUserQuestion`, recommending the one with the oldest last audit in [code-backlog.md](../../../docs/dev/code-backlog.md)'s header.
- **`all`** runs every dimension: one `Agent` subagent per dimension, launched in one message, each given its checklist below and the finding bar. It's expensive — only on an explicit request.
- Say what was covered and what was skipped, and why.

## 1. Facts first

Run before reading code, so the review doesn't spend effort on what tools already say:

- `npm run check` — a failure is a finding as-is; don't re-derive it.
- `npm run build` — chunk sizes, for **perf**.
- `node scripts/deps-audit.js` and `npm audit` — for **security** and **simplify**; anything beyond that is dependency-audit's job.
- Read [code-backlog.md](../../../docs/dev/code-backlog.md) and [pitfalls.md](../../../docs/dev/pitfalls.md): what's already recorded is not a new finding.

## 2. Review the dimension

Read the doc each dimension names first; it defines what "wrong" means here.

- **simplify** — CLAUDE.md's Simplicity rules: dead exports, params, flags and branches; duplication across modules (and code better moved to a shared one); abstractions or options with a single caller; temporary code whose removal condition has been met; hand-rolled code a dependency already in use provides.
- **security** — request input (steam IDs, vanity names, list params, query strings) reaching upstream URLs, SQL or file paths; SQL built by interpolation instead of bound parameters (`lib/db.js`, `lib/cache.js`); raw HTML in the frontend (`innerHTML`); `express-rate-limit` coverage per route; security headers; `lib/auth.js` session, cookie and redirect handling; secrets or upstream keys reaching logs, responses or the bundle.
- **perf** — [data.md](../../../docs/dev/data.md)'s cache tiers and TTLs vs. what the code does; outbound calls vs. [observability.md](../../../docs/dev/observability.md)'s budgets (N+1 fetches, missing dedup via `lib/dedup.js`); sqlite queries without an index; chunk sizes and what lands in the initial bundle; [frontend.md](../../../docs/dev/frontend.md)'s reactivity rules in hot paths (the game table, streaming loads).
- **reliability** — routes not mapping errors through `routeErrorStatus`; optional sources (HLTB, ProtonDB, reviews) failing the request instead of degrading with a `[tag]` warning; fetches without a timeout; unhandled rejections; races on stale responses (`public/staleGuard.ts`).
- **compliance** — anything raising request volume or changing request shape toward an upstream, against [integrations.md](../../../docs/dev/integrations.md)'s trust tiers; inferred upstream rules in code that integrations.md doesn't record.
- **tests** — `lib/` modules and `server.js` routes with no test in `test/`; branches the tests never reach (error and degrade paths first); journey steps no e2e test locks (`node scripts/journey-coverage.js`).

## 3. The finding bar

A finding has a `file:line`, a concrete scenario (input or state → wrong result, cost or exposure), a fix direction and an effort (S/M/L). Then verify each one adversarially — re-read the code around it, callers included, trying to prove it wrong — and drop what doesn't survive.

Not findings: style (ESLint and Prettier own it), "might need later" generality, a rule's deliberate exceptions (an `eslint-disable` with a reason, a pitfalls.md entry), anything already in the backlog.

## Record and report

- Record each finding in [code-backlog.md](../../../docs/dev/code-backlog.md) under its dimension: next free `C` number, `**C<n> · <severity> · <effort>** — problem at \`file:line\`. Direction.` Drop or narrow items the run shows fixed, and set the header's last-audited date (today) for each dimension covered.
- **Severity**: _critical_ (exploitable, or loses or corrupts data) · _major_ (a real bug, cost or risk users or the upstreams feel) · _minor_ · _cleanup_ (simpler code, no behaviour change).
- Report one table ranked by severity, then effort:

| C   | Severity | Effort | Dimension | Where | Finding | Direction |
| --- | -------- | ------ | --------- | ----- | ------- | --------- |

- Fix nothing. The user picks what to fix.
