import { describe, expect, it } from 'vitest';
import {
  ARENAS,
  CARD_IDS,
  CARDS,
  MAX_LEVEL,
  PACK,
  STARTER_CARDS,
  STARTER_DECK,
  nextInt,
  seedRng,
} from '../../engine/src/index.ts';
import type { CardId, Rarity } from '../../engine/src/index.ts';
import {
  arenaForElo,
  cardPool,
  checkDeck,
  checkLevelUp,
  checkSpendJokers,
  checkUnlockUpgrade,
  eloChange,
  isInPool,
  jokerCost,
  levelUpCost,
  packRewardValid,
  rollPack,
  upgradeUnlockCost,
  welcomeReward,
} from './progression.ts';

const elo = (
  o: Partial<{
    elo: number;
    opponentElo: number;
    score: 0 | 0.5 | 1;
    gamesPlayed: number;
    vsBot: boolean;
  }>,
) => eloChange({ elo: 1000, opponentElo: 1000, score: 1, gamesPlayed: 0, vsBot: false, ...o });

describe('eloChange (SPEC 7.5)', () => {
  it('uses K 48 for the first 20 games and K 32 afterwards', () => {
    expect(elo({})).toBe(24);
    expect(elo({ gamesPlayed: 19 })).toBe(24);
    expect(elo({ gamesPlayed: 20 })).toBe(16);
  });
  it('halves K against bots', () => {
    expect(elo({ vsBot: true })).toBe(12);
    expect(elo({ vsBot: true, gamesPlayed: 20 })).toBe(8);
  });
  it('handles losses and draws', () => {
    expect(elo({ score: 0 })).toBe(-24);
    expect(elo({ score: 0.5 })).toBe(0);
    expect(Object.is(elo({ score: 0.5 }), 0)).toBe(true);
    expect(elo({ score: 0.5, opponentElo: 1400, gamesPlayed: 20 })).toBe(
      Math.round(32 * (0.5 - 1 / (1 + 10 ** 1))),
    );
  });
  it('rewards upsets more', () => {
    expect(elo({ opponentElo: 1400, gamesPlayed: 20 })).toBe(29);
    expect(elo({ opponentElo: 600, gamesPlayed: 20 })).toBe(3);
  });
  it('never takes the Elo below 0', () => {
    expect(elo({ elo: 10, opponentElo: 10, score: 0 })).toBe(-10);
    expect(elo({ elo: 0, score: 0 })).toBe(0);
    expect(Object.is(elo({ elo: 0, score: 0 }), 0)).toBe(true);
  });
});

describe('arenas and pool', () => {
  it('maps Elo to the highest reached arena', () => {
    expect([0, 1099, 1100, 1249, 1250, 1399, 1400, 1599, 1600, 5000].map(arenaForElo)).toEqual([
      1, 1, 2, 2, 3, 3, 4, 4, 5, 5,
    ]);
  });
  it('builds the pool in CARD_IDS order', () => {
    expect(cardPool(1)).toHaveLength(7);
    expect(cardPool(2)).toHaveLength(12);
    expect(cardPool(5)).toEqual([...CARD_IDS]);
    expect(isInPool('whelp', 4)).toBe(false);
    expect(isInPool('whelp', 5)).toBe(true);
  });
});

describe('level-up (SPEC 7.2)', () => {
  const table: Record<Rarity, number[]> = {
    common: [5, 10, 20, 40],
    rare: [3, 6, 12, 24],
    epic: [1, 3, 6, 12],
  };
  const gold = [100, 300, 800, 2000];
  it('returns the cost of every step and rarity', () => {
    const byRarity = (r: Rarity) => CARD_IDS.find((id) => CARDS[id].rarity === r) as CardId;
    for (const r of ['common', 'rare', 'epic'] as const) {
      for (let level = 1; level < MAX_LEVEL; level++) {
        expect(levelUpCost(byRarity(r), level)).toEqual({
          copies: table[r][level - 1],
          gold: gold[level - 1],
        });
      }
    }
    expect(levelUpCost('archer', MAX_LEVEL)).toBeNull();
  });
  it('checks in the documented order', () => {
    const c = (copies: number, level = 1) => ({ level, copies, unlockedUpgrades: 0 });
    const cost = levelUpCost('archer', 1)!;
    expect(checkLevelUp('archer', undefined, 9999)).toBe('card_not_owned');
    expect(checkLevelUp('archer', c(0, MAX_LEVEL), 0)).toBe('max_level');
    expect(checkLevelUp('archer', c(cost.copies - 1), 0)).toBe('not_enough_copies');
    expect(checkLevelUp('archer', c(cost.copies), cost.gold - 1)).toBe('not_enough_gold');
    expect(checkLevelUp('archer', c(cost.copies), cost.gold)).toBeNull();
  });
});

