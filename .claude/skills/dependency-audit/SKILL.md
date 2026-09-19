---
name: dependency-audit
description: Audit npm dependencies for unused, missing, outdated, duplicated or vulnerable packages, and refresh package-lock.json. Use when asked to check, review or update dependencies, or before a release.
---

# Dependency audit

Read-only by default. Nothing below writes until the "Applying" section, which needs an explicit go-ahead.

## 1. Unused and missing

Every `dependencies`/`devDependencies` entry must be reachable from source, a config file, or an npm script — grep for the package name across `server.js lib public scripts test vite.config.js eslint.config.mjs package.json`, including comments and `docs/`.

The reverse direction catches phantom deps — bare specifiers imported but never declared:

```sh
grep -rhoE "(require\(['\"][^'\"]+['\"]\)|from ['\"][^'\"]+['\"]|import\(['\"][^'\"]+['\"]\))" \
  server.js lib public scripts test vite.config.js eslint.config.mjs \
  | grep -oE "['\"][^'\"]+['\"]" | tr -d "'\"" | grep -vE "^[./]" | sort -u
```

Known false positive: **`@babel/core` is never imported directly.** It's the required peer of `@babel/eslint-parser` and is declared explicitly on purpose — see `docs/dev/architecture.md`'s `eslint.config.mjs` bullet. Not unused.

## 2. Outdated

`npm outdated` — read both columns, they're different findings:

- **Wanted ≠ Current** — the lockfile is behind its own declared range. Fixed by `npm update`, no `package.json` edit.
- **Latest ≠ Wanted** — needs a range bump: `npm install <pkg>@latest`.

## 3. Lockfile health

- `npm ci --dry-run` — read-only; errors (`EUSAGE`) if the lock is out of sync with `package.json`.
- `npm audit` — expected: 0 vulnerabilities.
- Duplicate versions, which `npm outdated` never shows:

```sh
node -e '
const lock=require("./package-lock.json"), byName={};
for (const [p,v] of Object.entries(lock.packages)) {
  if (!p.startsWith("node_modules")) continue;
  (byName[p.slice(p.lastIndexOf("node_modules/")+13)] ??= []).push([p, v.version]);
}
for (const [name,list] of Object.entries(byName)) {
  const vers=[...new Set(list.map(x=>x[1]))];
  if (vers.length>1) console.log(name, JSON.stringify(vers));
}'
```

Only report a duplicate that `npm dedupe` can actually collapse. A major-version split can't be, and the big one here is upstream: `vite-plugin-solid` pins `@babel/core@^7`, so a whole second Babel 7 tree (~3.5 MB) sits under it alongside the Babel 8 the linter uses. Dev-only, not in the bundle, nothing to do — don't re-propose it every pass.

## Known-benign, don't re-flag as broken

`npm install` always warns `ERESOLVE`, and `npm ls --all` marks `typescript@7` `invalid`, because `eslint-plugin-solid`'s nested `@typescript-eslint/utils` peer-requires `typescript >=4.8.4 <6.1.0`. Deliberate, and the reason the linter parses with Babel rather than typescript-eslint — `docs/dev/architecture.md` and `CHANGELOG.md` both cover it. Bumping `eslint-plugin-solid` won't silence it: the constraint is on the nested package.

## Applying

Confirm the changes first, then:

1. `npm update` for in-range drift, `npm install <pkg>@latest` for a range bump.
2. Run the full gate — `npm test`, plus `npm run typecheck` and `npm run lint` (0 problems), plus `npm run build` for anything in the Vite/Babel/Solid chain. Report real output.
3. A lockfile-only change is still a code change: `CHANGELOG.md` entry in the same commit, per `CLAUDE.md`.
4. Surface new lint violations from a plugin bump rather than silencing them with `eslint-disable`.

## Automation

Don't propose Dependabot or Renovate as-is: there's no CI (no `.github/`) and `CLAUDE.md`'s workflow is direct-to-`main` with no PR process, so bot PRs would arrive untested into a repo that doesn't use PRs. It's worth revisiting only after a CI workflow exists.
