// TEMPORARY test aid (remove before launch): key "L" solves the current puzzle, so what happens afterwards can be
// tested quickly (next puzzle, unlocking, duel results …). Only on development hosts – never on the published site.

const DEV_HOST = /(^localhost$|^127\.0\.0\.1$|\.local$)/;

export const debugEnabled = () => import.meta.env.DEV || DEV_HOST.test(location.hostname);

/** Calls solve() on "L" (not while typing in a field). */
export function onSolveShortcut(solve) {
  if (!debugEnabled()) return;
  window.addEventListener('keydown', e => {
    if (e.key !== 'l' && e.key !== 'L') return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input, textarea, [contenteditable]')) return;
    e.preventDefault();
    solve();
  });
}
