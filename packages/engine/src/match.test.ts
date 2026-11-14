import { describe, expect, it } from 'vitest';
import { cloneState } from './battle/state.ts';
import { DECK_SIZE, HALF_ROWS, OFFER_SIZE, START_LIVES } from './data/balance.ts';
import { CARDS } from './data/cards.ts';
import { hashState } from './hash.ts';
import {
  applyPick,
  createMatch,
  currentPlayer,
  draftOrder,
  endRound,
  getOffer,
  picksRemaining,
  startBattle,
} from './match.ts';
import { nextInt, seedRng, STREAM_BATTLE, STREAM_MATCH } from './rng.ts';
import type { BattleResult, CardId, MatchConfig, MatchState, Winner } from './types.ts';

function config(seed = 42): MatchConfig {
  return {
    seed,
    players: [
      { deck: ['archer', 'knight', 'tnt', 'skeleton'], levels: { knight: 3 } },
      { deck: ['healer', 'musketeer', 'bat', 'assassin'], levels: { bat: 5, healer: 1 } },
    ],
  };
}

/** Plays all picks of the current draft with the given slot chooser. */
function draftAll(state: MatchState, chooser: (i: number) => number = (i) => i % OFFER_SIZE): void {
  let i = 0;
  while (state.phase === 'draft') applyPick(state, chooser(i++));
}

function finishBattle(state: MatchState, winner: Winner): void {
  const result: BattleResult = {
    winner,
    reason: 'elimination',
    ticks: 100,
    hp: winner === 0 ? [10, 0] : winner === 1 ? [0, 10] : [0, 0],
  };
  state.battle.result = result;
}

/** Completes the draft, fakes the battle result and books the round. */
function playRound(state: MatchState, winner: Winner): void {
  draftAll(state);
  finishBattle(state, winner);
  endRound(state);
}

function withConfig(change: (cfg: MatchConfig) => void): () => MatchState {
  const cfg = config();
  change(cfg);
  return () => createMatch(cfg);
}

describe('createMatch validation', () => {
  it.each<[string, (cfg: MatchConfig) => void, RegExp]>([
    ['negative seed', (c) => (c.seed = -1), /seed/],
    ['fractional seed', (c) => (c.seed = 1.5), /seed/],
    ['unsafe seed', (c) => (c.seed = 2 ** 53), /seed/],
    ['NaN seed', (c) => (c.seed = Number.NaN), /seed/],
    ['three players', (c) => (c.players as unknown as unknown[]).push(c.players[0]), /two players/],
    ['short deck', (c) => c.players[0].deck.pop(), /exactly 4 cards/],
    ['long deck', (c) => c.players[1].deck.push('knight'), /exactly 4 cards/],
    ['duplicate card', (c) => (c.players[0].deck[1] = 'archer'), /archer twice/],
    ['unknown card', (c) => ((c.players[1].deck as string[])[0] = 'dragon'), /unknown card dragon/],
    ['level 0', (c) => (c.players[0].levels.knight = 0), /level of knight/],
    ['level 6', (c) => (c.players[0].levels.knight = 6), /level of knight/],
    ['fractional level', (c) => (c.players[1].levels.bat = 2.5), /level of bat/],
    [
      'level for unknown card',
      (c) => ((c.players[0].levels as Record<string, number>).dragon = 2),
      /unknown card dragon/,
    ],
  ])('rejects %s', (_name, change, message) => {
    expect(withConfig(change)).toThrow(message);
  });

  it('accepts the maximum safe seed and levels of cards outside the deck', () => {
    const cfg = config(2 ** 53 - 1);
    cfg.players[0].levels.berserker = 5;
    expect(() => createMatch(cfg)).not.toThrow();
  });

  it('copies the config instead of aliasing it', () => {
    const cfg = config();
    const state = createMatch(cfg);
    expect(state.config).toEqual(cfg);
    cfg.players[0].deck[0] = 'bat';
    cfg.players[0].levels.knight = 1;
    cfg.seed = 7;
    expect(state.config.players[0].deck[0]).toBe('archer');
    expect(state.config.players[0].levels.knight).toBe(3);
    expect(state.config.seed).toBe(42);
  });
});

