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
  /**
   * Area damage on impact (pyromancer, whelp): hits every enemy on an attackable layer whose
   * cell lies within this radius (milli-fields) of the target's cell at impact. Fizzles
   * completely if the main target is dead by then.
   */
  splashRadius?: number;
  /** Frost shaman: a hit slows movement and attack speed of the target (renewed, no stacking). */
  slow?: { bps: number; durationTicks: number };
}

/**
 * Bombardier beetle (SPEC 5.3): lobs a slow shell at the **cell** its target stands on at
 * launch; on impact every enemy on an attackable layer within `radius` of that cell is hit.
 * Reaches the whole field, but only targets enemies at least `minRange` fields away.
 */
export interface ArtilleryAttack {
  kind: 'artillery';
  damage: number;
  /** Milli-fields. */
  radius: number;
  intervalTicks: number;
  /** Fields: targets need dx^2 + dy^2 >= minRange^2. */
  minRange: number;
  /** Fixed flight time of the shell in ticks. */
  flightTicks: number;
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

export type AttackDef = MeleeAttack | RangedAttack | HealAttack | ExplodeAttack | ArtilleryAttack;

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
  /**
   * Necromancer: every `intervalTicks` (first time `intervalTicks` after spawning) a unit of
   * `card` with the summoner's level appears on the nearest free neighbouring ground cell,
   * as long as fewer than `max` of its summons are alive.
   */
  summon?: { card: CardId; intervalTicks: number; max: number };
}

/**
 * One upgrade of a card (SPEC 5.4; values live in data/upgrades.ts). `params` holds
 * positive integers in engine units (ticks, basis points, milli-fields, hit points).
 * Upgrades with `implemented: false` never appear on offer.
 */
export interface UpgradeDef {
  /** '<card>.<snake_case_name>', unique. */
  id: string;
  implemented: boolean;
  params: Readonly<Record<string, number>>;
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

  // --- Stats resolved at spawn (level and active upgrades of the own card) ---
  /** Bit mask of the upgrades of the own card that were active when the unit spawned. */
  up: number;
  /** Move speed in milli-fields per tick before status effects. */
  speed: number;
  /** Attack range in fields (ranged: incl. upgrades; heal: heal range; others: 1). */
  range: number;
  /** Damage taken is reduced by this share (basis points, 0 = none). */
  armorBps: number;

  // --- Summons ---
  /** Id of the unit that summoned this one; 0 = part of the army. */
  summonerId: number;
  /** Summoner: tick of the next summon; -1 = never. */
  summonTick: number;

  // --- Status effects (battle/status.ts). An effect is active while tick < its end tick. ---
  /** Slows movement and attack speed by `slowBps` (basis points) until `slowUntil`. */
  slowBps: number;
  slowUntil: number;
  /** Slows only the attack speed by `atkSlowBps` until `atkSlowUntil`. */
  atkSlowBps: number;
  atkSlowUntil: number;
  /** Stunned or frozen (no attacks, abilities or movement) until this tick. */
  stunUntil: number;
  /** Burn: `burnDps` damage per second in the ticks burnStart < tick <= burnUntil (D-025). */
  burnDps: number;
  burnStart: number;
  burnUntil: number;
  /** Poison: like burn, separate slot. */
  poisonDps: number;
  poisonStart: number;
  poisonUntil: number;
  /** Shield points absorb damage before hit points. */
  shield: number;
  /** Takes no damage at all until this tick. */
  invulnUntil: number;
  /** Enemies cannot pick it as a target until this tick (area damage still hits). */
  untargetableUntil: number;
  /** Deals `dmgBonusBps` more damage until `dmgBonusUntil`. */
  dmgBonusBps: number;
  dmgBonusUntil: number;

  // --- Upgrade counters (reset with every new unit, i.e. every round) ---
  /** Attacks, shots, shells and heals started so far, bayonet stabs excluded (headshot). */
  attacks: number;
  /** Own single-target hits that landed so far (frost shaman ice block). */
  hits: number;
  /** Direct hits that are still ignored completely (pyromancer heat shield). */
  ignoreHits: number;
  /** Remaining triggers of the berserker's unstoppable (once per round). */
  unstoppableLeft: number;
  /** True after a step was started, until the next melee attack (knight charge). */
  moved: boolean;
  /** Factor on all own damage, basis points (10000 = normal; daughter TNT, mini golems). */
  powerBps: number;
  /** Remaining revives of a healer in this round (Wiederbelebung). */
  reviveLeft: number;
  /** Tick of the next timed upgrade ability (meteor, earthquake, frost nova, growth); -1 = none. */
  abilityTick: number;
  /** Growth stacks gained so far (whelp). */
  stacks: number;
  /** Assassin shadow step: first tick at which it may jump again. */
  jumpReadyTick: number;
  /** Riesenpilz: this shroomling is the giant of its group (3x HP and damage). */
  giant: boolean;
  /** Lich-Form: the necromancer has returned as a flying ghost (this round only). */
  ghost: boolean;
  /**
   * Ansteckend: hit by a contagious spore cloud while tick < sporedUntil; dying then
   * releases a cloud of `sporedDps` damage per second for the enemy (always the other player).
   */
  sporedUntil: number;
  sporedDps: number;
}

