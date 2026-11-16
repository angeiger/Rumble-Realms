/**
 * Bot data (SPEC 8.1): levels and ready-made profiles with fixed decks.
 * Easy picks at random, medium by a battle estimate from the card data, hard by Monte Carlo
 * simulation together with that estimate (bots.ts). The master level follows later.
 */
import type { CardId } from './cards.ts';

export type BotLevelId = 'easy' | 'medium' | 'hard';

export interface BotLevel {
  /** Elo the bot counts as (SPEC 8.1). */
  elo: number;
  /** Level of all cards of the bot. */
  cardLevel: number;
  /** Highest arena whose cards the decks of this level may use. */
  maxArena: number;
  /**
   * Monte Carlo runs per offer slot (hard bot): each one plays the rest of the round with
   * random picks and simulates the battle. 0 = the level does not simulate.
   */
  simulations: number;
  /**
   * Hard bot: points the medium bot's battle estimate adds to the result of every simulation
   * for an estimated lead as large as the hit points of both armies together (a simulation
   * scores between -1000 and 3000). The simulations only see the current round, the estimate
   * rates the mix of the army for the rounds to come (D-079). 0 = simulations only.
   */
  estimateWeight: number;
}

export interface BotProfile {
  id: string;
  /** Cartoon name shown to the player. */
  name: string;
  level: BotLevelId;
  /** Exactly DECK_SIZE distinct cards from the pools up to the level's `maxArena`. */
  deck: CardId[];
}

/**
 * Weights of the medium bot's battle estimate (bots.ts, D-079). For every offer slot the bot
 * estimates the hit point lead of the own army (with that pick) over the opponent's at the
 * end of a battle: both sides lose hit points at the damage rate of the other side until one
 * is destroyed or the time limit is reached (Lanchester style, no simulation). Tuned with
 * medium against easy in mirror matches. Percentages in basis points, distances in fields,
 * times in seconds.
 */
export interface MediumHeuristic {
  /**
   * Melee ground units that can fight at the same time (only the front line reaches the
   * enemy). More melee units only add hit points.
   */
  meleeFrontage: number;
  /** The same for melee flyers: they fly over the front and can surround their target. */
  airFrontage: number;
  /**
   * Share of the nominal damage per second that actually lands in a battle (walking,
   * changing targets, overkill, missed shots). Healing always lands; so this sets how much
   * healing is worth against damage, and how often the time limit decides.
   */
  damageEfficiencyBps: number;
  /** Damage bonus of a shooter per field of range beyond melee (it fires while others walk). */
  rangeBonusBps: number;
  /**
   * Upper limit of the free fire of a shooter: the time its lead in range over the enemy army
   * gives it while the enemy closes in.
   */
  freeFireMaxSeconds: number;
  /** Range the artillery counts with: it reaches the whole field. */
  artilleryRange: number;
  /**
   * Area damage: extra targets per hit for every enemy unit on a layer it can hit, per
   * square field of radius (enemy units stand closer together the more of them there are).
   */
  areaHitsPerUnitBps: number;
  /** Upper limit of the extra targets per hit of area damage. */
  areaMaxExtraHitsBps: number;
  /**
   * Blasts (TNT, spore clouds) destroy at most this share of the enemy hit points on a layer:
   * they all go off at the nearest enemies and overlap.
   */
  blastMaxShareBps: number;
  /** Healing can cancel at most this share of the incoming damage (it is spread, damage is focused). */
  healMaxShareBps: number;
  /** Share of a summoner's maximum summons that is alive on average. */
  summonUptimeBps: number;
  /** Damage bonus of an active upgrade whose effect the estimate does not model in detail. */
  upgradeDamageBps: number;
  /**
   * Future copies of a card count with this share when an upgrade is rated (later is less
   * certain than now).
   */
  futureCopiesBps: number;
  /**
   * The opponent's deck is unknown: besides what the opponent has played, the bot assumes this
   * many picks spread evenly over all cards.
   */
  opponentPriorPicks: number;
  /** The prior shrinks by one pick per card the opponent has played, down to this many. */
  opponentPriorMinPicks: number;
  /**
   * How far the opponent's army is scaled towards the size (hit points) of the own army
   * before the picks are compared: 0 = real size, 10000 = the same hit points.
   */
  opponentScaleBps: number;
  /**
   * Seconds of fighting until the time limit decides (SPEC 4.2: 90 s, the last 30 s with
   * sudden death, minus the time to close in).
   */
  battleSeconds: number;
}

export const MEDIUM_HEURISTIC: MediumHeuristic = {
  meleeFrontage: 8,
  airFrontage: 24,
  damageEfficiencyBps: 5000,
  rangeBonusBps: 1000,
  freeFireMaxSeconds: 10,
  artilleryRange: 8,
  areaHitsPerUnitBps: 500,
  areaMaxExtraHitsBps: 20000,
  blastMaxShareBps: 2500,
  healMaxShareBps: 5000,
  summonUptimeBps: 7500,
  upgradeDamageBps: 6000,
  futureCopiesBps: 5000,
  opponentPriorPicks: 2,
  opponentPriorMinPicks: 0,
  opponentScaleBps: 5000,
  battleSeconds: 90,
};

export const BOT_LEVELS: Record<BotLevelId, BotLevel> = {
  easy: { elo: 800, cardLevel: 1, maxArena: 1, simulations: 0, estimateWeight: 0 },
  medium: { elo: 1000, cardLevel: 2, maxArena: 2, simulations: 0, estimateWeight: 0 },
  hard: { elo: 1250, cardLevel: 3, maxArena: 3, simulations: 6, estimateWeight: 15000 },
};

export const BOT_PROFILES: BotProfile[] = [
  {
    id: 'goblin-gustav',
    name: 'Goblin-Gustav',
    level: 'easy',
    deck: ['knight', 'skeleton', 'tnt', 'bat'],
  },
  {
    id: 'lady-knochenkralle',
    name: 'Lady Knochenkralle',
    level: 'easy',
    deck: ['skeleton', 'bat', 'archer', 'healer'],
  },
  {
    id: 'professor-pulverdampf',
    name: 'Professor Pulverdampf',
    level: 'easy',
    deck: ['musketeer', 'archer', 'knight', 'healer'],
  },
  // Medium: cards up to arena 2.
  {
    id: 'baron-pilzbart',
    name: 'Baron Pilzbart',
    level: 'medium',
    deck: ['shroomling', 'pyromancer', 'knight', 'healer'],
  },
  {
    id: 'graefin-gruftgrusel',
    name: 'Gräfin Gruftgrusel',
    level: 'medium',
    deck: ['necromancer', 'skeleton', 'bat', 'berserker'],
  },
  {
    id: 'schatten-schorsch',
    name: 'Schatten-Schorsch',
    level: 'medium',
    deck: ['assassin', 'musketeer', 'tnt', 'archer'],
  },
  // Hard: cards up to arena 3.
  {
    id: 'koenig-klotzkopf',
    name: 'König Klotzkopf',
    level: 'hard',
    deck: ['golem', 'beetle', 'healer', 'musketeer'],
  },
  {
    id: 'madame-funkenfeder',
    name: 'Madame Funkenfeder',
    level: 'hard',
    deck: ['pyromancer', 'beetle', 'berserker', 'bat'],
  },
  {
    id: 'general-grummelbart',
    name: 'General Grummelbart',
    level: 'hard',
    deck: ['golem', 'necromancer', 'archer', 'assassin'],
  },
];
