/**
 * Special cards and upgrades (SPEC 4.3, 4.5, 5.4): offers, double packs, upgrade cards and
 * the seven upgrades implemented in M3b-1.
 */
import { describe, expect, it } from 'vitest';
import { simulateToEnd } from './battle/sim.ts';
import { createBattle } from './battle/state.ts';
import { attackTicks, dummy, eventsOf, field, put, run } from './battle/testing.ts';
import { applyStun } from './battle/status.ts';
import { chooseBotPick, STREAM_BOT } from './bots.ts';
import { DECK_SIZE, OFFER_SIZE } from './data/balance.ts';
import { CARDS } from './data/cards.ts';
import { UPGRADES } from './data/upgrades.ts';
import { applyPick, createMatch, currentPlayer, endRound, getOffer, startBattle } from './match.ts';
import { nextInt, seedRng, shuffle, STREAM_OFFERS } from './rng.ts';
import type {
  BattleResult,
  CardId,
  MatchConfig,
  MatchState,
  OfferSlot,
  PlayerConfig,
  Winner,
} from './types.ts';
import { selectableUpgrades, unitCount, unitStats } from './upgrades.ts';

const ALL: Partial<Record<CardId, number>> = {};
for (const card of Object.keys(CARDS) as CardId[]) ALL[card] = 7;

function player(deck: CardId[], upgrades?: Partial<Record<CardId, number>>): PlayerConfig {
  return upgrades === undefined ? { deck, levels: {} } : { deck, levels: {}, upgrades };
}

const UPGRADE_DECK: CardId[] = ['skeleton', 'bat', 'tnt', 'golem'];

function config(seed: number, up0?: typeof ALL, up1?: typeof ALL): MatchConfig {
  return { seed, players: [player(UPGRADE_DECK, up0), player(UPGRADE_DECK, up1)] };
}

/** Replaces the current offer (test set-up: lets applyPick play a chosen slot). */
function forceOffer(s: MatchState, slots: OfferSlot[]): void {
  s.draft.offer = { player: currentPlayer(s), slots };
}

function finishBattle(s: MatchState, winner: Winner): void {
  const result: BattleResult = { winner, reason: 'elimination', ticks: 1, hp: [0, 0] };
  s.battle.result = result;
}

/** Units of `card` of `owner` on the field. */
function unitsOf(s: MatchState, owner: 0 | 1, card: CardId) {
  return s.battle.units.filter((u) => u.owner === owner && u.card === card);
}

/** Lets the opponent pick slot 0 (a normal card) until `owner` is due again. */
function passTo(s: MatchState, owner: 0 | 1): void {
  while (s.phase === 'draft' && currentPlayer(s) !== owner) {
    forceOffer(s, [{ kind: 'spawn', card: 'golem' }]);
    applyPick(s, 0);
  }
}

describe('createMatch validates unlocked upgrades', () => {
  it.each<[string, unknown, RegExp]>([
    ['an array', [], /upgrades must be an object/],
    ['null', null, /upgrades must be an object/],
    ['an unknown card', { dragon: 1 }, /unknown card dragon/],
    ['mask 8', { knight: 8 }, /bit mask 0..7/],
    ['mask -1', { knight: -1 }, /bit mask 0..7/],
    ['a fraction', { knight: 1.5 }, /bit mask 0..7/],
  ])('rejects %s', (_name, upgrades, message) => {
    const cfg = config(1);
    (cfg.players[0] as unknown as { upgrades: unknown }).upgrades = upgrades;
    expect(() => createMatch(cfg)).toThrow(message);
  });

  it('accepts missing upgrades and copies them', () => {
    expect(createMatch(config(1)).config.players[0]).toEqual(player(UPGRADE_DECK));
    const cfg = config(1, { skeleton: 4, archer: 7 });
    const s = createMatch(cfg);
    (cfg.players[0].upgrades as Record<string, number>).skeleton = 0;
    expect(s.config.players[0].upgrades).toEqual({ skeleton: 4, archer: 7 });
    expect(s.activeUpgrades).toEqual([{}, {}]);
  });
});

