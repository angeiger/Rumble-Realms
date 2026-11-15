/**
 * Shared types of the engine: card definitions, match and battle state, events.
 *
 * Rules for everything in here (SPEC 6.1, DECISIONS D-018 ff.):
 * - State is plain, JSON-serialisable data (no classes, Map, Set, undefined holes).
 * - All numbers are integers. Time is counted in ticks (20 per second), distances in
 *   cells or milli-fields (1 field = 1000), percentages in basis points (1 % = 100).
 * - State objects are mutated in place by the engine functions. Use `cloneState` for copies.
 */
import type { CardId } from './data/cards.ts';

export type { CardId };

export type PlayerIndex = 0 | 1;
export type Winner = PlayerIndex | 'draw';

/** 0 = ground, 1 = air. Each cell holds at most one unit per layer (SPEC 4.1). */
export type Layer = 0 | 1;
export const GROUND: Layer = 0;
export const AIR: Layer = 1;

// ---------------------------------------------------------------------------
// Card definitions (values live in data/cards.ts)
// ---------------------------------------------------------------------------

export type Zone = 'front' | 'mid' | 'back';
export type Rarity = 'common' | 'rare' | 'epic';
export type Role =
  | 'tank'
  | 'melee'
  | 'swarm'
  | 'bomb'
  | 'support'
  | 'flyer'
  | 'ranged'
  | 'mage'
  | 'artillery'
  | 'summoner';

/** Hits one adjacent enemy (8 neighbouring cells) instantly. */
export interface MeleeAttack {
  kind: 'melee';
  damage: number;
  intervalTicks: number;
}

/** Fires a homing projectile that hits if the target is still alive on impact. */
export interface RangedAttack {
  kind: 'ranged';
  damage: number;
  intervalTicks: number;
  /** In fields, at least 2. */
  range: number;
  /** Milli-fields per tick. */
  projectileSpeed: number;
}

/** Heals allies; fights in melee once no other allies are left (SPEC 5.3 Heiler). */
export interface HealAttack {
  kind: 'heal';
  amount: number;
  intervalTicks: number;
  /** In fields. */
  range: number;
  /** Distance in fields kept to the followed ally while nobody needs healing. */
  followDistance: number;
  /** Melee damage used once no non-healer ally is left. */
  fallbackDamage: number;
}

/**
 * Runs to the nearest ground enemy and blows itself up (SPEC 5.3 Lauf-TNT, D-050): a fuse
 * starts once an enemy is within `triggerRange`, goes out when none is left in range, and
 * sets the charge off after `fuseTicks`. Dying from damage sets it off at once.
 */
export interface ExplodeAttack {
  kind: 'explode';
  damage: number;
  /** Blast radius in milli-fields. */
  radius: number;
  /** Fields (logical cells, D-022) within which an enemy lights the fuse. */
  triggerRange: number;
  /** Ticks from lighting the fuse to the blast. */
  fuseTicks: number;
}

export type AttackDef = MeleeAttack | RangedAttack | HealAttack | ExplodeAttack;

export interface CardDef {
  id: CardId;
  /** Units spawned per played card. */
  count: number;
  role: Role;
  zone: Zone;
  layer: Layer;
  /** Level 1 hit points. */
  hp: number;
  /** Milli-fields per tick (1.0 field/s = 50). */
  moveSpeed: number;
  /** Which layers this unit can attack. */
  targets: { ground: boolean; air: boolean };
  attack: AttackDef;
  rarity: Rarity;
  /** Arena (1-5) whose pool contains this card. */
  arena: number;
  /** Berserker: attack interval shrinks linearly with missing HP; heals from damage dealt. */
  rage?: { intervalReductionTicks: number; lifestealBps: number };
  /**
   * Assassin: charges at battle start, then teleports to the cell where the ground enemy
   * farthest from it stood at battle start (D-049).
   */
  shadowJump?: { chargeTicks: number };
  /** Shroomling: leaves a damaging cloud on death. Radius in milli-fields. */
  deathCloud?: { radius: number; damagePerSecond: number; durationTicks: number };
}

// ---------------------------------------------------------------------------
// Random numbers
// ---------------------------------------------------------------------------

/** xoshiro128** state: four unsigned 32-bit integers. */
export type RngState = [number, number, number, number];

// ---------------------------------------------------------------------------
// Battle
// ---------------------------------------------------------------------------

/** What a unit is currently trying to do with its target. */
export type UnitMode = 'attack' | 'heal' | 'follow';

export interface UnitState {
  /** Ascending in spawn order; fixes the processing order (SPEC 6.1). Starts at 1. */
  id: number;
  owner: PlayerIndex;
  card: CardId;
  level: number;
  layer: Layer;
  /** Logical cell: used for distances, ranges and area damage. Changes on arrival. */
  x: number;
  y: number;
  /** Occupied cell. Equals (x, y) while standing; the reserved next cell while stepping. */
  tx: number;
  ty: number;
  /** Length of the current step in milli-fields (1000 or 1414); 0 while standing. */
  moveCost: number;
  /** Milli-fields already covered of the current step. */
  moveProgress: number;
  /** Overshoot of the last step, credited to the next one if it starts right away. */
  moveCarry: number;
  hp: number;
  maxHp: number;
  mode: UnitMode;
  /** Unit id of the current target (enemy or ally, depending on mode); 0 = none. */
  targetId: number;
  /** Tick at which the target is re-evaluated. */
  retargetTick: number;
  /** First tick at which the unit may attack or heal again. */
  nextAttackTick: number;
  /** Consecutive ticks the unit wanted to step but found no cell. */
  stuckTicks: number;
  /** Remaining A* path as cell indices (y * GRID_COLS + x); empty if none. */
  path: number[];
  /** Assassin: tick of the pending shadow jump; -1 = none. */
  jumpTick: number;
  /** Assassin: cell the shadow jump aims at, fixed at battle start (D-049); -1 = none. */
  jumpX: number;
  jumpY: number;
  /** TNT: tick at which the burning fuse sets it off (D-050); -1 = fuse not burning. */
  fuseTick: number;
}

