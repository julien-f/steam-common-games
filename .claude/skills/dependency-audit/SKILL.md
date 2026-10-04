---
name: dependency-audit
description: Audit npm dependencies for unused, missing, outdated, duplicated or vulnerable packages, and refresh package-lock.json. Use when asked to check, review or update dependencies, or before a release.
---

# Dependency audit

Read-only by default. Nothing below writes until the "Applying" section, which needs an explicit go-ahead.

## 1. Unused and missing

`node scripts/deps-audit.js` — declared packages nothing references (source, configs, npm scripts, `docs/`) and bare imports nothing declares; exits 1 on any finding. `@babel/core` is exempt: it's `@babel/eslint-parser`'s required peer, never imported (`docs/dev/architecture.md`'s `eslint.config.mjs` bullet).

## 2. Outdated

`npm outdated` — read both columns, they're different findings:

- **Wanted ≠ Current** — the lockfile is behind its own declared range. Fixed by `npm update`, no `package.json` edit.
- **Latest ≠ Wanted** — needs a range bump: `npm install <pkg>@latest`.

## 3. Lockfile health

- `npm ci --dry-run` — read-only; errors (`EUSAGE`) if the lock is out of sync with `package.json`.
- `npm audit` — expected: 0 vulnerabilities.
- `npm dedupe --dry-run` — any change it lists is a collapsible duplicate. Major splits it can't collapse (e.g. `vite-plugin-solid`'s Babel 7 tree beside the linter's Babel 8) are upstream, dev-only and not findings.

## Stale `typescript` peer ranges

An `ERESOLVE` warning, or `npm ls --all` exiting non-zero on an `invalid` `typescript`, means a new package has a stale `typescript` peer range: add it to `package.json`'s `overrides` like the existing `@typescript-eslint/*` entries (safe — nothing there loads TypeScript), rather than bumping `eslint-plugin-solid` or declaring the noise benign.

## Applying

Confirm the changes first, then:

1. `npm update` for in-range drift, `npm install <pkg>@latest` for a range bump.
2. `npm run check` and `npm run build` — the one step neither it nor the hook covers — then `npm run test:e2e` (the hook runs it too, but find breakage before committing). A 0.x minor bump can break like a major one even when its README and types show only additions. Report real output.
3. A lockfile-only change is still a code change: `CHANGELOG.md` entry in the same commit, per `CLAUDE.md`.
4. Surface new lint violations from a plugin bump rather than silencing them with `eslint-disable`.

## Automation

Dependabot or Renovate can be proposed now that CI (`.github/workflows/ci.yml`) runs `check` and the e2e suite on PRs, but their PRs lack the `CHANGELOG.md` entry the pre-commit hook requires (CI doesn't check for it) and skip `npm run build`, so each still needs a local pass through Applying before merging.
