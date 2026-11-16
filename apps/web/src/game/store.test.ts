import { START_DECK } from './config.ts';
import { BackendUnavailableError, type Backend } from '../backend/types.ts';
import { createLocalBackend } from '../backend/local.ts';
import { setBackendForTests } from '../backend/index.ts';
import type { ApiAction, ApiRequestOf, ApiResponse, ApiResponseOf } from '@rumble-realms/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StateStorage } from 'zustand/middleware';
import { resetAccountStoreForTests, useAccountStore } from './accountStore.ts';
import { useBotStore } from './botStore.ts';
import { loadPendingMatch } from './pendingMatch.ts';
import { useGameStore } from './store.ts';
import type { GameSession } from './types.ts';

function memoryStorage(): StateStorage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

interface Net {
  /** Every call fails with BackendUnavailableError while true. */
  down: boolean;
  /** Overrides the answer of an action. */
  reply: Partial<Record<ApiAction, ApiResponse<never>>>;
  calls: ApiAction[];
}

/** A local backend (the real server code) behind a switchable network. */
function flaky(net: Net): Backend {
  const inner = createLocalBackend(memoryStorage());
  return {
    ...inner,
    mode: inner.mode,
    authMethods: inner.authMethods,
    getUser: () => inner.getUser(),
    onAuthChange: (l) => inner.onAuthChange(l),
    signInAsGuest: () => inner.signInAsGuest(),
    loadPlayer: () => inner.loadPlayer(),
    async call<A extends ApiAction>(
      action: A,
      request: ApiRequestOf<A>,
    ): Promise<ApiResponse<ApiResponseOf<A>>> {
      net.calls.push(action);
      if (net.down) throw new BackendUnavailableError();
      const forced = net.reply[action];
      if (forced) return forced as ApiResponse<ApiResponseOf<A>>;
      return inner.call(action, request);
    },
  };
}

/** Plays the session to its end (slot 0 for the human, 250 ms frames). */
function playOut(session: GameSession): void {
  for (let i = 0; i < 200_000 && session.getSnapshot().phase !== 'finished'; i++) {
    const snap = session.getSnapshot();
    if (snap.phase === 'draft' && snap.turn === 0) session.play(0);
    else session.advance(250);
  }
}

/** Plays until `n` picks exist. */
function playPicks(session: GameSession, n: number): void {
  for (let i = 0; i < 200_000 && session.picks.length < n; i++) {
    const snap = session.getSnapshot();
    if (snap.phase === 'draft' && snap.turn === 0) session.play(0);
    else session.advance(250);
  }
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
};

let net: Net;
let memory: Map<string, string>;

beforeEach(async () => {
  memory = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
  });
  net = { down: false, reply: {}, calls: [] };
  const backend = flaky(net);
  setBackendForTests(backend);
  resetAccountStoreForTests();
  await backend.signInAsGuest();
  await backend.call('set_username', { username: 'Anna_1' });
  await useAccountStore.getState().init();
  net.calls.length = 0;
  useBotStore.setState({ level: 'easy' });
  useGameStore.getState().backToMenu();
});

afterEach(() => {
  useGameStore.getState().backToMenu();
  setBackendForTests(null);
  resetAccountStoreForTests();
  vi.unstubAllGlobals();
});