describe('offers with special cards (SPEC 4.3)', () => {
  it('turns slots into double packs (12 %) and upgrade cards (20 %), at most one per offer', () => {
    const n = 3000;
    const firstSlot = { spawn: 0, double: 0, upgrade: 0 };
    let withSpecial = 0;
    for (let seed = 0; seed < n; seed++) {
      const offer = getOffer(createMatch(config(seed, ALL, ALL)));
      expect(offer.slots).toHaveLength(OFFER_SIZE);
      const specials = offer.slots.filter((x) => x.kind !== 'spawn').length;
      expect(specials).toBeLessThanOrEqual(1);
      if (specials > 0) withSpecial++;
      firstSlot[(offer.slots[0] as OfferSlot).kind]++;
    }
    // The first slot is never limited by an earlier special card.
    expect(firstSlot.double / n).toBeGreaterThan(0.1);
    expect(firstSlot.double / n).toBeLessThan(0.14);
    expect(firstSlot.upgrade / n).toBeGreaterThan(0.175);
    expect(firstSlot.upgrade / n).toBeLessThan(0.225);
    // 1 - 0.68^3 = 68.6 % of the offers contain a special card.
    expect(withSpecial / n).toBeGreaterThan(0.65);
    expect(withSpecial / n).toBeLessThan(0.72);
  });

  it('chooses every selectable upgrade about equally often', () => {
    const seen = new Map<string, number>();
    for (let seed = 0; seed < 3000; seed++) {
      for (const slot of getOffer(createMatch(config(seed, ALL, ALL))).slots) {
        if (slot.kind === 'upgrade' && slot.card === 'tnt') {
          const key = UPGRADES.tnt[slot.upgrade].id;
          seen.set(key, (seen.get(key) ?? 0) + 1);
        }
      }
    }
    // All three tnt upgrades are implemented.
    expect([...seen.keys()].sort()).toEqual([
      'tnt.armored_crate',
      'tnt.daughter_tnt',
      'tnt.short_fuse',
    ]);
    const counts = [...seen.values()];
    const lo = Math.min(...counts);
    const hi = Math.max(...counts);
    expect((hi - lo) / (hi + lo)).toBeLessThan(0.15);
  });

  it('uses exactly DECK_SIZE - 1 + 2 * OFFER_SIZE draws per offer, whatever the result', () => {
    for (let seed = 0; seed < 30; seed++) {
      const expected = seedRng(seed, STREAM_OFFERS);
      shuffle(expected, [...UPGRADE_DECK]);
      for (let i = 0; i < 2 * OFFER_SIZE; i++) nextInt(expected, 2);
      // nextInt may redraw internally, so compare with the same calls (n = 10000, 6).
      const ref = seedRng(seed, STREAM_OFFERS);
      shuffle(ref, [...UPGRADE_DECK]);
      for (let i = 0; i < OFFER_SIZE; i++) {
        nextInt(ref, 10000);
        nextInt(ref, 6);
      }
      expect(createMatch(config(seed)).rng.offers).toEqual(ref);
      expect(createMatch(config(seed, ALL, ALL)).rng.offers).toEqual(ref);
    }
    expect(DECK_SIZE - 1 + 2 * OFFER_SIZE).toBe(9);
  });

  it('keeps the offer stream in step with and without unlocked upgrades', () => {
    for (let seed = 0; seed < 10; seed++) {
      const plain = createMatch(config(seed));
      const upgraded = createMatch(config(seed, ALL, ALL));
      for (let round = 0; round < 3; round++) {
        while (plain.phase === 'draft') {
          expect(upgraded.rng.offers).toEqual(plain.rng.offers);
          const a = getOffer(plain).slots;
          const b = getOffer(upgraded).slots;
          expect(b.map((x) => x.card)).toEqual(a.map((x) => x.card));
          // Double packs come from the same rolls; upgrades only replace normal cards.
          // (unless an upgrade card earlier in the offer used up the special slot).
          a.forEach((x, i) => {
            const earlier = b.slice(0, i).some((y) => y.kind !== 'spawn');
            if (x.kind === 'double' && !earlier) expect(b[i]?.kind).toBe('double');
          });
          applyPick(plain, 0);
          applyPick(upgraded, 0);
        }
        finishBattle(plain, 0);
        finishBattle(upgraded, 0);
        endRound(plain);
        endRound(upgraded);
      }
    }
  });

  it('offers only unlocked, inactive and implemented upgrades', () => {
    const deck: CardId[] = ['archer', 'skeleton', 'whelp', 'bat'];
    // Only skeleton: rattle gang is unlocked (all 48 upgrades are implemented now).
    const unlocked = { skeleton: 0b100 };
    let offered = 0;
    for (let seed = 0; seed < 40; seed++) {
      const s = createMatch({
        seed,
        players: [player(deck, unlocked), player(deck, unlocked)],
      });
      for (let round = 0; round < 4 && s.phase === 'draft'; round++) {
        while (s.phase === 'draft') {
          const p = currentPlayer(s);
          const slots = getOffer(s).slots;
          for (const slot of slots) {
            if (slot.kind !== 'upgrade') continue;
            offered++;
            expect([slot.card, slot.upgrade]).toEqual(['skeleton', 2]);
            expect((s.activeUpgrades[p].skeleton ?? 0) & 4).toBe(0);
          }
          const pick = slots.findIndex((x) => x.kind === 'upgrade');
          applyPick(s, pick < 0 ? 0 : pick);
        }
        finishBattle(s, round % 2 === 0 ? 0 : 1);
        endRound(s);
      }
    }
    expect(offered).toBeGreaterThan(20);
    expect(selectableUpgrades('skeleton', 4, 4)).toEqual([]);
    expect(selectableUpgrades('tnt', 7, 2)).toEqual([0, 2]);
    expect(selectableUpgrades('archer', 7, 0)).toEqual([0, 1, 2]);
    expect(selectableUpgrades('whelp', 7, 0)).toEqual([0, 1, 2]);
  });

  it('do not depend on the field', () => {
    const a = createMatch(config(9, ALL, ALL));
    const b = createMatch(config(9, ALL, ALL));
    for (let i = 0; i < 30; i++) {
      b.army.push({
        player: 0,
        card: 'knight',
        level: 1,
        column: i % 12,
        round: 1,
        double: false,
        unitIds: [5000 + 2 * i, 5001 + 2 * i],
      });
    }
    b.nextUnitId = 6000;
    b.rng.placement = seedRng(4711, 3);
    while (a.phase === 'draft') {
      expect(getOffer(b)).toEqual(getOffer(a));
      applyPick(a, 2);
      applyPick(b, 2);
    }
  });
});

