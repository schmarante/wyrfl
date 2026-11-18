// Cube styles ("skins") – the chosen one is stored on this device only. No three.js here (used by the header menu).
// Textures are drawn in code (src/scripts/game/skins.js) – no external images, no licensing questions, no
// look-alikes of existing games.

export const SKINS = ['classic', 'colors', 'pixel', 'gifts'];
const KEY = 'wyrfl:skin';

export function currentSkin() {
  try {
    const value = localStorage.getItem(KEY);
    return SKINS.includes(value) ? value : 'classic';
  } catch {
    return 'classic';
  }
}

/** Stores the skin and tells every 3D scene on the page (window event 'wyrfl-skin'). */
export function setSkin(name) {
  if (!SKINS.includes(name)) return;
  try {
    localStorage.setItem(KEY, name);
  } catch {
    /* not stored – still applied on this page */
  }
  window.dispatchEvent(new CustomEvent('wyrfl-skin', { detail: name }));
}
