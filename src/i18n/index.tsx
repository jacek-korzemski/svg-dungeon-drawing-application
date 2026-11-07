import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { PresetId } from '../data/presets';
import type { DungeonDocument } from '../types/dungeon';
import { en } from './en';
import { pl, type Messages } from './pl';

export type Locale = 'pl' | 'en';
export type { Messages };

const STORAGE_KEY = 'jinkline.locale';

type Vars = Record<string, string | number>;
type Join<A extends string, B extends string> = A extends '' ? B : `${A}.${B}`;
type IsPlural<T> = T extends { one: string; few: string; many: string }
  ? Exclude<keyof T, 'one' | 'few' | 'many'> extends never
    ? true
    : false
  : false;

export type MessagePath<T, P extends string = ''> = T extends string
  ? P
  : T extends Record<string, unknown>
    ? {
        [K in keyof T & string]: IsPlural<T[K]> extends true
          ? `${Join<P, K>}.one` | `${Join<P, K>}.few` | `${Join<P, K>}.many`
          : MessagePath<T[K], Join<P, K>>;
      }[keyof T & string]
    : never;

export type PluralPath<T, P extends string = ''> = T extends Record<string, unknown>
  ? {
      [K in keyof T & string]: IsPlural<T[K]> extends true
        ? Join<P, K>
        : PluralPath<T[K], Join<P, K>>;
    }[keyof T & string]
  : never;

const dictionaries: Record<Locale, Messages> = { pl, en };

export function readInitialLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'pl' || stored === 'en') return stored;
  } catch {
    // Private mode can block storage. Fall through to the browser language.
  }
  if (typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('en')) {
    return 'en';
  }
  return 'pl';
}

function lookup(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => {
    if (node && typeof node === 'object' && key in (node as Record<string, unknown>)) {
      return (node as Record<string, unknown>)[key];
    }
    return undefined;
  }, source);
}

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (token, key: string) =>
    vars[key] === undefined ? token : String(vars[key])
  );
}

export function translate(messages: Messages, path: string, vars?: Vars): string {
  const value = lookup(messages, path);
  return typeof value === 'string' ? interpolate(value, vars) : path;
}

export function pluralCategory(locale: Locale, count: number): 'one' | 'few' | 'many' {
  const n = Math.abs(Math.trunc(count));
  if (locale === 'en') return n === 1 ? 'one' : 'many';
  if (n === 1) return 'one';
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'few';
  return 'many';
}

export function localizePresetDocument(
  doc: DungeonDocument,
  presetId: PresetId,
  messages: Messages
): DungeonDocument {
  const names = messages.presets[presetId].layers as Record<string, string>;
  return {
    ...doc,
    title: messages.presets[presetId].title,
    layers: doc.layers.map((layer) => ({
      ...layer,
      name: names[layer.id] ?? layer.name,
    })),
  };
}

interface I18nValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  messages: Messages;
  t: (path: MessagePath<Messages>, vars?: Vars) => string;
  tp: (path: PluralPath<Messages>, count: number, vars?: Vars) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(readInitialLocale);
  const messages = dictionaries[locale];

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // The choice still applies for this session.
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = translate(messages, 'app.title');
  }, [locale, messages]);

  const t = useCallback(
    (path: MessagePath<Messages>, vars?: Vars) => translate(messages, path, vars),
    [messages]
  );

  const tp = useCallback(
    (path: PluralPath<Messages>, count: number, vars?: Vars) =>
      translate(messages, `${path}.${pluralCategory(locale, count)}`, { count, ...vars }),
    [locale, messages]
  );

  const value = useMemo(
    () => ({ locale, setLocale, messages, t, tp }),
    [locale, setLocale, messages, t, tp]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used within I18nProvider');
  return value;
}
