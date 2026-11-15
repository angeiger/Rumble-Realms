/**
 * Bot data (SPEC 8.1): levels and ready-made profiles with fixed decks.
 * Easy picks at random, medium by a counter heuristic, hard by Monte Carlo simulation
 * (bots.ts). The master level follows later.
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
}

export interface BotProfile {
  id: string;
  /** Cartoon name shown to the player. */
  name: string;
  level: BotLevelId;
  /** Exactly DECK_SIZE distinct cards from the pools up to the level's `maxArena`. */
  deck: CardId[];
}

export const BOT_LEVELS: Record<BotLevelId, BotLevel> = {
  easy: { elo: 800, cardLevel: 1, maxArena: 1, simulations: 0 },
  medium: { elo: 1000, cardLevel: 2, maxArena: 2, simulations: 0 },
  hard: { elo: 1250, cardLevel: 3, maxArena: 3, simulations: 6 },
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