describe('createMatch setup', () => {
  it('starts round 1 in the draft with full lives and an empty field', () => {
    const s = createMatch(config());
    expect(s.phase).toBe('draft');
    expect(s.round).toBe(1);
    expect(s.lives).toEqual([START_LIVES, START_LIVES]);
    expect(s.picks).toEqual([]);
    expect(s.rounds).toEqual([]);
    expect(s.lastPick).toBeNull();
    expect(s.winner).toBeNull();
    expect(s.battle.units).toEqual([]);
    expect(s.battle.rng).toEqual(seedRng(42, STREAM_BATTLE));
  });

  it('flips the coin from the match stream of the seed only', () => {
    for (let seed = 0; seed < 30; seed++) {
      const expected = nextInt(seedRng(seed, STREAM_MATCH), 2);
      const a = createMatch(config(seed));
      const other = config(seed);
      other.players = [other.players[1], other.players[0]];
      const b = createMatch(other);
      expect(currentPlayer(a)).toBe(expected);
      expect(currentPlayer(b)).toBe(expected);
    }
  });

  it('lets both players start over many seeds', () => {
    const starters = new Set<number>();
    let zeros = 0;
    for (let seed = 0; seed < 200; seed++) {
      const p = currentPlayer(createMatch(config(seed)));
      starters.add(p);
      if (p === 0) zeros++;
    }
    expect(starters.size).toBe(2);
    expect(zeros).toBeGreaterThan(70);
    expect(zeros).toBeLessThan(130);
  });

  it('alternates three picks each in round 1, starting with the coin winner', () => {
    for (let seed = 0; seed < 10; seed++) {
      const s = createMatch(config(seed));
      const a = s.draft.order[0];
      const b = a === 0 ? 1 : 0;
      expect(s.draft.order).toEqual([a, b, a, b, a, b]);
      expect(picksRemaining(s, 0)).toBe(3);
      expect(picksRemaining(s, 1)).toBe(3);
    }
  });
});

describe('draftOrder', () => {
  it('builds the normal and the loser-bonus order', () => {
    expect(draftOrder(0, 3, 3)).toEqual([0, 1, 0, 1, 0, 1]);
    expect(draftOrder(1, 3, 3)).toEqual([1, 0, 1, 0, 1, 0]);
    expect(draftOrder(1, 4, 3)).toEqual([1, 0, 1, 0, 1, 0, 1]);
    expect(draftOrder(0, 4, 3)).toEqual([0, 1, 0, 1, 0, 1, 0]);
    expect(draftOrder(0, 0, 0)).toEqual([]);
  });
});

describe('offers', () => {
  it('always offers 3 distinct deck cards of the player whose turn it is', () => {
    for (let seed = 0; seed < 20; seed++) {
      const s = createMatch(config(seed));
      for (let round = 0; round < 3; round++) {
        while (s.phase === 'draft') {
          const offer = getOffer(s);
          const player = currentPlayer(s);
          expect(offer.player).toBe(player);
          expect(offer.slots).toHaveLength(OFFER_SIZE);
          const cards = offer.slots.map((slot) => slot.card);
          expect(new Set(cards).size).toBe(OFFER_SIZE);
          for (const slot of offer.slots) {
            expect(slot.kind).toBe('spawn');
            expect(s.config.players[player].deck).toContain(slot.card);
          }
          applyPick(s, seed % OFFER_SIZE);
        }
        finishBattle(s, round === 1 ? 'draw' : (seed + round) % 2 === 0 ? 0 : 1);
        endRound(s);
      }
    }
  });

  it('shows every deck card in every slot over many offers', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 60; seed++) {
      const offer = getOffer(createMatch(config(seed)));
      offer.slots.forEach((slot, i) => seen.add(`${offer.player}:${i}:${slot.card}`));
    }
    expect(seen.size).toBe(2 * OFFER_SIZE * DECK_SIZE);
  });

  it('differ between seeds', () => {
    const offers = (seed: number): string => {
      const s = createMatch(config(seed));
      const list: string[] = [];
      while (s.phase === 'draft') {
        list.push(
          getOffer(s)
            .slots.map((slot) => slot.card)
            .join(','),
        );
        applyPick(s, 0);
      }
      return list.join('|');
    };
    expect(offers(1)).not.toBe(offers(2));
    const distinct = new Set<string>();
    for (let seed = 0; seed < 20; seed++) distinct.add(offers(seed));
    expect(distinct.size).toBeGreaterThan(15);
  });

  it('do not depend on placement', () => {
    const a = createMatch(config(9));
    const b = createMatch(config(9));
    b.rng.placement = seedRng(12345, 3);
    let positionsDiffer = false;
    while (a.phase === 'draft') {
      expect(getOffer(b)).toEqual(getOffer(a));
      applyPick(a, 1);
      applyPick(b, 1);
      const ua = a.battle.units.map((u) => `${u.x},${u.y}`).join(';');
      const ub = b.battle.units.map((u) => `${u.x},${u.y}`).join(';');
      if (ua !== ub) positionsDiffer = true;
    }
    expect(positionsDiffer).toBe(true);
  });

  it('getOffer and currentPlayer throw outside the draft', () => {
    const s = createMatch(config());
    draftAll(s);
    expect(() => getOffer(s)).toThrow(/draft/);
    expect(() => currentPlayer(s)).toThrow(/draft/);
    expect(picksRemaining(s, 0)).toBe(0);
  });
});

