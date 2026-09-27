'use strict';

// Prints a function for Playwright's browser_evaluate that seeds (or restores) the demo state in
// localStorage — the only state allowed on screen in screenshots and UX reviews.
//   node scripts/demo-prefs.js seed      back up the real prefs, then write the demo ones
//   node scripts/demo-prefs.js restore   put the backup back and remove it
// Reload the page after either: every store reads localStorage once at load.

const PREFS_KEY = 'steam.isonoe.net:prefs'; // public/prefs.ts's PREFS_STORAGE_KEY
const BACKUP_KEY = `${PREFS_KEY}.backup`;
const DEMO_STEAMID = '76561198070571772';

function demoPrefs(now = Date.now()) {
  const account = { id: DEMO_STEAMID, members: [DEMO_STEAMID], rawInputs: [DEMO_STEAMID], lastUsedAt: now };
  const list = (id, parentId, order, fields) => ({ id, parentId, order, createdAt: now, updatedAt: now, ...fields });
  const values = {
    myAccount: account,
    currentAccount: account,
    recentAccounts: [account],
    folders: [{ id: 'demo-folder-weekend', name: 'Weekend', parentId: null, order: 0, createdAt: now }],
    lists: [
      list('demo-list-couch', null, 1, {
        name: 'Couch co-op picks',
        kind: 'manual',
        appids: [620, 1426210, 268910, 413150],
      }),
      list('demo-list-friday', 'demo-folder-weekend', 0, {
        name: 'Friday shortlist',
        kind: 'manual',
        appids: [1145360, 646570, 504230],
      }),
      // Unnamed on purpose: shows the formula-derived label.
      list('demo-list-rest', null, 2, {
        kind: 'dynamic',
        op: 'subtract',
        sources: [
          { kind: 'account-owned', accountId: DEMO_STEAMID },
          { kind: 'user', listId: 'demo-list-couch' },
        ],
      }),
    ],
  };
  const entries = Object.fromEntries(Object.entries(values).map(([k, value]) => [k, { value, updatedAt: now }]));
  return { schemaVersion: 2, ...entries };
}

function seedFn() {
  return `() => {
  if (localStorage.getItem(${JSON.stringify(BACKUP_KEY)}) !== null) throw new Error('A prefs backup already exists — restore it first');
  localStorage.setItem(${JSON.stringify(BACKUP_KEY)}, JSON.stringify({ prefs: localStorage.getItem(${JSON.stringify(PREFS_KEY)}) }));
  localStorage.setItem(${JSON.stringify(PREFS_KEY)}, ${JSON.stringify(JSON.stringify(demoPrefs()))});
  return 'seeded';
}`;
}

function restoreFn() {
  return `() => {
  const raw = localStorage.getItem(${JSON.stringify(BACKUP_KEY)});
  if (raw === null) throw new Error('No prefs backup to restore');
  const { prefs } = JSON.parse(raw);
  if (prefs === null) localStorage.removeItem(${JSON.stringify(PREFS_KEY)});
  else localStorage.setItem(${JSON.stringify(PREFS_KEY)}, prefs);
  localStorage.removeItem(${JSON.stringify(BACKUP_KEY)});
  return 'restored';
}`;
}

module.exports = { PREFS_KEY, BACKUP_KEY, DEMO_STEAMID, demoPrefs, seedFn, restoreFn };

if (require.main === module) {
  const fns = { seed: seedFn, restore: restoreFn };
  const fn = fns[process.argv[2]];
  if (!fn) {
    console.error('Usage: node scripts/demo-prefs.js seed|restore');
    process.exit(1);
  }
  console.log(fn());
}