export interface ProjectileState {
  id: number;
  owner: PlayerIndex;
  sourceId: number;
  /** Homing shot: the target unit. Artillery shell: the target at launch (informational). */
  targetId: number;
  /** Card of the shooter: decides splash, artillery and on-hit effects at impact. */
  card: CardId;
  /** Upgrade bit mask of the shooter at launch. */
  up: number;
  /** Level of the shooter (scales on-hit effects such as burn). */
  level: number;
  /** Cell of the shooter at launch (direction of a piercing shot). */
  fromX: number;
  fromY: number;
  /** Artillery: target cell fixed at launch; -1 for homing shots. */
  x: number;
  y: number;
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
  /** Ansteckend: units it damages count as spored; their cloud deals this per second (0 = no). */
  contagiousDps: number;
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
  /**
   * Active upgrades per player and card (bit masks, missing = 0), copied from the match when
   * the field is set up. `spawnUnit` resolves every new unit's stats from it (also summons).
   */
  upgrades: [Partial<Record<CardId, number>>, Partial<Record<CardId, number>>];
  result: BattleResult | null;
}

/**
 * Things that happened in one tick, for the renderer. They never influence the simulation.
 * - `shot`: homing projectile launched (archer, musketeer, pyromancer, necromancer, frost
 *   shaman, whelp).
 * - `lob`: artillery shell launched at cell (x, y) (beetle); lands at `impactTick`.
 * - `impact`: area hit around cell (x, y) with `radius` (milli-fields), from a splash shot
 *   or an artillery shell of `unit` (the shooter, may be dead by then).
 * - `damage`: `amount` is the hit point loss after armour and shield (0 if everything was
 *   absorbed; it may exceed the remaining hit points). None while invulnerable.
 * - `summon`: `unit` appeared on (x, y), summoned by `summoner`.
 * - `breath`: whelp fire breath, a cone from (x, y) towards (tx, ty) with `range` fields.
 */
export type BattleEvent =
  | { type: 'attack'; unit: number; target: number }
  | { type: 'shot'; id: number; unit: number; target: number; impactTick: number }
  | { type: 'lob'; id: number; unit: number; x: number; y: number; impactTick: number }
  | { type: 'impact'; unit: number; x: number; y: number; radius: number }
  | { type: 'summon'; unit: number; summoner: number; card: CardId; x: number; y: number }
  | { type: 'damage'; unit: number; amount: number }
  | { type: 'heal'; unit: number; target: number; amount: number }
  | { type: 'death'; unit: number }
  | { type: 'explosion'; unit: number; x: number; y: number; radius: number }
  | { type: 'jump'; unit: number; fromX: number; fromY: number; x: number; y: number }
  | { type: 'zone'; id: number; x: number; y: number; radius: number; endTick: number }
  | {
      type: 'breath';
      unit: number;
      /** Origin cell (the whelp). */
      x: number;
      y: number;
      /** Main target and its cell: the cone's direction. */
      target: number;
      tx: number;
      ty: number;
      /** Reach in fields. */
      range: number;
    };

// ---------------------------------------------------------------------------
// Match
// ---------------------------------------------------------------------------

export interface PlayerConfig {
  /** Exactly DECK_SIZE distinct cards. */
  deck: CardId[];
  /** Card levels 1..MAX_LEVEL; missing cards count as level 1. */
  levels: Partial<Record<CardId, number>>;
  /**
   * Unlocked upgrades per card (SPEC 7.3): bit mask 0..7, bit i = upgrade i of UPGRADES[card];
   * missing = 0. Only unlocked upgrades can appear as upgrade cards (SPEC 4.3).
   */
  upgrades?: Partial<Record<CardId, number>>;
}

export interface MatchConfig {
  /** Non-negative safe integer. */
  seed: number;
  players: [PlayerConfig, PlayerConfig];
}

/** Index of an upgrade in UPGRADES[card]. */
export type UpgradeIndex = 0 | 1 | 2;

/**
 * One of the three cards on offer (SPEC 4.3, 4.5): a normal card, a double pack (twice the
 * units, also in later rounds) or an upgrade card (activates upgrade `upgrade` of `card`).
 */
export type OfferSlot =
  | { kind: 'spawn'; card: CardId }
  | { kind: 'double'; card: CardId }
  | { kind: 'upgrade'; card: CardId; upgrade: UpgradeIndex };

export type OfferKind = OfferSlot['kind'];

export interface Offer {
  player: PlayerIndex;
  slots: OfferSlot[];
}

export interface PickInfo {
  player: PlayerIndex;
  slot: number;
  kind: OfferKind;
  card: CardId;
  /** Only for kind 'upgrade': the activated upgrade. */
  upgrade?: UpgradeIndex;
  /**
   * Ids of the new units that got a cell on the field: the units of the played card, or for
   * an upgrade the units the army gained through it (e.g. two more skeletons per card).
   */
  spawned: number[];
  /** New units that found no free cell in the player's half (D-052). */
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
  /** Played as double pack: twice the units, in this and every later round (SPEC 4.5). */
  double: boolean;
  /**
   * Unit ids reserved for this card, kept for the whole match. Their number is
   * `unitCount(card, active upgrades, double)`; when an upgrade raises it, fresh ids are
   * appended (so the ids of one entry need not be contiguous).
   */
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
  /** Upgrades activated in this match per player and card (bit masks, missing = 0). */
  activeUpgrades: [Partial<Record<CardId, number>>, Partial<Record<CardId, number>>];
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
