'use strict';

// Builds public/'s four HTML entry points into dist/ — a real bundled/hashed production
// build in place of the hand-rolled import-map + /vendor/* static-route resolution this app
// used before the frontend moved to TypeScript/Vite (both retired once nothing resolved
// through them anymore — see server.js's own STATIC_DIR comment). publicDir is
// disabled: public/ has no passthrough static assets left once hls.js moved from a vendored
// public/hls.min.js to a real npm dependency (both dev and this build now resolve it as a
// real ES import) — enabling it would also collide with Vite's own "publicDir" convention,
// since our whole frontend source directory happens to be named public/ too.
const { defineConfig } = require('vite');
const path = require('node:path');

module.exports = defineConfig({
  root: 'public',
  publicDir: false,
  server: {
    // Local dev: `npm run dev:web` serves public/ (now TypeScript, which the plain
    // express.static fallback in server.js can't parse) with HMR on :5173, proxying
    // the API to the backend. Run `npm run dev` in a second terminal for the backend;
    // the old single-`npm start` flow still works against `npm run build`'s dist/.
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
        library: path.resolve(__dirname, 'public/library.html'),
        bundles: path.resolve(__dirname, 'public/bundles.html'),
        about: path.resolve(__dirname, 'public/about.html'),
      },
    },
  },
});
