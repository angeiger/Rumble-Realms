/** Username check (SPEC 9.3): format and word filter. Pure, runs in browser, Node and Deno. */
import { BLOCKED_NAMES } from './data/blockedNames.ts';

export const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,16}$/;

const LEET: Readonly<Record<string, string>> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
};

/** Lower case, underscores removed, leetspeak digits turned into letters. */
export function normalizeUsername(name: string): string {
  return name
    .toLowerCase()
    .replace(/_/g, '')
    .replace(/[013457]/g, (c) => LEET[c] ?? c);
}

export function checkUsername(name: unknown): 'username_invalid' | 'username_blocked' | null {
  if (typeof name !== 'string' || !USERNAME_PATTERN.test(name)) return 'username_invalid';
  const normalized = normalizeUsername(name);
  return BLOCKED_NAMES.some((word) => normalized.includes(word)) ? 'username_blocked' : null;
}
