import { describe, expect, it } from 'vitest';
import {
  applyPick,
  BOT_LEVELS,
  BOT_PROFILES,
  botPickRng,
  chooseBotPick,
  cloneMatchState,
  createMatch,
  endRound,
  ENGINE_VERSION,
  getOffer,
  hashState,
  nextInt,
  OFFER_SIZE,
  randomConfig,
  replayMatch,
  seedRng,
  simulateToEnd,
  startBattle,
  upgradesForLevel,
} from '../../engine/src/index.ts';
import type { BotLevelId, MatchState, PlayerConfig } from '../../engine/src/index.ts';
import { HARD_CHECK_MAX, MAX_REPORTED_PICKS, VERIFY_BUDGET_MS } from './data/server.ts';
import {
  BOT,
  botPlayerConfig,
  botProfileOf,
  HUMAN,
  matchConfigOf,
  nextBotPick,
  outcomeOf,
  pickBotProfile,
  serverCheckPolicy,
  verifyBotMatch,
  type BotCheckInfo,
  type SampleCheck,
  type VerifyOptions,
  type VerifyResult,
} from './match.ts';
import type { MatchTicket } from './protocol.ts';

const LEVELS: BotLevelId[] = ['easy', 'medium', 'hard'];

const HUMAN_PLAYER: PlayerConfig = {
  deck: ['archer', 'knight', 'skeleton', 'healer'],
  levels: { archer: 2, knight: 1, skeleton: 3, healer: 1 },
  upgrades: { archer: 1, skeleton: 3 },
};

function profileFor(level: BotLevelId, n = 0): string {
  return BOT_PROFILES.filter((p) => p.level === level)[n]!.id;
}

function ticketFor(level: BotLevelId, seed: number, player = HUMAN_PLAYER): MatchTicket {
  return {
    matchId: '00000000-0000-4000-8000-000000000000',
    seed,
    engineVersion: ENGINE_VERSION,
    botLevel: level,
    botProfile: profileFor(level, seed % 3),
    player,
  };
}

interface Played {
  state: MatchState;
  picks: number[];
  /** Indexes of the bot's picks in `picks`. */
  botIndexes: number[];
}

/** An honest match: the human picks at random, the bot with `nextBotPick`. */
function playHonest(
  ticket: MatchTicket,
  humanSeed: number,
  onBotPick?: (state: MatchState, ms: number) => void,
): Played {
  const cfg = matchConfigOf(ticket);
  if (cfg === null) throw new Error('playHonest: bad ticket');
  const state = createMatch(cfg);
  const rng = seedRng(humanSeed, 0);
  const botIndexes: number[] = [];
  while (state.phase !== 'finished') {
    if (state.phase === 'draft') {
      if (getOffer(state).player === BOT) {
        botIndexes.push(state.picks.length);
        const start = clock();
        const slot = nextBotPick(state, ticket);
        onBotPick?.(state, clock() - start);
        applyPick(state, slot);
      } else {
        applyPick(state, nextInt(rng, OFFER_SIZE));
      }
    } else {
      simulateToEnd(startBattle(state));
      endRound(state);
    }
  }
  return { state, picks: [...state.picks], botIndexes };
}

/** High-resolution clock of the test runner (Node or browser), in milliseconds. */
function clock(): number {
  return (globalThis as unknown as { performance: { now(): number } }).performance.now();
}

function expectFailure(result: VerifyResult, reason: string): void {
  expect(result.ok, JSON.stringify(result)).toBe(false);
  if (!result.ok) expect(result.reason).toBe(reason);
}

/** The honest hard match is expensive (Monte Carlo), so it is played once. */
let hardMatch: { ticket: MatchTicket; played: Played } | null = null;
function hardHonest(): { ticket: MatchTicket; played: Played } {
  if (hardMatch === null) {
    const ticket = ticketFor('hard', 31);
    hardMatch = { ticket, played: playHonest(ticket, 5) };
  }
  return hardMatch;
}

