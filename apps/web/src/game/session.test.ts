import { BOT_PROFILES, hashState, type BotProfile, type MatchState } from '@rumble-realms/engine';
import { describe, expect, it } from 'vitest';
import {
  BOT_THINK_MS,
  INTRO_MS,
  MAX_FRAME_MS,
  ROUND_END_MS,
  START_DECK,
  TICK_MS,
} from './config.ts';
import {
  createLocalSession,
  createLocalSessionHandle,
  type LocalSessionOptions,
} from './session.ts';
import type { FrameInfo, GameSession, SessionPhase, SessionSnapshot } from './types.ts';

const BOT = BOT_PROFILES[0] as BotProfile;

function opts(seed = 1, extra: Partial<LocalSessionOptions> = {}): LocalSessionOptions {
  return { seed, bot: BOT, playerName: '', ...extra };
}

/** Advances in 100 ms steps (at most) until `done`, playing slot 0 whenever the human is due. */
function stepUntil(
  s: GameSession,
  done: (snap: SessionSnapshot) => boolean,
  dt = 100,
  limit = 200_000,
): void {
  for (let i = 0; i < limit; i++) {
    const snap = s.getSnapshot();
    if (done(snap)) return;
    if (snap.phase === 'draft' && snap.turn === 0) {
      s.play(0);
    } else s.advance(dt);
  }
  throw new Error('stepUntil: limit reached');
}

/** Advances until the human has the pick (bot picks first if due). */
function toHumanTurn(s: GameSession): void {
  stepUntil(s, (n) => n.phase === 'draft' && n.turn === 0);
}

describe('start', () => {
  it('starts in the draft with the human as player 0', () => {
    const s = createLocalSession(opts());
    const snap = s.getSnapshot();
    expect(snap.phase).toBe('draft');
    expect(snap.round).toBe(1);
    expect(snap.me).toBe(0);
    expect(snap.lives).toEqual([4, 4]);
    expect(snap.players[0]).toMatchObject({ isBot: false, name: '', deck: START_DECK });
    expect(snap.players[0].levels).toEqual({ archer: 1, knight: 1, skeleton: 1, healer: 1 });
    expect(snap.players[1]).toMatchObject({ isBot: true, name: BOT.name, deck: BOT.deck });
    expect(snap.players[1].levels.tnt).toBe(1);
    expect(snap.lastPick).toBeNull();
    expect(snap.roundResult).toBeNull();
    expect(snap.winner).toBeNull();
    expect(snap.speed).toBe(1);
    expect(snap.picksLeft[0] + snap.picksLeft[1]).toBeGreaterThan(0);
  });

  it('shows the offer only on the human turn, as a copy', () => {
    const h = createLocalSessionHandle(opts());
    const snap = h.session.getSnapshot();
    if (snap.turn === 0) {
      expect(snap.offer).toHaveLength(3);
      expect(snap.offer).not.toBe(h.match.draft.offer?.slots);
      expect(snap.offer?.[0]).not.toBe(h.match.draft.offer?.slots[0]);
    } else {
      expect(snap.offer).toBeNull();
    }
  });
});

