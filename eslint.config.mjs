// Solid-specific linting for the frontend sources in public/ — `npm run lint`.
//
// The rule that earns this config its keep is `solid/reactivity`: it flags a reactive value
// (a signal call, a store/props member read) captured into a plain `const` in a component
// body, where changes to it can never re-render anything. That mistake is invisible to
// `tsc`, compiles fine, and renders correctly *once* — which is exactly how the panel ended
// up rebuilding its whole DOM subtree off a `revision` counter instead of updating the one
// field that changed (see CLAUDE.md's "Frontend reactivity" section). `no-destructure` and
// `components-return-once` cover the two other ways the same mistake is usually spelled.
//
// Parser: @babel/eslint-parser, NOT typescript-eslint, which every other TS project would
// reach for first. This repo's typechecker is TypeScript 7 (the tsgo/Go port, see
// CLAUDE.md's tsconfig.json bullet), whose npm package deliberately ships no JavaScript
// compiler API — `require('typescript').createSourceFile` is `undefined`, so
// @typescript-eslint/parser cannot parse anything here, and its own peer range
// (`typescript >=4.8.4 <6.1.0`) refuses to install against 7.x in the first place. Babel
// parses TS+JSX for the linter's purposes (syntax only — none of these rules are type-aware),
// needs no TypeScript at all, and is already in the tree as vite-plugin-solid's own
// dependency; the three @babel/* entries in package.json are explicit rather than relying on
// that hoisting, same reasoning as the @vates/data-table-core entry.
// `.mjs`, not `.js`: this repo's package.json has no `"type": "module"` (the test suite and
// server.js are CommonJS), so a `.js` config with `import`s makes Node warn about reparsing it.
import solid from 'eslint-plugin-solid';
import babelParser from '@babel/eslint-parser';

export default [
  {
    // Frontend only. The backend (server.js, lib/*) is plain JS with no JSX and no Solid —
    // intentionally out of scope here, same as it is for tsconfig.json's `include`.
    files: ['public/**/*.ts', 'public/**/*.tsx'],
    ...solid.configs['flat/typescript'],
    languageOptions: {
      sourceType: 'module',
      parser: babelParser,
      parserOptions: {
        // No babel.config.js in this repo (Vite owns the real build pipeline) — the parser
        // needs to be told that's deliberate rather than looking one up and failing.
        requireConfigFile: false,
        babelOptions: {
          // preset-typescript strips the types; syntax-jsx is still needed explicitly, since
          // the preset only turns JSX parsing on by itself for a file it can see is .tsx, and
          // ESLint hands it the source as a string.
          plugins: ['@babel/plugin-syntax-jsx'],
          presets: ['@babel/preset-typescript'],
        },
      },
    },
  },
];
