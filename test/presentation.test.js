'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

// presentation.ts is loaded once (an ES module: `require.cache` can't reset it), so the globals it
// reads are set up once and each test stops the presentation it started.
const bus = [];
class FakeChannel {
  constructor(name) {
    this.name = name;
    this.listeners = [];
    bus.push(this);
  }
  addEventListener(_type, fn) {
    this.listeners.push(fn);
  }
  // Asynchronous and cloned, like the real BroadcastChannel.
  postMessage(data) {
    const copy = structuredClone(data);
    for (const ch of bus)
      if (ch !== this && ch.name === this.name) queueMicrotask(() => ch.listeners.forEach((fn) => fn({ data: copy })));
  }
}

let opened;
let openResult;
let closed;
const tick = () => new Promise((r) => setTimeout(r, 0));
const session = new Map();
global.BroadcastChannel = FakeChannel;
global.sessionStorage = {
  getItem: (k) => session.get(k) ?? null,
  setItem: (k, v) => session.set(k, v),
  removeItem: (k) => session.delete(k),
};
global.addEventListener = () => {};
const announced = [];
global.document = {
  visibilityState: 'visible',
  // announce.ts's status line, enough to read what it says.
  createElement: () => ({
    setAttribute() {},
    style: {},
    set textContent(text) {
      if (text) announced.push(text);
    },
  }),
  body: { append() {} },
};
global.window = {
  open: (url) => {
    opened.push(url);
    return openResult;
  },
};
// The presentation window's end: records what it receives and answers as PresentationView does.
function fakeWindow(main) {
  const ch = new FakeChannel('playshelf-presentation');
  const got = [];
  ch.addEventListener('message', (e) => e.data.main === main && got.push(e.data));
  return { got, say: (msg) => ch.postMessage({ main, ...msg }) };
}

// A main window reloaded while presenting: its id is in sessionStorage, and its window is open.
session.set('playshelf-presentation-main', 'resumed');
const resumed = fakeWindow('resumed');
const p = require('../public/presentation.ts');
const flush = () => new Promise((r) => queueMicrotask(r)); // the fake channel delivers in a microtask; `tick` hangs under mocked timers

beforeEach(() => {
  opened = [];
  closed = 0;
  openResult = { close: () => closed++, closed: false };
});

afterEach(() => p.stopPresenting());

const game = (appid, name = `Game ${appid}`) => ({
  appid,
  name,
  details: {
    meta: { movies: [], screenshots: [{ id: 1, full: 'f1', thumbnail: 't1' }] },
  },
});

const mainIdOf = (url) => new URL(url, 'http://x').searchParams.get('main');

// Opens the window and waits for its hello.
async function started() {
  p.present(game(10), 'banner');
  const remote = fakeWindow(mainIdOf(opened.at(-1)));
  remote.say({ type: 'hello' });
  await tick();
  return remote;
}

// First: it observes the import-time reconnect, and its Stop presenting clears the seeded id for the rest.
test('a reloaded main window takes its window back from its state, without opening another', async () => {
  await tick();
  assert.deepEqual(resumed.got, [{ main: 'resumed', type: 'main' }]);
  resumed.say({
    type: 'state',
    onAir: {
      appid: 30,
      name: 'Hades',
      item: { type: 'image', main: 'm', thumb: 't', shotId: 's1' },
    },
  });
  await tick();
  assert.equal(p.presented().name, 'Hades');
  p.present(game(20), 's1');
  await tick();
  assert.equal(opened.length, 0);
  assert.equal(resumed.got.at(-1).onAir.appid, 20);
});

test('present: opens the window, then sends the media once it says hello', async () => {
  const remote = await started();
  assert.equal(opened.length, 1);
  const onAir = remote.got.find((m) => m.type === 'onAir').onAir;
  assert.deepEqual([onAir.appid, onAir.name, onAir.item.shotId], [10, 'Game 10', 'banner']);
  assert.equal(p.presented().appid, 10);
});

test('present: a second one before the window says hello opens no other window', () => {
  p.present(game(10), 'banner');
  p.present(game(20), 's1');
  assert.equal(opened.length, 1);
  assert.equal(p.presented().appid, 20);
});

test('present: with the window open, sends a plain media object without opening another', async () => {
  const remote = await started();
  p.present(game(20), 's1');
  await tick();
  assert.equal(opened.length, 1);
  assert.deepEqual(remote.got.at(-1).onAir.item, {
    type: 'image',
    main: 'f1',
    thumb: 't1',
    shotId: 's1',
  });
});

test('present: a media the game does not have sends nothing', async () => {
  const remote = await started();
  p.present(game(20), 'v9');
  await tick();
  assert.equal(remote.got.filter((m) => m.type === 'onAir').length, 1);
  assert.equal(p.presented().appid, 10);
});

test('Stop presenting before the window says hello closes it, after the fade a ready one does itself', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  p.present(game(1), 'banner');
  p.stopPresenting();
  assert.equal(closed, 0);
  t.mock.timers.tick(600);
  assert.equal(closed, 1);
});

test('a blocked pop-up leaves nothing presented, and says so', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  openResult = null;
  p.present(game(1), 'banner');
  assert.equal(p.presented(), null);
  t.mock.timers.tick(100);
  assert.equal(announced.at(-1), 'Allow pop-ups for this site to present.');
});

test("another tab's presentation window is ignored", async () => {
  p.present(game(1), 'banner');
  fakeWindow('someone-else').say({ type: 'bye' });
  await tick();
  assert.equal(p.presented().appid, 1);
});

