'use strict';

// `npm run dev` (the real backend and Vite) in the background: `node scripts/dev-server.js up|down`
// (background-server.js).
require('./background-server').cli({ name: 'dev-server', npmScript: 'dev', port: 58991 });