describe('game store', () => {
  it('starts on the menu', () => {
    const s = useGameStore.getState();
    expect(s.screen).toBe('menu');
    expect(s.session).toBeNull();
    expect(s.snapshot).toBeNull();
    expect(s.starting).toBe(false);
    expect(s.startError).toBeNull();
    expect(s.report.state).toBe('idle');
  });

  it('startMatch takes a ticket, opens the battle and follows the session', async () => {
    useBotStore.setState({ level: 'medium' });
    await useGameStore.getState().startMatch();
    const s = useGameStore.getState();
    expect(s.screen).toBe('battle');
    expect(s.starting).toBe(false);
    expect(s.snapshot).toBe(s.session?.getSnapshot());
    expect(s.snapshot?.players[0].name).toBe('Anna_1');
    expect(s.snapshot?.players[0].deck).toEqual(START_DECK);
    expect(s.snapshot?.players[1].isBot).toBe(true);
    expect(net.calls).toEqual(['create_match']);

    s.setSpeed(2);
    expect(useGameStore.getState().snapshot?.speed).toBe(2);
    // The ticket is saved so that the match survives a restart.
    const matchId = useAccountStore.getState().player?.pendingMatch?.matchId ?? '';
    expect(matchId).not.toBe('');
    expect(loadPendingMatch(matchId)).toEqual([]);
  });

  it('saves every pick for resuming', async () => {
    await useGameStore.getState().startMatch();
    const session = useGameStore.getState().session as GameSession;
    const matchId = useAccountStore.getState().player?.pendingMatch?.matchId ?? '';
    playPicks(session, 4);
    expect(loadPendingMatch(matchId)).toEqual([...session.picks]);
  });

  it('a failed start shows the error and keeps the screen', async () => {
    net.down = true;
    await useGameStore.getState().startMatch();
    let s = useGameStore.getState();
    expect(s.screen).toBe('menu');
    expect(s.session).toBeNull();
    expect(s.startError).toBe('unavailable');
    expect(s.starting).toBe(false);

    net.down = false;
    net.reply.create_match = { ok: false, error: { code: 'engine_mismatch' } };
    await useGameStore.getState().startMatch();
    s = useGameStore.getState();
    expect(s.startError).toBe('engine_mismatch');
    expect(s.screen).toBe('menu');

    net.reply = {};
    await useGameStore.getState().startMatch();
    s = useGameStore.getState();
    expect(s.startError).toBeNull();
    expect(s.screen).toBe('battle');
  });

  it('reports a finished match automatically and books it', async () => {
    await useGameStore.getState().startMatch();
    const matchId = useAccountStore.getState().player?.pendingMatch?.matchId ?? '';
    const session = useGameStore.getState().session as GameSession;
    const gamesBefore = useAccountStore.getState().player?.gamesPlayed ?? 0;
    playOut(session);
    expect(useGameStore.getState().report.state).toBe('sending');
    await flush();
    const { report } = useGameStore.getState();
    expect(report.state).toBe('done');
    expect(report.result?.outcome).toBe(
      session.getSnapshot().winner === 0
        ? 'win'
        : session.getSnapshot().winner === 'draw'
          ? 'draw'
          : 'loss',
    );
    expect(net.calls.filter((c) => c === 'report_match')).toHaveLength(1);
    expect(loadPendingMatch(matchId)).toBeNull();
    expect(useAccountStore.getState().player?.gamesPlayed).toBe(gamesBefore + 1);
    expect(useAccountStore.getState().player?.pendingMatch).toBeNull();
  });

  it('keeps the match after "no network" and reports again with retryReport', async () => {
    await useGameStore.getState().startMatch();
    const matchId = useAccountStore.getState().player?.pendingMatch?.matchId ?? '';
    const session = useGameStore.getState().session as GameSession;
    net.down = true;
    playOut(session);
    await flush();
    let s = useGameStore.getState();
    expect(s.report).toEqual({ state: 'failed', result: null, error: 'unavailable' });
    expect(loadPendingMatch(matchId)).not.toBeNull();

    net.down = false;
    const first = s.retryReport();
    void s.retryReport(); // never twice at the same time
    await first;
    await flush();
    s = useGameStore.getState();
    expect(s.report.state).toBe('done');
    expect(net.calls.filter((c) => c === 'report_match')).toHaveLength(2);
    expect(loadPendingMatch(matchId)).toBeNull();
  });

  it('a rejected report is final: failed with the code, saved match deleted', async () => {
    await useGameStore.getState().startMatch();
    const matchId = useAccountStore.getState().player?.pendingMatch?.matchId ?? '';
    net.reply.report_match = { ok: false, error: { code: 'match_rejected' } };
    playOut(useGameStore.getState().session as GameSession);
    await flush();
    expect(useGameStore.getState().report).toEqual({
      state: 'failed',
      result: null,
      error: 'match_rejected',
    });
    expect(loadPendingMatch(matchId)).toBeNull();
  });

  it('resumes with the saved picks of the same match', async () => {
    await useGameStore.getState().startMatch();
    const first = useGameStore.getState().session as GameSession;
    const matchId = useAccountStore.getState().player?.pendingMatch?.matchId ?? '';
    playPicks(first, 5);
    const picks = [...first.picks];
    useGameStore.getState().backToMenu();
    expect(useGameStore.getState().screen).toBe('menu');
    // Still open: on the server and in the browser.
    expect(useAccountStore.getState().player?.pendingMatch?.matchId).toBe(matchId);
    expect(loadPendingMatch(matchId)).toEqual(picks);

    await useGameStore.getState().startMatch('resume');
    const s = useGameStore.getState();
    expect(s.screen).toBe('battle');
    expect(s.session).not.toBe(first);
    expect(s.session?.picks.slice(0, picks.length)).toEqual(picks);
    expect(useAccountStore.getState().player?.pendingMatch?.matchId).toBe(matchId);
  });

  it('resumes from the start if the saved picks belong to another match', async () => {
    await useGameStore.getState().startMatch();
    const matchId = useAccountStore.getState().player?.pendingMatch?.matchId ?? '';
    playPicks(useGameStore.getState().session as GameSession, 3);
    useGameStore.getState().backToMenu();
    memory.clear();
    await useGameStore.getState().startMatch('resume');
    expect(useAccountStore.getState().player?.pendingMatch?.matchId).toBe(matchId);
    expect(useGameStore.getState().session?.picks).toEqual([]);
  });

  it('forfeit starts a new match and ignores the old picks', async () => {
    await useGameStore.getState().startMatch();
    const oldId = useAccountStore.getState().player?.pendingMatch?.matchId ?? '';
    playPicks(useGameStore.getState().session as GameSession, 3);
    useGameStore.getState().backToMenu();
    await useGameStore.getState().startMatch('forfeit');
    const newId = useAccountStore.getState().player?.pendingMatch?.matchId ?? '';
    expect(newId).not.toBe(oldId);
    expect(useGameStore.getState().session?.picks).toEqual([]);
    expect(useGameStore.getState().screen).toBe('battle');
  });

  it('keeps the tab and goes back to the battle tab on backToMenu', () => {
    useGameStore.getState().setTab('deck');
    expect(useGameStore.getState().tab).toBe('deck');
    useGameStore.getState().setTab('profile');
    expect(useGameStore.getState().tab).toBe('profile');
    useGameStore.getState().backToMenu();
    expect(useGameStore.getState().tab).toBe('battle');
  });

  it('backToMenu detaches and clears', async () => {
    await useGameStore.getState().startMatch();
    const session = useGameStore.getState().session;
    useGameStore.getState().backToMenu();
    const s = useGameStore.getState();
    expect(s.screen).toBe('menu');
    expect(s.session).toBeNull();
    expect(s.snapshot).toBeNull();
    session?.setSpeed(2);
    expect(useGameStore.getState().snapshot).toBeNull();
  });

  it('a new match replaces the old one and ignores the old session', async () => {
    await useGameStore.getState().startMatch('forfeit');
    const first = useGameStore.getState().session;
    await useGameStore.getState().startMatch('forfeit');
    const second = useGameStore.getState().session;
    expect(second).not.toBe(first);
    first?.setSpeed(2);
    expect(useGameStore.getState().snapshot?.speed).toBe(1);
  });

  it('startMatch uses a bot of the chosen level', async () => {
    useBotStore.setState({ level: 'hard' });
    await useGameStore.getState().startMatch();
    const ticket = useAccountStore.getState().player?.pendingMatch;
    expect(ticket?.botLevel).toBe('hard');
  });
});