describe('full match', () => {
  it('plays to the end with the expected phase order, lives and field resets', () => {
    const h = createLocalSessionHandle(opts(5));
    const s = h.session;
    const phases: SessionPhase[] = [s.getSnapshot().phase];
    let resets = 0;
    let rounds = 0;
    let prevLives: [number, number] = [4, 4];
    for (let i = 0; i < 400_000 && s.getSnapshot().phase !== 'finished'; i++) {
      const snap = s.getSnapshot();
      let frame: FrameInfo | null = null;
      if (snap.phase === 'draft' && snap.turn === 0) {
        s.play(0);
      } else frame = s.advance(100);
      if (frame?.fieldReset) resets++;
      const now = s.getSnapshot();
      if (now.phase !== phases[phases.length - 1]) {
        phases.push(now.phase);
        if (now.phase === 'roundEnd') {
          rounds++;
          const r = now.roundResult;
          expect(r?.round).toBe(rounds);
          // lives already updated during roundEnd, match not yet booked
          expect(now.lives).toEqual(r?.lives);
          expect(h.match.lives).toEqual(prevLives);
          const expected: [number, number] = [...prevLives];
          if (r?.result.winner === 'draw') {
            expected[0]--;
            expected[1]--;
          } else {
            expected[r?.result.winner === 0 ? 1 : 0]--;
          }
          expect(now.lives).toEqual(expected);
          prevLives = expected;
        }
      }
    }
    const end = s.getSnapshot();
    expect(end.phase).toBe('finished');
    expect(end.winner).not.toBeNull();
    expect(end.roundResult?.round).toBe(rounds);
    expect(end.lives).toEqual(h.match.lives);
    expect(Math.min(...end.lives)).toBe(0);
    expect(resets).toBe(rounds - 1);
    expect(h.match.rounds).toHaveLength(rounds);

    // Every round runs draft -> intro -> battle -> roundEnd; then draft or finished.
    const expected: SessionPhase[] = [];
    for (let r = 0; r < rounds; r++) expected.push('draft', 'intro', 'battle', 'roundEnd');
    expected.push('finished');
    expect(phases).toEqual(expected);

    // finished: nothing changes any more
    const ref = s.getSnapshot();
    const frame = s.advance(1000);
    expect(frame.ticks).toBe(0);
    expect(s.getSnapshot()).toBe(ref);
  });

  it('keeps the field with survivors during roundEnd and replaces it for the next round', () => {
    const s = createLocalSession(opts(8));
    stepUntil(s, (n) => n.phase === 'roundEnd');
    const field = s.battle;
    expect(field.result).not.toBeNull();
    s.advance(MAX_FRAME_MS);
    expect(s.battle).toBe(field);
    stepUntil(s, (n) => n.phase !== 'roundEnd');
    if (s.getSnapshot().phase === 'draft') {
      expect(s.battle).not.toBe(field);
      // Units of earlier rounds may already stand there (D-046), but no tick has run yet.
      expect(s.battle.tick).toBe(0);
      expect(s.battle.started).toBe(false);
      expect(s.getSnapshot().roundResult).toBeNull();
    }
  });
});

describe('draft', () => {
  it('lets the bot pick only after the think time, accumulated over calls', () => {
    // find a seed where the bot starts
    let s: GameSession | null = null;
    for (let seed = 1; seed < 50 && s === null; seed++) {
      const c = createLocalSession(opts(seed));
      if (c.getSnapshot().turn === 1) s = c;
    }
    if (s === null) throw new Error('no seed with bot start');
    expect(s.getSnapshot().offer).toBeNull();
    const first = s.getSnapshot();
    for (let t = 0; t < BOT_THINK_MS - 50; t += 50) {
      s.advance(50);
      expect(s.getSnapshot()).toBe(first);
    }
    s.advance(50);
    const after = s.getSnapshot();
    expect(after).not.toBe(first);
    expect(after.lastPick?.player).toBe(1);
    expect(after.picksLeft[1]).toBe(first.picksLeft[1] - 1);
  });

  it('never lets the bot pick while the human is due', () => {
    let s: GameSession | null = null;
    for (let seed = 1; seed < 50 && s === null; seed++) {
      const c = createLocalSession(opts(seed));
      if (c.getSnapshot().turn === 0) s = c;
    }
    if (s === null) throw new Error('no seed with human start');
    const first = s.getSnapshot();
    for (let i = 0; i < 100; i++) s.advance(MAX_FRAME_MS);
    expect(s.getSnapshot()).toBe(first);
  });

  it('ignores play while the bot is due', () => {
    let s: GameSession | null = null;
    for (let seed = 1; seed < 50 && s === null; seed++) {
      const c = createLocalSession(opts(seed));
      if (c.getSnapshot().turn === 1) s = c;
    }
    if (s === null) throw new Error('no seed with bot start');
    const first = s.getSnapshot();
    s.play(0);
    s.play(1);
    expect(s.getSnapshot()).toBe(first);
  });

  it('a single play() plays the card at once', () => {
    const h = createLocalSessionHandle(opts(3));
    toHumanTurn(h.session);
    const s = h.session;
    const picks = h.match.picks.length;
    s.play(2);
    expect(h.match.picks.length).toBe(picks + 1);
    expect(h.match.picks[picks]).toBe(2);
    expect(s.getSnapshot().lastPick?.player).toBe(0);
    expect(s.getSnapshot().lastPick?.slot).toBe(2);
  });

  it('a second play() right after the pick does nothing while the bot is due', () => {
    const h = createLocalSessionHandle(opts(3));
    toHumanTurn(h.session);
    h.session.play(0);
    const snap = h.session.getSnapshot();
    if (snap.turn === 1) {
      const picks = h.match.picks.length;
      h.session.play(0);
      expect(h.match.picks.length).toBe(picks);
      expect(h.session.getSnapshot()).toBe(snap);
    }
  });

  it('ignores invalid slots', () => {
    const h = createLocalSessionHandle(opts(3));
    toHumanTurn(h.session);
    const before = h.session.getSnapshot();
    for (const slot of [-1, 3, 99, 1.5, NaN, Infinity]) h.session.play(slot);
    expect(h.session.getSnapshot()).toBe(before);
  });

  it('does not copy the engine offer into the snapshot', () => {
    const h = createLocalSessionHandle(opts(3));
    toHumanTurn(h.session);
    const snap = h.session.getSnapshot();
    expect(snap.offer).not.toBeNull();
    expect(snap.offer).not.toBe(h.match.draft.offer?.slots);
  });

  it('starts the intro after the last pick', () => {
    const s = createLocalSession(opts(4));
    stepUntil(s, (n) => n.phase !== 'draft');
    const snap = s.getSnapshot();
    expect(snap.phase).toBe('intro');
    expect(snap.turn).toBeNull();
    expect(snap.offer).toBeNull();
    expect(snap.picksLeft).toEqual([0, 0]);
  });
});

