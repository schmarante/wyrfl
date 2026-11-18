// UI texts: German first, English second. Never hard-code UI strings – add them to both files.
import de from './de.json';
import en from './en.json';

export const LOCALES = { de, en };
export const DEFAULT_LOCALE = 'de';

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
