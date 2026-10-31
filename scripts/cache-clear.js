'use strict';

require('../lib/config'); // loads .env + default.env as a side effect

const DB_PATH = process.env.DB_FILE;

if (!DB_PATH) {
  console.log('DB_FILE is empty — in-memory database, nothing to clear.');
  process.exit(0);
}

const { db } = require('../lib/db');

const cacheTables = db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'cache\\_%' ESCAPE '\\'")
  .all()
  .map((row) => row.name);

let total = 0;
for (const table of cacheTables) {
  total += db.prepare(`DELETE FROM ${table}`).run().changes;
}

console.log(`Cleared ${total} cache entr${total === 1 ? 'y' : 'ies'} from ${DB_PATH}.`);
