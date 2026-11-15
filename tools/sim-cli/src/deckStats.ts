/**
 * Strength of a card in a deck (balance section "Karte im Deck" and the `tune` command):
 * many whole matches with random decks of four different cards, both sides at the same level
 * with all upgrades unlocked, random picks. Every player scores 1 for a won match, 0.5 for a
 * draw and 0 for a loss; each card of the deck gets that score.
 */
import {
  ALL_UPGRADES_MASK,
  CARD_IDS,
  DECK_SIZE,
  START_LIVES,
  createMatch,
  applyPick,
  endRound,
  nextInt,
  nextU32,
  randomPicker,
  seedRng,
  simulateToEnd,
  startBattle,
} from '@rumble-realms/engine';
import type { CardId, MatchConfig, PlayerConfig, RngState } from '@rumble-realms/engine';

/** Stream number for random picks (the engine itself uses 1..4; robust uses 100). */
export const PICK_STREAM = 100;

const TWO_POW_21 = 2097152;
const TWO_POW_32 = 4294967296;

/** A random match seed below 2^53, like `randomConfig` draws it. */
export function randomSeed(rng: RngState): number {
  return nextInt(rng, TWO_POW_21) * TWO_POW_32 + nextU32(rng);
}

/** Four different random cards out of all 16. */
export function randomDeck(rng: RngState): CardId[] {
  const pool: CardId[] = [...CARD_IDS];
  const deck: CardId[] = [];
  for (let i = 0; i < DECK_SIZE; i++) {
    deck.push(pool.splice(nextInt(rng, pool.length), 1)[0] as CardId);
  }
  return deck;
}

/** All cards of `deck` at `level`, all three upgrades of every card unlocked. */
export function fullPlayer(deck: readonly CardId[], level: number): PlayerConfig {
  const levels: Partial<Record<CardId, number>> = {};
  const upgrades: Partial<Record<CardId, number>> = {};
  for (const card of deck) {
    levels[card] = level;
    upgrades[card] = ALL_UPGRADES_MASK;
  }
  return { deck: [...deck], levels, upgrades };
}

/** Plays one match with random picks (stream PICK_STREAM of the match seed) to its end. */
export function playRandomMatch(cfg: MatchConfig): 0 | 1 | 'draw' {
  const state = createMatch(cfg);
  const picker = randomPicker(seedRng(cfg.seed, PICK_STREAM));
  while (state.phase !== 'finished') {
    if (state.phase === 'draft') applyPick(state, picker(state));
    else {
      simulateToEnd(startBattle(state));
      endRound(state);
    }
  }
  return state.winner as 0 | 1 | 'draw';
}

export interface DeckCardResults {
  matches: number;
  /** uses[i]: decks (players) that contained CARD_IDS[i]. */
  uses: number[];
  /** points[i]: summed match score of those players. */
  points: number[];
}

/**
 * `matches` random matches from the random stream (`seed`, `stream`). Each match draws its
 * seed and two independent random decks; a card in both decks is counted for both players.
 */
export function runDeckCardMatches(
  seed: number,
  stream: number,
  matches: number,
  level: number,
): DeckCardResults {
  const rng = seedRng(seed, stream);
  const index = new Map<CardId, number>(CARD_IDS.map((c, i) => [c, i]));
  const uses = CARD_IDS.map(() => 0);
  const points = CARD_IDS.map(() => 0);
  for (let m = 0; m < matches; m++) {
    const matchSeed = randomSeed(rng);
    const decks = [randomDeck(rng), randomDeck(rng)] as const;
    const winner = playRandomMatch({
      seed: matchSeed,
      players: [fullPlayer(decks[0], level), fullPlayer(decks[1], level)],
    });
    for (const side of [0, 1] as const) {
      const score = winner === side ? 1 : winner === 'draw' ? 0.5 : 0;
      for (const card of decks[side]) {
        const i = index.get(card) as number;
        uses[i] = (uses[i] as number) + 1;
        points[i] = (points[i] as number) + score;
      }
    }
  }
  return { matches, uses, points };
}

/** Win rate per card (0.5 for a card that never appeared). */
export function deckWinRates(r: DeckCardResults): number[] {
  return r.uses.map((n, i) => (n === 0 ? 0.5 : (r.points[i] as number) / n));
}

/** Half width of the rough 95 % interval of a rate `p` measured on `n` samples (normal approx.). */
export function ci95(p: number, n: number): number {
  return n === 0 ? 1 : 1.96 * Math.sqrt((p * (1 - p)) / n);
}

/**
 * Chance that the winner of round 1 wins the match if every later round were an independent
 * coin flip without draws (D-057): it must win `lives - 1` more rounds before the opponent
 * wins `lives`. For 4 lives: 42/64 = 65.6 %.
 */
export function firstRoundLeadTheory(lives: number = START_LIVES): number {
  const need = lives - 1; // rounds the leader still has to win
  const other = lives; // rounds the other player has to win
  if (need <= 0) return 1;
  // Sum over the number k of rounds the other player wins before the leader's last win.
  let p = 0;
  for (let k = 0; k < other; k++) p += binom(need - 1 + k, k) * 0.5 ** (need + k);
  return p;
}

function binom(n: number, k: number): number {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}
