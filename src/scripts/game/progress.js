// Player progress – only in this browser (localStorage), never sent anywhere.
// Every access is wrapped: private mode / blocked storage must never break the game.

import { DIFFICULTIES } from './structure.js';

const STORAGE_KEY = 'wyrfl:v1';
export const LEVELS = Object.keys(DIFFICULTIES);
// puzzles to solve on a level before the next one opens
export const UNLOCK_AFTER = 3;

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {};
  } catch {
    return {};
  }
}

function save(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* storage unavailable – progress just isn't kept */
  }
}

export function solvedCount(mode, level) {
  return load().solved?.[mode]?.[level] ?? 0;
}

export function isUnlocked(mode, level) {
  const i = LEVELS.indexOf(level);
  return i <= 0 || solvedCount(mode, LEVELS[i - 1]) >= UNLOCK_AFTER;
}

/** Counts a solved puzzle. Returns the level that just got unlocked by it (or null). */
export function recordSolved(mode, level) {
  const next = LEVELS[LEVELS.indexOf(level) + 1];
  const wasLocked = next && !isUnlocked(mode, next);
  const data = load();
  data.solved ??= {};
  data.solved[mode] ??= {};
  data.solved[mode][level] = (data.solved[mode][level] ?? 0) + 1;
  save(data);
  return wasLocked && isUnlocked(mode, next) ? next : null;
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
