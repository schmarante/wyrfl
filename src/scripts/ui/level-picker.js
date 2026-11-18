// Difficulty as stars (★ easy … ★★★★ hardcore), shown top left in the 3D view.
// Tap a star to pick that level; locked levels are dimmed. Small label: level name + progress to the next unlock.
import { LEVELS, UNLOCK_AFTER, isUnlocked, solvedCount, lastLevel, setLastLevel } from '../game/progress.js';
import { ICONS } from './icons.js';

const CHIP = 'pointer-events-auto inline-flex items-center gap-0 rounded-full bg-surface/85 py-1 pl-2 pr-2.5 text-star shadow-sm backdrop-blur';

function label(t, level, extra = '') {
  return `<span class="ml-1 text-xs font-semibold text-text">${t(`levels.${level}`)}</span>${extra}`;
}

/**
 * @param {HTMLElement} root  element with [data-level-picker]
 * @param {string} mode       'guess' | 'build'
 * @param {(key: string, params?: object) => string} t
 * @param {(level: string) => void} onChange
 */
export function createLevelPicker(root, mode, t, onChange) {
  let current = lastLevel(mode);

  function render() {
    const index = LEVELS.indexOf(current);
    const chip = document.createElement('div');
    chip.className = CHIP;
    chip.setAttribute('role', 'group');
    chip.setAttribute('aria-label', t('level.label'));
    LEVELS.forEach((level, i) => {
      const unlocked = isUnlocked(mode, level);
      const b = document.createElement('button');
      b.type = 'button';
      b.disabled = !unlocked;
      b.setAttribute('aria-pressed', String(level === current));
      b.setAttribute('aria-label', t(`levels.${level}`));
      b.title = unlocked ? t(`levels.${level}`) : t('level.locked', { count: UNLOCK_AFTER, level: t(`levels.${LEVELS[i - 1]}`) });
      b.className = `press grid h-8 w-5 place-items-center ${unlocked ? '' : 'cursor-not-allowed opacity-35'}`;
      b.innerHTML = i <= index ? ICONS.star : ICONS.starEmpty;
      b.addEventListener('click', () => {
        if (level === current) return;
        current = level;
        setLastLevel(mode, level);
        render();
        onChange(level);
      });
      chip.append(b);
    });
    const next = LEVELS[index + 1];
    const progress = next && !isUnlocked(mode, next)
      ? `<span class="ml-1.5 inline-flex items-center gap-0.5 text-xs text-muted" title="${t('level.toUnlock', { count: UNLOCK_AFTER - solvedCount(mode, current), level: t(`levels.${next}`) })}">${ICONS.lock}${solvedCount(mode, current)}/${UNLOCK_AFTER}</span>`
      : '';
    chip.insertAdjacentHTML('beforeend', label(t, current, progress));
    root.replaceChildren(chip);
  }

  render();
  return {
    get level() {
      return current;
    },
    refresh: render,
    /** switch to a level from code (level completed → next one); starts a new puzzle via onChange */
    select(level) {
      if (!LEVELS.includes(level)) return;
      current = level;
      setLastLevel(mode, level);
      render();
      onChange(level);
    },
  };
}

/** Read-only stars (duel: the host picked the level). */
export function renderLevelBadge(root, level, t) {
  const index = LEVELS.indexOf(level);
  root.innerHTML = `<div class="${CHIP}" role="img" aria-label="${t(`levels.${level}`)}">${LEVELS.map((_, i) => `<span class="grid h-8 w-5 place-items-center">${i <= index ? ICONS.star : ICONS.starEmpty}</span>`).join('')}${label(t, level)}</div>`;
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
