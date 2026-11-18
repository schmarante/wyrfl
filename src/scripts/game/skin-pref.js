// Cube styles ("skins") – which ones are available and which one is active. No three.js here (header menu, tests).
// Textures are drawn in code (src/scripts/game/skins.js) – no external images, no look-alikes of existing games.
//
// - classic: always
// - colors:  unlocked by completing "easy" in both game modes
// - pixel:   unlocked by winning a duel
// - eyes:    unlocked by completing "medium" in both game modes
// - gifts:   comes by itself on St. Nicholas' Day (Dec 6) and at Christmas (Dec 24–26) – active automatically on those
//            days unless the player picked another style that day
// The choice is stored on this device only.

import { dailyDate } from './rng.js';
import { levelDone, duelWins, MODES, seenSkins, markSkinsSeen } from './progress.js';

export const SKINS = ['classic', 'colors', 'pixel', 'eyes', 'gifts'];
const KEY = 'wyrfl:skin';
const DAY_KEY = 'wyrfl:skin-day';

const GIFT_DAYS = ['12-06', '12-24', '12-25', '12-26'];
export const isGiftDay = (date = dailyDate()) => GIFT_DAYS.includes(date.slice(5));

/** how a style is unlocked (key for the hint text: skins.unlock.<name>) */
export function skinUnlocked(name, date = dailyDate()) {
  switch (name) {
    case 'classic':
      return true;
    case 'colors':
      return MODES.every(mode => levelDone(mode, 'easy'));
    case 'pixel':
      return duelWins() >= 1;
    case 'eyes':
      return MODES.every(mode => levelDone(mode, 'medium'));
    case 'gifts':
      return isGiftDay(date);
    default:
      return false;
  }
}

const read = key => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

export function currentSkin(date = dailyDate()) {
  const chosen = read(KEY);
  if (isGiftDay(date) && read(DAY_KEY) !== date) return 'gifts';   // holiday: presents, unless changed today
  return SKINS.includes(chosen) && skinUnlocked(chosen, date) ? chosen : 'classic';
}

/** Stores the skin and tells every 3D scene on the page (window event 'wyrfl-skin'). */
export function setSkin(name) {
  if (!SKINS.includes(name) || !skinUnlocked(name)) return;
  try {
    localStorage.setItem(KEY, name);
    localStorage.setItem(DAY_KEY, dailyDate());
  } catch {
    /* not stored – still applied on this page */
  }
  window.dispatchEvent(new CustomEvent('wyrfl-skin', { detail: name }));
}

/** Styles that are unlocked now but were never celebrated (gifts come by themselves – no celebration). */
export function takeNewSkinUnlocks() {
  const seen = seenSkins();
  const fresh = SKINS.filter(name => name !== 'classic' && name !== 'gifts' && !seen.includes(name) && skinUnlocked(name));
  if (fresh.length) markSkinsSeen(fresh);
  return fresh;
}
