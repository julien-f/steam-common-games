---
name: setup-review
description: Review the Claude Code setup — skills, scripts, hooks, settings and CLAUDE.md — for drift, contradictions, duplication and prose steps better scripted, optionally mining past session transcripts for repeated friction, and report ranked proposals. Use when asked to review, audit or improve the skills, scripts, hooks or agent setup.
---

# Setup review

Judges the setup against CLAUDE.md's Where things belong and Working style rules. Proposals only, no edits: the user picks what to apply. App code goes to [code-audit](../code-audit/SKILL.md), dependencies to [dependency-audit](../dependency-audit/SKILL.md).

## Scope

- **Files**: `.claude/skills/*/SKILL.md`, `scripts/`, `.githooks/`, `.claude/settings.json`, `package.json`'s `scripts`, `CLAUDE.md`.
- **Argument `transcripts`** adds step 3. Without it, skip step 3 and say so.

## 1. Facts first

- `npm run check:doc-refs`: stale script names, flags, npm scripts and links in skills and CLAUDE.md. A failure is a finding as-is.
- For each script in `scripts/`, its callers: `grep -rn '<name>' package.json .githooks .claude/skills CLAUDE.md scripts docs`.
- Read every skill, CLAUDE.md and `.claude/settings.json` in full.

## 2. Review

- **Contradictions**: a skill that disagrees with CLAUDE.md (CLAUDE.md wins), or two skills that disagree with each other.
- **Prose → script**: deterministic steps a skill makes the agent do by hand (fixed command sequences, parsing, counting) that a script would make repeatable.
- **Duplication**: the same procedure in several skills (e.g. the close-and-commit steps of `code-fix` and `ux-fix`), or a CLAUDE.md rule repeated in a skill. Propose one owner and a link from the others.
- **Triggers**: skill descriptions whose "Use when" overlaps another skill's, built-in ones included (`/code-review`, `/simplify`, `/security-review`), or misses how the user actually asks.
- **Scripts**: ones with no caller, overlapping jobs, missing usage messages on bad arguments.
- **Hooks**: "always do X after Y" rules in CLAUDE.md or a skill that only a hook can guarantee.
- **Permissions**: allows that pre-approve CLAUDE.md's ask-first actions, and dead one-off entries, in both settings files. For missing allows, propose running the built-in `fewer-permission-prompts` skill (it writes settings) rather than reviewing transcripts by hand.
- **Staleness**: rules about code, files or procedures that no longer exist; rules nothing has needed lately (prefer deleting them).

## 3. Transcripts (only with `transcripts`)

One `Agent` subagent reads the session logs under `~/.claude/projects/<this repo's slug>/*.jsonl`, newest first, and returns patterns seen in at least two sessions:

- the user correcting the agent the same way (a rule missing, unclear or ignored);
- the same command sequence run by hand (a script or skill candidate);
- the same command failing the same way (a pitfalls.md entry or a fix);
- permission prompts for the same read-only command.

Each pattern comes with the sessions and a short quote. It quotes no secrets, and nothing from the transcripts leaves the report.

## 4. The finding bar

A finding names a `file:line` (or the sessions), the friction it causes, the change, its target (CLAUDE.md, a skill, a script, a hook, settings) and an effort (S/M/L). Verify each one adversarially (re-read the files involved, trying to prove it wrong) and drop what doesn't survive. Prefer tightening or deleting a rule over adding one.

Not findings: wording taste, Prettier's output, deliberate exceptions recorded with a reason (`HISTORY` in `scripts/doc-refs.js`).

## Report

One table, ranked by how often the friction bites, then effort:

| #   | Target | Where | Friction | Proposed change | Effort | Recommend |
| --- | ------ | ----- | -------- | --------------- | ------ | --------- |

Then one `AskUserQuestion`: apply the recommended set, plus any real choice among the rest. Adding a skill, hook or agent still needs that explicit approval (CLAUDE.md, Ask first).