let hardFullResult: VerifyResult | null = null;
/** The full check (every decision) of the honest hard match, computed once. */
function hardFull(): VerifyResult {
  if (hardFullResult === null) {
    const { ticket, played } = hardHonest();
    hardFullResult = verifyBotMatch(ticket, played.picks);
  }
  return hardFullResult;
}

describe('bot profiles and match setup', () => {
  it('uses player 0 for the human and 1 for the bot', () => {
    expect(HUMAN).toBe(0);
    expect(BOT).toBe(1);
  });

  it('finds profiles by id', () => {
    for (const p of BOT_PROFILES) expect(botProfileOf(p.id)).toBe(p);
    expect(botProfileOf('nobody')).toBeNull();
    expect(botProfileOf('toString')).toBeNull();
    expect(botProfileOf(7 as unknown as string)).toBeNull();
  });

  it('gives the bot the card level and upgrades of its level (like the local session)', () => {
    for (const p of BOT_PROFILES) {
      const cfg = botPlayerConfig(p);
      const level = BOT_LEVELS[p.level].cardLevel;
      expect(cfg.deck).toEqual(p.deck);
      expect(cfg.deck).not.toBe(p.deck);
      for (const card of p.deck) {
        expect(cfg.levels[card]).toBe(level);
        expect(cfg.upgrades?.[card]).toBe(upgradesForLevel(level));
      }
      expect(Object.keys(cfg.levels)).toHaveLength(p.deck.length);
    }
    expect(botPlayerConfig(botProfileOf(profileFor('hard'))!).upgrades).toEqual(
      Object.fromEntries(botProfileOf(profileFor('hard'))!.deck.map((c) => [c, 0b011])),
    );
  });

  it('picks a profile of the requested level with the given random numbers', () => {
    for (const level of LEVELS) {
      const ids = BOT_PROFILES.filter((p) => p.level === level).map((p) => p.id);
      const seen = ids.map((_, i) => pickBotProfile(level, () => i));
      expect(seen.map((p) => p.id)).toEqual(ids);
      for (const p of seen) expect(p.level).toBe(level);
      expect(pickBotProfile(level, (n) => n - 1).id).toBe(ids.at(-1));
    }
  });

  it('rejects random numbers out of range and levels without profiles', () => {
    expect(() => pickBotProfile('easy', (n) => n)).toThrow();
    expect(() => pickBotProfile('easy', () => -1)).toThrow();
    expect(() => pickBotProfile('easy', () => 0.5)).toThrow();
    expect(() => pickBotProfile('master' as BotLevelId, () => 0)).toThrow();
  });

  it('builds the match config of a ticket: human first, bot second', () => {
    const ticket = ticketFor('medium', 4);
    const cfg = matchConfigOf(ticket)!;
    expect(cfg.seed).toBe(4);
    expect(cfg.players[0]).toEqual(HUMAN_PLAYER);
    expect(cfg.players[0]).not.toBe(HUMAN_PLAYER);
    expect(cfg.players[1]).toEqual(botPlayerConfig(botProfileOf(ticket.botProfile)!));
    const noUpgrades = matchConfigOf(ticketFor('easy', 1, { deck: HUMAN_PLAYER.deck, levels: {} }));
    expect(noUpgrades?.players[0]).toEqual({ deck: HUMAN_PLAYER.deck, levels: {} });
  });

  it('gives no match config for an unknown profile or a profile of another level', () => {
    expect(matchConfigOf({ ...ticketFor('easy', 1), botProfile: 'nobody' })).toBeNull();
    expect(matchConfigOf({ ...ticketFor('easy', 1), botProfile: profileFor('hard') })).toBeNull();
    expect(matchConfigOf({ ...ticketFor('easy', 1), botLevel: 'master' as BotLevelId })).toBeNull();
  });

  it('turns the winner into the outcome of the human', () => {
    expect(outcomeOf(0)).toBe('win');
    expect(outcomeOf(1)).toBe('loss');
    expect(outcomeOf('draw')).toBe('draw');
  });
});