describe('double pack (SPEC 4.5, D-046)', () => {
  it('spawns twice the units, also in every later round', () => {
    const s = createMatch(config(3));
    const p = currentPlayer(s);
    forceOffer(s, [{ kind: 'double', card: 'skeleton' }]);
    applyPick(s, 0);
    const entry = s.army[0]!;
    expect(entry.double).toBe(true);
    expect(entry.unitIds).toHaveLength(10);
    expect(s.lastPick).toMatchObject({ kind: 'double', card: 'skeleton', forfeited: 0 });
    expect(s.lastPick?.spawned).toEqual(entry.unitIds);
    expect(unitsOf(s, p, 'skeleton')).toHaveLength(10);
    while (s.phase === 'draft') applyPick(s, 0);
    finishBattle(s, p);
    endRound(s);
    expect(unitsOf(s, p, 'skeleton').length).toBeGreaterThanOrEqual(10);
    expect(unitsOf(s, p, 'skeleton').filter((u) => entry.unitIds.includes(u.id))).toHaveLength(10);
    expect(s.army[0]?.unitIds).toEqual(entry.unitIds);
  });

  it('can be picked from a real offer', () => {
    let seed = 0;
    let slot = -1;
    let s = createMatch(config(seed));
    while (slot < 0) {
      s = createMatch(config(seed++));
      slot = getOffer(s).slots.findIndex((x) => x.kind === 'double');
    }
    const card = getOffer(s).slots[slot]!.card;
    applyPick(s, slot);
    expect(s.lastPick?.spawned).toHaveLength(2 * CARDS[card].count);
  });
});

