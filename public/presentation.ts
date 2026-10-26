// The main window's side of the presentation window (PresentationView.tsx): opens it and sends it what to
// show, over a BroadcastChannel tagged with this window's id (docs/dev/frontend.md#the-presentation-window).
import { createSignal } from 'solid-js';
import { buildMediaItems } from './mediaItems.ts';
import type { ReadonlyGame } from './types.ts';
import { PRESENTATION_CHANNEL, HEARTBEAT_MS } from './presentationProtocol.ts';
import type { FromPresentation, OnAir, ToPresentation } from './presentationProtocol.ts';

const MISSED_BEATS = 3;
const ID_KEY = 'playshelf-presentation-main';

// What the presentation window shows; null while not presenting.
const [presented, setPresented] = createSignal<OnAir | null>(null);
export { presented };

let mainId: string | null = null;
let channel: BroadcastChannel | null = null;
let win: Window | null = null;
let lastSeen = 0;
let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
let byeTimer: ReturnType<typeof setTimeout> | undefined;

function storedId(): string | null {
  try {
    return sessionStorage.getItem(ID_KEY);
  } catch {
    return null;
  }
}

function post(msg: ToPresentation) {
  channel?.postMessage(msg);
}

// Starts or keeps the watch on the window's heartbeat; `bye` misses a crash or a discarded tab.
function seen() {
  lastSeen = Date.now();
  heartbeatTimer ??= setInterval(() => {
    // Judged only while this window is visible: a hidden tab's own timers are throttled and would misjudge.
    if (document.visibilityState === 'visible' && Date.now() - lastSeen > HEARTBEAT_MS * MISSED_BEATS) forget();
  }, HEARTBEAT_MS);
}

function forget() {
  clearTimeout(byeTimer);
  setPresented(null);
  clearInterval(heartbeatTimer);
  heartbeatTimer = undefined;
}

function onMessage(e: MessageEvent<FromPresentation>) {
  const msg = e.data;
  if (msg?.main !== mainId) return;
  // A reload also says bye, then hello: only a bye that stays one forgets the window.
  clearTimeout(byeTimer);
  if (msg.type === 'bye') {
    byeTimer = setTimeout(forget, 2000);
    return;
  }
  seen();
  const current = presented();
  // A reloaded window asks again; a reloaded main window learns what's shown from the window's state.
  if (msg.type === 'hello' && current) post({ main: mainId, type: 'onAir', onAir: current });
  if (msg.type === 'state' && !current && msg.onAir) setPresented(msg.onAir);
}

function connect(id: string) {
  mainId = id;
  if (!channel) {
    channel = new BroadcastChannel(PRESENTATION_CHANNEL);
    channel.addEventListener('message', onMessage);
  }
  // Tells a window left from before a reload that this one is back; it answers with its state at once.
  post({ main: id, type: 'main' });
}

// A tab that presented before a reload keeps driving the same window.
const resumedId = storedId();
if (resumedId) connect(resumedId);

// Shows one media of `game` in the presentation window, opening it first if needed (it then asks for
// the media on hello). A plain object: store rows are proxies, which postMessage can't clone.
export function present(game: ReadonlyGame, shotId: string, handover?: Pick<OnAir, 'startAt' | 'paused'>): void {
  const item = buildMediaItems(game.appid, game.details?.meta).find((s) => s.shotId === shotId);
  if (!item) return;
  const wasPresenting = presented() != null;
  const onAir = { appid: game.appid, name: game.name || `App ${game.appid}`, item, ...handover };
  setPresented(onAir);
  seen();
  // An open window main forgot (missed beats) is sent to, not reopened: that would reload it out of fullscreen.
  if (win ? !win.closed : wasPresenting) return post({ main: mainId!, type: 'onAir', onAir });
  const id = storedId() ?? crypto.randomUUID();
  try {
    sessionStorage.setItem(ID_KEY, id);
  } catch {
    // Private mode: presenting still works, it just won't survive a reload of this window.
  }
  connect(id);
  const url = `/present.html?main=${encodeURIComponent(id)}`;
  // Blocked: P or a click is a user gesture, so browsers seldom do.
  win = window.open(url, `playshelf-presentation-${id}`, 'popup,width=960,height=540');
  if (!win) forget();
}

// A new id for the next window: the closing one's last bye and heartbeat then go unheard.
export function stopPresenting(): void {
  if (mainId) post({ main: mainId, type: 'close' });
  // Still loading, it can't hear `close` yet.
  win?.close();
  win = null;
  forget();
  mainId = null;
  try {
    sessionStorage.removeItem(ID_KEY);
  } catch {
    // Private mode: nothing was stored.
  }
}
