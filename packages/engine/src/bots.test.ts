import { describe, expect, it } from 'vitest';
import { simulateToEnd } from './battle/sim.ts';
import {
  chooseBotPick,
  cloneMatchState,
  counterFactor,
  profileOf,
  rollout,
  scoreSlot,
  STREAM_BOT,
} from './bots.ts';
import { BOT_LEVELS, BOT_PROFILES, type BotLevelId } from './data/bots.ts';
import { BPS, DECK_SIZE, OFFER_SIZE } from './data/balance.ts';
import { CARDS } from './data/cards.ts';
import { hashState } from './hash.ts';
import { applyPick, createMatch, endRound, getOffer, startBattle } from './match.ts';
import { playMatch } from './play.ts';
import { seedRng } from './rng.ts';
import type { CardId, MatchState, OfferSlot, PlayerIndex } from './types.ts';

const LEVELS: BotLevelId[] = ['easy', 'medium', 'hard'];

function matchFor(deck: (typeof BOT_PROFILES)[number]['deck'], seed = 7): MatchState {
  return createMatch({
    seed,
    players: [
      { deck: ['archer', 'knight', 'skeleton', 'healer'], levels: {} },
      { deck, levels: {} },
    ],
  });
}

/** Adds a played card to the army directly (the heuristic only reads `army`). */
function addArmy(state: MatchState, player: PlayerIndex, card: CardId, double = false): void {
  state.army.push({
    player,
    card,
    level: 1,
    column: 0,
    round: 1,
    double,
    unitIds: [],
  });
}

/** Replaces the current offer (plain data) for a controlled scenario. */
function setOffer(state: MatchState, slots: OfferSlot[]): void {
  state.draft.offer = { player: getOffer(state).player, slots };
}

/** A state in round 3 or later with a sizeable army on both sides. */
function lateState(seed = 21): MatchState {
  const deck: CardId[] = ['golem', 'beetle', 'healer', 'musketeer'];
  const state = createMatch({
    seed,
    players: [
      { deck, levels: {} },
      { deck: ['skeleton', 'bat', 'archer', 'shroomling'], levels: {} },
    ],
  });
  while (state.round < 3 && state.phase !== 'finished') {
    if (state.phase === 'draft') applyPick(state, 0);
    else {
      simulateToEnd(startBattle(state));
      endRound(state);
    }
  }
  if (state.phase !== 'draft') throw new Error('lateState: match ended too early');
  return state;
}

describe('bot data', () => {
  it('has the levels of SPEC 8.1', () => {
    expect(BOT_LEVELS.easy).toMatchObject({ elo: 800, cardLevel: 1, simulations: 0 });
    expect(BOT_LEVELS.medium).toMatchObject({ elo: 1000, cardLevel: 2, maxArena: 2 });
    expect(BOT_LEVELS.hard).toMatchObject({ elo: 1250, cardLevel: 3, maxArena: 3 });
    expect(BOT_LEVELS.hard.simulations).toBeGreaterThanOrEqual(1);
  });

  it('has at least three profiles per level with unique ids and names', () => {
    expect(new Set(BOT_PROFILES.map((p) => p.id)).size).toBe(BOT_PROFILES.length);
    expect(new Set(BOT_PROFILES.map((p) => p.name)).size).toBe(BOT_PROFILES.length);
    for (const level of LEVELS) {
      expect(BOT_PROFILES.filter((p) => p.level === level).length).toBeGreaterThanOrEqual(3);
    }
  });

  it('has valid decks from the pools up to the arena of the level', () => {
    for (const p of BOT_PROFILES) {
      expect(p.deck).toHaveLength(DECK_SIZE);
      expect(new Set(p.deck).size).toBe(DECK_SIZE);
      for (const card of p.deck) {
        expect(CARDS[card].arena).toBeLessThanOrEqual(BOT_LEVELS[p.level].maxArena);
      }
      expect(() => matchFor(p.deck)).not.toThrow();
    }
  });

  it('keeps the easy decks in arena 1', () => {
    for (const p of BOT_PROFILES.filter((b) => b.level === 'easy')) {
      for (const card of p.deck) expect(CARDS[card].arena).toBe(1);
    }
  });
});

