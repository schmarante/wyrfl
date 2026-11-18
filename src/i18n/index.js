// UI texts: German first, then English and the other languages. Never hard-code UI strings – add them to every file
// (tests/i18n.test.js checks that all languages have the same keys and placeholders).
import de from './de.json';
import en from './en.json';
import fr from './fr.json';
import es from './es.json';
import hr from './hr.json';
import pl from './pl.json';
import cs from './cs.json';

export const LOCALES = { de, en, fr, es, hr, pl, cs };
export const DEFAULT_LOCALE = 'de';
/** language menu: code + name in its own language (order = menu order) */
export const LANGUAGES = [
  { code: 'de', name: 'Deutsch' },
  { code: 'en', name: 'English' },
  { code: 'fr', name: 'Français' },
  { code: 'es', name: 'Español' },
  { code: 'hr', name: 'Hrvatski' },
  { code: 'pl', name: 'Polski' },
  { code: 'cs', name: 'Čeština' },
];
export const OTHER_LOCALES = LANGUAGES.map(l => l.code).filter(c => c !== DEFAULT_LOCALE);

/** t('duel.round', { n: 2, total: 5 }) → text with {placeholders} filled in; falls back to German. */
export function useTranslations(locale = DEFAULT_LOCALE) {
  const lookup = (dict, key) => key.split('.').reduce((node, part) => node?.[part], dict);
  return (key, params = {}) => {
    const text = lookup(LOCALES[locale], key) ?? lookup(LOCALES[DEFAULT_LOCALE], key) ?? key;
    return typeof text === 'string' ? text.replace(/\{(\w+)\}/g, (m, name) => params[name] ?? m) : text;
  };
}

/** Path of a page in a locale, respecting the base path (German has no prefix). */
export function localePath(locale, path = '') {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}${locale === DEFAULT_LOCALE ? '' : `/${locale}`}/${path}`;
}

/** getStaticPaths for the pages under src/pages/[lang]/ (all languages except the default one) */
export const otherLocalePaths = () => OTHER_LOCALES.map(lang => ({ params: { lang } }));
