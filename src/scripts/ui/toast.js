// Small notifications bottom left: slide in, stay a few seconds, slide out (tap to close early). Several stack.
// For short infos ("the connection to 🦄 is gone") – errors that need reading stay in the page's banner.
// Screen readers get them through a polite live region.

const DURATION = 4000;
let region = null;

function container() {
  if (region?.isConnected) return region;
  region = document.createElement('div');
  region.setAttribute('role', 'status');
  region.setAttribute('aria-live', 'polite');
  region.className = 'pointer-events-none fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-4 z-[60] flex max-w-[calc(100vw-2rem)] flex-col items-start gap-2';
  document.body.append(region);
  return region;
}

/** @param {string} html  trusted markup (our own texts + avatar images) */
export function showToast(html) {
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const el = document.createElement('div');
  el.className = 'pointer-events-auto flex max-w-xs cursor-pointer items-center gap-2 rounded-2xl border-2 border-line bg-surface px-3 py-2 text-sm font-semibold text-text shadow-lg'
    + (reduced ? '' : ' -translate-x-6 opacity-0 transition duration-300 ease-out');
  el.innerHTML = html;
  container().append(el);
  if (!reduced) requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('-translate-x-6', 'opacity-0')));

  let gone = false;
  const close = () => {
    if (gone) return;
    gone = true;
    if (reduced) return el.remove();
    el.classList.add('-translate-x-6', 'opacity-0');
    el.addEventListener('transitionend', () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 400);   // in case transitionend never comes
  };
  el.addEventListener('click', close);
  setTimeout(close, DURATION);
}
