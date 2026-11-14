/**
 * Global rule and balance values (SPEC 2.5: no magic numbers in the code).
 * Times are in ticks, distances in fields or milli-fields, percentages in basis points.
 */

// --- Time ---
export const TICKS_PER_SECOND = 20;
/** Sudden death starts after 60 s (SPEC 4.2). */
export const SUDDEN_DEATH_TICK = 60 * TICKS_PER_SECOND;
/** All damage is multiplied by this during sudden death (+50 %). */
export const SUDDEN_DEATH_DAMAGE_BPS = 15000;
/** A battle ends after 90 s at the latest (SPEC 4.2). */
export const TIME_LIMIT_TICKS = 90 * TICKS_PER_SECOND;
/** Units look for a better target every 0.5 s (SPEC 6.2). */
export const RETARGET_INTERVAL_TICKS = 10;
/** A unit blocked for longer than 1 s uses A* path finding (SPEC 6.2). */
export const STUCK_TICKS_BEFORE_PATHFINDING = 20;

// --- Field ---
export const GRID_COLS = 12;
export const GRID_ROWS = 24;
/** Rows per player: A owns rows 0-11, B rows 12-23 (SPEC 4.1). */
export const HALF_ROWS = 12;
export const GRID_CELLS = GRID_COLS * GRID_ROWS;
/** Milli-fields per field. */
export const FIELD = 1000;
/** Length of a diagonal step in milli-fields (1000 * sqrt 2, rounded). */
export const DIAGONAL_STEP = 1414;
/** Placement zones as rows counted from the own base line (SPEC 4.4), inclusive. */
export const ZONE_ROWS = {
  front: { from: 8, to: 11 },
  mid: { from: 4, to: 7 },
  back: { from: 0, to: 3 },
} as const;

// --- Combat ---
/** Melee reaches the 8 neighbouring cells (SPEC 6.2). */
export const MELEE_RANGE = 1;

// --- Match ---
export const START_LIVES = 4;
export const DECK_SIZE = 4;
export const OFFER_SIZE = 3;
export const PICKS_PER_ROUND = 3;
/** Extra picks for the loser of the previous round (SPEC 4.2). */
export const LOSER_BONUS_PICKS = 1;

// --- Levels ---
export const BPS = 10000;
export const MAX_LEVEL = 5;
/** +10 % HP and damage per level above 1, additive (SPEC 6.3). */
export const LEVEL_BONUS_BPS = 1000;
