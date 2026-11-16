import { useSyncExternalStore } from 'react';
import { getLocale, subscribeLocale, type Locale } from './index.ts';

/** Re-renders the calling component when the language changes; returns the current language. */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale);
}
