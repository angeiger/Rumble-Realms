/**
 * Bot data (SPEC 8.1): levels and ready-made profiles with fixed decks.
 * Only the level "easy" exists so far; medium and hard follow in M3.
 */
import type { CardId } from './cards.ts';

export type BotLevelId = 'easy';

export interface BotLevel {
  /** Elo the bot counts as (SPEC 8.1). */
  elo: number;
  /** Level of all cards of the bot. */
  cardLevel: number;
}

export interface BotProfile {
  id: string;
  /** Cartoon name shown to the player. */
  name: string;
  level: BotLevelId;
  /** Exactly DECK_SIZE distinct cards from the pool of arena 1. */
  deck: CardId[];
}

export const BOT_LEVELS: Record<BotLevelId, BotLevel> = {
  easy: { elo: 800, cardLevel: 1 },
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
];
