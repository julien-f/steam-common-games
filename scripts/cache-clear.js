'use strict';

const { DatabaseSync } = require('node:sqlite');

require('../lib/config'); // loads .env + default.env as a side effect

const DB_PATH = process.env.DB_FILE;

if (!DB_PATH) {
  console.log('DB_FILE is empty — in-memory database, nothing to clear.');
  process.exit(0);
}

const db = new DatabaseSync(DB_PATH);

const CACHE_TABLES = ['cache_library', 'cache_resolve', 'cache_rating', 'cache_meta'];

let total = 0;
for (const table of CACHE_TABLES) {
  try {
    const result = db.prepare(`DELETE FROM ${table}`).run();
    total += result.changes;
  } catch {
    // Table doesn't exist yet — nothing to clear.
  }
}

console.log(`Cleared ${total} cache entr${total === 1 ? 'y' : 'ies'} from ${DB_PATH}.`);
