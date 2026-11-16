import { describe, expect, it } from 'vitest';
import { simulateToEnd } from './battle/sim.ts';
import {
  addGroups,
  armyGroups,
  battleMargin,
  battleValue,
  chooseBotPick,
  clash,
  cloneMatchState,
  estimateShares,
  futureCopies,
  killMs,
  mediumOpponent,
  opponentGroups,
  rollout,
  scaledTo,
  scoreSlot,
  STREAM_BOT,
  type UnitGroup,
} from './bots.ts';
import { BOT_LEVELS, BOT_PROFILES, MEDIUM_HEURISTIC, type BotLevelId } from './data/bots.ts';
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
    round: 1,
    double,
    unitIds: [],
  });
}

/** Replaces the current offer (plain data) for a controlled scenario. */
function setOffer(state: MatchState, slots: OfferSlot[]): void {
  state.draft.offer = { player: getOffer(state).player, slots };
}

/** Value of the own army without a new pick, against the opponent as the bot sees it. */
function baseMargin(state: MatchState, me: PlayerIndex): number {
  return battleValue(armyGroups(state, me, state.activeUpgrades[me]), mediumOpponent(state, me));
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

/** Groups of `cards` (one played card each, level 1, no upgrades) for the battle estimate. */
function groupsOf(cards: CardId[]): UnitGroup[] {
  const out: UnitGroup[] = [];
  for (const card of cards) addGroups(out, card, 1, {}, CARDS[card].count * BPS);
  return out;
}

/** `card` `n` times. */
function times(card: CardId, n: number): CardId[] {
  return Array.from({ length: n }, () => card);
}

/**
 * A fresh match in which the player whose pick is due has already played `own` and the
 * opponent `opp` (round 1, level 1, no upgrades).
 */
function scenario(own: CardId[], opp: CardId[]): MatchState {
  const deck: CardId[] = ['archer', 'knight', 'skeleton', 'healer'];
  const state = createMatch({
    seed: 11,
    players: [
      { deck, levels: {} },
      { deck, levels: {} },
    ],
  });
  const me = getOffer(state).player;
  const opponent: PlayerIndex = me === 0 ? 1 : 0;
  for (const card of own) addArmy(state, me, card);
  for (const card of opp) addArmy(state, opponent, card);
  return state;
}

/** Score of a normal card for the player whose pick is due. */
function spawnScore(state: MatchState, card: CardId): number {
  return scoreSlot(state, { kind: 'spawn', card }, getOffer(state).player);
}

describe('medium heuristic: battle estimate', () => {
  it('counts summons with the reduced hit points and damage of a summon (D-077)', () => {
    const out: UnitGroup[] = [];
    addGroups(out, 'necromancer', 1, {}, BPS);
    expect(out).toHaveLength(2);
    const summon = out[1]!;
    const skeleton = groupsOf(['skeleton'])[0]!;
    const s = CARDS.necromancer.summon!;
    expect(summon.hp).toBe(Math.trunc((skeleton.hp * s.hpBps) / BPS));
    expect(summon.dps).toBe(Math.trunc((skeleton.dps * s.damageBps) / BPS));
    expect(summon.weight).toBe(Math.trunc((s.max * MEDIUM_HEURISTIC.summonUptimeBps * BPS) / BPS));
    // The summons carry the owner's skeleton upgrades (more hit points with "undead" is not
    // modelled, but extra units of the card are not summoned either).
    const withGang: UnitGroup[] = [];
    addGroups(withGang, 'necromancer', 1, { skeleton: 4 }, BPS);
    expect(withGang[1]!.weight).toBe(summon.weight);
  });

  it('only counts attackers that can reach a layer of the defender', () => {
    const knights = groupsOf(times('knight', 3));
    const bats = groupsOf(['bat']);
    const c = clash(knights, bats);
    expect(c.total).toBe(0);
    expect(killMs(c)).toBeGreaterThan(MEDIUM_HEURISTIC.battleSeconds * 1000);
    expect(clash(groupsOf(['archer']), bats).toAir).toBeGreaterThan(0);
  });

  it('lets only the front line of melee units fight, but all shooters', () => {
    const target = groupsOf(times('golem', 4));
    const melee = (n: number) => clash(groupsOf(times('skeleton', n)), target).total;
    const shooters = (n: number) => clash(groupsOf(times('archer', n)), target).total;
    // One card of 5 skeletons fits the front line, 15 or 30 skeletons do not: beyond it the
    // damage stays the same (up to rounding).
    expect(CARDS.skeleton.count).toBeLessThanOrEqual(MEDIUM_HEURISTIC.meleeFrontage);
    expect(3 * CARDS.skeleton.count).toBeGreaterThan(MEDIUM_HEURISTIC.meleeFrontage);
    expect(melee(3)).toBeLessThan(melee(1) * 3);
    expect(Math.abs(melee(6) - melee(3))).toBeLessThanOrEqual(Math.ceil(melee(3) / 100));
    expect(shooters(3)).toBeGreaterThanOrEqual(shooters(1) * 3 - 3);
  });

  it('gives area damage more targets against many units than against few', () => {
    const perDps = (att: CardId, def: CardId[]) => {
      const g = groupsOf([att]);
      return Math.trunc((clash(g, groupsOf(def)).total * BPS) / g[0]!.dps);
    };
    expect(perDps('pyromancer', times('skeleton', 4))).toBeGreaterThan(
      perDps('pyromancer', ['golem']),
    );
    // Single target damage does not care.
    expect(perDps('frost_shaman', times('skeleton', 4))).toBe(perDps('frost_shaman', ['golem']));
  });

  it('gives shooters free fire against slow enemies, not against faster or longer ranged ones', () => {
    const musketeer = groupsOf(['musketeer']);
    const vsGolems = clash(musketeer, groupsOf(['golem']));
    const vsBats = clash(musketeer, groupsOf(['bat']));
    const vsMusketeers = clash(musketeer, groupsOf(['musketeer']));
    expect(vsGolems.burstTotal).toBeGreaterThan(vsBats.burstTotal);
    expect(vsBats.burstTotal).toBeGreaterThan(0);
    expect(vsMusketeers.burstTotal).toBe(0);
    expect(clash(groupsOf(['knight']), groupsOf(['golem'])).burstTotal).toBe(0);
  });

  it('caps the blasts at a share of the enemy hit points', () => {
    const enemy = groupsOf(times('knight', 4));
    const hp = enemy.reduce((sum, g) => sum + Math.trunc((g.hp * g.weight) / BPS), 0);
    const cap = Math.trunc((hp * MEDIUM_HEURISTIC.blastMaxShareBps) / BPS);
    const one = clash(groupsOf(['tnt']), enemy).burstGround;
    const many = clash(groupsOf(times('tnt', 10)), enemy).burstGround;
    expect(one).toBeGreaterThan(0);
    expect(many).toBe(cap);
  });

  it('lets healing cancel only part of the damage, and only with allies to heal', () => {
    const attackers = groupsOf(times('knight', 2));
    const plain = clash(attackers, groupsOf(['golem'])).total;
    const healed = clash(attackers, groupsOf(['golem', ...times('healer', 10)])).total;
    expect(healed).toBeLessThan(plain);
    const maxCancel = Math.trunc((plain * MEDIUM_HEURISTIC.healMaxShareBps) / BPS);
    expect(plain - healed).toBeLessThanOrEqual(maxCancel + 1);
    // Healers alone have nobody to heal.
    const onlyHealers = groupsOf(times('healer', 3));
    const noHealing = onlyHealers.map((g) => ({ ...g, heal: 0 }));
    expect(clash(attackers, onlyHealers).total).toBeGreaterThan(0);
    expect(clash(attackers, onlyHealers).total).toBe(clash(attackers, noHealing).total);
  });

  it('reads area healing from the upgrade data', () => {
    const plain = groupsOf(['healer'])[0]!;
    const circle: UnitGroup[] = [];
    addGroups(circle, 'healer', 1, { healer: 1 }, CARDS.healer.count * BPS);
    expect(plain.healAreaBps).toBe(0);
    expect(circle[0]!.healAreaBps).toBeGreaterThan(0);
    expect(circle[0]!.healRadius).toBeGreaterThan(0);
    // An upgrade with healBps but without a radius (berserker blood frenzy) is no area heal.
    const frenzy: UnitGroup[] = [];
    addGroups(frenzy, 'berserker', 1, { berserker: 4 }, BPS);
    expect(frenzy[0]!.healAreaBps).toBe(0);
  });

  it('assumes unknown cards of the opponent only until it has played a few', () => {
    const hp = (groups: UnitGroup[]) =>
      groups.reduce((sum, g) => sum + Math.trunc((g.hp * g.weight) / BPS), 0);
    const state = scenario([], []);
    const opponent: PlayerIndex = getOffer(state).player === 0 ? 1 : 0;
    const prior = hp(opponentGroups(state, opponent));
    expect(prior).toBeGreaterThan(0);
    addArmy(state, opponent, 'knight');
    const one = hp(opponentGroups(state, opponent));
    const knight = hp(groupsOf(['knight']));
    expect(one - knight).toBeLessThan(prior);
    expect(one - knight).toBeGreaterThan(0);
    for (let i = 0; i < MEDIUM_HEURISTIC.opponentPriorPicks; i++)
      addArmy(state, opponent, 'knight');
    const n = MEDIUM_HEURISTIC.opponentPriorPicks + 1;
    expect(hp(opponentGroups(state, opponent))).toBe(n * knight);
  });

  it('scales the opponent towards the own army without changing its unit numbers', () => {
    const own = groupsOf(times('knight', 4));
    const opp = groupsOf(['archer']);
    const scaled = scaledTo(opp, own);
    expect(scaled[0]!.weight).toBe(opp[0]!.weight);
    expect(scaled[0]!.hp).toBeGreaterThan(opp[0]!.hp);
    expect(scaled[0]!.dps).toBeGreaterThan(opp[0]!.dps);
    expect(scaledTo(opp, [])).toEqual(opp);
  });

  it('battleMargin is positive for the stronger army and antisymmetric', () => {
    const strong = groupsOf(['knight', 'knight', 'archer']);
    const weak = groupsOf(['archer']);
    expect(battleMargin(strong, weak)).toBeGreaterThan(0);
    expect(battleMargin(weak, strong)).toBeLessThan(0);
    expect(battleMargin(strong, weak)).toBe(-battleMargin(weak, strong));
    expect(battleMargin(strong, strong)).toBe(0);
  });

  it('decides the time limit by the hit points left', () => {
    // Neither army can hit the other: the larger sum of hit points is ahead.
    const golems = groupsOf(['golem']);
    const bats = groupsOf(['bat']);
    const golemsOnly = golems.map((g) => ({ ...g, hitsAir: false }));
    const batsGroundless = bats.map((g) => ({ ...g, hitsGround: false }));
    const hpGolem = golems[0]!.hp;
    const hpBats = Math.trunc((bats[0]!.hp * bats[0]!.weight) / BPS);
    expect(battleMargin(golemsOnly, batsGroundless)).toBe(hpGolem - hpBats);
  });
});

describe('medium heuristic: picks', () => {
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

  it('chooses a shooter when the opponent has flyers and the own army no anti-air', () => {
    const state = scenario(['knight', 'skeleton', 'knight'], ['bat', 'bat', 'knight']);
    setOffer(state, [
      { kind: 'spawn', card: 'skeleton' },
      { kind: 'spawn', card: 'knight' },
      { kind: 'spawn', card: 'archer' },
    ]);
    expect(chooseBotPick(state, 'medium', seedRng(1, STREAM_BOT))).toBe(2);
    // Against ground units the same army takes the melee card.
    const ground = scenario(['knight', 'skeleton', 'knight'], ['knight', 'knight', 'skeleton']);
    expect(spawnScore(ground, 'archer') - spawnScore(ground, 'skeleton')).toBeLessThan(
      spawnScore(state, 'archer') - spawnScore(state, 'skeleton'),
    );
  });

  it('values ranged anti-air higher against flyers than against ground units', () => {
    const vsAir = scenario(['knight'], ['bat', 'bat']);
    const vsGround = scenario(['knight'], ['knight', 'knight']);
    const edge = (s: MatchState) => spawnScore(s, 'archer') - spawnScore(s, 'knight');
    expect(edge(vsAir)).toBeGreaterThan(edge(vsGround));
    expect(edge(vsAir)).toBeGreaterThan(0);
  });

  it('prefers area damage against many units', () => {
    const swarm = scenario(['knight'], times('skeleton', 4));
    const tanks = scenario(['knight'], times('golem', 2));
    const edge = (s: MatchState) => spawnScore(s, 'pyromancer') - spawnScore(s, 'frost_shaman');
    expect(edge(swarm)).toBeGreaterThan(edge(tanks));
  });

  it('mixes: a frontline in front of shooters, shooters behind a crowded front', () => {
    const opp: CardId[] = ['knight', 'archer', 'knight', 'archer'];
    const shooters = scenario(times('musketeer', 4), opp);
    const melee = scenario(times('knight', 6), opp);
    const edge = (s: MatchState) => spawnScore(s, 'knight') - spawnScore(s, 'musketeer');
    expect(edge(shooters)).toBeGreaterThan(0);
    expect(edge(melee)).toBeLessThan(0);
  });

  it('adds less for one more melee card once the front line is full', () => {
    const opp: CardId[] = ['golem', 'golem', 'archer'];
    const gain = (own: CardId[]) => {
      const s = scenario(own, opp);
      const me = getOffer(s).player;
      return spawnScore(s, 'skeleton') - baseMargin(s, me);
    };
    expect(gain(times('skeleton', 4))).toBeLessThan(gain(['skeleton']));
  });

  it('rates flyers higher when the enemy army cannot hit the air', () => {
    const noAntiAir = scenario(['knight'], ['knight', 'skeleton']);
    const antiAir = scenario(['knight'], ['archer', 'musketeer']);
    const edge = (s: MatchState) => spawnScore(s, 'bat') - spawnScore(s, 'knight');
    expect(edge(noAntiAir)).toBeGreaterThan(edge(antiAir));
  });

  it('does not rate all slots alike when the deck cannot hit the air (prior opponent)', () => {
    const state = createMatch({
      seed: 4,
      players: [
        { deck: ['knight', 'golem', 'beetle', 'healer'], levels: {} },
        { deck: ['knight', 'golem', 'beetle', 'healer'], levels: {} },
      ],
    });
    const me = getOffer(state).player;
    const scores = (['knight', 'golem', 'beetle', 'healer'] as CardId[]).map((card) =>
      scoreSlot(state, { kind: 'spawn', card }, me),
    );
    expect(new Set(scores).size).toBe(scores.length);
  });

  it('values a double pack above the normal card, but not above twice its gain', () => {
    const state = scenario(times('knight', 4), ['knight', 'archer', 'knight']);
    const me = getOffer(state).player;
    const base = baseMargin(state, me);
    const single = scoreSlot(state, { kind: 'spawn', card: 'knight' }, me) - base;
    const double = scoreSlot(state, { kind: 'double', card: 'knight' }, me) - base;
    expect(single).toBeGreaterThan(0);
    expect(double).toBeGreaterThan(single);
    expect(double).toBeLessThanOrEqual(2 * single + 1);
  });

  it('values an upgrade more with more units of the card and earlier in the match', () => {
    const state = scenario([], ['knight', 'archer', 'skeleton']);
    const me = getOffer(state).player;
    const upgrade: OfferSlot = { kind: 'upgrade', card: 'skeleton', upgrade: 2 };
    const gain = (s: MatchState) => scoreSlot(s, upgrade, me) - baseMargin(s, me);
    const none = gain(state);
    addArmy(state, me, 'skeleton');
    const one = gain(state);
    addArmy(state, me, 'skeleton', true);
    const three = gain(state);
    expect(none).toBeGreaterThan(0);
    expect(one).toBeGreaterThan(none);
    expect(three).toBeGreaterThan(one);
    const late = cloneMatchState(state);
    late.lives = [1, 1];
    expect(gain(late)).toBeLessThan(three);
  });

  it('expects more future copies of a card it plays, and fewer late in the match', () => {
    const state = matchFor(['archer', 'knight', 'skeleton', 'healer']);
    const me = getOffer(state).player;
    const fresh = futureCopies(state, me, 'knight');
    expect(fresh).toBeGreaterThan(0);
    addArmy(state, me, 'knight');
    addArmy(state, me, 'knight');
    addArmy(state, me, 'archer');
    expect(futureCopies(state, me, 'knight')).toBeGreaterThan(futureCopies(state, me, 'healer'));
    const late = cloneMatchState(state);
    late.lives = [1, 2];
    expect(futureCopies(late, me, 'knight')).toBeLessThan(futureCopies(state, me, 'knight'));
  });

  it('values an upgrade of a card it does not play less than one of a card it plays', () => {
    const state = scenario(times('knight', 4), ['knight', 'archer']);
    const shield: OfferSlot = { kind: 'upgrade', card: 'knight', upgrade: 0 };
    const fire: OfferSlot = { kind: 'upgrade', card: 'archer', upgrade: 0 };
    const me = getOffer(state).player;
    expect(scoreSlot(state, shield, me)).toBeGreaterThan(scoreSlot(state, fire, me));
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

  it('estimateShares gives the medium estimate of every slot as a share of the hit points', () => {
    const state = lateState();
    const offer = getOffer(state);
    const before = hashState(state);
    const shares = estimateShares(state, offer);
    expect(shares).toHaveLength(offer.slots.length);
    const values = offer.slots.map((slot) => scoreSlot(state, slot, offer.player));
    for (let a = 0; a < shares.length; a++) {
      expect(Number.isInteger(shares[a])).toBe(true);
      // A lead cannot be larger than a few times the hit points on the field.
      expect(Math.abs(shares[a]!)).toBeLessThan(5000);
      // The shares keep the order of the medium bot's values.
      for (let b = 0; b < shares.length; b++) {
        if (values[a]! >= values[b]!) expect(shares[a]!).toBeGreaterThanOrEqual(shares[b]!);
      }
    }
    expect(hashState(state)).toBe(before);
  });

  it('hard counts the medium estimate with a weight from the bot data', () => {
    expect(BOT_LEVELS.hard.estimateWeight).toBeGreaterThan(0);
    expect(BOT_LEVELS.easy.estimateWeight).toBe(0);
    expect(BOT_LEVELS.medium.estimateWeight).toBe(0);
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
 * Strength test (SPEC 8.1): same deck, card level 2 and unlocked upgrades on both sides,
 * sides alternate, so only the pick strategy counts. Takes a few minutes (hard rollouts),
 * so it only runs with BOT_STRENGTH=1:
 *   BOT_STRENGTH=1 pnpm --filter @rumble-realms/engine exec vitest run src/bots.test.ts
 */
function winShare(
  strong: BotLevelId,
  weak: BotLevelId,
  deck: CardId[],
  matches: number,
  upgradeMask = 0,
): number {
  const levels: Partial<Record<CardId, number>> = {};
  const upgrades: Partial<Record<CardId, number>> = {};
  for (const card of deck) {
    levels[card] = 2;
    upgrades[card] = upgradeMask;
  }
  let score = 0;
  for (let i = 0; i < matches; i++) {
    const strongSide: PlayerIndex = i % 2 === 0 ? 0 : 1;
    const who: BotLevelId[] = strongSide === 0 ? [strong, weak] : [weak, strong];
    const rngs = [seedRng(1000 + i, STREAM_BOT), seedRng(2000 + i, STREAM_BOT)];
    const end = playMatch(
      {
        seed: 500 + i,
        players: [
          { deck, levels, upgrades },
          { deck, levels, upgrades },
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
  const testDeck: CardId[] = ['necromancer', 'skeleton', 'bat', 'berserker'];
  /** Test deck, start deck and decks of shooters, tanks, rushers and flyers. */
  const decks: CardId[][] = [
    testDeck,
    ['archer', 'knight', 'skeleton', 'healer'],
    ['archer', 'musketeer', 'pyromancer', 'frost_shaman'],
    ['knight', 'golem', 'beetle', 'healer'],
    ['tnt', 'berserker', 'assassin', 'skeleton'],
    ['bat', 'whelp', 'archer', 'healer'],
  ];

  /** Medium against easy on every deck: at least 60 % on average and 55 % per deck. */
  function expectMediumBeatsEasy(matches: number, upgradeMask: number): void {
    const shares = decks.map((deck) => winShare('medium', 'easy', deck, matches, upgradeMask));
    const mean = shares.reduce((a, b) => a + b, 0) / shares.length;
    expect(mean, `shares ${shares.join(' ')}`).toBeGreaterThan(0.6);
    for (const [i, share] of shares.entries()) {
      expect(share, `deck ${decks[i]!.join(', ')}`).toBeGreaterThan(0.55);
    }
  }

  it('medium beats easy clearly with every deck (60 matches each)', () => {
    expectMediumBeatsEasy(60, 0);
  }, 300_000);

  it('medium beats easy clearly with upgrade 1 unlocked (40 matches each)', () => {
    expectMediumBeatsEasy(40, 1);
  }, 300_000);

  it('hard beats medium with the test deck and the start deck (40 matches each)', () => {
    const shares = [testDeck, decks[1]!].map((deck) => winShare('hard', 'medium', deck, 40));
    const mean = shares.reduce((a, b) => a + b, 0) / shares.length;
    expect(mean, `shares ${shares.join(' ')}`).toBeGreaterThan(0.6);
    for (const share of shares) expect(share).toBeGreaterThan(0.55);
  }, 900_000);
});
