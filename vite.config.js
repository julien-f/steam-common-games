'use strict';

// Builds public/'s four HTML entry points into dist/ — a real bundled/hashed production
// build in place of the hand-rolled import-map + /vendor/* static-route resolution server.js
// still falls back to for local dev (see server.js's own STATIC_DIR comment). publicDir is
// disabled: public/ has no passthrough static assets left once hls.js moved from a vendored
// public/hls.min.js to a real npm dependency (both dev and this build now resolve it as a
// real ES import) — enabling it would also collide with Vite's own "publicDir" convention,
// since our whole frontend source directory happens to be named public/ too.
const { defineConfig } = require('vite');
const path = require('node:path');

module.exports = defineConfig({
  root: 'public',
  publicDir: false,
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