describe('upgrade cards (SPEC 4.5)', () => {
  it('activate the upgrade for standing and later units of the player, in later rounds too', () => {
    const s = createMatch(config(5));
    const p = currentPlayer(s);
    const q = p === 0 ? 1 : 0;
    forceOffer(s, [{ kind: 'spawn', card: 'skeleton' }]);
    applyPick(s, 0);
    forceOffer(s, [{ kind: 'spawn', card: 'skeleton' }]); // the opponent's skeletons
    applyPick(s, 0);
    expect(unitsOf(s, p, 'skeleton')).toHaveLength(5);
    const placement = [...s.rng.placement];
    const nextId = s.nextUnitId;
    forceOffer(s, [{ kind: 'upgrade', card: 'skeleton', upgrade: 2 }]); // Rasselbande
    applyPick(s, 0);
    // No placement draw and no new army entry; the standing card grows to 7 units.
    expect(s.rng.placement).toEqual(placement);
    expect(s.army).toHaveLength(2);
    expect(s.activeUpgrades[p]).toEqual({ skeleton: 4 });
    expect(s.activeUpgrades[q]).toEqual({});
    expect(s.lastPick).toEqual({
      player: p,
      slot: 0,
      kind: 'upgrade',
      card: 'skeleton',
      upgrade: 2,
      spawned: [nextId, nextId + 1],
      forfeited: 0,
    });
    expect(s.army[0]?.unitIds).toHaveLength(7);
    expect(unitsOf(s, p, 'skeleton')).toHaveLength(7);
    expect(unitsOf(s, q, 'skeleton')).toHaveLength(5);
    for (const u of unitsOf(s, p, 'skeleton')) expect(u.up).toBe(4);
    // Later cards of the player get it as well, also as double pack (2 x 7).
    passTo(s, p);
    forceOffer(s, [{ kind: 'double', card: 'skeleton' }]);
    applyPick(s, 0);
    expect(unitsOf(s, p, 'skeleton')).toHaveLength(7 + 14);
    while (s.phase === 'draft') applyPick(s, 0);
    finishBattle(s, q);
    endRound(s);
    expect(s.activeUpgrades[p]).toEqual({ skeleton: 4 });
    expect(unitsOf(s, p, 'skeleton').length).toBeGreaterThanOrEqual(21);
    expect(unitsOf(s, q, 'skeleton').length % 5).toBe(0);
  });

  it('stack with other upgrades of the same card (Kurze Lunte + Panzerkiste)', () => {
    const cfg = config(6);
    cfg.players[0].levels = { tnt: 3 };
    cfg.players[1].levels = { tnt: 3 };
    const s = createMatch(cfg);
    const p = currentPlayer(s);
    forceOffer(s, [{ kind: 'spawn', card: 'tnt' }]);
    applyPick(s, 0);
    expect(unitsOf(s, p, 'tnt').map((u) => [u.maxHp, u.speed])).toEqual([
      [180, 75],
      [180, 75],
    ]);
    passTo(s, p);
    forceOffer(s, [{ kind: 'upgrade', card: 'tnt', upgrade: 1 }]);
    applyPick(s, 0);
    expect(unitsOf(s, p, 'tnt').map((u) => [u.maxHp, u.speed])).toEqual([
      [180, 120],
      [180, 120],
    ]);
    passTo(s, p);
    forceOffer(s, [{ kind: 'upgrade', card: 'tnt', upgrade: 2 }]);
    applyPick(s, 0);
    expect(s.activeUpgrades[p].tnt).toBe(6);
    // Level 3: 150 * 120 % = 180 HP, doubled by the crate; 75 * 160 % = 120 speed.
    for (const u of unitsOf(s, p, 'tnt')) {
      expect([u.maxHp, u.hp, u.speed, u.up]).toEqual([360, 360, 120, 6]);
    }
  });

  it('work with the bot for every slot kind', () => {
    const s = createMatch(config(7, ALL, ALL));
    forceOffer(s, [
      { kind: 'spawn', card: 'bat' },
      { kind: 'double', card: 'tnt' },
      { kind: 'upgrade', card: 'skeleton', upgrade: 2 },
    ]);
    const rng = seedRng(1, STREAM_BOT);
    const slot = chooseBotPick(s, 'easy', rng);
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(slot).toBeLessThan(3);
    applyPick(s, slot);
    while (s.phase !== 'finished') {
      if (s.phase === 'draft') applyPick(s, chooseBotPick(s, 'easy', rng));
      else {
        simulateToEnd(startBattle(s));
        endRound(s);
      }
    }
  });
});

