'use strict';

// Builds public/'s single HTML entry (the SPA shell — see public/App.tsx/AppShell.tsx)
// into dist/ — a real bundled/hashed production build in place of the hand-rolled import-map
// + /vendor/* static-route resolution this app used before the frontend moved to
// TypeScript/Vite (both retired once nothing resolved through them anymore — see server.js's
// own STATIC_DIR comment). Used to be four separate HTML entry points (one full page reload
// per page navigation); collapsed to one during the list-centric redesign (see
// docs/list-centric-redesign.md) once client-side routing (@solidjs/router) took over
// navigation between what used to be separate pages. publicDir is disabled: public/ has no
// passthrough static assets left once hls.js moved from a vendored public/hls.min.js to a
// real npm dependency (both dev and this build now resolve it as a real ES import) —
// enabling it would also collide with Vite's own "publicDir" convention, since our whole
// frontend source directory happens to be named public/ too.
const { defineConfig } = require('vite');
const solidPlugin = require('vite-plugin-solid');
const path = require('node:path');

module.exports = defineConfig({
  root: 'public',
  plugins: [solidPlugin()],
  publicDir: false,
  server: {
    // Local dev: `npm run dev:web` serves public/ (now TypeScript, which the plain
    // express.static fallback in server.js can't parse) with HMR on :58991, proxying
    // the API to the backend. Run `npm run dev` in a second terminal for the backend;
    // the old single-`npm start` flow still works against `npm run build`'s dist/.
    // Port is pinned (and strictPort set) rather than left to Vite's default-or-next-free
    // fallback: this machine runs several Vite apps at once, and a plain fallback means the
    // same app can land on a different port between runs — a different origin as far as the
    // browser's concerned, so localStorage/cookies/auth silently reset each time.
    port: 58991,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:3000',
    },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'public/index.html'),
      },
    },
  },
});