describe('nextBotPick', () => {
  it.each(['easy', 'medium'] as BotLevelId[])(
    '%s uses the stream of this decision and leaves the state unchanged',
    (level) => {
      const ticket = ticketFor(level, 12);
      const state = createMatch(matchConfigOf(ticket)!);
      while (getOffer(state).player !== BOT) applyPick(state, 0);
      const before = hashState(state);
      const slot = nextBotPick(state, ticket);
      expect(slot).toBe(chooseBotPick(state, level, botPickRng(12, state.picks.length)));
      expect(nextBotPick(state, ticket)).toBe(slot);
      expect(hashState(state)).toBe(before);
    },
  );
});

describe('verifyBotMatch: honest matches', () => {
  it.each(['easy', 'medium'] as BotLevelId[])(
    'accepts honest %s matches with the winner of the direct simulation',
    (level) => {
      for (let seed = 1; seed <= 6; seed++) {
        const ticket = ticketFor(level, seed * 7919);
        const { state, picks, botIndexes } = playHonest(ticket, seed);
        const result = verifyBotMatch(ticket, picks);
        expect(result).toEqual({
          ok: true,
          winner: state.winner,
          outcome: outcomeOf(state.winner!),
          rounds: state.rounds.length,
          botPicks: botIndexes.length,
          botPicksChecked: botIndexes.length,
        });
        // Same result as a plain replay of the engine.
        expect(replayMatch(matchConfigOf(ticket)!, picks).winner).toBe(state.winner);
      }
    },
  );

  it('accepts an honest hard match with every bot decision checked', () => {
    const { played } = hardHonest();
    const result = hardFull();
    expect(result).toMatchObject({
      ok: true,
      winner: played.state.winner,
      outcome: outcomeOf(played.state.winner!),
      rounds: played.state.rounds.length,
      botPicks: played.botIndexes.length,
      botPicksChecked: played.botIndexes.length,
    });
  }, 120_000);

  it('accepts a match with a random human setup', () => {
    const player = randomConfig(seedRng(77, 0)).players[0];
    const ticket = ticketFor('medium', 77, player);
    const { state, picks } = playHonest(ticket, 3);
    expect(verifyBotMatch(ticket, picks)).toMatchObject({ ok: true, winner: state.winner });
  });

  it('passes the pick index, decision number and elapsed time to `check`', () => {
    const ticket = ticketFor('medium', 5);
    const { picks, botIndexes } = playHonest(ticket, 2);
    const seen: BotCheckInfo[] = [];
    let t = 100;
    const result = verifyBotMatch(ticket, picks, {
      check: (info) => {
        seen.push(info);
        return info.botDecision % 2 === 0;
      },
      now: () => (t += 10),
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.botPicksChecked).toBe(Math.ceil(botIndexes.length / 2));
    expect(seen.map((s) => s.pickIndex)).toEqual(botIndexes);
    expect(seen.map((s) => s.botDecision)).toEqual(botIndexes.map((_, i) => i));
    // One clock read at the start and one per bot decision.
    expect(seen.map((s) => s.elapsedMs)).toEqual(botIndexes.map((_, i) => 10 * (i + 1)));
  });
});

describe('verifyBotMatch: rejected reports', () => {
  const ticket = ticketFor('medium', 9);
  const honest = playHonest(ticket, 4);

  it('detects a changed bot pick when the decision is checked', () => {
    for (const at of [honest.botIndexes[0]!, honest.botIndexes.at(-1)!]) {
      const picks = [...honest.picks];
      picks[at] = (picks[at]! + 1) % OFFER_SIZE;
      expect(picks[at]).not.toBe(honest.picks[at]);
      const result = verifyBotMatch(ticket, picks);
      expectFailure(result, 'bot_mismatch');
      if (!result.ok) expect(result.detail).toContain(`pick ${at}:`);
    }
  });

  it('does not report a mismatch for a decision that is not checked', () => {
    const at = honest.botIndexes[0]!;
    const picks = [...honest.picks];
    picks[at] = (picks[at]! + 1) % OFFER_SIZE;
    const result = verifyBotMatch(ticket, picks, { check: (info) => info.pickIndex !== at });
    // The changed pick changes the rest of the match; any later bot pick may mismatch.
    if (!result.ok) expect(['bot_mismatch', 'incomplete', 'leftover']).toContain(result.reason);
    if (!result.ok && result.reason === 'bot_mismatch') {
      expect(result.detail).not.toContain(`pick ${at}:`);
    }
    // Without any check, the human may pick anything for the bot: still a valid replay.
    const unchecked = verifyBotMatch(ticket, honest.picks, { check: () => false });
    expect(unchecked).toMatchObject({ ok: true, botPicksChecked: 0 });
  });

  it('rejects a cut pick list as incomplete', () => {
    expectFailure(verifyBotMatch(ticket, honest.picks.slice(0, -1)), 'incomplete');
    expectFailure(verifyBotMatch(ticket, []), 'incomplete');
  });

  it('rejects appended picks as leftover', () => {
    expectFailure(verifyBotMatch(ticket, [...honest.picks, 0]), 'leftover');
    expectFailure(verifyBotMatch(ticket, [...honest.picks, 2, 2, 2]), 'leftover');
  });

  it('rejects invalid values as bad_picks', () => {
    const bad: unknown[] = [
      null,
      'picks',
      { 0: 1 },
      [1.5],
      [-1],
      [OFFER_SIZE],
      ['1'],
      [Number.NaN],
      [null],
      [...honest.picks.slice(0, 3), 7, ...honest.picks.slice(4)],
      Array.from({ length: MAX_REPORTED_PICKS + 1 }, () => 0),
    ];
    for (const picks of bad) expectFailure(verifyBotMatch(ticket, picks), 'bad_picks');
  });

  it('rejects a long list of valid values as leftover, not as an error', () => {
    const picks = Array.from({ length: MAX_REPORTED_PICKS }, () => 0);
    const result = verifyBotMatch(ticket, picks, { check: () => false });
    expectFailure(result, 'leftover');
  });

  it('rejects unknown profiles, level mismatches and broken tickets as bad_ticket', () => {
    const bad: MatchTicket[] = [
      { ...ticket, botProfile: 'nobody' },
      { ...ticket, botProfile: profileFor('hard') },
      { ...ticket, botLevel: 'easy' },
      { ...ticket, engineVersion: ENGINE_VERSION - 1 },
      { ...ticket, seed: -1 },
      { ...ticket, seed: 0.5 },
      { ...ticket, player: { deck: ['archer', 'knight', 'skeleton'], levels: {} } },
      {
        ...ticket,
        player: { deck: ['archer', 'knight', 'skeleton', 'nope' as never], levels: {} },
      },
      { ...ticket, player: null as unknown as PlayerConfig },
      null as unknown as MatchTicket,
    ];
    for (const t of bad) expectFailure(verifyBotMatch(t, honest.picks), 'bad_ticket');
  });

  it('never throws, also when a callback throws', () => {
    const result = verifyBotMatch(ticket, honest.picks, {
      check: () => {
        throw new Error('boom');
      },
    });
    expectFailure(result, 'bad_picks');
    if (!result.ok) expect(result.detail).toContain('boom');
  });
});

describe('serverCheckPolicy', () => {
  const info = (elapsedMs: number): BotCheckInfo => ({ pickIndex: 0, botDecision: 0, elapsedMs });

  it.each(['easy', 'medium'] as BotLevelId[])('checks every %s decision in one pass', (level) => {
    let draws = 0;
    const now = (): number => 0;
    const policy = serverCheckPolicy(level, () => (draws++, 0), now);
    expect(policy.sample).toBeUndefined();
    expect(policy.now).toBe(now);
    for (const ms of [0, VERIFY_BUDGET_MS, 10 * VERIFY_BUDGET_MS]) {
      expect(policy.check!(info(ms))).toBe(true);
    }
    expect(draws).toBe(0);
  });

  it('samples the hard bot (and unknown levels) after the replay', () => {
    const randInt = (n: number): number => n - 1;
    const now = (): number => 0;
    for (const level of ['hard', 'master'] as BotLevelId[]) {
      const policy = serverCheckPolicy(level, randInt, now);
      expect(policy).toEqual({
        sample: { randInt, budgetMs: VERIFY_BUDGET_MS, maxChecks: HARD_CHECK_MAX },
        now,
      });
    }
  });

  it('keeps sane protection parameters', () => {
    expect(HARD_CHECK_MAX).toBeGreaterThanOrEqual(1);
    expect(VERIFY_BUDGET_MS).toBeGreaterThan(0);
    expect(VERIFY_BUDGET_MS).toBeLessThanOrEqual(500);
  });
});

describe('verifyBotMatch: sampled bot checks', () => {
  // The sample works for every level; the cheap medium bot keeps these tests fast.
  const ticket = ticketFor('medium', 21);
  const honest = playHonest(ticket, 8);
  const n = honest.botIndexes.length;
  const sample = (over: Partial<SampleCheck> = {}): VerifyOptions => ({
    sample: { randInt: () => 0, budgetMs: 1e9, maxChecks: 1e9, ...over },
  });

  it('gives the same result as the full check, with the number of sampled checks', () => {
    const full = verifyBotMatch(ticket, honest.picks);
    expect(full.ok).toBe(true);
    for (const maxChecks of [1, 3, n, n + 5]) {
      expect(verifyBotMatch(ticket, honest.picks, sample({ maxChecks }))).toEqual({
        ...full,
        botPicksChecked: Math.min(maxChecks, n),
      });
    }
    expect(verifyBotMatch(ticket, honest.picks, sample({ maxChecks: 0 }))).toEqual({
      ...full,
      botPicksChecked: 0,
    });
  });

  it('gives every decision, early or late, the same chance', () => {
    // One check; randInt(n) = r draws decision r, so each one is drawn with probability 1/n.
    const found: number[] = [];
    for (let r = 0; r < n; r++) {
      const picks = [...honest.picks];
      const at = honest.botIndexes[r]!;
      picks[at] = (picks[at]! + 1) % OFFER_SIZE;
      const result = verifyBotMatch(ticket, picks, sample({ maxChecks: 1, randInt: () => r }));
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      if (result.reason === 'bot_mismatch') {
        // Exactly the drawn (and changed) decision was checked.
        expect(result.detail).toContain(`pick ${at}:`);
        found.push(r);
      } else {
        // The changed pick changed the length of the match.
        expect(['incomplete', 'leftover']).toContain(result.reason);
      }
    }
    expect(found.length).toBeGreaterThan(n / 2);
    expect(found).toContain(n - 1);
  });

  it('finds a changed late bot pick with enough budget', () => {
    const late = honest.botIndexes.at(-1)!;
    const picks = [...honest.picks];
    picks[late] = (picks[late]! + 1) % OFFER_SIZE;
    // All decisions checked in random order: the change is found wherever it is.
    let seed = 1;
    const randInt = (m: number): number => (seed = (seed * 48271) % 2147483647) % m;
    const result = verifyBotMatch(ticket, picks, sample({ randInt }));
    expectFailure(result, 'bot_mismatch');
    if (!result.ok) expect(result.detail).toContain(`pick ${late}:`);
  });

  it('checks no further decision once the budget is used up, but always one', () => {
    for (const allowed of [0, 1, 2, 4]) {
      // Reads: one at the start, then one before every check after the first.
      let reads = 0;
      const now = (): number => (reads++ <= allowed ? 0 : 1000);
      const result = verifyBotMatch(ticket, honest.picks, {
        ...sample({ budgetMs: 999 }),
        now,
      });
      expect(result).toMatchObject({ ok: true, botPicksChecked: Math.min(n, allowed + 1) });
    }
    // Used up before the replay ended: still exactly one check.
    let t = 0;
    const late = verifyBotMatch(ticket, honest.picks, {
      ...sample({ budgetMs: 10 }),
      now: () => (t += 100),
    });
    expect(late).toMatchObject({ ok: true, botPicksChecked: 1 });
  });

  it('ignores `check` and reports failures of the replay first', () => {
    const counted: number[] = [];
    const opts: VerifyOptions = {
      ...sample({ maxChecks: 2 }),
      check: (i) => (counted.push(i.pickIndex), true),
    };
    expect(verifyBotMatch(ticket, honest.picks, opts)).toMatchObject({ botPicksChecked: 2 });
    expect(counted).toEqual([]);
    expectFailure(verifyBotMatch(ticket, honest.picks.slice(0, -1), opts), 'incomplete');
    expectFailure(verifyBotMatch(ticket, [...honest.picks, 1], opts), 'leftover');
  });

  it('never throws on a broken random source', () => {
    for (const randInt of [() => -1, () => 0.5, (m: number) => m]) {
      expectFailure(verifyBotMatch(ticket, honest.picks, sample({ randInt })), 'bad_picks');
    }
  });

  it('works on copies: the sampled states are those before each decision', () => {
    // Checking every decision through the sample must equal the in-order check.
    const all = verifyBotMatch(ticket, honest.picks, sample());
    expect(all).toMatchObject({ ok: true, botPicksChecked: n });
  });

  it('hard: the server plan keeps the result of the full check and stays in budget', () => {
    const { ticket: hardTicket, played } = hardHonest();
    const full = hardFull();
    // Plenty of time: HARD_CHECK_MAX decisions.
    const plenty = verifyBotMatch(
      hardTicket,
      played.picks,
      serverCheckPolicy(
        'hard',
        (m) => m - 1,
        () => 0,
      ),
    );
    expect(plenty).toEqual({
      ...full,
      botPicksChecked: Math.min(HARD_CHECK_MAX, played.botIndexes.length),
    });
    // Budget gone right after the replay: exactly one check.
    let reads = 0;
    const tight = verifyBotMatch(
      hardTicket,
      played.picks,
      serverCheckPolicy(
        'hard',
        () => 0,
        () => (reads++ === 0 ? 0 : VERIFY_BUDGET_MS + 1),
      ),
    );
    expect(tight).toEqual({ ...full, botPicksChecked: 1 });
    // The last bot pick changed: found when the sample draws it (randInt(n) = n - 1 first).
    const late = played.botIndexes.at(-1)!;
    const picks = [...played.picks];
    picks[late] = (picks[late]! + 1) % OFFER_SIZE;
    const caught = verifyBotMatch(
      hardTicket,
      picks,
      serverCheckPolicy(
        'hard',
        (m) => m - 1,
        () => 0,
      ),
    );
    // Changing the last pick of a round can change the battle and so the rest of the match.
    if (caught.ok || caught.reason !== 'bot_mismatch') {
      expect(caught.ok).toBe(false);
      if (!caught.ok) expect(['incomplete', 'leftover']).toContain(caught.reason);
    } else {
      expect(caught.detail).toContain(`pick ${late}:`);
    }
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Cost measurement (slow, not part of `pnpm test`):
//   VERIFY_COST=1 pnpm --filter @rumble-realms/shared exec vitest run src/match.test.ts -t cost
// ---------------------------------------------------------------------------

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;

/** `console.log` of the test runner (the package compiles without DOM or Node types). */
function log(text: string): void {
  (globalThis as unknown as { console: { log(text: string): void } }).console.log(text);
}

function stats(values: readonly number[]): string {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = sorted.reduce((a, b) => a + b, 0) / Math.max(1, sorted.length);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const max = sorted.at(-1) ?? 0;
  return `n=${sorted.length} mean=${mean.toFixed(1)} median=${median.toFixed(1)} max=${max.toFixed(1)} ms`;
}

describe.skipIf(env?.['VERIFY_COST'] === undefined)('verification cost (slow)', () => {
  const MATCHES = Number(env?.['VERIFY_COST_MATCHES'] ?? 50);

  it.each(LEVELS)(
    'cost of %s',
    (level) => {
      const replayMs: number[] = [];
      const fullMs: number[] = [];
      const policyMs: number[] = [];
      const picksPerMatch: number[] = [];
      const roundsPerMatch: number[] = [];
      const hardByRound = new Map<number, number[]>();
      const checkedPerMatch: number[] = [];
      const cloneMs: number[] = [];
      const cloneKb: number[] = [];
      const clonesKbPerMatch: number[] = [];
      let firstReplay = -1;
      for (let i = 0; i < MATCHES; i++) {
        const player = randomConfig(seedRng(1000 + i, 0)).players[0];
        const ticket: MatchTicket = {
          ...ticketFor(level, 5000 + i, player),
          botProfile: pickBotProfile(level, (n) => i % n).id,
        };
        let matchKb = 0;
        const played = playHonest(ticket, 3000 + i, (state, ms) => {
          const c = clock();
          const copy = cloneMatchState(state);
          cloneMs.push(clock() - c);
          const kb = JSON.stringify(copy).length / 1024;
          cloneKb.push(kb);
          matchKb += kb;
          if (level !== 'hard') return;
          const list = hardByRound.get(state.round) ?? [];
          list.push(ms);
          hardByRound.set(state.round, list);
        });
        clonesKbPerMatch.push(matchKb);
        picksPerMatch.push(played.picks.length);
        roundsPerMatch.push(played.state.rounds.length);

        let t = clock();
        const replay = verifyBotMatch(ticket, played.picks, { check: () => false });
        const ms = clock() - t;
        if (firstReplay < 0) firstReplay = ms;
        replayMs.push(ms);
        expect(replay.ok).toBe(true);

        if (level === 'hard') {
          t = clock();
          const policy = serverCheckPolicy(level, (n) => Math.floor(Math.random() * n), clock);
          const result = verifyBotMatch(ticket, played.picks, policy);
          policyMs.push(clock() - t);
          expect(result.ok).toBe(true);
          if (result.ok) checkedPerMatch.push(result.botPicksChecked);
        } else {
          t = clock();
          expect(verifyBotMatch(ticket, played.picks).ok).toBe(true);
          fullMs.push(clock() - t);
        }
      }
      const lines = [
        `=== ${level}: ${MATCHES} matches, picks ${stats(picksPerMatch).replaceAll(' ms', '')}, rounds ${stats(roundsPerMatch).replaceAll(' ms', '')}`,
        `replay without bot checks: ${stats(replayMs)} (first, cold: ${firstReplay.toFixed(1)} ms)`,
      ];
      if (level === 'hard') {
        lines.push(
          `server policy (hard sample, max ${HARD_CHECK_MAX}, budget ${VERIFY_BUDGET_MS} ms): ${stats(policyMs)}`,
        );
        lines.push(
          `checked hard decisions per match: ${stats(checkedPerMatch).replace(' ms', '')}`,
        );
        for (const [round, list] of [...hardByRound].sort((a, b) => a[0] - b[0])) {
          lines.push(`hard decision, round ${round}: ${stats(list)}`);
        }
        lines.push(`hard decision, all: ${stats([...hardByRound.values()].flat())}`);
      } else {
        lines.push(`full verification (all bot decisions): ${stats(fullMs)}`);
      }
      lines.push(`clone of the state before a bot decision: ${stats(cloneMs)}`);
      lines.push(`clone size (JSON): ${stats(cloneKb).replace(' ms', ' KiB')}`);
      lines.push(`all clones of one match: ${stats(clonesKbPerMatch).replace(' ms', ' KiB')}`);
      log(lines.join('\n'));
    },
    1_800_000,
  );
});
