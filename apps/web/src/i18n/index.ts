import de from './de.json';
import en from './en.json';

/** de.json is authoritative: all keys are derived from it. */
export type MessageKey = keyof typeof de;
export type Locale = 'de' | 'en';

const catalogs: Record<Locale, Record<MessageKey, string>> = { de, en };

let locale: Locale = 'de';

export function setLocale(next: Locale): void {
  locale = next;
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
