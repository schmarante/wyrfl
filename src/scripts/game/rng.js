// Deterministic randomness – the Daily Wyrfl must be identical for everyone, so game code never uses Math.random().

/** Hashes a string to a 32-bit seed (FNV-1a). */
export function hashSeed(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 – small, fast, good enough for puzzles. Returns a function yielding floats in [0, 1). */
export function createRng(seed) {
  let a = (typeof seed === 'string' ? hashSeed(seed) : seed) >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Object.assign(next, {
    /** integer in [min, max] (both inclusive) */
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: list => list[Math.floor(next() * list.length)],
  });
}

// The day changes at midnight in this timezone – for everyone, wherever they play.
export const DAILY_TIMEZONE = 'Europe/Berlin';
// Day of Wyrfl #1 (adjust before the public launch).
export const LAUNCH_DATE = '2026-11-18';

/** Calendar date (YYYY-MM-DD) of `now` in the daily timezone. */
export function dailyDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: DAILY_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Wyrfl number of a date: LAUNCH_DATE is #1. */
export function puzzleNumber(date = dailyDate()) {
  const day = d => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86400000;
  return day(date) - day(LAUNCH_DATE) + 1;
}
