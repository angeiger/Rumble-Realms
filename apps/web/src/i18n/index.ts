import de from './de.json';
import en from './en.json';

/** de.json is authoritative: all keys are derived from it. */
export type MessageKey = keyof typeof de;
export type Locale = 'de' | 'en';

const catalogs: Record<Locale, Record<MessageKey, string>> = { de, en };

const STORAGE_KEY = 'rr.locale';

/** The language the player chose earlier in this browser, else German (the default). */
function storedLocale(): Locale {
  try {
    const value = globalThis.localStorage?.getItem(STORAGE_KEY);
    return value === 'en' || value === 'de' ? value : 'de';
  } catch {
    return 'de';
  }
}

let locale: Locale = storedLocale();
const listeners = new Set<() => void>();

function applyDocumentLanguage(): void {
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
}
applyDocumentLanguage();

/** Sets the language for this page load only (tests); does not touch the stored choice. */
export function setLocale(next: Locale): void {
  if (next === locale) return;
  locale = next;
  applyDocumentLanguage();
  for (const listener of listeners) listener();
}

/** The player's choice: switches the language, tells subscribers (re-render) and remembers it. */
export function chooseLocale(next: Locale): void {
  setLocale(next);
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, next);
  } catch {
    // Private mode or quota: the choice then only lasts until the page is closed.
  }
}

/** For `useSyncExternalStore`: called after every language change. Returns the unsubscribe function. */
export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getLocale(): Locale {
  return locale;
}

/** Looks up a message and replaces `{name}` placeholders; unknown placeholders stay untouched. */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const template = catalogs[locale][key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}