describe('upgrades (SPEC 7.3)', () => {
  it('has the costs and levels of the table', () => {
    expect([0, 1, 2].map((i) => upgradeUnlockCost(i as 0 | 1 | 2))).toEqual([
      { level: 2, gold: 200 },
      { level: 3, gold: 600 },
      { level: 5, gold: 1500 },
    ]);
  });
  it('checks in the documented order', () => {
    const o = (level: number, mask = 0) => ({ level, copies: 0, unlockedUpgrades: mask });
    expect(checkUnlockUpgrade(undefined, 0, 9999)).toBe('card_not_owned');
    expect(checkUnlockUpgrade(o(5, 0b001), 0, 0)).toBe('upgrade_already_unlocked');
    expect(checkUnlockUpgrade(o(1), 0, 9999)).toBe('level_too_low');
    expect(checkUnlockUpgrade(o(4), 2, 9999)).toBe('level_too_low');
    expect(checkUnlockUpgrade(o(2), 0, 199)).toBe('not_enough_gold');
    expect(checkUnlockUpgrade(o(2), 0, 200)).toBeNull();
    expect(checkUnlockUpgrade(o(5, 0b011), 2, 1500)).toBeNull();
  });
});

describe('jokers (SPEC 7.4)', () => {
  it('costs 1 / 2 / 4 per copy by rarity', () => {
    expect(jokerCost('archer', 3)).toBe(3);
    expect(jokerCost('musketeer', 3)).toBe(6);
    expect(jokerCost('whelp', 3)).toBe(12);
  });
  it('validates a spend', () => {
    expect(checkSpendJokers('archer', 0, 99, 1)).toBe('bad_request');
    expect(checkSpendJokers('archer', 1.5, 99, 1)).toBe('bad_request');
    expect(checkSpendJokers('archer', 1000, 99999, 1)).toBe('bad_request');
    expect(checkSpendJokers('whelp', 1, 99, 4)).toBe('card_not_in_pool');
    expect(checkSpendJokers('whelp', 2, 7, 5)).toBe('not_enough_jokers');
    expect(checkSpendJokers('whelp', 2, 8, 5)).toBeNull();
  });
});

describe('checkDeck', () => {
  const owned = new Set<string>(STARTER_CARDS);
  it('accepts the starter deck', () => {
    expect(checkDeck([...STARTER_DECK], owned)).toBeNull();
  });
  it('rejects everything else', () => {
    expect(checkDeck('archer', owned)).toBe('deck_invalid');
    expect(checkDeck(['archer', 'knight', 'skeleton'], owned)).toBe('deck_invalid');
    expect(checkDeck(['archer', 'knight', 'skeleton', 'healer', 'bat'], owned)).toBe(
      'deck_invalid',
    );
    expect(checkDeck(['archer', 'archer', 'skeleton', 'healer'], owned)).toBe('deck_invalid');
    expect(checkDeck(['archer', 'knight', 'skeleton', 'whelp'], owned)).toBe('deck_invalid');
    expect(
      checkDeck(['archer', 'knight', 'skeleton', 'dragon'], new Set(['dragon', ...owned])),
    ).toBe('deck_invalid');
    expect(checkDeck(['archer', 'knight', 'skeleton', 5], owned)).toBe('deck_invalid');
  });
});

