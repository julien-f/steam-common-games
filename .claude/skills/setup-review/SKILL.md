---
name: setup-review
description: Review the Claude Code setup — skills, scripts, hooks, settings, CLAUDE.md and Claude memory — for drift, contradictions, duplication, prose steps better scripted, wasted time or tokens and skills better merged, split or renamed, optionally mining past session transcripts for repeated friction, and report ranked proposals. Use when asked to review, audit or improve the skills, scripts, hooks or agent setup.
---

# Setup review

Judges the setup against CLAUDE.md's Where things belong and Working style rules. No edits until the user picks from the report. App code goes to [code-audit](../code-audit/SKILL.md), dependencies to [dependency-audit](../dependency-audit/SKILL.md).

## Scope

- **Files**: `.claude/skills/*/SKILL.md`, `scripts/`, `.githooks/`, `.github/workflows/`, `.claude/settings.json` and `settings.local.json`, `package.json`'s `scripts`, `CLAUDE.md`, and this repo's Claude memory (`~/.claude/projects/<this repo's slug>/memory/`).
- **Argument `transcripts`** adds step 3. Without it, skip step 3 and say so.

## 1. Facts first

- `npm run check:doc-refs`: stale script names, flags, npm scripts and links in skills and CLAUDE.md. A failure is a finding as-is.
- `node scripts/setup-facts.js`: each script's callers, and which read arguments without a usage line (a script taking only optional flags may not need one).
- `node scripts/setup-facts.js --cost` (~40 s): time and output size of `check`, `test`, `test:e2e` and `build`, and CLAUDE.md's size — the numbers the **Cost** check judges.
- Read every skill, CLAUDE.md, both settings files and the memory files in full.

## 2. Review

- **Contradictions**: a skill that disagrees with CLAUDE.md (CLAUDE.md wins), or two skills that disagree with each other.
- **Prose → script**: deterministic steps a skill makes the agent do by hand (fixed command sequences, parsing, counting) that a script would make repeatable.
- **Duplication**: the same procedure in several skills, or a CLAUDE.md rule repeated in a skill. Propose one owner and a link from the others.
- **Triggers**: skill descriptions whose "Use when" overlaps another skill's, built-in ones included (`/code-review`, `/simplify`, `/security-review`), or misses how the user actually asks.
- **Structure**: skills always run back to back or sharing most steps (merge), a skill with independent modes each loading the other's text (split), a name or description that doesn't match how the user asks (rename), a skill nothing has run lately (delete; `--transcripts` counts runs). Changing them needs the user's approval like adding one.
- **Scripts**: ones with no caller, overlapping jobs, missing usage messages on bad arguments.
- **Memory**: project rules kept in memory (they bind only one machine: move them to CLAUDE.md or a skill), memory repeating CLAUDE.md or a skill, stale entries.
- **Hooks**: "always do X after Y" rules in CLAUDE.md or a skill that only a hook can guarantee.
- **Permissions**: allows that pre-approve CLAUDE.md's ask-first actions, and dead one-off entries, in both settings files. For missing allows, propose running the built-in `fewer-permission-prompts` skill (it writes settings) rather than reviewing transcripts by hand.
- **Cost**: time and tokens every session pays — CLAUDE.md lines that could load on demand (a skill, a linked doc); commands or skill steps whose output floods the context (prefer a quiet mode or a script printing only what matters); slow steps and work run twice or when nothing it covers changed; skill patterns that fan out agents, snapshot click by click or read whole files where an excerpt does.
- **Staleness**: rules about code, files or procedures that no longer exist; rules nothing has needed lately (prefer deleting them).

## 3. Transcripts (only with `transcripts`)

- `node scripts/setup-facts.js --transcripts[=N]` counts what needs no judgment over the last N sessions (default 20): largest outputs and slowest calls by command, command pairs repeated across sessions, calls the permission classifier denied, and each skill's runs and longest run.
- One `Agent` subagent then reads the same sessions under `~/.claude/projects/<this repo's slug>/*.jsonl`, newest first, for what does need judgment, seen in at least two sessions:
  - the user correcting the agent the same way (a rule missing, unclear or ignored);
  - the same command failing the same way (a pitfalls.md entry or a fix);
  - the script's repeated pairs that are a real procedure (a script or skill candidate), not just reading files;
  - per skill run: steps skipped or improvised (the skill is wrong or missing one), the user correcting the agent during or right after it, a question asked every run that a default would settle, a report the user reshapes.

Each pattern comes with the sessions and a short quote. It quotes no secrets, and nothing from the transcripts leaves the report.

## 4. The finding bar

A finding names a `file:line` (or the sessions), the friction it causes, the change, its target (CLAUDE.md, a skill, a script, a hook, settings) and an effort (S/M/L). Verify each one adversarially (re-read the files involved, trying to prove it wrong) and drop what doesn't survive. Prefer tightening or deleting a rule over adding one.

Not findings: wording taste, Prettier's output, deliberate exceptions recorded with a reason (`HISTORY` in `scripts/doc-refs.js`).

## Report

One table, ranked by how often the friction bites, then effort:

| #   | Target | Where | Friction | Proposed change | Effort | Recommend |
| --- | ------ | ----- | -------- | --------------- | ------ | --------- |

Then one `AskUserQuestion`: apply the recommended set, plus any real choice among the rest. Adding a skill, hook or agent still needs that explicit approval (CLAUDE.md, Ask first).

## Applying

- Follow CLAUDE.md's Development workflow; a `scripts/` change gets a Development changelog entry and a test.
- Files in `PROTECTED` (`scripts/guard.js`) need the user's `viewed` while the pilot runs: say which ones the change touched.
- Memory edits are outside the repo: say which entries were moved or deleted.
