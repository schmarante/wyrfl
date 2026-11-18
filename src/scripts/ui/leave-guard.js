// Leaving the page would drop a running duel (the direct connection lives in this page). While `active()` is true:
// - every link that leaves the page first asks in our own dialog ("Stay" is the default, Escape = stay)
// - closing the tab / the browser's back button get the browser's own "leave page?" prompt (its text can't be set)
// Language links are not affected – they switch in place during a duel (live-locale.js).

/**
 * @param {{ active: () => boolean, texts: () => { title: string, text: string, stay: string, leave: string } }} opts
 */
export function guardLeaving({ active, texts }) {
  let leaving = false;
  let dialog = null;

  function ask(href) {
    const { title, text, stay, leave } = texts();
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.className = 'm-auto w-[min(26rem,calc(100vw-2rem))] rounded-3xl border-2 border-line bg-surface p-5 text-text backdrop:bg-bg/75 backdrop:backdrop-blur-sm';
      dialog.innerHTML = `
        <h2 data-leave-title class="text-xl font-extrabold"></h2>
        <p data-leave-text class="mt-2 text-muted"></p>
        <div class="mt-5 grid grid-cols-2 gap-3">
          <button type="button" data-leave-stay autofocus class="press inline-flex min-h-12 items-center justify-center whitespace-nowrap rounded-full bg-cube px-3 font-bold text-on-cube hover:brightness-110"></button>
          <button type="button" data-leave-go class="press inline-flex min-h-12 items-center justify-center whitespace-nowrap rounded-full bg-line px-3 font-semibold hover:bg-cube/40"></button>
        </div>`;
      dialog.addEventListener('click', e => e.target === dialog && dialog.close());   // tap on the backdrop = stay
      dialog.querySelector('[data-leave-stay]').addEventListener('click', () => dialog.close());
      document.body.append(dialog);
    }
    dialog.querySelector('[data-leave-title]').textContent = title;
    dialog.querySelector('[data-leave-text]').textContent = text;
    dialog.querySelector('[data-leave-stay]').textContent = stay;
    const go = dialog.querySelector('[data-leave-go]');
    go.textContent = leave;
    go.onclick = () => {
      leaving = true;   // no second (browser) prompt
      dialog.close();
      location.href = href;
    };
    dialog.showModal();
    dialog.querySelector('[data-leave-stay]').focus();
  }

  document.addEventListener('click', e => {
    if (!active() || e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest?.('a[href]');
    if (!a || a.dataset.lang || a.target === '_blank' || a.hasAttribute('download')) return;
    const url = new URL(a.href, location.href);
    if (!/^https?:$/.test(url.protocol)) return;   // mailto: etc. don't leave the page
    if (url.origin === location.origin && url.pathname === location.pathname && url.search === location.search) return;   // same page
    e.preventDefault();
    a.closest('details')?.removeAttribute('open');
    ask(url.href);
  });

  window.addEventListener('beforeunload', e => {
    if (!active() || leaving) return;
    e.preventDefault();
    e.returnValue = '';   // older browsers
  });
}
