import { ENGINE_VERSION } from '@rumble-realms/engine';
import type { MatchTicket } from '@rumble-realms/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPendingMatch,
  loadPendingMatch,
  PENDING_MATCH_KEY,
  savePendingMatch,
} from './pendingMatch.ts';

const TICKET: MatchTicket = {
  matchId: 'abc',
  seed: 7,
  engineVersion: ENGINE_VERSION,
  botLevel: 'easy',
  botProfile: 'x',
  player: { deck: ['archer'], levels: { archer: 1 } },
};

let memory: Map<string, string>;

beforeEach(() => {
  memory = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('pending match', () => {
  it('saves and loads the picks of the same match', () => {
    savePendingMatch(TICKET, [0, 2, 1]);
    expect(memory.has(PENDING_MATCH_KEY)).toBe(true);
    expect(loadPendingMatch('abc')).toEqual([0, 2, 1]);
  });

  it('knows nothing about another match', () => {
    savePendingMatch(TICKET, [0]);
    expect(loadPendingMatch('other')).toBeNull();
  });

  it('clears', () => {
    savePendingMatch(TICKET, [0]);
    clearPendingMatch();
    expect(loadPendingMatch('abc')).toBeNull();
  });

  it('rejects broken or foreign data', () => {
    const bad = [
      'not json',
      'null',
      '42',
      '{}',
      JSON.stringify({ ticket: null, picks: [] }),
      JSON.stringify({ ticket: { matchId: 5 }, picks: [] }),
      JSON.stringify({ ticket: TICKET, picks: 'x' }),
      JSON.stringify({ ticket: TICKET, picks: [0, 3] }),
      JSON.stringify({ ticket: TICKET, picks: [0, -1] }),
      JSON.stringify({ ticket: TICKET, picks: [0.5] }),
      JSON.stringify({ ticket: TICKET, picks: ['1'] }),
      JSON.stringify({ ticket: TICKET, picks: new Array(1000).fill(0) }),
    ];
    for (const raw of bad) {
      memory.set(PENDING_MATCH_KEY, raw);
      expect(loadPendingMatch('abc'), raw.slice(0, 40)).toBeNull();
    }
  });

  it('does not throw without a storage', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(() => savePendingMatch(TICKET, [0])).not.toThrow();
    expect(loadPendingMatch('abc')).toBeNull();
    expect(() => clearPendingMatch()).not.toThrow();
  });
});
