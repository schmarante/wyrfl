// Switching the language without reloading the page – used while a duel is paired or running (a reload would drop the
// direct connection). Every server-rendered text carries its key: data-i18n (text), data-i18n-aria (aria-label),
// data-i18n-title (title). Dynamic texts are re-rendered by the page itself on the window event 'wyrfl-locale'.
import { useTranslations, localePath } from '../../i18n/index.js';
import { FLAGS } from './icons.js';

/** While on, the language menu switches in place instead of loading the other language's page. */
export function setLiveLocale(on) {
  if (on) document.documentElement.dataset.liveLocale = 'on';
  else delete document.documentElement.dataset.liveLocale;
}
export const liveLocaleActive = () => document.documentElement.dataset.liveLocale === 'on';

export function switchLocaleInPlace(lang) {
  const t = useTranslations(lang);
  const page = document.body.dataset.page ?? '';
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
  for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  for (const el of document.querySelectorAll('[data-locale-href]')) el.setAttribute('href', localePath(lang, el.dataset.localeHref));

  // language menu: current flag, marker of the current language
  const menu = document.querySelector('[data-lang-menu]');
  if (menu) {
    menu.querySelector('[data-lang-current]').innerHTML = FLAGS[lang];
    for (const link of menu.querySelectorAll('[data-lang]')) {
      const current = link.dataset.lang === lang;
      if (current) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
      link.classList.toggle('font-bold', current);
      link.querySelector('[data-lang-check]').hidden = !current;
    }
  }
  history.replaceState(history.state, '', localePath(lang, page) + location.search);
  window.dispatchEvent(new CustomEvent('wyrfl-locale', { detail: lang }));
}
