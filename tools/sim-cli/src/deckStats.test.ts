import { describe, expect, it } from 'vitest';
import {
  ALL_UPGRADES_MASK,
  CARD_IDS,
  DECK_SIZE,
  applyPick,
  createMatch,
  hashState,
  randomPicker,
  seedRng,
  simulateToEnd,
  startBattle,
} from '@rumble-realms/engine';
import type { MatchConfig, MatchState } from '@rumble-realms/engine';
import {
  PICK_STREAM,
  ci95,
  deckWinRates,
  firstRoundLeadTheory,
  fullPlayer,
  randomDeck,
  runDeckCardMatches,
} from './deckStats.ts';
import { battleWithPeaks, deckCardTable, deckFlag } from './balance.ts';

describe('firstRoundLeadTheory', () => {
  it('is 42/64 for four lives (D-057)', () => {
    expect(firstRoundLeadTheory()).toBeCloseTo(42 / 64, 12);
    expect(firstRoundLeadTheory(4)).toBeCloseTo(0.65625, 12);
  });

  it('matches small cases worked out by hand', () => {
    expect(firstRoundLeadTheory(1)).toBe(1);
    // Two lives: the leader needs one more win before the other wins twice: 1/2 + 1/4.
    expect(firstRoundLeadTheory(2)).toBeCloseTo(0.75, 12);
  });
});

describe('ci95', () => {
  it('is the normal approximation of the 95 % interval', () => {
    expect(ci95(0.5, 100)).toBeCloseTo(0.098, 12);
    expect(ci95(0.5, 0)).toBe(1);
    expect(ci95(1, 50)).toBe(0);
  });
});

describe('random decks', () => {
  it('draws four different cards with all upgrades unlocked', () => {
    const rng = seedRng(1, 11);
    for (let i = 0; i < 50; i++) {
      const deck = randomDeck(rng);
      expect(deck).toHaveLength(DECK_SIZE);
      expect(new Set(deck).size).toBe(DECK_SIZE);
      const p = fullPlayer(deck, 2);
      for (const card of deck) {
        expect(p.levels[card]).toBe(2);
        expect(p.upgrades?.[card]).toBe(ALL_UPGRADES_MASK);
      }
    }
  });
});

describe('runDeckCardMatches', () => {
  it('counts every deck card of both players and is deterministic', () => {
    const a = runDeckCardMatches(4, 11, 6, 1);
    expect(a.uses.reduce((x, y) => x + y, 0)).toBe(6 * 2 * DECK_SIZE);
    // Per match both players together score 1 (1 + 0 or 0.5 + 0.5), on four cards each.
    expect(a.points.reduce((x, y) => x + y, 0)).toBe(6 * DECK_SIZE);
    expect(runDeckCardMatches(4, 11, 6, 1)).toEqual(a);
    const rates = deckWinRates(a);
    rates.forEach((r, i) => {
      if (a.uses[i] === 0) expect(r).toBe(0.5);
      else expect(r).toBeCloseTo((a.points[i] as number) / (a.uses[i] as number), 12);
    });
  }, 30_000);
});

describe('balance helpers', () => {
  it('rates a win rate in a deck against 45..55 and 42..58 %', () => {
    expect(deckFlag(0.5)).toBe('ok');
    expect(deckFlag(0.55)).toBe('ok');
    expect(deckFlag(0.56)).toBe('eher stark');
    expect(deckFlag(0.44)).toBe('eher schwach');
    expect(deckFlag(0.59)).toBe('**ZU STARK**');
    expect(deckFlag(0.41)).toBe('**ZU SCHWACH**');
  });

  it('lists every card in the deck ranking, best first', () => {
    const uses = CARD_IDS.map(() => 100);
    const points = CARD_IDS.map((_, i) => 40 + i); // the last card is best
    const text = deckCardTable({ matches: 400, uses, points });
    const lines = text.split('\n');
    expect(lines).toHaveLength(2 + CARD_IDS.length);
    expect(lines[2]).toContain(CARD_IDS[CARD_IDS.length - 1] as string);
    expect(lines[2]).toContain('55,0');
  });

  it('counting living units tick by tick does not change the battle', () => {
    const cfg: MatchConfig = {
      seed: 99,
      players: [
        fullPlayer(['necromancer', 'skeleton', 'knight', 'archer'], 1),
        fullPlayer(['shroomling', 'golem', 'healer', 'whelp'], 1),
      ],
    };
    const toBattle = (): MatchState => {
      const state = createMatch(cfg);
      const picker = randomPicker(seedRng(cfg.seed, PICK_STREAM));
      while (state.phase === 'draft') applyPick(state, picker(state));
      return state;
    };
    const plain = toBattle();
    const counted = toBattle();
    const result = simulateToEnd(startBattle(plain));
    const peaks = battleWithPeaks(counted);
    expect(peaks.result).toEqual(result);
    expect(hashState(counted)).toBe(hashState(plain));
    expect(peaks.both).toBeGreaterThanOrEqual(peaks.side);
    expect(peaks.side).toBeGreaterThan(0);
  });
});