describe('chooseBotPick (all levels)', () => {
  it.each(LEVELS)('%s always returns a valid slot', (level) => {
    const state = matchFor(BOT_PROFILES[0]!.deck);
    const rng = seedRng(1, STREAM_BOT);
    const calls = level === 'hard' ? 5 : 200;
    for (let i = 0; i < calls; i++) {
      const slot = chooseBotPick(state, level, rng);
      expect(Number.isInteger(slot)).toBe(true);
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(slot).toBeLessThan(getOffer(state).slots.length);
    }
  });

  it.each(LEVELS)('%s is deterministic for the same state and RNG state', (level) => {
    const state = lateState();
    const a = seedRng(99, STREAM_BOT);
    const b = seedRng(99, STREAM_BOT);
    const n = level === 'hard' ? 3 : 50;
    const picksA = Array.from({ length: n }, () => chooseBotPick(state, level, a));
    const picksB = Array.from({ length: n }, () => chooseBotPick(state, level, b));
    expect(picksA).toEqual(picksB);
    expect(a).toEqual(b);
  });

  it.each(LEVELS)('%s does not touch the match state or its streams', (level) => {
    const state = lateState();
    const before = hashState(state);
    const json = JSON.stringify(state);
    chooseBotPick(state, level, seedRng(1, STREAM_BOT));
    expect(hashState(state)).toBe(before);
    expect(JSON.stringify(state)).toBe(json);
  });

  it.each(LEVELS)('%s throws outside the draft', (level) => {
    const state = matchFor(BOT_PROFILES[0]!.deck);
    while (state.phase === 'draft') applyPick(state, 0);
    expect(() => chooseBotPick(state, level, seedRng(1, STREAM_BOT))).toThrow();
  });

  it('easy uses every slot over many calls', () => {
    const state = matchFor(BOT_PROFILES[2]!.deck);
    const rng = seedRng(3, STREAM_BOT);
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) seen.add(chooseBotPick(state, 'easy', rng));
    expect([...seen].sort()).toEqual(Array.from({ length: OFFER_SIZE }, (_, i) => i));
  });

  it('throws for an unknown level', () => {
    const state = matchFor(BOT_PROFILES[0]!.deck);
    expect(() => chooseBotPick(state, 'nope' as never, seedRng(1, STREAM_BOT))).toThrow();
  });

  it('plays whole matches with every level without errors', () => {
    const deck: CardId[] = ['knight', 'bat', 'archer', 'pyromancer'];
    const levels: BotLevelId[] = ['medium', 'easy'];
    const rngs = [seedRng(1, STREAM_BOT), seedRng(2, STREAM_BOT)];
    const end = playMatch(
      {
        seed: 3,
        players: [
          { deck, levels: {} },
          { deck, levels: {} },
        ],
      },
      (s) => {
        const p = getOffer(s).player;
        return chooseBotPick(s, levels[p]!, rngs[p]!);
      },
    );
    expect(end.phase).toBe('finished');
  });
});