export interface ProjectileState {
  id: number;
  owner: PlayerIndex;
  sourceId: number;
  targetId: number;
  /** Damage before the sudden-death bonus, fixed at launch. */
  damage: number;
  launchTick: number;
  impactTick: number;
}

/** Lingering area that damages enemies of `owner` standing in it (e.g. spore cloud). */
export interface ZoneState {
  id: number;
  owner: PlayerIndex;
  x: number;
  y: number;
  /** Milli-fields. */
  radius: number;
  damagePerSecond: number;
  hitsGround: boolean;
  hitsAir: boolean;
  startTick: number;
  endTick: number;
}

export type BattleEndReason = 'elimination' | 'timeout';

export interface BattleResult {
  winner: Winner;
  reason: BattleEndReason;
  /** Number of simulated ticks. */
  ticks: number;
  /** Sum of remaining hit points per player. */
  hp: [number, number];
}

export interface BattleState {
  engineVersion: number;
  /** Number of ticks simulated so far; also the index of the next tick. */
  tick: number;
  /** False during the draft; set by the first `stepTick`. */
  started: boolean;
  nextUnitId: number;
  nextProjectileId: number;
  nextZoneId: number;
  /** Living units, ascending by id. */
  units: UnitState[];
  projectiles: ProjectileState[];
  zones: ZoneState[];
  /** Occupancy: unit id per cell and layer, 0 = free. Index: layer * cells + y * cols + x. */
  occ: number[];
  rng: RngState;
  result: BattleResult | null;
}

/** Things that happened in one tick, for the renderer. They never influence the simulation. */
export type BattleEvent =
  | { type: 'attack'; unit: number; target: number }
  | { type: 'shot'; id: number; unit: number; target: number; impactTick: number }
  | { type: 'damage'; unit: number; amount: number }
  | { type: 'heal'; unit: number; target: number; amount: number }
  | { type: 'death'; unit: number }
  | { type: 'explosion'; unit: number; x: number; y: number; radius: number }
  | { type: 'jump'; unit: number; fromX: number; fromY: number; x: number; y: number }
  | { type: 'zone'; id: number; x: number; y: number; radius: number; endTick: number };

// ---------------------------------------------------------------------------
// Match
// ---------------------------------------------------------------------------

export interface PlayerConfig {
  /** Exactly DECK_SIZE distinct cards. */
  deck: CardId[];
  /** Card levels 1..MAX_LEVEL; missing cards count as level 1. */
  levels: Partial<Record<CardId, number>>;
}

export interface MatchConfig {
  /** Non-negative safe integer. */
  seed: number;
  players: [PlayerConfig, PlayerConfig];
}

/** One of the three cards on offer. Special cards (double, upgrade) follow in M3. */
export type OfferSlot = { kind: 'spawn'; card: CardId };

export interface Offer {
  player: PlayerIndex;
  slots: OfferSlot[];
}

export interface PickInfo {
  player: PlayerIndex;
  slot: number;
  card: CardId;
  /** Ids of the units of this card that got a cell on the field. */
  spawned: number[];
  /** Units of this card that found no free cell in the player's half (D-052). */
  forfeited: number;
}

/**
 * One card played in this match (D-046, D-053). The whole army is set up again on the
 * field after every pick and at the start of every round.
 */
export interface ArmyEntry {
  player: PlayerIndex;
  card: CardId;
  level: number;
  /** Random center column of the card, relative to the owner (0..11, D-052). */
  column: number;
  /** Round in which the card was played (1-based). */
  round: number;
  /** Unit ids reserved for this card (CARDS[card].count of them); kept for the whole match. */
  unitIds: number[];
}

export interface RoundOutcome {
  round: number;
  result: BattleResult;
  /** Lives after this round. */
  lives: [number, number];
}

export type MatchPhase = 'draft' | 'battle' | 'finished';

export interface MatchState {
  engineVersion: number;
  config: MatchConfig;
  phase: MatchPhase;
  /** 1-based. */
  round: number;
  lives: [number, number];
  draft: {
    /** Who picks when in this round, e.g. [0,1,0,1,0,1] or with loser bonus [1,0,1,0,1,0,1]. */
    order: PlayerIndex[];
    /** Index into `order` of the pick that is due. */
    pickIndex: number;
    /** Offer for the player whose turn it is; null outside the draft. */
    offer: Offer | null;
  };
  /** Every chosen slot (0..2) since match start, in order. Enough to replay the match. */
  picks: number[];
  lastPick: PickInfo | null;
  /** Finished rounds, oldest first. */
  rounds: RoundOutcome[];
  /** Separate streams so that e.g. placement never shifts the offers (SPEC 6.1). */
  rng: { match: RngState; offers: RngState; placement: RngState };
  /** Every card played so far by both players, in pick order (D-053). */
  army: ArmyEntry[];
  /**
   * Next unit id to hand out, match-wide (starts at 1). Ids are never reused: at the end of
   * a round this also covers ids the battle handed out itself (e.g. summoned units).
   */
  nextUnitId: number;
  /**
   * The field: set up from `army` during the draft, simulated during the battle, replaced
   * at the start of each round (the last field stays after the match).
   */
  battle: BattleState;
  /** Set when the match is over. */
  winner: Winner | null;
}