describe('applyPick', () => {
  it('spawns the card units for the picking player in the own half', () => {
    const s = createMatch(config(3));
    let total = 0;
    while (s.phase === 'draft') {
      const player = currentPlayer(s);
      const offer = getOffer(s);
      const slot = (s.picks.length * 2) % OFFER_SIZE;
      const card = offer.slots[slot]?.card as CardId;
      const before = s.battle.units.length;
      applyPick(s, slot);
      const pick = s.lastPick;
      expect(pick).toEqual({
        player,
        slot,
        card,
        spawned: pick?.spawned,
        forfeited: 0,
      });
      expect(pick?.spawned).toHaveLength(CARDS[card].count);
      expect(s.battle.units.length).toBe(before + CARDS[card].count);
      total += CARDS[card].count;
      for (const id of pick?.spawned ?? []) {
        const u = s.battle.units.find((unit) => unit.id === id);
        expect(u?.owner).toBe(player);
        expect(u?.card).toBe(card);
        if (player === 0) expect(u !== undefined && u.y < HALF_ROWS).toBe(true);
        else expect(u !== undefined && u.y >= HALF_ROWS).toBe(true);
      }
    }
    expect(s.battle.units.length).toBe(total);
  });

  it('uses the configured card levels (missing = level 1)', () => {
    const cfg = config(4);
    const s = createMatch(cfg);
    // Pick the knight (player 0, level 3), bat (player 1, level 5) or archer (level 1) when offered.
    while (s.phase === 'draft') {
      const offer = getOffer(s);
      const prefer: CardId[] = ['knight', 'bat', 'archer', 'healer'];
      let slot = 0;
      for (const card of prefer) {
        const i = offer.slots.findIndex((x) => x.card === card);
        if (i >= 0) {
          slot = i;
          break;
        }
      }
      applyPick(s, slot);
    }
    const expectedHp: Partial<Record<CardId, number>> = {
      knight: 720, // 600 * 120 %
      bat: 98, // 70 * 140 %
      archer: 120,
      healer: 200,
      tnt: 150,
      skeleton: 60,
      musketeer: 400,
      assassin: 200,
    };
    expect(s.battle.units.length).toBeGreaterThan(0);
    for (const u of s.battle.units) {
      expect(u.maxHp).toBe(expectedHp[u.card]);
      expect(u.hp).toBe(u.maxHp);
      expect(u.level).toBe(cfg.players[u.owner].levels[u.card] ?? 1);
    }
  });

  it('records every slot and switches to the battle after the last pick', () => {
    const s = createMatch(config());
    const slots = [2, 0, 1, 1, 0, 2];
    for (let i = 0; i < slots.length; i++) {
      expect(s.phase).toBe('draft');
      expect(applyPick(s, slots[i] as number)).toBe(s);
    }
    expect(s.picks).toEqual(slots);
    expect(s.phase).toBe('battle');
    expect(s.draft.offer).toBeNull();
    expect(startBattle(s)).toBe(s.battle);
  });

  it.each([-1, 3, 1.5, Number.NaN])('rejects slot %s', (slot) => {
    const s = createMatch(config());
    const before = hashState(s);
    expect(() => applyPick(s, slot)).toThrow(/slot/);
    expect(hashState(s)).toBe(before);
  });

  it('rejects picks during the battle', () => {
    const s = createMatch(config());
    draftAll(s);
    expect(() => applyPick(s, 0)).toThrow(/draft/);
  });

  it('startBattle throws during the draft', () => {
    expect(() => startBattle(createMatch(config()))).toThrow(/draft/);
  });
});

