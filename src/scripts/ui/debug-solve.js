// TEMPORARY test aids (remove before launch), only on development hosts – never on the published site:
// - key "L" solves the current puzzle (next puzzle, unlocking, duel results …)
// - key "P" unlocks everything (all levels in both modes, a duel win, every cube style) and reloads the page

const DEV_HOST = /(^localhost$|^127\.0\.0\.1$|\.local$)/;

export const debugEnabled = () => import.meta.env.DEV || DEV_HOST.test(location.hostname);

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
