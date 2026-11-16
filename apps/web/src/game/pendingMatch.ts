/**
 * The unfinished bot match, saved in the browser so that closing the app does not lose it
 * (D-084). The server keeps the ticket as well; here the picks made so far are added.
 */
import { OFFER_SIZE } from '@rumble-realms/engine';
import { MAX_REPORTED_PICKS, type MatchTicket } from '@rumble-realms/shared';
import { safeStorage } from './safeStorage.ts';

export const PENDING_MATCH_KEY = 'rr.match.v1';

export interface PendingMatch {
  ticket: MatchTicket;
  picks: readonly number[];
}

function validPicks(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_REPORTED_PICKS &&
    value.every((p) => typeof p === 'number' && Number.isInteger(p) && p >= 0 && p < OFFER_SIZE)
  );
}

/** Saves the match; never throws (no storage means: no resume after a restart). */
export function savePendingMatch(ticket: MatchTicket, picks: readonly number[]): void {
  try {
    safeStorage.setItem(PENDING_MATCH_KEY, JSON.stringify({ ticket, picks }));
  } catch {
    // Not serializable: nothing to save.
  }
}

/**
 * The saved picks of match `matchId`, or null if nothing valid is saved for exactly this
 * match. Everything read from the storage is checked.
 */
export function loadPendingMatch(matchId: string): number[] | null {
  try {
    const raw = safeStorage.getItem(PENDING_MATCH_KEY);
    if (typeof raw !== 'string') return null;
    const data: unknown = JSON.parse(raw);
    if (data === null || typeof data !== 'object') return null;
    const { ticket, picks } = data as { ticket?: unknown; picks?: unknown };
    if (ticket === null || typeof ticket !== 'object') return null;
    const id = (ticket as { matchId?: unknown }).matchId;
    if (typeof id !== 'string' || id !== matchId) return null;
    return validPicks(picks) ? [...picks] : null;
  } catch {
    return null;
  }
}

export function clearPendingMatch(): void {
  safeStorage.removeItem(PENDING_MATCH_KEY);
}