describe('the seven implemented upgrades', () => {
  it('Rasselbande and Schwarm add two units per card', () => {
    expect(unitCount('skeleton', 0, false)).toBe(5);
    expect(unitCount('skeleton', 4, false)).toBe(7);
    expect(unitCount('skeleton', 4, true)).toBe(14);
    expect(unitCount('bat', 2, false)).toBe(5);
    expect(unitCount('bat', 5, false)).toBe(3); // other bat upgrades add no units
  });

  it('Panzerkiste, Glutschuppen and Kurze Lunte change HP and speed', () => {
    expect(unitStats('tnt', 1, 4).maxHp).toBe(300);
    expect(unitStats('tnt', 1, 2).speed).toBe(120);
    expect(unitStats('whelp', 1, 2).maxHp).toBe(770);
    expect(unitStats('whelp', 5, 2).maxHp).toBe(1078); // 550 * 140 % * 140 %
    expect(unitStats('beetle', 1, 4).maxHp).toBe(560); // Chitinpanzer: 350 * 160 %
    expect(unitStats('whelp', 1, 1).range).toBe(3); // Feueratem: +1 range
  });

  it('Adlerauge: the archer shoots from 7 fields instead of walking closer', () => {
    const shoot = (mask: number) => {
      const b = field();
      b.upgrades[0].archer = mask;
      const archer = put(b, 0, 'archer', 5, 2);
      applyStun(dummy(b, 1, 'knight', 5, 9), 1000, 0); // distSq 49
      const log = run(b, 1);
      return { range: archer.range, attacks: attackTicks(log, archer.id), moving: archer.moveCost };
    };
    expect(shoot(4)).toEqual({ range: 7, attacks: [0], moving: 0 });
    const plain = shoot(0);
    expect([plain.range, plain.attacks]).toEqual([5, []]);
    expect(plain.moving).toBeGreaterThan(0);
  });

  it('Steinhaut: the golem takes 20 % less damage, through every source', () => {
    const b = field();
    b.upgrades[0].golem = 1;
    const golem = put(b, 0, 'golem', 5, 10);
    expect(golem.armorBps).toBe(2000);
    applyStun(golem, 1000, 0);
    put(b, 1, 'knight', 5, 11);
    const log = run(b, 1);
    expect(eventsOf(log, 'damage').map((e) => e.amount)).toEqual([48]); // 60 * 80 %
    expect(golem.hp).toBe(1600 - 48);
  });

  it('summoned units take the owner upgrades of their card', () => {
    const b = createBattle([1, 2, 3, 4]);
    b.upgrades = [{ skeleton: 4 }, {}];
    const necro = put(b, 0, 'necromancer', 5, 5, { maxHp: 1_000_000 });
    applyStun(dummy(b, 1, 'bat', 5, 8), 1000, 0);
    const log = run(b, 81);
    const summoned = eventsOf(log, 'summon')[0]!;
    const unit = b.units.find((u) => u.id === summoned.unit)!;
    expect([unit.up, unit.summonerId]).toEqual([4, necro.id]);
  });
});

describe('summoned units in a match', () => {
  it('get fresh ids above the army, vanish at the end of the round and are never reused', () => {
    const s = createMatch({
      seed: 21,
      players: [player(['necromancer', 'golem', 'knight', 'archer']), player(UPGRADE_DECK)],
    });
    // Player 0 only plays necromancers, player 1 only golems: a long, summon-heavy battle.
    while (s.phase === 'draft') {
      forceOffer(s, [{ kind: 'spawn', card: currentPlayer(s) === 0 ? 'necromancer' : 'golem' }]);
      applyPick(s, 0);
    }
    const armyIds = s.army.flatMap((e) => e.unitIds);
    const battle = startBattle(s);
    simulateToEnd(battle);
    expect(battle.nextUnitId).toBeGreaterThan(s.nextUnitId); // something was summoned
    const last = battle.nextUnitId;
    endRound(s);
    expect(s.battle.units.map((u) => u.id)).toEqual(armyIds);
    expect(s.battle.units.every((u) => u.summonerId === 0)).toBe(true);
    expect(s.nextUnitId).toBe(last);
    forceOffer(s, [{ kind: 'spawn', card: currentPlayer(s) === 0 ? 'necromancer' : 'golem' }]);
    applyPick(s, 0);
    expect(s.army[s.army.length - 1]?.unitIds[0]).toBe(last);
  });
});
