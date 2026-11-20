// Player progress – only in this browser (localStorage), never sent anywhere. Stored scrambled + signed (store.js), so
// it can't simply be edited in the dev tools. Every access is wrapped: blocked storage must never break the game.

import { DIFFICULTIES } from './structure.js';
import { secureGet, secureSet } from './store.js';

const STORAGE_KEY = 'wyrfl:v1';
export const LEVELS = Object.keys(DIFFICULTIES);
export const MODES = ['guess', 'build'];
// puzzles to solve on a level to complete it – the next level opens then
export const UNLOCK_AFTER = 5;

function load() {
  try {
    return JSON.parse(secureGet(STORAGE_KEY)) ?? {};
  } catch {
    return {};
  }
}

function save(data) {
  secureSet(STORAGE_KEY, JSON.stringify(data));   // storage unavailable → progress just isn't kept
}

export function solvedCount(mode, level) {
  return load().solved?.[mode]?.[level] ?? 0;
}

/** a level counts as completed once UNLOCK_AFTER puzzles are solved on it */
export function levelDone(mode, level) {
  return solvedCount(mode, level) >= UNLOCK_AFTER;
}

export function isUnlocked(mode, level) {
  const i = LEVELS.indexOf(level);
  return i <= 0 || levelDone(mode, LEVELS[i - 1]);
}

/**
 * Counts a solved puzzle.
 * @returns {{ completed: string | null, unlocked: string | null }}  completed: the level that was just completed by this
 *          puzzle (exactly the UNLOCK_AFTER-th), unlocked: the level that opened because of it (null after the last level)
 */
export function recordSolved(mode, level) {
  const data = load();
  data.solved ??= {};
  data.solved[mode] ??= {};
  const count = (data.solved[mode][level] ?? 0) + 1;
  data.solved[mode][level] = count;
  save(data);
  if (count !== UNLOCK_AFTER) return { completed: null, unlocked: null };
  return { completed: level, unlocked: LEVELS[LEVELS.indexOf(level) + 1] ?? null };
}

export function lastLevel(mode) {
  const level = load().level?.[mode];
  return LEVELS.includes(level) && isUnlocked(mode, level) ? level : LEVELS[0];
}

export function setLastLevel(mode, level) {
  const data = load();
  data.level = { ...data.level, [mode]: level };
  save(data);
}

// ---- duel ------------------------------------------------------------------------------------

export function duelWins() {
  return load().duelWins ?? 0;
}

export function recordDuelWin() {
  const data = load();
  data.duelWins = (data.duelWins ?? 0) + 1;
  save(data);
}

// ---- test aid (debug-solve.js, key "P", only in PUBLIC_DEBUG builds): everything unlocked ------------------------

export const DEBUG_ALL_KEY = 'wyrfl:debug-unlock-all';
/** honored only in debug builds – in the published game this key does nothing, even if someone sets it */
export const debugUnlockAll = () => import.meta.env.PUBLIC_DEBUG === 'true' && secureGet(DEBUG_ALL_KEY) === '1';

export function unlockEverything(skins) {
  const data = load();
  data.solved = Object.fromEntries([...MODES, 'shadow'].map(mode => [mode, Object.fromEntries(LEVELS.map(level => [level, UNLOCK_AFTER]))]));
  data.duelWins = Math.max(1, data.duelWins ?? 0);
  data.skinsSeen = skins;   // no celebration for each of them
  save(data);
  secureSet(DEBUG_ALL_KEY, '1');   // also styles that depend on the date (gifts)
}

// ---- cube styles already celebrated (so an unlock is shown only once) --------------------------------------

export function seenSkins() {
  return load().skinsSeen ?? [];
}

export function markSkinsSeen(names) {
  const data = load();
  data.skinsSeen = [...new Set([...(data.skinsSeen ?? []), ...names])];
  save(data);
}
