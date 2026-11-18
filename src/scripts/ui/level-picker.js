// Difficulty buttons with lock state and a friendly progress line ("2 solved · 1 more to unlock Medium").
import { LEVELS, UNLOCK_AFTER, isUnlocked, solvedCount, lastLevel, setLastLevel } from '../game/progress.js';
import { ICONS } from './icons.js';

/**
 * @param {HTMLElement} root  container with [data-levels] (buttons) and [data-level-status]
 * @param {string} mode       'guess' | 'build'
 * @param {(key: string, params?: object) => string} t
 * @param {(level: string) => void} onChange
 */
export function createLevelPicker(root, mode, t, onChange) {
  const buttons = root.querySelector('[data-levels]');
  const status = root.querySelector('[data-level-status]');
  let current = lastLevel(mode);

  function render() {
    buttons.replaceChildren(
      ...LEVELS.map(level => {
        const unlocked = isUnlocked(mode, level);
        const b = document.createElement('button');
        b.type = 'button';
        b.disabled = !unlocked;
        b.setAttribute('aria-pressed', String(level === current));
        b.className = 'press inline-flex min-h-11 flex-1 items-center justify-center gap-1 rounded-full px-2 text-sm font-semibold transition-colors '
          + (level === current ? 'bg-cube text-white' : unlocked ? 'bg-line text-text hover:bg-cube/40' : 'bg-line/40 text-muted cursor-not-allowed');
        b.innerHTML = unlocked ? '' : ICONS.lock;
        b.append(t(`levels.${level}`));
        if (!unlocked) b.title = t('level.locked', { count: UNLOCK_AFTER, level: t(`levels.${LEVELS[LEVELS.indexOf(level) - 1]}`) });
        b.addEventListener('click', () => {
          if (level === current) return;
          current = level;
          setLastLevel(mode, level);
          render();
          onChange(level);
        });
        return b;
      }),
    );

    const solved = solvedCount(mode, current);
    const next = LEVELS[LEVELS.indexOf(current) + 1];
    let text = t('level.solved', { count: solved });
    if (next && !isUnlocked(mode, next)) {
      text += ' · ' + t('level.toUnlock', { count: UNLOCK_AFTER - solved, level: t(`levels.${next}`) });
    }
    status.textContent = text;
  }

  render();
  return {
    get level() {
      return current;
    },
    refresh: render,
  };
}

let urlSeed = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('seed');

/** Random seed for practice puzzles (the Daily Wyrfl uses the date instead). `?seed=` in the URL is used for the
 *  first puzzle only (testing/sharing a puzzle). */
export function practiceSeed() {
  if (urlSeed) {
    const seed = urlSeed;
    urlSeed = null;
    return seed;
  }
  const bytes = new Uint32Array(2);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, n => n.toString(36)).join('');
}
