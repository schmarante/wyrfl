// After a puzzle that completes a level (the UNLOCK_AFTER-th): let the answer show for a moment, celebrate the level
// (big name + yellow check), celebrate newly unlocked cube styles, then continue on the next level automatically.
import { celebrate, celebrateNewSkins } from './celebrate.js';

const SHOW_ANSWER = 1000;   // ms to look at the solved puzzle first

/**
 * @param {(key: string, params?: object) => string} t
 * @param {{ completed: string, unlocked: string | null }} result  from recordSolved()
 * @param {{ select: (level: string) => void }} picker
 * @returns {Promise<boolean>} true when it moved on to the next level (false after the last one)
 */
export async function levelUp(t, { completed, unlocked }, picker) {
  await new Promise(resolve => setTimeout(resolve, SHOW_ANSWER));
  await celebrate({
    title: t(`levels.${completed}`),
    subtitle: unlocked ? t('level.next', { level: t(`levels.${unlocked}`) }) : t('level.allDone'),
  });
  await celebrateNewSkins(t);
  if (!unlocked) return false;
  picker.select(unlocked);
  return true;
}
