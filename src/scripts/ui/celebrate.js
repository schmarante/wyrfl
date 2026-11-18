// Short full-screen celebration: big title with a yellow check drawing itself (level completed) or a cube style
// preview (new style unlocked). Tap to skip. Resolves when it's gone.
import { SKIN_PREVIEWS } from './icons.js';
import { takeNewSkinUnlocks, setSkin } from '../game/skin-pref.js';

const CHECK = `<svg viewBox="0 0 64 64" width="88" height="88" aria-hidden="true" class="celebrate-check shrink-0">
  <circle cx="32" cy="32" r="30" fill="var(--color-front)"/>
  <path d="M18 33.5 27.5 43 46 23" fill="none" stroke="#12151c" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" pathLength="1"/>
</svg>`;

/**
 * @param {{ title: string, subtitle?: string, visual?: 'check' | string, duration?: number }} options
 */
export function celebrate({ title, subtitle = '', visual = 'check', duration = 1800 }) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'celebrate fixed inset-0 z-50 grid cursor-pointer place-items-center bg-bg/75 p-6 backdrop-blur-sm';
    overlay.setAttribute('role', 'status');
    overlay.setAttribute('aria-live', 'assertive');
    const art = visual === 'check' ? CHECK : `<span class="celebrate-check grid h-[88px] w-[88px] shrink-0 place-items-center [&>svg]:h-full [&>svg]:w-full">${visual}</span>`;
    overlay.innerHTML = `<div class="flex flex-col items-center gap-3 text-center">
        <div class="flex items-center gap-4">
          <span class="celebrate-title text-5xl font-extrabold tracking-tight sm:text-6xl"></span>${art}
        </div>
        <p class="celebrate-sub text-lg font-semibold text-muted"></p>
      </div>`;
    overlay.querySelector('.celebrate-title').textContent = title;
    overlay.querySelector('.celebrate-sub').textContent = subtitle;
    document.body.append(overlay);

    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      overlay.classList.add('celebrate-out');
      setTimeout(() => {
        overlay.remove();
        resolve();
      }, 250);
    };
    overlay.addEventListener('click', close);
    setTimeout(close, duration);
  });
}

/** Celebrates (and switches to) cube styles that have just been unlocked – one after another. */
export async function celebrateNewSkins(t) {
  for (const name of takeNewSkinUnlocks()) {
    setSkin(name);
    await celebrate({ title: t(`skins.${name}`), subtitle: t('skins.newStyle'), visual: SKIN_PREVIEWS[name], duration: 2200 });
  }
}