test('a reloaded window, whose bye comes before its hello, gets the media back', async () => {
  const remote = await started();
  remote.say({ type: 'bye' });
  remote.say({ type: 'hello' });
  await tick();
  assert.equal(p.presented().appid, 10);
  assert.equal(remote.got.filter((m) => m.type === 'onAir').length, 2);
});

test("the window's bye forgets it when no hello follows; its state tells a main window that lost track what it shows", async (t) => {
  const remote = await started();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  remote.say({ type: 'bye' });
  await flush();
  t.mock.timers.tick(2000);
  t.mock.timers.reset();
  assert.equal(p.presented(), null);
  remote.say({
    type: 'state',
    onAir: {
      appid: 30,
      name: 'Hades',
      item: { type: 'image', main: 'm', thumb: 't', shotId: 's1' },
    },
  });
  await tick();
  assert.equal(p.presented().name, 'Hades');
});

test('Stop presenting closes the window', async () => {
  const remote = await started();
  p.stopPresenting();
  await tick();
  assert.equal(remote.got.at(-1).type, 'close');
  assert.equal(p.presented(), null);
});

test("a closing window's bye after Stop presenting doesn't forget the next presentation", async (t) => {
  const old = await started();
  p.stopPresenting();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  old.say({ type: 'bye' });
  await flush();
  p.present(game(20), 's1');
  t.mock.timers.tick(2000);
  t.mock.timers.reset();
  assert.equal(p.presented()?.appid, 20);
  const remote = fakeWindow(mainIdOf(opened.at(-1)));
  remote.say({ type: 'hello' });
  await tick();
  assert.equal(remote.got.find((m) => m.type === 'onAir')?.onAir.appid, 20);
});

test("a closing window's last heartbeat after Stop presenting isn't adopted", async () => {
  const old = await started();
  p.stopPresenting();
  old.say({
    type: 'state',
    onAir: {
      appid: 10,
      name: 'Game 10',
      item: { type: 'image', main: 'm', thumb: 't', shotId: 's1' },
    },
  });
  await tick();
  assert.equal(p.presented(), null);
});

test('P after the main window forgot a still-open window sends to it instead of reopening it', async (t) => {
  const remote = await started();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  remote.say({ type: 'bye' });
  await flush();
  t.mock.timers.tick(2000);
  t.mock.timers.reset();
  assert.equal(p.presented(), null);
  p.present(game(20), 's1');
  await tick();
  assert.equal(opened.length, 1);
  assert.equal(remote.got.at(-1).onAir.appid, 20);
  assert.equal(p.presented().appid, 20);
});

async function presentWithMockedClock(t) {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] });
  p.present(game(10), 'banner');
  fakeWindow(mainIdOf(opened.at(-1))).say({ type: 'hello' });
  await flush();
}

test("with the window's handle, its closing forgets it at once", async (t) => {
  await presentWithMockedClock(t);
  openResult.closed = true;
  t.mock.timers.tick(5000);
  assert.equal(p.presented(), null);
});

test('with the handle too, a window gone silent (a crashed TV stays open) is forgotten after three beats', async (t) => {
  await presentWithMockedClock(t);
  t.mock.timers.tick(15000);
  assert.equal(p.presented().appid, 10);
  t.mock.timers.tick(5000);
  assert.equal(p.presented(), null);
});

// A main window reloaded while presenting: a fresh instance of the module, without the window's handle.
let reloads = 0;
async function reloadedMain(t, id) {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] });
  session.set('playshelf-presentation-main', id);
  const main = await import(`${require.resolve('../public/presentation.ts')}?reload=${++reloads}`);
  const remote = fakeWindow(id);
  remote.say({
    type: 'state',
    onAir: { appid: 10, name: 'Game 10', item: { type: 'image', thumb: 't', shotId: 's1' } },
  });
  await flush();
  t.after(() => main.stopPresenting());
  return { main, remote };
}

test('without its handle, three missed heartbeats forget the window', async (t) => {
  const { main } = await reloadedMain(t, 'beats');
  t.mock.timers.tick(15000);
  assert.equal(main.presented().appid, 10);
  t.mock.timers.tick(5000);
  assert.equal(main.presented(), null);
});

test('a window that said it was hidden (throttled to a beat a minute) is given 2.5 min', async (t) => {
  const { main, remote } = await reloadedMain(t, 'hidden');
  remote.say({ type: 'state', onAir: main.presented(), hidden: true });
  await flush();
  t.mock.timers.tick(120000);
  assert.equal(main.presented().appid, 10);
  t.mock.timers.tick(35000);
  assert.equal(main.presented(), null);
});

test('missed heartbeats are not judged while this window is hidden', async (t) => {
  const { main } = await reloadedMain(t, 'self-hidden');
  document.visibilityState = 'hidden';
  try {
    t.mock.timers.tick(20000);
    assert.equal(main.presented().appid, 10);
  } finally {
    document.visibilityState = 'visible';
  }
});

test('P after the user closed the window opens a new one, even before its bye is judged', async () => {
  await started();
  openResult.closed = true;
  p.present(game(20), 's1');
  assert.equal(opened.length, 2);
});

test("the window's relayed keys reach the one subscriber, down and up", async () => {
  const remote = await started();
  const keys = [];
  const off = p.onRelayedKey((key, up) => keys.push([key, up]));
  remote.say({ type: 'key', key: 'ArrowRight', up: false });
  remote.say({ type: 'key', key: 'ArrowRight', up: true });
  await tick();
  off();
  remote.say({ type: 'key', key: 'ArrowLeft', up: false });
  await tick();
  assert.deepEqual(keys, [
    ['ArrowRight', false],
    ['ArrowRight', true],
  ]);
});
