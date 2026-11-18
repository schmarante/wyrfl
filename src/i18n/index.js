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

/** Pages by id ('' = home) and their URL slug per language – ASCII only, so links survive messengers and copy & paste.
 *  The old English slugs (/guess/, /fr/guess/ …) redirect to these (src/pages/guess/…, src/pages/[lang]/[slug]/). */
export const PAGES = ['guess', 'build', 'duel', 'about'];
export const SLUGS = {
  de: { guess: 'raten', build: 'bauen', duel: 'duell', about: 'ueber' },
  en: { guess: 'guess', build: 'build', duel: 'duel', about: 'about' },
  fr: { guess: 'deviner', build: 'construire', duel: 'duel', about: 'a-propos' },
  es: { guess: 'adivinar', build: 'construir', duel: 'duelo', about: 'acerca-de' },
  hr: { guess: 'pogodi', build: 'sagradi', duel: 'dvoboj', about: 'o-igri' },
  pl: { guess: 'zgadnij', build: 'zbuduj', duel: 'pojedynek', about: 'o-grze' },
  cs: { guess: 'uhodni', build: 'postav', duel: 'souboj', about: 'o-hre' },
};

/** t('duel.round', { n: 2, total: 5 }) → text with {placeholders} filled in; falls back to German. */
export function useTranslations(locale = DEFAULT_LOCALE) {
  const lookup = (dict, key) => key.split('.').reduce((node, part) => node?.[part], dict);
  const plural = new Intl.PluralRules(locale);
  return (key, params = {}) => {
    let text = lookup(LOCALES[locale], key) ?? lookup(LOCALES[DEFAULT_LOCALE], key) ?? key;
    // plural forms: { one, few, many, other } picked by params.count (Polish/Czech/Croatian need more than two)
    if (text && typeof text === 'object' && 'other' in text && typeof params.count === 'number') text = text[plural.select(params.count)] ?? text.other;
    return typeof text === 'string' ? text.replace(/\{(\w+)\}/g, (m, name) => params[name] ?? m) : text;
  };
}

/** Path of a page (id: '' | 'guess' | 'build' | 'duel' | 'about') in a locale, with the translated slug and the base
 *  path; German has no language prefix. */
export function localePath(locale, page = '') {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const id = String(page).replace(/\/$/, '');
  const slug = id ? `${SLUGS[locale]?.[id] ?? id}/` : '';
  return `${base}${locale === DEFAULT_LOCALE ? '' : `/${locale}`}/${slug}`;
}

/** getStaticPaths for the pages under src/pages/[lang]/ (all languages except the default one) */
export const otherLocalePaths = () => OTHER_LOCALES.map(lang => ({ params: { lang } }));

/** getStaticPaths for src/pages/[lang]/[slug]/: every page in every other language, plus the old English slugs that
 *  now redirect (props.redirect = the new path). */
export const otherLocalePagePaths = () =>
  OTHER_LOCALES.flatMap(lang => [
    ...PAGES.map(page => ({ params: { lang, slug: SLUGS[lang][page] }, props: { page } })),
    ...PAGES.filter(page => SLUGS[lang][page] !== page).map(page => ({ params: { lang, slug: page }, props: { page, redirect: true } })),
  ]);