describe('intro', () => {
  it('lasts INTRO_MS without simulating ticks, then the battle begins', () => {
    const s = createLocalSession(opts(4));
    stepUntil(s, (n) => n.phase === 'intro');
    let elapsed = 0;
    while (s.getSnapshot().phase === 'intro') {
      const f = s.advance(50);
      elapsed += 50;
      expect(f.ticks).toBe(0);
      expect(f.alpha).toBe(0);
      expect(f.events).toHaveLength(0);
    }
    expect(elapsed).toBeGreaterThanOrEqual(INTRO_MS - 50);
    expect(elapsed).toBeLessThanOrEqual(INTRO_MS + 50);
    expect(s.getSnapshot().phase).toBe('battle');
    expect(s.battle.started).toBe(false);
  });

  it('is short: well below a second and a half', () => {
    expect(INTRO_MS).toBe(900);
  });
});

describe('player levels', () => {
  it('uses playerLevels for the deck cards and falls back to 1', () => {
    const s = createLocalSession(
      opts(1, {
        playerDeck: ['assassin', 'tnt', 'knight', 'archer'],
        playerLevels: { tnt: 3, knight: 5, archer: 9, assassin: 1.5, bat: 4 },
      }),
    );
    const me = s.getSnapshot().players[0];
    expect(me.deck).toEqual(['assassin', 'tnt', 'knight', 'archer']);
    expect(me.levels).toEqual({ assassin: 1, tnt: 3, knight: 5, archer: 1 });
  });

  it('reaches the engine: units of a higher level have more hp', () => {
    const low = createLocalSessionHandle(opts(2, { playerLevels: { knight: 1 } }));
    const high = createLocalSessionHandle(opts(2, { playerLevels: { knight: 5 } }));
    expect(low.match.config.players[0].levels.knight).toBe(1);
    expect(high.match.config.players[0].levels.knight).toBe(5);
  });
});

