'use strict';

// `npm run dev:mock` in the background: `node scripts/mock-server.js up|down` (background-server.js).
const { portOf } = require('./ports');

require('./background-server').cli({ name: 'mock-server', npmScript: 'dev:mock', port: portOf('mock') });
