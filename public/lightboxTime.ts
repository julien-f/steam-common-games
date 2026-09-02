// `fmtTime` pulled out of lightbox.tsx into its own plain-TS module — Node's test runner
// strips TypeScript syntax natively (see CLAUDE.md) but has no JSX transform at all, so a test
// can no longer `require()` lightbox.tsx directly once it contains real JSX.
// This is the one export test/lightbox.test.js needs; everything else in that file is DOM/Solid-
// dependent and has no test of its own.
export function fmtTime(s: number) {
  if (!isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}
