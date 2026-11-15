import { CARD_IDS, MAX_LEVEL } from '@rumble-realms/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import { START_DECK } from './config.ts';
import {
  DECK_STORAGE_KEY,
  levelOf,
  sanitizeDeckData,
  upgradesOf,
  useDeckStore,
} from './deckStore.ts';

function reset(): void {
  useDeckStore.setState({ deck: [...START_DECK], levels: {}, upgrades: {} });
}

describe('sanitizeDeckData', () => {
  const start = { deck: [...START_DECK], levels: {}, upgrades: {} };

  it('keeps valid data', () => {
    const ok = {
      deck: ['assassin', 'tnt', 'knight', 'archer'],
      levels: { tnt: 3, knight: 5 },
      upgrades: { tnt: 3, knight: 0 },
    };
    expect(sanitizeDeckData(ok)).toEqual(ok);
  });

  it('falls back to the start deck for anything damaged', () => {
    expect(sanitizeDeckData(null)).toEqual(start);
    expect(sanitizeDeckData('x')).toEqual(start);
    expect(sanitizeDeckData({})).toEqual(start);
    expect(sanitizeDeckData({ deck: ['archer', 'knight', 'skeleton'] })).toEqual(start);
    expect(sanitizeDeckData({ deck: ['archer', 'knight', 'skeleton', 'healer', 'tnt'] })).toEqual(
      start,
    );
    expect(sanitizeDeckData({ deck: ['archer', 'knight', 'skeleton', 'dragon'] })).toEqual(start);
    expect(sanitizeDeckData({ deck: ['archer', 'archer', 'skeleton', 'healer'] })).toEqual(start);
    expect(sanitizeDeckData({ deck: 'archer' })).toEqual(start);
  });

  it('drops invalid levels and unknown cards in levels', () => {
    const got = sanitizeDeckData({
      levels: { knight: 0, tnt: MAX_LEVEL + 1, archer: 2.5, bat: '3', dragon: 2, healer: 4 },
    });
    expect(got.levels).toEqual({ healer: 4 });
    expect(sanitizeDeckData({ levels: [1, 2] }).levels).toEqual({});
    expect(sanitizeDeckData({ levels: null }).levels).toEqual({});
  });

  it('does not share the arrays with its input', () => {
    const input = { deck: ['assassin', 'tnt', 'knight', 'archer'], levels: {} };
    expect(sanitizeDeckData(input).deck).not.toBe(input.deck);
  });
});

describe('deck store', () => {
  beforeEach(reset);

  it('starts with the start deck at level 1 (also without localStorage)', () => {
    const s = useDeckStore.getState();
    expect(s.deck).toEqual(START_DECK);
    expect(s.levels).toEqual({});
    expect(levelOf(s.levels, 'archer')).toBe(1);
    expect(DECK_STORAGE_KEY).toBe('rr.deck.v1');
  });

  it('setSlot replaces a card', () => {
    useDeckStore.getState().setSlot(1, 'assassin');
    expect(useDeckStore.getState().deck).toEqual(['archer', 'assassin', 'skeleton', 'healer']);
  });

  it('setSlot swaps when the card already lies in another place', () => {
    useDeckStore.getState().setSlot(0, 'healer');
    expect(useDeckStore.getState().deck).toEqual(['healer', 'knight', 'skeleton', 'archer']);
    useDeckStore.getState().setSlot(0, 'healer');
    expect(useDeckStore.getState().deck).toEqual(['healer', 'knight', 'skeleton', 'archer']);
  });

  it('always keeps four different known cards', () => {
    const { setSlot } = useDeckStore.getState();
    for (let i = 0; i < 40; i++) setSlot(i % 4, CARD_IDS[(i * 7) % CARD_IDS.length] as never);
    const deck = useDeckStore.getState().deck;
    expect(deck).toHaveLength(4);
    expect(new Set(deck).size).toBe(4);
  });

  it('setSlot ignores bad input', () => {
    const { setSlot } = useDeckStore.getState();
    setSlot(4, 'tnt');
    setSlot(-1, 'tnt');
    setSlot(1.5, 'tnt');
    setSlot(0, 'dragon' as never);
    expect(useDeckStore.getState().deck).toEqual(START_DECK);
  });

  it('setLevel sets and limits the level', () => {
    const { setLevel } = useDeckStore.getState();
    setLevel('tnt', 3);
    expect(useDeckStore.getState().levels.tnt).toBe(3);
    setLevel('tnt', 99);
    expect(useDeckStore.getState().levels.tnt).toBe(MAX_LEVEL);
    setLevel('tnt', -4);
    expect(useDeckStore.getState().levels.tnt).toBe(1);
    setLevel('tnt', NaN);
    setLevel('dragon' as never, 2);
    expect(useDeckStore.getState().levels).toEqual({ tnt: 1 });
  });
});