describe('rollPack (SPEC 7.4)', () => {
  const N = 200_000;
  const roll = (arena: number, n = N) => {
    const rng = seedRng(12345, arena);
    const out = [];
    for (let i = 0; i < n; i++) out.push(rollPack((m) => nextInt(rng, m), arena));
    return out;
  };

  it('matches the probabilities and ranges (arena 5)', () => {
    const rolls = roll(5);
    const share = (f: (r: (typeof rolls)[number]) => boolean) => rolls.filter(f).length / N;
    expect(Math.abs(share((r) => r.kind === 'cards') - 0.6)).toBeLessThan(0.01);
    expect(Math.abs(share((r) => r.kind === 'gold') - 0.3)).toBeLessThan(0.01);
    expect(Math.abs(share((r) => r.kind === 'jokers') - 0.1)).toBeLessThan(0.01);
    const cards = rolls.filter((r) => r.kind === 'cards');
    const rarityShare = (rar: Rarity) =>
      cards.filter((r) => CARDS[r.card].rarity === rar).length / cards.length;
    expect(Math.abs(rarityShare('common') - 0.7)).toBeLessThan(0.01);
    expect(Math.abs(rarityShare('rare') - 0.25)).toBeLessThan(0.01);
    expect(Math.abs(rarityShare('epic') - 0.05)).toBeLessThan(0.01);
    const pool = new Set(cardPool(5));
    for (const r of rolls) {
      if (r.kind === 'cards') {
        const range = PACK.copies[CARDS[r.card].rarity];
        expect(pool.has(r.card)).toBe(true);
        expect(r.copies).toBeGreaterThanOrEqual(range.min);
        expect(r.copies).toBeLessThanOrEqual(range.max);
      } else if (r.kind === 'gold') {
        expect(r.gold).toBeGreaterThanOrEqual(100);
        expect(r.gold).toBeLessThanOrEqual(300);
      } else {
        expect(r.jokers).toBeGreaterThanOrEqual(1);
        expect(r.jokers).toBeLessThanOrEqual(3);
      }
      expect(packRewardValid(r)).toBe(true);
    }
  });

  it('arena 1 never rolls epic cards and keeps to the pool and gold range', () => {
    const rolls = roll(1, 50_000);
    const pool = new Set(cardPool(1));
    let golds = 0;
    for (const r of rolls) {
      if (r.kind === 'cards') {
        expect(pool.has(r.card)).toBe(true);
        expect(CARDS[r.card].rarity).not.toBe('epic');
      } else if (r.kind === 'gold') {
        golds++;
        expect(r.gold).toBeGreaterThanOrEqual(50);
        expect(r.gold).toBeLessThanOrEqual(150);
      }
    }
    expect(golds).toBeGreaterThan(0);
  });

  it('applies the gold multiplier of the arena and floors', () => {
    const gold = (arena: number, base: number) => {
      // kind = gold (index 6000 of 10000), then base - 50 as the amount
      const answers = [6000, base - PACK.gold.min];
      let i = 0;
      return rollPack(() => answers[i++] as number, arena);
    };
    expect(gold(1, 77)).toEqual({ kind: 'gold', gold: 77 });
    expect(gold(2, 77)).toEqual({ kind: 'gold', gold: 92 });
    expect(gold(3, 77)).toEqual({ kind: 'gold', gold: 107 });
    expect(gold(5, 150)).toEqual({ kind: 'gold', gold: 300 });
  });

  it('uses a fixed call order for cards', () => {
    const calls: number[] = [];
    const answers = [0, 9999, 0, 0];
    let i = 0;
    const r = rollPack((n) => {
      calls.push(n);
      return answers[i++] as number;
    }, 5);
    expect(calls).toEqual([10000, 10000, 5, 2]);
    expect(r.kind).toBe('cards');
  });

  it('gives the welcome pack', () => {
    expect(welcomeReward()).toEqual({ kind: 'cards', card: 'musketeer', copies: 2 });
    expect(packRewardValid(welcomeReward())).toBe(true);
  });
});

describe('packRewardValid', () => {
  it('rejects malformed values', () => {
    const bad: unknown[] = [
      null,
      7,
      'x',
      [],
      {},
      { kind: 'gold' },
      { kind: 'gold', gold: 49 },
      { kind: 'gold', gold: 301 },
      { kind: 'gold', gold: 60.5 },
      { kind: 'gold', gold: 60, extra: 1 },
      { kind: 'jokers', jokers: 0 },
      { kind: 'jokers', jokers: 4 },
      { kind: 'cards', card: 'dragon', copies: 2 },
      { kind: 'cards', card: 'whelp', copies: 3 },
      { kind: 'cards', card: 'archer', copies: 2 },
      { kind: 'cards', card: 'archer', copies: 9 },
      { kind: 'cards', card: 'archer' },
      { kind: 'cards', card: 'toString', copies: 2 },
    ];
    for (const b of bad) expect(packRewardValid(b), JSON.stringify(b)).toBe(false);
    expect(packRewardValid({ kind: 'gold', gold: 300 })).toBe(true);
    expect(packRewardValid({ kind: 'cards', card: 'archer', copies: 8 })).toBe(true);
  });
  it('covers every arena', () => {
    expect(ARENAS.length).toBe(5);
  });
});