describe('endRound', () => {
  it('throws during the draft and without a battle result', () => {
    const s = createMatch(config());
    expect(() => endRound(s)).toThrow(/phase is draft/);
    draftAll(s);
    expect(() => endRound(s)).toThrow(/no result/);
  });

  it.each([0, 1] as const)('gives the loser a bonus pick when player %i wins', (winner) => {
    const loser = winner === 0 ? 1 : 0;
    const s = createMatch(config());
    draftAll(s);
    finishBattle(s, winner);
    expect(endRound(s)).toBe(s);
    expect(s.lives[winner]).toBe(START_LIVES);
    expect(s.lives[loser]).toBe(START_LIVES - 1);
    expect(s.round).toBe(2);
    expect(s.phase).toBe('draft');
    expect(s.lastPick).toBeNull();
    expect(s.draft.pickIndex).toBe(0);
    expect(s.draft.order).toEqual([loser, winner, loser, winner, loser, winner, loser]);
    expect(currentPlayer(s)).toBe(loser);
    expect(picksRemaining(s, loser)).toBe(4);
    expect(picksRemaining(s, winner)).toBe(3);
    expect(getOffer(s).player).toBe(loser);
    draftAll(s);
    expect(s.picks).toHaveLength(13);
    expect(s.lastPick?.player).toBe(loser);
  });

  it('takes a life from both players on a draw and flips a new coin', () => {
    const starters = new Set<number>();
    for (let seed = 0; seed < 40; seed++) {
      const s = createMatch(config(seed));
      playRound(s, 'draw');
      expect(s.lives).toEqual([START_LIVES - 1, START_LIVES - 1]);
      expect(s.draft.order).toHaveLength(6);
      const a = s.draft.order[0];
      expect(s.draft.order).toEqual([
        a,
        1 - (a as number),
        a,
        1 - (a as number),
        a,
        1 - (a as number),
      ]);
      // The second coin flip is the second draw of the match stream.
      const coin = seedRng(seed, STREAM_MATCH);
      nextInt(coin, 2);
      expect(a).toBe(nextInt(coin, 2));
      starters.add(a as number);
    }
    expect(starters.size).toBe(2);
  });

  it('records the outcome without aliasing the battle result', () => {
    const s = createMatch(config());
    draftAll(s);
    finishBattle(s, 1);
    const result = s.battle.result as BattleResult;
    endRound(s);
    expect(s.rounds).toEqual([{ round: 1, result, lives: [3, 4] }]);
    result.hp[0] = 999;
    expect(s.rounds[0]?.result.hp).toEqual([0, 10]);
  });

  it('starts the next round on an empty field with the continued battle stream', () => {
    const s = createMatch(config());
    draftAll(s);
    expect(s.battle.units.length).toBeGreaterThan(0);
    // Pretend the simulation advanced the battle stream and the clock.
    s.battle.rng = [1, 2, 3, 4];
    s.battle.tick = 500;
    s.battle.started = true;
    finishBattle(s, 0);
    const old = s.battle;
    endRound(s);
    expect(s.battle).not.toBe(old);
    expect(s.battle.units).toEqual([]);
    expect(s.battle.projectiles).toEqual([]);
    expect(s.battle.zones).toEqual([]);
    expect(s.battle.occ.every((v) => v === 0)).toBe(true);
    expect(s.battle.tick).toBe(0);
    expect(s.battle.started).toBe(false);
    expect(s.battle.result).toBeNull();
    expect(s.battle.nextUnitId).toBe(1);
    expect(s.battle.rng).toEqual([1, 2, 3, 4]);
    expect(s.battle.rng).not.toBe(old.rng);
  });

  it('ends the match when a player has no lives left', () => {
    for (const winner of [0, 1] as const) {
      const s = createMatch(config());
      for (let r = 0; r < START_LIVES; r++) {
        expect(s.phase).toBe('draft');
        playRound(s, winner);
      }
      expect(s.phase).toBe('finished');
      expect(s.winner).toBe(winner);
      expect(s.lives[winner]).toBe(START_LIVES);
      expect(s.lives[winner === 0 ? 1 : 0]).toBe(0);
      expect(s.round).toBe(START_LIVES);
      expect(s.rounds.map((o) => o.round)).toEqual([1, 2, 3, 4]);
      expect(s.draft.offer).toBeNull();
      // The final field stays for display.
      expect(s.battle.units.length).toBeGreaterThan(0);
      expect(() => applyPick(s, 0)).toThrow(/finished/);
      expect(() => getOffer(s)).toThrow(/finished/);
      expect(() => startBattle(s)).toThrow(/finished/);
      expect(() => endRound(s)).toThrow(/finished/);
    }
  });

  it('declares a draw when both players lose their last life in the same round', () => {
    const s = createMatch(config());
    playRound(s, 0);
    playRound(s, 1);
    playRound(s, 'draw');
    expect(s.lives).toEqual([2, 2]);
    playRound(s, 'draw');
    expect(s.lives).toEqual([1, 1]);
    expect(s.phase).toBe('draft');
    playRound(s, 'draw');
    expect(s.lives).toEqual([0, 0]);
    expect(s.phase).toBe('finished');
    expect(s.winner).toBe('draw');
  });

  it('a draw only finishes the match for the player at 0', () => {
    const s = createMatch(config());
    playRound(s, 0);
    playRound(s, 0);
    playRound(s, 0);
    expect(s.lives).toEqual([4, 1]);
    playRound(s, 'draw');
    expect(s.lives).toEqual([3, 0]);
    expect(s.winner).toBe(0);
  });

  it('keeps every chosen slot in picks across rounds', () => {
    const s = createMatch(config(77));
    const chosen: number[] = [];
    const results: Winner[] = [1, 'draw', 0, 0, 1, 1];
    let k = 0;
    for (const winner of results) {
      if (s.phase === 'finished') break;
      while (s.phase === 'draft') {
        const slot = (k * 7 + 1) % OFFER_SIZE;
        k++;
        chosen.push(slot);
        applyPick(s, slot);
      }
      finishBattle(s, winner);
      endRound(s);
    }
    expect(s.picks).toEqual(chosen);
    // 6 + 7 (loser bonus) + 6 (after draw) + 7 + 7 + 7 = 40 picks for six rounds.
    expect(chosen).toHaveLength(40);
    expect(s.phase).toBe('finished');
    expect(s.winner).toBe(1);
  });
});

