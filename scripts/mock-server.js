'use strict';

// `npm run dev:mock` in the background: `node scripts/mock-server.js up|down` (background-server.js).
require('./background-server').cli({ name: 'mock-server', npmScript: 'dev:mock', port: 58993 });
