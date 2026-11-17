import { checkUsername } from '@rumble-realms/shared';

export type UsernameState =
  | 'empty'
  | 'invalid'
  | 'blocked'
  | 'checking'
  | 'taken'
  | 'free'
  /** The availability check failed (no connection); the server decides on submit. */
  | 'unknown';

/** Local part of the check (format and word filter); null if the name needs the server check. */
export function localUsernameState(name: string): 'empty' | 'invalid' | 'blocked' | null {
  if (name === '') return 'empty';
  const problem = checkUsername(name);
  if (problem === 'username_invalid') return 'invalid';
  if (problem === 'username_blocked') return 'blocked';
  return null;
}

/** The player may submit in these states (`unknown`: the server has the last word). */
export function canSubmitUsername(state: UsernameState): boolean {
  return state === 'free' || state === 'unknown';
}

export const AVAILABILITY_DELAY_MS = 400;

export interface UsernameChecker {
  /** Call on every input change. Reports `onState` for the newest input only. */
  update(name: string): void;
  /** Cancels pending work; a later `update` still works (safe under StrictMode). */
  stop(): void;
}

/**
 * Live check while typing: local rules at once, then the server lookup after a pause.
 * Every call to `update` makes older, still running lookups obsolete, so a slow answer for
 * an earlier input can never overwrite the state of a newer one.
 */
export function createUsernameChecker(
  isFree: (name: string) => Promise<boolean>,
  onState: (state: UsernameState) => void,
  delayMs: number = AVAILABILITY_DELAY_MS,
): UsernameChecker {
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cancel = (): void => {
    generation++;
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  return {
    update(name) {
      cancel();
      const local = localUsernameState(name);
      if (local !== null) {
        onState(local);
        return;
      }
      onState('checking');
      const mine = generation;
      timer = setTimeout(() => {
        timer = null;
        isFree(name).then(
          (free) => {
            if (mine === generation) onState(free ? 'free' : 'taken');
          },
          () => {
            if (mine === generation) onState('unknown');
          },
        );
      }, delayMs);
    },
    stop: cancel,
  };
}