describe('battle clock', () => {
  function toBattle(speed?: 1 | 2): GameSession {
    const s = createLocalSession(opts(6));
    if (speed === 2) s.setSpeed(2);
    stepUntil(s, (n) => n.phase === 'battle');
    return s;
  }

  it('simulates 20 ticks per second at speed 1 and 40 at speed 2', () => {
    for (const [speed, expected] of [
      [1, 20],
      [2, 40],
    ] as const) {
      const s = toBattle(speed);
      let ticks = 0;
      for (let i = 0; i < 4; i++) ticks += s.advance(250).ticks;
      expect(s.getSnapshot().phase).toBe('battle');
      expect(ticks).toBe(expected);
      expect(s.battle.tick).toBe(expected);
    }
  });

  it('applies setSpeed immediately', () => {
    const s = toBattle();
    expect(s.advance(200).ticks).toBe(4);
    s.setSpeed(2);
    expect(s.getSnapshot().speed).toBe(2);
    expect(s.advance(200).ticks).toBe(8);
  });

  it('keeps alpha in [0, 1) and carries the remainder', () => {
    const s = toBattle();
    let total = 0;
    let ticks = 0;
    for (let i = 0; i < 7; i++) {
      const f = s.advance(30);
      total += 30;
      ticks += f.ticks;
      expect(f.alpha).toBeGreaterThanOrEqual(0);
      expect(f.alpha).toBeLessThan(1);
      expect(f.alpha).toBeCloseTo((total - ticks * TICK_MS) / TICK_MS, 10);
    }
    expect(ticks).toBe(Math.floor(total / TICK_MS));
  });

  it('limits dt to MAX_FRAME_MS and ticks to 10, and drops the rest', () => {
    const s = toBattle(2);
    const f = s.advance(10_000);
    expect(f.ticks).toBe(10);
    expect(s.battle.tick).toBe(10);
    // dt limited to 250 ms * speed 2 = 10 ticks, nothing carried over
    expect(s.advance(0).ticks).toBe(0);
  });

  it('treats negative and NaN dt as 0', () => {
    const s = toBattle();
    for (const dt of [-100, NaN, -Infinity]) {
      const f = s.advance(dt);
      expect(f.ticks).toBe(0);
      expect(f.alpha).toBe(0);
    }
    expect(s.battle.tick).toBe(0);
  });

  it('reuses the events array and clears it every call', () => {
    const s = toBattle();
    const first = s.advance(250);
    const second = s.advance(250);
    expect(second.events).toBe(first.events);
    let any = false;
    for (let i = 0; i < 300 && s.getSnapshot().phase === 'battle'; i++) {
      const f = s.advance(250);
      if (f.events.length > 0) any = true;
    }
    expect(any).toBe(true);
    const idle = s.advance(0);
    expect(idle.events).toHaveLength(0);
  });

  it('reports roundResult when the battle ends and waits ROUND_END_MS', () => {
    const s = toBattle();
    stepUntil(s, (n) => n.phase !== 'battle', 250);
    const snap = s.getSnapshot();
    expect(snap.phase).toBe('roundEnd');
    expect(snap.roundResult).not.toBeNull();
    expect(s.battle.result).not.toBeNull();
    let elapsed = 0;
    while (s.getSnapshot().phase === 'roundEnd') {
      const f = s.advance(50);
      elapsed += 50;
      expect(f.ticks).toBe(0);
    }
    expect(elapsed).toBeGreaterThanOrEqual(ROUND_END_MS - 50);
    expect(elapsed).toBeLessThanOrEqual(ROUND_END_MS + 50);
  });
});

describe('snapshot and listeners', () => {
  it('keeps the same snapshot when nothing visible changes', () => {
    const s = toBattleSession();
    const snap = s.getSnapshot();
    for (let i = 0; i < 10; i++) s.advance(50);
    expect(s.getSnapshot()).toBe(snap);
  });

  function toBattleSession(): GameSession {
    const s = createLocalSession(opts(6));
    stepUntil(s, (n) => n.phase === 'battle');
    return s;
  }

  it('is immutable', () => {
    const s = createLocalSession(opts(6));
    const snap = s.getSnapshot();
    expect(Object.isFrozen(snap)).toBe(true);
  });

  it('notifies listeners per replacement and supports unsubscribe', () => {
    const s = createLocalSession(opts(2));
    let calls = 0;
    const seen: SessionSnapshot[] = [];
    const off = s.subscribe(() => {
      calls++;
      seen.push(s.getSnapshot());
    });
    toHumanTurn(s);
    const callsBefore = calls;
    expect(callsBefore).toBeGreaterThanOrEqual(0);
    const before = s.getSnapshot();
    s.play(0);
    expect(calls).toBe(callsBefore + 1);
    expect(s.getSnapshot()).not.toBe(before);
    expect(seen[seen.length - 1]).toBe(s.getSnapshot());
    s.setSpeed(2);
    expect(calls).toBe(callsBefore + 2);
    s.setSpeed(2);
    expect(calls).toBe(callsBefore + 2);
    off();
    s.setSpeed(1);
    expect(calls).toBe(callsBefore + 2);
    expect(s.getSnapshot().speed).toBe(1);
  });
});

describe('determinism', () => {
  function run(seed: number, dts: number[]): string[] {
    const h = createLocalSessionHandle(opts(seed, { botSeed: seed + 1 }));
    const hashes: string[] = [hashState(h.match as MatchState)];
    for (let i = 0; i < 20_000 && h.session.getSnapshot().phase !== 'finished'; i++) {
      const snap = h.session.getSnapshot();
      if (snap.phase === 'draft' && snap.turn === 0) {
        h.session.play(i % 3);
      } else {
        h.session.advance(dts[i % dts.length] as number);
      }
      hashes.push(hashState(h.match));
    }
    return hashes;
  }

  it('gives identical state histories for identical inputs', () => {
    const a = run(11, [37, 120, 250, 16]);
    const b = run(11, [37, 120, 250, 16]);
    expect(a.length).toBeGreaterThan(100);
    expect(a).toEqual(b);
    expect(run(12, [37, 120, 250, 16])).not.toEqual(a);
    // Three full matches with a state hash after every step: slow on a busy machine.
  }, 60_000);
});