describe('determinism', () => {
  function playScript(seed: number): string[] {
    const s = createMatch(config(seed));
    const hashes = [hashState(s)];
    const results: Winner[] = [0, 'draw', 1, 1, 0, 1, 0];
    let k = 0;
    for (const winner of results) {
      if (s.phase === 'finished') break;
      while (s.phase === 'draft') {
        applyPick(s, (k++ * 5) % OFFER_SIZE);
        hashes.push(hashState(s));
      }
      finishBattle(s, winner);
      endRound(s);
      hashes.push(hashState(s));
    }
    return hashes;
  }

  it('gives identical hashes for the same seed and picks', () => {
    expect(playScript(5)).toEqual(playScript(5));
    expect(playScript(2 ** 40 + 3)).toEqual(playScript(2 ** 40 + 3));
  });

  it('gives different hashes for different seeds', () => {
    const a = playScript(5);
    const b = playScript(6);
    expect(a[0]).not.toBe(b[0]);
    expect(a[a.length - 1]).not.toBe(b[b.length - 1]);
  });

  it('a cloned state continues exactly like the original', () => {
    const s = createMatch(config(8));
    applyPick(s, 1);
    applyPick(s, 2);
    const c = cloneState(s);
    expect(hashState(c)).toBe(hashState(s));
    draftAll(s);
    draftAll(c);
    expect(hashState(c)).toBe(hashState(s));
  });
});
