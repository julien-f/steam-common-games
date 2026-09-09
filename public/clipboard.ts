// One "copy this text, then say so" helper, shared by every copy button in the app — the panel's
// 🔗, the tables' "🔗 Share view", and the account-identifier buttons on Home and the nav chip.
// Each of the first two grew its own writeText-then-swap-the-label-for-1.5s pair, and they had
// already drifted: both silently did nothing when the Clipboard API was unavailable (it needs a
// secure context, and can be permission-denied), leaving a button that looks broken, while the
// lightbox's third copy fell back to a `window.prompt` the user could copy out of by hand.
export const COPIED_MS = 1500;

// Resolves true if the text reached the clipboard, false if the user was given the prompt
// fallback instead — callers that show a "Copied!" state should only show it on true.
export function copyText(text: string): Promise<boolean> {
  const clipboard = navigator.clipboard;
  if (!clipboard?.writeText) return Promise.resolve(promptFallback(text));
  return clipboard.writeText(text).then(() => true, () => promptFallback(text));
}

function promptFallback(text: string): boolean {
  try { window.prompt('Copy this:', text); } catch { /* no window (tests) */ }
  return false;
}

export interface CopyFeedback {
  copiedText?: string;  // label shown while confirming (default '✓ Copied!')
  copiedClass?: string; // class added for the same window, for a distinct confirmation color
}

// The imperative half, for the two call sites that already hold a plain DOM button rather than
// rendering one (panel.tsx's header buttons, tableViewPrefs.ts's table actions). JSX call sites
// use CopyButton.tsx instead, which drives the same state through a signal rather than by
// writing to the DOM behind Solid's back.
export function copyWithFeedback(btn: HTMLElement, text: string, opts: CopyFeedback = {}): void {
  copyText(text).then(ok => { if (ok) flash(btn, opts); });
}

function flash(btn: HTMLElement, { copiedText = '✓ Copied!', copiedClass }: CopyFeedback): void {
  const prevText = btn.textContent;
  const prevTitle = btn.title;
  btn.textContent = copiedText;
  btn.title = 'Copied!';
  if (copiedClass) btn.classList.add(copiedClass);
  setTimeout(() => {
    btn.textContent = prevText;
    btn.title = prevTitle;
    if (copiedClass) btn.classList.remove(copiedClass);
  }, COPIED_MS);
}
