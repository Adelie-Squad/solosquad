// UI language (PRD v2.1.0 I31 · decision 53): ko (default) · en · zh-CN.
// Only the web's own words are translated. Conversation text, artifact content, screen
// titles written by the FDE and names from the engine are shown exactly as they are.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { en } from './en';
import type { MarketingKey } from '../marketing/messages/ko';
import { ko, type MessageKey as AppKey } from './ko';
import { zhCN } from './zh-CN';

export type Locale = 'ko' | 'en' | 'zh-CN';
export const LOCALES: Locale[] = ['ko', 'en', 'zh-CN'];
export const DEFAULT_LOCALE: Locale = 'ko';
/** Each language is named in itself, so anyone can find their own. */
export const LOCALE_NAMES: Record<Locale, string> = { ko: '한국어', en: 'English', 'zh-CN': '简体中文' };

/** The app's words. The marketing build adds its own (`addMessages`) — a company server's web
 * never carries the landing, request or demo login copy (decision 62, C62). */
export const dictionaries: Record<Locale, Record<AppKey, string>> = { ko, en, 'zh-CN': zhCN };

/** Every key a component may ask for: the app's and the marketing site's. */
export type MessageKey = AppKey | MarketingKey;

const added: Record<Locale, Record<string, string>> = { ko: {}, en: {}, 'zh-CN': {} };

/** Load another set of words (the marketing build's) next to the app's. */
export function addMessages(set: Record<Locale, Record<string, string>>) {
  for (const l of LOCALES) Object.assign(added[l], set[l]);
}

/** The app's words and any added set, per language (for tests that read every word). */
export const allMessages = (locale: Locale): Record<string, string> => ({ ...dictionaries[locale], ...added[locale] });

export type Vars = Record<string, string | number>;
export type Translate = (key: MessageKey, vars?: Vars) => string;

export function translate(locale: Locale, key: MessageKey, vars?: Vars): string {
  const own = dictionaries[locale] as Record<string, string>;
  const base = dictionaries[DEFAULT_LOCALE] as Record<string, string>;
  const text = own[key] ?? added[locale][key] ?? base[key] ?? added[DEFAULT_LOCALE][key] ?? key;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (LOCALES as string[]).includes(v);
}

const STORE_KEY = 'solosquad.locale';

/** The language before anyone has logged in — last one used on this device, else ko. */
function initial(): Locale {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (isLocale(saved)) return saved;
  } catch {
    // storage may be blocked; fall through
  }
  return DEFAULT_LOCALE;
}

interface I18n {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: Translate;
  fmt: Formatters;
}

export interface Formatters {
  number: (n: number, digits?: number) => string;
  money: (n: number, currency: string) => string;
  usd: (n: number) => string;
  date: (epochSeconds: number) => string;
  dateTime: (epochSeconds: number) => string;
  time: (epochSeconds: number) => string;
  relative: (epochSeconds: number) => string;
  bytes: (n: number) => string;
}

export function formatters(locale: Locale): Formatters {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  return {
    number: (n, digits = 0) => n.toLocaleString(locale, { maximumFractionDigits: digits }),
    money: (n, currency) => {
      try {
        return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
      } catch {
        return `${n.toLocaleString(locale)} ${currency}`;
      }
    },
    usd: (n) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n),
    date: (s) => new Date(s * 1000).toLocaleDateString(locale),
    dateTime: (s) => new Date(s * 1000).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }),
    time: (s) => new Date(s * 1000).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' }),
    relative: (s) => {
      const diff = s - Date.now() / 1000;
      const abs = Math.abs(diff);
      if (abs < 60) return rtf.format(Math.round(diff), 'second');
      if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
      if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
      return rtf.format(Math.round(diff / 86400), 'day');
    },
    bytes: (n) => (n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`),
  };
}

const Ctx = createContext<I18n>({
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
  t: (k, v) => translate(DEFAULT_LOCALE, k, v),
  fmt: formatters(DEFAULT_LOCALE),
});

export function I18nProvider({ children, locale: forced }: { children: ReactNode; locale?: Locale }) {
  const [locale, setLocaleState] = useState<Locale>(forced ?? initial);
  useEffect(() => {
    if (forced) setLocaleState(forced);
  }, [forced]);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem(STORE_KEY, l);
    } catch {
      // not remembered on this device; the server keeps the person's choice anyway
    }
  }, []);
  const value = useMemo<I18n>(
    () => ({ locale, setLocale, t: (k, v) => translate(locale, k, v), fmt: formatters(locale) }),
    [locale, setLocale],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);
export const useT = () => useContext(Ctx).t;

/** An approval category in the reader's language; one the web does not know shows as sent. */
export function categoryLabel(locale: Locale, category: string, fallback?: string): string {
  const key = `category.${category}`;
  return key in ko ? translate(locale, key as AppKey) : (fallback ?? category);
}
/** An artifact kind (`finance.pnl`) in the reader's language; an unknown kind shows as sent. */
export function kindLabel(locale: Locale, kind: string): string {
  const key = `artifact.kind.${kind}`;
  return key in ko ? translate(locale, key as AppKey) : kind;
}