describe('medium heuristic', () => {
  it('avoids cards that cannot hit the enemy flyers', () => {
    const state = matchFor(['bat', 'knight', 'archer', 'skeleton']);
    const opponent: PlayerIndex = getOffer(state).player === 0 ? 1 : 0;
    for (let i = 0; i < 4; i++) addArmy(state, opponent, 'bat', true);
    setOffer(state, [
      { kind: 'spawn', card: 'knight' },
      { kind: 'spawn', card: 'archer' },
      { kind: 'spawn', card: 'skeleton' },
    ]);
    expect(chooseBotPick(state, 'medium', seedRng(1, STREAM_BOT))).toBe(1);
  });

  it('values ranged anti-air higher against flyers than against ground units', () => {
    const state = matchFor(['bat', 'knight', 'archer', 'skeleton']);
    const me = getOffer(state).player;
    const opponent: PlayerIndex = me === 0 ? 1 : 0;
    const own = profileOf(state, me);
    const vsAir = cloneMatchState(state);
    addArmy(vsAir, opponent, 'bat');
    const vsGround = cloneMatchState(state);
    addArmy(vsGround, opponent, 'knight');
    const air = counterFactor('archer', profileOf(vsAir, opponent), own);
    const ground = counterFactor('archer', profileOf(vsGround, opponent), own);
    expect(air).toBeGreaterThan(ground);
    expect(counterFactor('knight', profileOf(vsAir, opponent), own)).toBeLessThan(BPS);
  });

  it('prefers area damage against swarms', () => {
    const state = matchFor(['skeleton', 'knight', 'pyromancer', 'musketeer']);
    const me = getOffer(state).player;
    const opponent: PlayerIndex = me === 0 ? 1 : 0;
    const own = profileOf(state, me);
    const swarm = cloneMatchState(state);
    for (let i = 0; i < 3; i++) addArmy(swarm, opponent, 'skeleton');
    const tanks = cloneMatchState(state);
    for (let i = 0; i < 3; i++) addArmy(tanks, opponent, 'golem');
    expect(counterFactor('pyromancer', profileOf(swarm, opponent), own)).toBeGreaterThan(
      counterFactor('pyromancer', profileOf(tanks, opponent), own),
    );
  });

  it('puts a frontline in front of an army of shooters and shooters behind tanks', () => {
    const state = matchFor(['archer', 'knight', 'musketeer', 'golem']);
    const me = getOffer(state).player;
    const opponent: PlayerIndex = me === 0 ? 1 : 0;
    addArmy(state, opponent, 'knight');
    const opp = profileOf(state, opponent);
    const shooters = cloneMatchState(state);
    for (let i = 0; i < 3; i++) addArmy(shooters, me, 'musketeer');
    const tanks = cloneMatchState(state);
    for (let i = 0; i < 3; i++) addArmy(tanks, me, 'golem');
    const ownShooters = profileOf(shooters, me);
    const ownTanks = profileOf(tanks, me);
    expect(counterFactor('golem', opp, ownShooters)).toBeGreaterThan(
      counterFactor('golem', opp, ownTanks),
    );
    expect(counterFactor('musketeer', opp, ownTanks)).toBeGreaterThan(
      counterFactor('musketeer', opp, ownShooters),
    );
  });

  it('rates flyers highly when the enemy army cannot hit the air', () => {
    const state = matchFor(['bat', 'knight', 'archer', 'skeleton']);
    const me = getOffer(state).player;
    const opponent: PlayerIndex = me === 0 ? 1 : 0;
    const own = profileOf(state, me);
    const noAntiAir = cloneMatchState(state);
    addArmy(noAntiAir, opponent, 'knight');
    addArmy(noAntiAir, opponent, 'skeleton');
    const antiAir = cloneMatchState(state);
    addArmy(antiAir, opponent, 'archer');
    addArmy(antiAir, opponent, 'musketeer');
    expect(counterFactor('bat', profileOf(noAntiAir, opponent), own)).toBeGreaterThan(
      counterFactor('bat', profileOf(antiAir, opponent), own),
    );
  });

  it('values a double pack at twice the normal card', () => {
    const state = matchFor(['archer', 'knight', 'skeleton', 'healer']);
    const me = getOffer(state).player;
    const single = scoreSlot(state, { kind: 'spawn', card: 'knight' }, me);
    const double = scoreSlot(state, { kind: 'double', card: 'knight' }, me);
    // Integer rounding of the factor may add one point.
    expect(Math.abs(double - single * 2)).toBeLessThanOrEqual(1);
  });

  it('values an upgrade more with more units of the card and earlier in the match', () => {
    const state = matchFor(['archer', 'knight', 'skeleton', 'healer']);
    const me = getOffer(state).player;
    const upgrade: OfferSlot = { kind: 'upgrade', card: 'skeleton', upgrade: 2 };
    const none = scoreSlot(state, upgrade, me);
    addArmy(state, me, 'skeleton');
    const one = scoreSlot(state, upgrade, me);
    addArmy(state, me, 'skeleton', true);
    const three = scoreSlot(state, upgrade, me);
    expect(one).toBeGreaterThan(none);
    expect(three).toBeGreaterThan(one);
    const late = cloneMatchState(state);
    late.lives = [1, 1];
    expect(scoreSlot(late, upgrade, me)).toBeLessThan(three);
  });

  it('breaks ties with the bot stream', () => {
    const state = matchFor(['archer', 'knight', 'skeleton', 'healer']);
    setOffer(state, [
      { kind: 'spawn', card: 'knight' },
      { kind: 'spawn', card: 'knight' },
      { kind: 'spawn', card: 'knight' },
    ]);
    const rng = seedRng(5, STREAM_BOT);
    const seen = new Set<number>();
    for (let i = 0; i < 60; i++) seen.add(chooseBotPick(state, 'medium', rng));
    expect(seen.size).toBe(3);
  });
});

