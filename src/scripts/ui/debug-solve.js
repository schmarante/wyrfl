// Test aids, switched on by the build variable PUBLIC_DEBUG=true (.env locally, a repository variable in GitHub
// Actions) – off when it is unset:
// - key "L" solves the current puzzle (next puzzle, unlocking, duel results …)
// - key "P" unlocks everything (all levels in both modes, a duel win, every cube style) and reloads the page

export const debugEnabled = () => import.meta.env.PUBLIC_DEBUG === 'true';

function onKey(letter, action) {
  if (!debugEnabled()) return;
  window.addEventListener('keydown', e => {
    if (e.key.toLowerCase() !== letter) return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input, textarea, [contenteditable]')) return;
    e.preventDefault();
    action();
  });
}

/** Calls solve() on "L". */
export const onSolveShortcut = solve => onKey('l', solve);

/** "P": unlock everything (every page – registered in the layout). */
export function registerUnlockAllShortcut() {
  onKey('p', async () => {
    const [{ unlockEverything }, { SKINS }] = await Promise.all([import('../game/progress.js'), import('../game/skin-pref.js')]);
    unlockEverything(SKINS);
    location.reload();
  });
}
