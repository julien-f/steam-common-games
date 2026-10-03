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

// `npm run dev:mock`: answers /api from e2e/mockApi.ts's fixtures — no backend, no upstream traffic.
const mock = process.env.MOCK_API === '1';
const mockApiPlugin = {
  name: 'mock-api',
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (!req.url.startsWith('/api/')) return next();
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const { respond } = await server.ssrLoadModule(path.join(__dirname, 'e2e/mockApi.ts'));
      // `document.cookie = 'mock=no-itad,slow'` in the page picks mockApi.ts's states.
      const cookie = /(?:^|;\s*)mock=([^;]*)/.exec(req.headers.cookie ?? '');
      const states = new Set(cookie ? decodeURIComponent(cookie[1]).split(',') : []);
      const { status, contentType, body } = respond(
        req.method,
        new URL(req.url, 'http://localhost'),
        chunks.length ? Buffer.concat(chunks).toString() : null,
        states,
      );
      res.writeHead(status, { 'Content-Type': contentType });
      if (!states.has('slow') || contentType !== 'text/event-stream') return res.end(body);
      for (const event of body.split(/(?<=\n\n)/)) {
        res.write(event);
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      res.end();
    });
  },
};

module.exports = defineConfig({
  root: 'public',
  plugins: [solidPlugin(), mock && mockApiPlugin],
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
    proxy: mock
      ? undefined
      : {
          '/api': 'http://127.0.0.1:3000',
          // Steam OpenID sign-in (lib/auth.js) — a real page navigation, not an /api fetch, so it
          // needs its own proxy entry. The trailing slash matters: Vite's proxy keys are plain
          // prefix matches, and '/auth' (no slash) also prefixes '/authStore.ts', this app's own
          // frontend module — every request for it was silently proxied to the backend instead of
          // served by Vite, which fell through to server.js's SPA catch-all and served index.html
          // (text/html) in place of the script, breaking the module load entirely.
          '/auth/': 'http://127.0.0.1:3000',
        },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    // Only chunk over the 500 kB default is hls.js, lazy-imported by lightbox.tsx and never
    // in the initial load; 600 keeps the warning guarding the ~310 kB entry chunk.
    chunkSizeWarningLimit: 600,
  },
});