describe('hard (Monte Carlo)', () => {
  it('rollout works on a copy and returns a bounded score', () => {
    const state = lateState();
    const before = hashState(state);
    for (let slot = 0; slot < OFFER_SIZE; slot++) {
      const score = rollout(state, slot, 1234);
      expect(score).toBeGreaterThanOrEqual(-1000);
      expect(score).toBeLessThanOrEqual(3000);
      expect(rollout(state, slot, 1234)).toBe(score);
    }
    expect(hashState(state)).toBe(before);
  });

  it('cloneMatchState shares nothing with the original', () => {
    const state = lateState();
    const copy = cloneMatchState(state);
    expect(copy).toEqual(state);
    copy.rng.offers[0] = (copy.rng.offers[0] + 1) >>> 0;
    copy.army.pop();
    expect(copy).not.toEqual(state);
    expect(hashState(state)).toBe(hashState(lateState()));
  });

  it('returns a valid slot in a late round with large armies', () => {
    const state = lateState(5);
    const offer = getOffer(state);
    const slot = chooseBotPick(state, 'hard', seedRng(8, STREAM_BOT));
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(slot).toBeLessThan(offer.slots.length);
  });
});

/**
 * Strength test (SPEC 8.1): same deck and card level on both sides, sides alternate.
 * Takes about a minute (hard rollouts), so it only runs with BOT_STRENGTH=1:
 *   BOT_STRENGTH=1 pnpm vitest run src/bots.test.ts
 */
function winShare(strong: BotLevelId, weak: BotLevelId, deck: CardId[], matches: number): number {
  const levels: Partial<Record<CardId, number>> = {};
  for (const card of deck) levels[card] = 2;
  let score = 0;
  for (let i = 0; i < matches; i++) {
    const strongSide: PlayerIndex = i % 2 === 0 ? 0 : 1;
    const who: BotLevelId[] = strongSide === 0 ? [strong, weak] : [weak, strong];
    const rngs = [seedRng(1000 + i, STREAM_BOT), seedRng(2000 + i, STREAM_BOT)];
    const end = playMatch(
      {
        seed: 500 + i,
        players: [
          { deck, levels },
          { deck, levels },
        ],
      },
      (s) => {
        const p = getOffer(s).player;
        return chooseBotPick(s, who[p]!, rngs[p]!);
      },
    );
    score += end.winner === 'draw' ? 1 : end.winner === strongSide ? 2 : 0;
  }
  return score / (2 * matches);
}

describe.skipIf(process.env['BOT_STRENGTH'] === undefined)('bot strength (slow)', () => {
  const deck: CardId[] = ['necromancer', 'skeleton', 'bat', 'berserker'];

  it('medium beats easy in clearly more than half of 40 matches', () => {
    expect(winShare('medium', 'easy', deck, 40)).toBeGreaterThan(0.6);
  });

  it('hard beats medium in clearly more than half of 40 matches', () => {
    expect(winShare('hard', 'medium', deck, 40)).toBeGreaterThan(0.6);
  }, 600_000);
});