describe('deck store with a working localStorage', () => {
  it('saves under rr.deck.v1 and loads validated data', async () => {
    const data = new Map<string, string>();
    const fake = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    };
    (globalThis as { localStorage?: unknown }).localStorage = fake;
    try {
      reset();
      useDeckStore.getState().setSlot(0, 'tnt');
      useDeckStore.getState().setLevel('tnt', 3);
      const saved = JSON.parse(data.get('rr.deck.v1') ?? 'null') as {
        state: { deck: string[]; levels: Record<string, number> };
      };
      expect(saved.state.deck[0]).toBe('tnt');
      expect(saved.state.levels).toEqual({ tnt: 3 });

      // A damaged entry is replaced by the defaults on load.
      data.set(
        'rr.deck.v1',
        JSON.stringify({ state: { deck: ['x'], levels: { tnt: 77 } }, version: 1 }),
      );
      await useDeckStore.persist.rehydrate();
      expect(useDeckStore.getState().deck).toEqual(START_DECK);
      expect(useDeckStore.getState().levels).toEqual({});

      data.set(
        'rr.deck.v1',
        JSON.stringify({
          state: { deck: ['assassin', 'tnt', 'knight', 'archer'], levels: { tnt: 3 } },
          version: 1,
        }),
      );
      await useDeckStore.persist.rehydrate();
      expect(useDeckStore.getState().deck).toEqual(['assassin', 'tnt', 'knight', 'archer']);
      expect(useDeckStore.getState().levels).toEqual({ tnt: 3 });
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage;
      reset();
    }
  });

  it('survives a localStorage that throws', () => {
    const boom = () => {
      throw new Error('blocked');
    };
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: boom,
      setItem: boom,
      removeItem: boom,
    };
    try {
      expect(() => useDeckStore.getState().setSlot(0, 'tnt')).not.toThrow();
      expect(useDeckStore.getState().deck[0]).toBe('tnt');
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage;
      reset();
    }
  });
});

describe('upgrades', () => {
  beforeEach(reset);

  it('a missing card has all upgrades (D-073)', () => {
    expect(upgradesOf({}, 'knight')).toBe(7);
    expect(upgradesOf({ knight: 2 }, 'knight')).toBe(2);
    expect(upgradesOf({ knight: 0 }, 'knight')).toBe(0);
  });

  it('toggleUpgrade switches one bit and leaves the other cards alone', () => {
    const s = useDeckStore.getState();
    s.toggleUpgrade('knight', 1);
    expect(useDeckStore.getState().upgrades).toEqual({ knight: 5 });
    s.toggleUpgrade('knight', 1);
    expect(useDeckStore.getState().upgrades).toEqual({ knight: 7 });
    s.toggleUpgrade('archer', 0);
    s.toggleUpgrade('archer', 2);
    expect(upgradesOf(useDeckStore.getState().upgrades, 'archer')).toBe(2);
    expect(upgradesOf(useDeckStore.getState().upgrades, 'knight')).toBe(7);
  });

  it('toggleUpgrade ignores invalid input', () => {
    const s = useDeckStore.getState();
    s.toggleUpgrade('knight', 3);
    s.toggleUpgrade('knight', -1);
    s.toggleUpgrade('knight', 0.5);
    s.toggleUpgrade('dragon' as never, 0);
    expect(useDeckStore.getState().upgrades).toEqual({});
  });

  it('accepts old saved data without the field', () => {
    const old = { deck: ['assassin', 'tnt', 'knight', 'archer'], levels: { tnt: 3 } };
    expect(sanitizeDeckData(old).upgrades).toEqual({});
    expect(sanitizeDeckData(old).levels).toEqual({ tnt: 3 });
  });

  it('drops invalid masks and unknown cards', () => {
    const got = sanitizeDeckData({
      upgrades: { knight: 8, tnt: -1, archer: 1.5, bat: '3', dragon: 2, healer: 4, golem: 0 },
    });
    expect(got.upgrades).toEqual({ healer: 4, golem: 0 });
    expect(sanitizeDeckData({ upgrades: [1] }).upgrades).toEqual({});
    expect(sanitizeDeckData({ upgrades: null }).upgrades).toEqual({});
  });
});
