/**
 * The deterministic battle simulation (SPEC 6). One call of `stepTick` advances the
 * field by one tick (1/20 s) in the fixed order of SPEC 6.2:
 *
 *   1. status effects (burn, poison), lingering zones and projectile impacts
 *   2. target selection
 *   3. attacks and abilities
 *   4. movement
 *   5. deaths and death effects
 *   6. end of round check
 *
 * Units are always processed in ascending id order. Damage is applied immediately (only
 * through `applyDamage` in status.ts), but units only leave the field in step 5, so fatally
 * hit units still act in that tick. Summoned units join at the end of `units` (new, higher
 * ids) and act from the next tick on.
 */
import * as balance from '../data/balance.ts';
import * as cards from '../data/cards.ts';
import * as math from '../math.ts';
import type {
  AttackDef,
  BattleEvent,
  ProjectileState,
  BattleResult,
  BattleState,
  CardDef,
  CardId,
  Layer,
  PlayerIndex,
  UnitMode,
  UnitState,
  Winner,
} from '../types.ts';
import * as types from '../types.ts';
import * as upgrades from '../upgrades.ts';
import * as pathfinding from './pathfinding.ts';
import * as state from './state.ts';
import * as status from './status.ts';

// Local copies of everything imported that the inner loops use. Behaviour is identical;
// test runners that turn every imported name into a property look-up (Vitest's module
// runner) would otherwise pay for it on each access, which slowed the simulation down
// about threefold there.
const {
  DIAGONAL_STEP,
  FIELD,
  FIELD_REACH_SQ,
  GRID_CELLS,
  GRID_COLS,
  MELEE_RANGE,
  RETARGET_INTERVAL_TICKS,
  STUCK_TICKS_BEFORE_PATHFINDING,
  SUDDEN_DEATH_DAMAGE_BPS,
  SUDDEN_DEATH_TICK,
  TICKS_PER_SECOND,
  TIME_LIMIT_TICKS,
} = balance;
const { CARDS } = cards;
const { applyBps, distSq, idiv, isqrt, rangeSq, scaleByLevel } = math;
const { AIR, GROUND } = types;
const { findPath, STEP_DX, STEP_DY } = pathfinding;
const { cellIndex, isFree, occIndex, spawnUnit } = state;
const {
  applyDamage,
  applySlow,
  canAct,
  dotDamage,
  effectiveAttackInterval,
  effectiveMoveSpeed,
  isTargetable,
  applyAttackSlow,
  applyBurn,
  applyDamageBonus,
  applyPoison,
  applyStun,
  outgoingDamage,
  setInvulnerable,
} = status;
const { refParam, summonInterval, summonMax, unitHas, upgradeRef } = upgrades;
const { BPS } = balance;

// Upgrades with an effect in the simulation (SPEC 5.4) and their parameters (data/upgrades.ts).
const FIRE_ARROWS = upgradeRef('archer.fire_arrows');
const FIRE_ARROWS_DPS = refParam(FIRE_ARROWS, 'burnDps');
const FIRE_ARROWS_TICKS = refParam(FIRE_ARROWS, 'burnTicks');
const INFERNO = upgradeRef('pyromancer.inferno');
const INFERNO_DPS = refParam(INFERNO, 'burnDps');
const INFERNO_TICKS = refParam(INFERNO, 'burnTicks');
const POISON = upgradeRef('assassin.poison');
const POISON_DPS = refParam(POISON, 'poisonDps');
const POISON_TICKS = refParam(POISON, 'poisonTicks');
const ULTRASOUND = upgradeRef('bat.ultrasound');
const ULTRASOUND_BPS = refParam(ULTRASOUND, 'attackSlowBps');
const ULTRASOUND_TICKS = refParam(ULTRASOUND, 'durationTicks');
const ICE_BLOCK = upgradeRef('frost_shaman.ice_block');
const ICE_BLOCK_NTH = refParam(ICE_BLOCK, 'everyNthHit');
const ICE_BLOCK_TICKS = refParam(ICE_BLOCK, 'freezeTicks');
const ICE_ARMOR = upgradeRef('frost_shaman.ice_armor');
const ICE_ARMOR_BPS = refParam(ICE_ARMOR, 'slowBps');
const ICE_ARMOR_TICKS = refParam(ICE_ARMOR, 'slowTicks');
const CHITIN = upgradeRef('beetle.chitin_armor');
const CHITIN_THORNS = refParam(CHITIN, 'thornsDamage');
const BLOODTHIRST = upgradeRef('bat.bloodthirst');
const BLOODTHIRST_BPS = refParam(BLOODTHIRST, 'lifestealBps');
const HEADSHOT = upgradeRef('musketeer.headshot');
const HEADSHOT_BPS = refParam(HEADSHOT, 'damageBps');
const BLOOD_FRENZY = upgradeRef('berserker.blood_frenzy');
const BLOOD_FRENZY_BPS = refParam(BLOOD_FRENZY, 'healBps');
const HEAL_CIRCLE = upgradeRef('healer.heal_circle');
const HEAL_CIRCLE_RADIUS = refParam(HEAL_CIRCLE, 'radius');
const HEAL_CIRCLE_BPS = refParam(HEAL_CIRCLE, 'healBps');
const BLESSING = upgradeRef('healer.blessing');
const BLESSING_BPS = refParam(BLESSING, 'damageBonusBps');
const BLESSING_TICKS = refParam(BLESSING, 'durationTicks');
const CHARGE = upgradeRef('knight.charge');
const CHARGE_BPS = refParam(CHARGE, 'damageBps');
const CHARGE_STUN_TICKS = refParam(CHARGE, 'stunTicks');
const BAYONET = upgradeRef('musketeer.bayonet');
const BAYONET_DAMAGE = refParam(BAYONET, 'damage');
const BAYONET_TICKS = refParam(BAYONET, 'intervalTicks');
const VOLLEY = upgradeRef('archer.volley');
const VOLLEY_NTH = refParam(VOLLEY, 'everyNthShot');
const VOLLEY_MAX = refParam(VOLLEY, 'maxTargets');
const PIERCE = upgradeRef('musketeer.pierce');
const PIERCE_BPS = refParam(PIERCE, 'damageBps');
const BONE_HAIL = upgradeRef('skeleton.bone_hail');
const BONE_HAIL_DAMAGE = refParam(BONE_HAIL, 'damage');
const BONE_HAIL_RADIUS = refParam(BONE_HAIL, 'radius');
const DAUGHTER_TNT = upgradeRef('tnt.daughter_tnt');
const DAUGHTER_COUNT = refParam(DAUGHTER_TNT, 'count');
const DAUGHTER_HP_BPS = refParam(DAUGHTER_TNT, 'hpBps');
const DAUGHTER_DAMAGE_BPS = refParam(DAUGHTER_TNT, 'damageBps');
const RUBBLE = upgradeRef('golem.rubble');
const RUBBLE_COUNT = refParam(RUBBLE, 'count');
const RUBBLE_BPS = refParam(RUBBLE, 'statsBps');
const SOUL_HARVEST = upgradeRef('necromancer.soul_harvest');
const SOUL_HARVEST_RADIUS = refParam(SOUL_HARVEST, 'radius');
const UNDEAD = upgradeRef('skeleton.undead');
const UNDEAD_DELAY = refParam(UNDEAD, 'delayTicks');
const UNDEAD_HP_BPS = refParam(UNDEAD, 'hpBps');
const REVIVE = upgradeRef('healer.revive');
const REVIVE_HP_BPS = refParam(REVIVE, 'hpBps');
const MYCELIUM = upgradeRef('shroomling.mycelium');
const MYCELIUM_HPS = refParam(MYCELIUM, 'healPerSecond');
const MYCELIUM_RADIUS = refParam(MYCELIUM, 'radius');
const METEOR = upgradeRef('pyromancer.meteor');
const METEOR_INTERVAL = refParam(METEOR, 'intervalTicks');
const METEOR_DAMAGE = refParam(METEOR, 'damage');
const METEOR_RADIUS = refParam(METEOR, 'radius');
const EARTHQUAKE = upgradeRef('golem.earthquake');
const EARTHQUAKE_INTERVAL = refParam(EARTHQUAKE, 'intervalTicks');
const EARTHQUAKE_DAMAGE = refParam(EARTHQUAKE, 'damage');
const EARTHQUAKE_RADIUS = refParam(EARTHQUAKE, 'radius');
const EARTHQUAKE_SLOW_BPS = refParam(EARTHQUAKE, 'slowBps');
const EARTHQUAKE_SLOW_TICKS = refParam(EARTHQUAKE, 'slowTicks');
const FROST_NOVA = upgradeRef('frost_shaman.frost_nova');
const FROST_NOVA_INTERVAL = refParam(FROST_NOVA, 'intervalTicks');
const FROST_NOVA_RADIUS = refParam(FROST_NOVA, 'radius');
const FROST_NOVA_TICKS = refParam(FROST_NOVA, 'freezeTicks');
const GROWTH = upgradeRef('whelp.growth');
const GROWTH_INTERVAL = refParam(GROWTH, 'intervalTicks');
const GROWTH_BPS = refParam(GROWTH, 'damageBonusBps');
const GROWTH_MAX = refParam(GROWTH, 'maxStacks');
const ACID = upgradeRef('beetle.acid_pool');
const ACID_TICKS = refParam(ACID, 'durationTicks');
const ACID_DPS = refParam(ACID, 'damagePerSecond');
const ACID_RADIUS = refParam(ACID, 'radius');
const SHADOW_STEP = upgradeRef('assassin.shadow_step');
const SHADOW_STEP_COOLDOWN = refParam(SHADOW_STEP, 'cooldownTicks');
const SMOKE_BOMB = upgradeRef('assassin.smoke_bomb');
const SMOKE_BOMB_TICKS = refParam(SMOKE_BOMB, 'untargetableTicks');
const TAUNT = upgradeRef('knight.taunt');
const TAUNT_RADIUS = refParam(TAUNT, 'radius');
const DOUBLE_LOAD = upgradeRef('beetle.double_load');
const DOUBLE_LOAD_SHELLS = refParam(DOUBLE_LOAD, 'shells');
const DOUBLE_LOAD_BPS = refParam(DOUBLE_LOAD, 'damageBps');
const CONTAGIOUS = upgradeRef('shroomling.contagious');
const CONTAGIOUS_RADIUS = refParam(CONTAGIOUS, 'radius');
const CONTAGIOUS_DPS = refParam(CONTAGIOUS, 'damagePerSecond');
const CONTAGIOUS_TICKS = refParam(CONTAGIOUS, 'durationTicks');
/** "Poisoned" means: damaged by a contagious cloud within the last second (20 ticks). */
const SPORED_TICKS = TICKS_PER_SECOND;
const LICH = upgradeRef('necromancer.lich_form');
const LICH_HP_BPS = refParam(LICH, 'hpBps');
const FIRE_BREATH = upgradeRef('whelp.fire_breath');
const WHIRLWIND = upgradeRef('berserker.whirlwind');
/** Work flag for the current tick: some living unit taunts (saves the search otherwise). */
let tauntActive = false;
const WHIRLWIND_NTH = refParam(WHIRLWIND, 'everyNthAttack');
const UNSTOPPABLE = upgradeRef('berserker.unstoppable');
const UNSTOPPABLE_BPS = refParam(UNSTOPPABLE, 'hpThresholdBps');
const UNSTOPPABLE_TICKS = refParam(UNSTOPPABLE, 'invulnerableTicks');

type Events = BattleEvent[] | undefined;

/**
 * Work data, never part of the state: the units of each owner in ascending id order and a
 * table from id to unit, filled at the start of every `stepTick` and emptied before the
 * deaths are resolved. Units only leave the field in that last step, so both stay complete
 * until then; hit points must still be checked. Units summoned during the tick are missing
 * from both, which is fine: nobody can target them before the next tick. They only save the
 * owner tests and the binary search and never change a result or an order.
 */
const SIDES: [UnitState[], UnitState[]] = [[], []];
/** Work table for the current tick: the unit per id (like `unitById`), else undefined. */
const BY_ID: (UnitState | undefined)[] = [];
/** Ids set in BY_ID, so that it can be emptied again (even after an exception). */
const BY_ID_SET: number[] = [];

function clearWorkData(): void {
  SIDES[0].length = 0;
  SIDES[1].length = 0;
  for (let i = 0; i < BY_ID_SET.length; i++) BY_ID[BY_ID_SET[i] as number] = undefined;
  BY_ID_SET.length = 0;
}

/** The unit with this id on the field during the current tick, if any (see BY_ID). */
function byId(id: number): UnitState | undefined {
  return id > 0 && id < BY_ID.length ? BY_ID[id] : undefined;
}

/** Advances the battle by one tick. Pass `events` to collect what happened for rendering. */
export function stepTick(b: BattleState, events?: BattleEvent[]): void {
  if (b.result !== null) return;
  if (!b.started) beginBattle(b);
  const units = b.units;
  const count = units.length;
  clearWorkData();
  const side0 = SIDES[0];
  const side1 = SIDES[1];
  while (BY_ID.length < b.nextUnitId) BY_ID.push(undefined);
  for (let i = 0; i < count; i++) {
    const u = units[i] as UnitState;
    if (u.owner === 0) side0.push(u);
    else side1.push(u);
    BY_ID[u.id] = u;
    BY_ID_SET.push(u.id);
  }

  tauntActive = false;
  for (let i = 0; i < count; i++) {
    const u = units[i] as UnitState;
    if (u.hp > 0 && unitHas(u, TAUNT)) tauntActive = true;
  }
  tickStatus(b, events);
  tickMycelium(b);
  tickZones(b, events);
  landProjectiles(b, events);
  for (let i = 0; i < count; i++) {
    const u = units[i] as UnitState;
    if (u.hp > 0) chooseTarget(b, u);
  }
  for (let i = 0; i < count; i++) act(b, units[i] as UnitState, events);
  for (let i = 0; i < count; i++) {
    const u = units[i] as UnitState;
    if (u.hp > 0) move(b, u);
  }
  clearWorkData();
  resolveDeaths(b, events);
  b.tick++;
  checkEnd(b);
}

/** Runs the battle to its end (at most TIME_LIMIT_TICKS ticks) and returns the result. */
export function simulateToEnd(b: BattleState): BattleResult {
  while (b.result === null) stepTick(b);
  return b.result;
}

/**
 * First tick of the battle. Assassins fix their jump target (D-049): the cell of the ground
 * enemy farthest from them right now; ties: smaller id. Without a ground enemy no jump.
 */
/**
 * Fixes the jump cell of assassin `u`: the cell of the living ground enemy farthest from it;
 * ties: smaller id. False (and no cell) if there is none.
 */
function aimJump(b: BattleState, u: UnitState): boolean {
  let far: UnitState | undefined;
  let farDist = -1;
  for (const o of b.units) {
    if (o.owner === u.owner || o.hp <= 0 || o.layer !== GROUND) continue;
    const d = distSq(u.x, u.y, o.x, o.y);
    if (d > farDist) {
      far = o;
      farDist = d;
    }
  }
  if (far === undefined) {
    u.jumpX = -1;
    u.jumpY = -1;
    return false;
  }
  u.jumpX = far.x;
  u.jumpY = far.y;
  return true;
}

function beginBattle(b: BattleState): void {
  b.started = true;
  for (const u of b.units) {
    const jump = CARDS[u.card].shadowJump;
    if (jump === undefined) continue;
    let far: UnitState | undefined;
    let farDist = -1;
    for (const o of b.units) {
      if (o.owner === u.owner || o.hp <= 0 || o.layer !== GROUND) continue;
      const d = distSq(u.x, u.y, o.x, o.y);
      if (d > farDist) {
        far = o;
        farDist = d;
      }
    }
    if (far === undefined) {
      u.jumpTick = -1;
      u.jumpX = -1;
      u.jumpY = -1;
    } else {
      u.jumpTick = b.tick + jump.chargeTicks;
      u.jumpX = far.x;
      u.jumpY = far.y;
    }
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function canHit(def: CardDef, target: UnitState): boolean {
  return target.layer === GROUND ? def.targets.ground : def.targets.air;
}

/** Squared distance in cells within which the unit can act on its current target. */
function reachSq(u: UnitState, atk: AttackDef): number {
  if (atk.kind === 'ranged') return rangeSq(u.range);
  if (atk.kind === 'artillery') return FIELD_REACH_SQ;
  if (atk.kind === 'heal') {
    if (u.mode === 'heal') return rangeSq(atk.range);
    if (u.mode === 'follow') return rangeSq(atk.followDistance);
  }
  return rangeSq(MELEE_RANGE);
}

function inRadius(ax: number, ay: number, bx: number, by: number, radius: number): boolean {
  return distSq(ax, ay, bx, by) * FIELD * FIELD <= radius * radius;
}

function withSuddenDeath(b: BattleState, amount: number): number {
  return b.tick >= SUDDEN_DEATH_TICK ? applyBps(amount, SUDDEN_DEATH_DAMAGE_BPS) : amount;
}

/**
 * Applies final damage (see applyDamage) and returns the hit points actually removed.
 * Berserker unstoppable: a unit that drops below the threshold but survives the damage turns
 * invulnerable (assumption: a hit that is lethal on its own still kills, D-031).
 */
function damage(b: BattleState, target: UnitState, amount: number, events: Events): number {
  const removed = applyDamage(target, amount, b.tick, events);
  if (
    target.unstoppableLeft > 0 &&
    target.hp > 0 &&
    target.hp * BPS < target.maxHp * UNSTOPPABLE_BPS
  ) {
    target.unstoppableLeft--;
    setInvulnerable(target, UNSTOPPABLE_TICKS, b.tick);
  }
  return removed;
}

/**
 * Damage from a hit (attack, shot, shell, blast) as opposed to damage over time or zones.
 * Pyromancer heat shield: the first hits are ignored completely (assumption: area hits count
 * as hits, burn, poison, zones and thorns do not; hits while invulnerable use up nothing).
 */
function hitDamage(b: BattleState, target: UnitState, amount: number, events: Events): number {
  if (target.ignoreHits > 0 && target.invulnUntil <= b.tick) {
    target.ignoreHits--;
    if (events !== undefined) events.push({ type: 'damage', unit: target.id, amount: 0 });
    return 0;
  }
  return damage(b, target, amount, events);
}

/** Squared minimum distance to a target (artillery), 0 = none. */
function minReachSq(atk: AttackDef): number {
  return atk.kind === 'artillery' ? atk.minRange * atk.minRange : 0;
}

function setTarget(
  b: BattleState,
  u: UnitState,
  target: UnitState | undefined,
  mode: UnitMode,
): void {
  const id = target === undefined ? 0 : target.id;
  if ((id !== u.targetId || mode !== u.mode) && u.path.length > 0) u.path = [];
  u.targetId = id;
  u.mode = mode;
  u.retargetTick = b.tick + RETARGET_INTERVAL_TICKS;
}

// ---------------------------------------------------------------------------
// 1. Status effects, zones and projectiles
// ---------------------------------------------------------------------------

/** Damage over time of burn and poison (D-025, sudden death applies to the rate). */
function tickStatus(b: BattleState, events: Events): void {
  const units = b.units;
  const tick = b.tick;
  for (let i = 0; i < units.length; i++) {
    const u = units[i] as UnitState;
    if (u.hp <= 0) continue;
    if (u.burnUntil >= tick && u.burnUntil > 0) {
      const amount = dotDamage(withSuddenDeath(b, u.burnDps), u.burnStart, u.burnUntil, tick);
      if (amount > 0) damage(b, u, amount, events);
    }
    if (u.poisonUntil >= tick && u.poisonUntil > 0) {
      const amount = dotDamage(withSuddenDeath(b, u.poisonDps), u.poisonStart, u.poisonUntil, tick);
      if (amount > 0) damage(b, u, amount, events);
    }
  }
}

/**
 * Myzel: every shroomling with the upgrade heals each other living shroomling of its owner
 * within r 1.5 by 5 HP per second, spread over the ticks without rounding loss (D-025).
 */
function tickMycelium(b: BattleState): void {
  const tick = b.tick;
  const amount =
    idiv(MYCELIUM_HPS * (tick + 1), TICKS_PER_SECOND) - idiv(MYCELIUM_HPS * tick, TICKS_PER_SECOND);
  if (amount <= 0) return;
  const units = b.units;
  for (let i = 0; i < units.length; i++) {
    const h = units[i] as UnitState;
    if (h.hp <= 0 || !unitHas(h, MYCELIUM)) continue;
    for (let j = 0; j < units.length; j++) {
      const o = units[j] as UnitState;
      if (o === h || o.owner !== h.owner || o.card !== MYCELIUM.card) continue;
      if (o.hp <= 0 || o.hp >= o.maxHp) continue;
      if (inRadius(h.x, h.y, o.x, o.y, MYCELIUM_RADIUS)) o.hp = Math.min(o.maxHp, o.hp + amount);
    }
  }
}

function tickZones(b: BattleState, events: Events): void {
  const zones = b.zones;
  if (zones.length === 0) return;
  let kept = 0;
  for (const z of zones) {
    // Spread the damage per second over the ticks without rounding loss (D-025).
    const k = b.tick - z.startTick;
    const perSecond = withSuddenDeath(b, z.damagePerSecond);
    const amount =
      idiv(perSecond * k, TICKS_PER_SECOND) - idiv(perSecond * (k - 1), TICKS_PER_SECOND);
    if (amount > 0) {
      for (const u of b.units) {
        if (u.owner === z.owner || u.hp <= 0) continue;
        if (u.layer === GROUND ? !z.hitsGround : !z.hitsAir) continue;
        if (!inRadius(u.x, u.y, z.x, z.y, z.radius)) continue;
        damage(b, u, amount, events);
        if (z.contagiousDps > 0) {
          u.sporedUntil = b.tick + SPORED_TICKS;
          u.sporedDps = Math.max(u.sporedDps, z.contagiousDps);
        }
      }
    }
    if (b.tick < z.endTick) zones[kept++] = z;
  }
  zones.length = kept;
}

function landProjectiles(b: BattleState, events: Events): void {
  const projectiles = b.projectiles;
  if (projectiles.length === 0) return;
  let kept = 0;
  for (const p of projectiles) {
    if (p.impactTick > b.tick) {
      projectiles[kept++] = p;
      continue;
    }
    const def = CARDS[p.card];
    const atk = def.attack;
    const amount = withSuddenDeath(b, p.damage);
    if (atk.kind === 'artillery') {
      // Shell on a cell: hits whoever stands there now (moving targets can dodge).
      if (events !== undefined) {
        events.push({ type: 'impact', unit: p.sourceId, x: p.x, y: p.y, radius: atk.radius });
      }
      areaDamage(b, p, def, p.x, p.y, atk.radius, amount, events);
      if (p.card === ACID.card && (p.up & ACID.bit) !== 0) {
        // Säurepfütze: a zone like the spore cloud, starting with this impact (D-025).
        const id = b.nextZoneId++;
        const endTick = b.tick + ACID_TICKS;
        b.zones.push({
          id,
          owner: p.owner,
          x: p.x,
          y: p.y,
          radius: ACID_RADIUS,
          damagePerSecond: scaleByLevel(ACID_DPS, p.level),
          hitsGround: def.targets.ground,
          hitsAir: def.targets.air,
          startTick: b.tick,
          endTick,
          contagiousDps: 0,
        });
        if (events !== undefined) {
          events.push({ type: 'zone', id, x: p.x, y: p.y, radius: ACID_RADIUS, endTick });
        }
      }
      continue;
    }
    // Homing shot: hits if the target is still alive, otherwise it fizzles (SPEC 6.2).
    const target = byId(p.targetId);
    if (target === undefined || target.hp <= 0) continue;
    if (atk.kind === 'ranged' && atk.splashRadius !== undefined) {
      const radius = atk.splashRadius;
      if (events !== undefined) {
        events.push({ type: 'impact', unit: p.sourceId, x: target.x, y: target.y, radius });
      }
      areaDamage(b, p, def, target.x, target.y, radius, amount, events);
    } else {
      hitDamage(b, target, amount, events);
      onHit(b, p, atk, target);
      if (p.card === PIERCE.card && (p.up & PIERCE.bit) !== 0)
        pierce(b, p, def, target, amount, events);
    }
  }
  projectiles.length = kept;
}

/**
 * Effects of a single-target shot on the target: frost shaman's slow, fire arrows, ice block.
 * Rates of damage over time scale with the shooter's level (assumption, SPEC 6.3).
 */
function onHit(b: BattleState, p: ProjectileState, atk: AttackDef, target: UnitState): void {
  if (atk.kind === 'ranged' && atk.slow !== undefined) {
    applySlow(target, atk.slow.bps, atk.slow.durationTicks, b.tick);
  }
  if (p.card === FIRE_ARROWS.card && (p.up & FIRE_ARROWS.bit) !== 0) {
    applyBurn(target, scaleByLevel(FIRE_ARROWS_DPS, p.level), FIRE_ARROWS_TICKS, b.tick);
  }
  if (p.card === ICE_BLOCK.card && (p.up & ICE_BLOCK.bit) !== 0) {
    // Counted on the shooter. Assumption: a shot landing after its shooter has left the
    // field neither counts nor freezes.
    const source = byId(p.sourceId);
    if (source !== undefined) {
      source.hits++;
      if (source.hits % ICE_BLOCK_NTH === 0) applyStun(target, ICE_BLOCK_TICKS, b.tick);
    }
  }
}

/**
 * Durchschlag (assumption): the cell right behind the target, seen from the shooter's cell at
 * launch (one step in the sign of each axis), is hit with 50 % of the shot's damage: every
 * enemy there the shooter can attack, both layers, ascending id.
 */
function pierce(
  b: BattleState,
  p: ProjectileState,
  def: CardDef,
  target: UnitState,
  amount: number,
  events: Events,
): void {
  const sx = Math.sign(target.x - p.fromX);
  const sy = Math.sign(target.y - p.fromY);
  if (sx === 0 && sy === 0) return;
  const bx = target.x + sx;
  const by = target.y + sy;
  const part = applyBps(amount, PIERCE_BPS);
  const enemies = SIDES[p.owner === 0 ? 1 : 0];
  for (let i = 0; i < enemies.length; i++) {
    const o = enemies[i] as UnitState;
    if (o.hp <= 0 || o.x !== bx || o.y !== by || !canHit(def, o)) continue;
    hitDamage(b, o, part, events);
  }
}

/**
 * Damages every living enemy of `owner` on a layer `def` can attack whose cell lies within
 * `radius` (milli-fields) of cell (x, y), in ascending id order (D-022).
 */
function areaDamage(
  b: BattleState,
  p: ProjectileState,
  def: CardDef,
  x: number,
  y: number,
  radius: number,
  amount: number,
  events: Events,
): void {
  const owner = p.owner;
  // Inferno: every unit hit by the blast burns (assumption: not only the main target).
  const burn = p.card === INFERNO.card && (p.up & INFERNO.bit) !== 0;
  const units = b.units;
  for (let i = 0; i < units.length; i++) {
    const o = units[i] as UnitState;
    if (o.owner === owner || o.hp <= 0 || !canHit(def, o)) continue;
    if (!inRadius(o.x, o.y, x, y, radius)) continue;
    hitDamage(b, o, amount, events);
    if (burn) applyBurn(o, scaleByLevel(INFERNO_DPS, p.level), INFERNO_TICKS, b.tick);
  }
}

// ---------------------------------------------------------------------------
// 2. Target selection
// ---------------------------------------------------------------------------

/**
 * Nearest attackable enemy at a squared distance of at least `minSq`; ties: smaller row
 * distance, then smaller id (SPEC 6.2). Untargetable enemies are skipped.
 */
function nearestEnemy(
  u: UnitState,
  def: CardDef,
  tick: number,
  minSq: number,
): UnitState | undefined {
  const enemies = SIDES[u.owner === 0 ? 1 : 0];
  const hitsGround = def.targets.ground;
  const hitsAir = def.targets.air;
  const ux = u.x;
  const uy = u.y;
  let best: UnitState | undefined;
  let bestDist = 0;
  let bestRows = 0;
  for (let i = 0; i < enemies.length; i++) {
    const o = enemies[i] as UnitState;
    if (o.hp <= 0 || !(o.layer === GROUND ? hitsGround : hitsAir)) continue;
    if (o.untargetableUntil > tick) continue;
    const dx = o.x - ux;
    const dy = o.y - uy;
    const d = dx * dx + dy * dy;
    if (d < minSq || (best !== undefined && d > bestDist)) continue;
    const rows = dy < 0 ? -dy : dy;
    // Here d <= bestDist: a smaller distance wins, an equal one needs fewer rows.
    if (best === undefined || d < bestDist || rows < bestRows) {
      best = o;
      bestDist = d;
      bestRows = rows;
    }
  }
  return best;
}

function chooseTarget(b: BattleState, u: UnitState): void {
  if (u.jumpTick >= 0) return;
  const def = CARDS[u.card];
  const current = byId(u.targetId);
  const alive = current !== undefined && current.hp > 0;
  if (!alive && u.targetId !== 0 && b.tick >= u.jumpReadyTick && unitHas(u, SHADOW_STEP)) {
    // Schattenschritt: the target is gone, so jump again (from the next act on).
    // Assumption: only from a standing position; mid-step it waits for the step to end.
    if (u.moveCost > 0) return;
    if (aimJump(b, u)) {
      u.jumpTick = b.tick;
      u.jumpReadyTick = b.tick + SHADOW_STEP_COOLDOWN;
      return;
    }
  }
  if (def.attack.kind === 'heal') {
    const healed = u.mode === 'heal' && alive && current.hp >= current.maxHp;
    if (alive && !healed && b.tick < u.retargetTick) return;
    chooseHealerTarget(b, u, def);
    return;
  }
  const minSq = minReachSq(def.attack);
  if (tauntActive) {
    const t = taunter(u, def, b.tick, minSq);
    if (t !== undefined) {
      if (t.id !== u.targetId || u.mode !== 'attack') setTarget(b, u, t, 'attack');
      return;
    }
  }
  const valid =
    alive &&
    isTargetable(current, b.tick) &&
    (minSq === 0 || distSq(u.x, u.y, current.x, current.y) >= minSq);
  if (valid && b.tick < u.retargetTick) return;
  setTarget(b, u, nearestEnemy(u, def, b.tick, minSq), 'attack');
}

/**
 * Spott: the nearest taunting enemy within r 2 that `u` can attack (layer, targetable,
 * artillery minimum distance); ties: smaller id. Checked every tick, so it overrides the
 * retarget interval.
 */
function taunter(u: UnitState, def: CardDef, tick: number, minSq: number): UnitState | undefined {
  const enemies = SIDES[u.owner === 0 ? 1 : 0];
  let best: UnitState | undefined;
  let bestDist = 0;
  for (let i = 0; i < enemies.length; i++) {
    const o = enemies[i] as UnitState;
    if (o.hp <= 0 || !unitHas(o, TAUNT) || !canHit(def, o) || !isTargetable(o, tick)) continue;
    if (!inRadius(u.x, u.y, o.x, o.y, TAUNT_RADIUS)) continue;
    const d = distSq(u.x, u.y, o.x, o.y);
    if (d < minSq) continue;
    if (best === undefined || d < bestDist) {
      best = o;
      bestDist = d;
    }
  }
  return best;
}

/** Healer priorities (SPEC 5.3, D-027). */
function chooseHealerTarget(b: BattleState, u: UnitState, def: CardDef): void {
  if (def.attack.kind !== 'heal') return;
  const healReach = rangeSq(def.attack.range);
  let fighterLeft = false;
  let weakest: UnitState | undefined; // lowest HP share among injured allies in range
  let weakestDist = 0;
  let nearestInjured: UnitState | undefined;
  let nearestInjuredDist = 0;
  let nearestAlly: UnitState | undefined;
  let nearestAllyDist = 0;
  for (const o of SIDES[u.owner]) {
    if (o.id === u.id || o.hp <= 0) continue;
    if (CARDS[o.card].attack.kind !== 'heal') fighterLeft = true;
    const d = distSq(u.x, u.y, o.x, o.y);
    if (nearestAlly === undefined || d < nearestAllyDist) {
      nearestAlly = o;
      nearestAllyDist = d;
    }
    if (o.hp >= o.maxHp) continue;
    if (nearestInjured === undefined || d < nearestInjuredDist) {
      nearestInjured = o;
      nearestInjuredDist = d;
    }
    if (d > healReach) continue;
    // o.hp / o.maxHp < weakest.hp / weakest.maxHp, compared without division.
    const share = weakest === undefined ? -1 : o.hp * weakest.maxHp - weakest.hp * o.maxHp;
    if (weakest === undefined || share < 0 || (share === 0 && d < weakestDist)) {
      weakest = o;
      weakestDist = d;
    }
  }
  if (!fighterLeft) setTarget(b, u, nearestEnemy(u, def, b.tick, 0), 'attack');
  else if (weakest !== undefined) setTarget(b, u, weakest, 'heal');
  else if (nearestInjured !== undefined) setTarget(b, u, nearestInjured, 'heal');
  else setTarget(b, u, nearestAlly, 'follow');
}

// ---------------------------------------------------------------------------
// 3. Attacks and abilities
// ---------------------------------------------------------------------------

function attackInterval(b: BattleState, u: UnitState, def: CardDef): number {
  const atk = def.attack;
  if (atk.kind === 'explode') return 0;
  let interval = atk.intervalTicks;
  if (def.rage !== undefined) {
    // Berserker: the interval shrinks linearly with the missing share of hit points.
    const missing = u.maxHp - Math.max(u.hp, 0);
    interval -= idiv(def.rage.intervalReductionTicks * missing, u.maxHp);
  }
  return effectiveAttackInterval(u, interval, b.tick);
}

function act(b: BattleState, u: UnitState, events: Events): void {
  if (!canAct(u, b.tick)) return;
  const def = CARDS[u.card];
  const atk = def.attack;
  if (u.jumpTick >= 0) {
    if (b.tick >= u.jumpTick) shadowJump(b, u, events);
    return;
  }
  if (atk.kind === 'explode') {
    // Fuse (D-050): lit while an enemy is in trigger range, even in mid-step; goes out as
    // soon as none is left. The blast itself is a death effect.
    if (enemyWithin(u, def, rangeSq(atk.triggerRange))) {
      if (u.fuseTick < 0) u.fuseTick = b.tick + atk.fuseTicks;
      if (b.tick >= u.fuseTick) u.hp = 0;
    } else {
      u.fuseTick = -1;
    }
    return;
  }
  if (u.summonTick >= 0 && b.tick >= u.summonTick) summon(b, u, def, events);
  if (u.abilityTick >= 0 && b.tick >= u.abilityTick) ability(b, u, def, events);
  if (u.moveCost > 0 || u.targetId === 0 || u.mode === 'follow') return;
  if (b.tick < u.nextAttackTick) return;
  const target = byId(u.targetId);
  if (target === undefined || target.hp <= 0) return;
  const d = distSq(u.x, u.y, target.x, target.y);
  if (d > reachSq(u, atk)) return;

  if (u.mode === 'heal') {
    if (atk.kind !== 'heal' || target.hp >= target.maxHp) return;
    const full = scaleByLevel(atk.amount, u.level);
    healUnit(b, u, target, full, events);
    if (unitHas(u, HEAL_CIRCLE)) {
      // Heilkreis (assumption): allies within r 2 of the healed target, without the target
      // and the healer, get 60 % of the healing each, in ascending id order.
      const part = applyBps(full, HEAL_CIRCLE_BPS);
      const allies = SIDES[u.owner];
      for (let i = 0; i < allies.length; i++) {
        const o = allies[i] as UnitState;
        if (o === u || o === target || o.hp <= 0 || o.hp >= o.maxHp) continue;
        if (inRadius(o.x, o.y, target.x, target.y, HEAL_CIRCLE_RADIUS)) {
          healUnit(b, u, o, part, events);
        }
      }
    }
  } else if (
    unitHas(u, BAYONET) &&
    d <= rangeSq(MELEE_RANGE) &&
    (target.layer === GROUND ? def.targets.ground : def.targets.air)
  ) {
    // Bajonett: an adjacent target is stabbed instead of shot (assumption: only the current
    // target counts; target selection picks the nearest enemy anyway). Not counted as a shot.
    if (events !== undefined) events.push({ type: 'attack', unit: u.id, target: target.id });
    const stab = outgoingDamage(u, scaleByLevel(BAYONET_DAMAGE, u.level), b.tick);
    const before = target.hp;
    const removed = hitDamage(b, target, withSuddenDeath(b, stab), events);
    meleeEffects(b, u, def, target, before, removed, events);
    u.nextAttackTick = b.tick + effectiveAttackInterval(u, BAYONET_TICKS, b.tick);
    return;
  } else if (atk.kind === 'artillery') {
    const minSq = minReachSq(atk);
    if (d < minSq) return;
    let shell = outgoingDamage(u, scaleByLevel(atk.damage, u.level), b.tick);
    if (unitHas(u, DOUBLE_LOAD)) {
      // Doppelladung (assumption): the second shell goes to the next nearest other enemy
      // outside the minimum distance; without one, both shells go to the target.
      shell = applyBps(shell, DOUBLE_LOAD_BPS);
      lob(b, u, atk.flightTicks, target, shell, events);
      const skip = [target.id];
      for (let k = 1; k < DOUBLE_LOAD_SHELLS; k++) {
        const other = nearestOther(u, def, b.tick, FIELD_REACH_SQ, skip, minSq) ?? target;
        skip.push(other.id);
        lob(b, u, atk.flightTicks, other, shell, events);
      }
    } else {
      lob(b, u, atk.flightTicks, target, shell, events);
    }
  } else if (atk.kind === 'ranged' && unitHas(u, FIRE_BREATH)) {
    fireBreath(
      b,
      u,
      def,
      target,
      outgoingDamage(u, scaleByLevel(atk.damage, u.level), b.tick),
      events,
    );
  } else if (atk.kind === 'ranged') {
    let shot = outgoingDamage(u, scaleByLevel(atk.damage, u.level), b.tick);
    // Headshot: the first shot of the round (every unit is new each round).
    if (u.attacks === 0 && unitHas(u, HEADSHOT)) shot = applyBps(shot, HEADSHOT_BPS);
    fire(b, u, atk.projectileSpeed, target, d, shot, events);
    if (unitHas(u, VOLLEY) && (u.attacks + 1) % VOLLEY_NTH === 0) {
      // Salve (assumption): extra arrows at the next nearest other enemies in range, picked
      // like a normal target (distance, rows, id), same damage each.
      const reach = rangeSq(u.range);
      const picked: number[] = [target.id];
      for (let k = 1; k < VOLLEY_MAX; k++) {
        const extra = nearestOther(u, def, b.tick, reach, picked);
        if (extra === undefined) break;
        picked.push(extra.id);
        fire(b, u, atk.projectileSpeed, extra, distSq(u.x, u.y, extra.x, extra.y), shot, events);
      }
    }
  } else {
    const base = atk.kind === 'heal' ? atk.fallbackDamage : atk.damage;
    if (events !== undefined) events.push({ type: 'attack', unit: u.id, target: target.id });
    let amount = withSuddenDeath(b, outgoingDamage(u, scaleByLevel(base, u.level), b.tick));
    // Ansturm: the first hit after a step deals double damage and stuns the target.
    const charge = u.moved && unitHas(u, CHARGE);
    if (charge) amount = applyBps(amount, CHARGE_BPS);
    u.moved = false;
    if (unitHas(u, WHIRLWIND) && (u.attacks + 1) % WHIRLWIND_NTH === 0) {
      // Whirlwind: every adjacent enemy it can hit takes the full hit, the target included,
      // in ascending id order (assumption: untargetable enemies are hit, as by area damage).
      const enemies = SIDES[u.owner === 0 ? 1 : 0];
      const melee = rangeSq(MELEE_RANGE);
      for (let i = 0; i < enemies.length; i++) {
        const o = enemies[i] as UnitState;
        if (o.hp <= 0 || !canHit(def, o) || distSq(u.x, u.y, o.x, o.y) > melee) continue;
        const before = o.hp;
        meleeEffects(b, u, def, o, before, hitDamage(b, o, amount, events), events);
      }
    } else {
      const before = target.hp;
      const removed = hitDamage(b, target, amount, events);
      meleeEffects(b, u, def, target, before, removed, events);
    }
    if (charge) applyStun(target, CHARGE_STUN_TICKS, b.tick);
  }
  u.attacks++;
  u.nextAttackTick = b.tick + attackInterval(b, u, def);
}

/** Heals `target` by up to `amount` (capped at max HP); Segen adds its damage bonus. */
function healUnit(
  b: BattleState,
  u: UnitState,
  target: UnitState,
  amount: number,
  events: Events,
): void {
  const healed = Math.min(amount, target.maxHp - target.hp);
  if (healed <= 0) return;
  target.hp += healed;
  if (events !== undefined) {
    events.push({ type: 'heal', unit: u.id, target: target.id, amount: healed });
  }
  if (unitHas(u, BLESSING)) applyDamageBonus(target, BLESSING_BPS, BLESSING_TICKS, b.tick);
}

/**
 * Timed upgrade abilities (one per card at most). Stunned units postpone them (act is not
 * called while stunned, assumption).
 */
function ability(b: BattleState, u: UnitState, def: CardDef, events: Events): void {
  u.abilityTick = -1;
  if (unitHas(u, EARTHQUAKE)) {
    u.abilityTick = b.tick + EARTHQUAKE_INTERVAL;
    const amount = withSuddenDeath(
      b,
      outgoingDamage(u, scaleByLevel(EARTHQUAKE_DAMAGE, u.level), b.tick),
    );
    if (events !== undefined) {
      events.push({ type: 'impact', unit: u.id, x: u.x, y: u.y, radius: EARTHQUAKE_RADIUS });
    }
    for (const o of b.units) {
      if (o.owner === u.owner || o.hp <= 0 || !canHit(def, o)) continue;
      if (!inRadius(o.x, o.y, u.x, u.y, EARTHQUAKE_RADIUS)) continue;
      hitDamage(b, o, amount, events);
      applySlow(o, EARTHQUAKE_SLOW_BPS, EARTHQUAKE_SLOW_TICKS, b.tick);
    }
  } else if (unitHas(u, FROST_NOVA)) {
    u.abilityTick = b.tick + FROST_NOVA_INTERVAL;
    if (events !== undefined) {
      events.push({ type: 'impact', unit: u.id, x: u.x, y: u.y, radius: FROST_NOVA_RADIUS });
    }
    for (const o of b.units) {
      if (o.owner === u.owner || o.hp <= 0 || !canHit(def, o)) continue;
      if (inRadius(o.x, o.y, u.x, u.y, FROST_NOVA_RADIUS)) applyStun(o, FROST_NOVA_TICKS, b.tick);
    }
  } else if (unitHas(u, GROWTH)) {
    // Wachstum: +15 % damage per stack (additive), at most 3 stacks.
    u.stacks++;
    u.powerBps += GROWTH_BPS;
    if (u.stacks < GROWTH_MAX) u.abilityTick = b.tick + GROWTH_INTERVAL;
  } else if (unitHas(u, METEOR)) {
    u.abilityTick = b.tick + METEOR_INTERVAL;
    meteor(b, u, def, events);
  }
}

/**
 * Meteor (assumption for "largest enemy group"): centred on the attackable enemy with the
 * most attackable enemies within r 1.5 of it (itself included); ties: smaller id.
 * Untargetable enemies are not chosen as the centre but are hit.
 */
function meteor(b: BattleState, u: UnitState, def: CardDef, events: Events): void {
  const units = b.units;
  let center: UnitState | undefined;
  let best = 0;
  for (let i = 0; i < units.length; i++) {
    const c = units[i] as UnitState;
    if (c.owner === u.owner || c.hp <= 0 || !canHit(def, c) || !isTargetable(c, b.tick)) continue;
    let n = 0;
    for (let j = 0; j < units.length; j++) {
      const o = units[j] as UnitState;
      if (o.owner === u.owner || o.hp <= 0 || !canHit(def, o)) continue;
      if (inRadius(o.x, o.y, c.x, c.y, METEOR_RADIUS)) n++;
    }
    if (n > best) {
      center = c;
      best = n;
    }
  }
  if (center === undefined) return;
  const x = center.x;
  const y = center.y;
  if (events !== undefined)
    events.push({ type: 'impact', unit: u.id, x, y, radius: METEOR_RADIUS });
  const amount = withSuddenDeath(
    b,
    outgoingDamage(u, scaleByLevel(METEOR_DAMAGE, u.level), b.tick),
  );
  for (let i = 0; i < units.length; i++) {
    const o = units[i] as UnitState;
    if (o.owner === u.owner || o.hp <= 0 || !canHit(def, o)) continue;
    if (inRadius(o.x, o.y, x, y, METEOR_RADIUS)) hitDamage(b, o, amount, events);
  }
}

/**
 * Feueratem: instant cone instead of the splash shot. Hit are the main target and every
 * enemy `u` can attack (both layers, untargetable ones too, ascending id) within its range
 * (D-022) whose direction b lies within 45 degrees of the direction a to the main target:
 * dot(a, b) > 0 and 2 * dot(a, b)^2 >= |a|^2 * |b|^2. Vectors are in whole cells (the field
 * is 12 x 24), so every product stays far below 2^31.
 */
function fireBreath(
  b: BattleState,
  u: UnitState,
  def: CardDef,
  target: UnitState,
  base: number,
  events: Events,
): void {
  const amount = withSuddenDeath(b, base);
  const ax = target.x - u.x;
  const ay = target.y - u.y;
  const aa = ax * ax + ay * ay;
  const reach = rangeSq(u.range);
  if (events !== undefined) {
    events.push({
      type: 'breath',
      unit: u.id,
      x: u.x,
      y: u.y,
      target: target.id,
      tx: target.x,
      ty: target.y,
      range: u.range,
    });
  }
  const enemies = SIDES[u.owner === 0 ? 1 : 0];
  for (let i = 0; i < enemies.length; i++) {
    const o = enemies[i] as UnitState;
    if (o.hp <= 0 || !canHit(def, o)) continue;
    if (o !== target) {
      const bx = o.x - u.x;
      const by = o.y - u.y;
      const bb = bx * bx + by * by;
      if (bb > reach) continue;
      const dot = ax * bx + ay * by;
      if (dot <= 0 || 2 * dot * dot < aa * bb) continue;
    }
    hitDamage(b, o, amount, events);
  }
}

/** Launches an artillery shell of `u` at the cell of `target`. */
function lob(
  b: BattleState,
  u: UnitState,
  flightTicks: number,
  target: UnitState,
  amount: number,
  events: Events,
): void {
  const id = b.nextProjectileId++;
  const impactTick = b.tick + flightTicks;
  b.projectiles.push({
    id,
    owner: u.owner,
    sourceId: u.id,
    targetId: target.id,
    card: u.card,
    up: u.up,
    level: u.level,
    fromX: u.x,
    fromY: u.y,
    x: target.x,
    y: target.y,
    damage: amount,
    launchTick: b.tick,
    impactTick,
  });
  if (events !== undefined) {
    events.push({ type: 'lob', id, unit: u.id, x: target.x, y: target.y, impactTick });
  }
}

/** Launches a homing shot of `u` at `target` (squared distance `d` in cells). */
function fire(
  b: BattleState,
  u: UnitState,
  speed: number,
  target: UnitState,
  d: number,
  amount: number,
  events: Events,
): void {
  const dist = isqrt(d * FIELD * FIELD);
  const flight = Math.max(1, idiv(dist + speed - 1, speed));
  const id = b.nextProjectileId++;
  b.projectiles.push({
    id,
    owner: u.owner,
    sourceId: u.id,
    targetId: target.id,
    card: u.card,
    up: u.up,
    level: u.level,
    fromX: u.x,
    fromY: u.y,
    x: -1,
    y: -1,
    damage: amount,
    launchTick: b.tick,
    impactTick: b.tick + flight,
  });
  if (events !== undefined) {
    events.push({ type: 'shot', id, unit: u.id, target: target.id, impactTick: b.tick + flight });
  }
}

/** Like nearestEnemy, within `reach`, at least `minSq` away and without the ids in `skip`. */
function nearestOther(
  u: UnitState,
  def: CardDef,
  tick: number,
  reach: number,
  skip: number[],
  minSq = 0,
): UnitState | undefined {
  const enemies = SIDES[u.owner === 0 ? 1 : 0];
  let best: UnitState | undefined;
  let bestDist = 0;
  let bestRows = 0;
  for (let i = 0; i < enemies.length; i++) {
    const o = enemies[i] as UnitState;
    if (o.hp <= 0 || !canHit(def, o) || o.untargetableUntil > tick) continue;
    if (skip.indexOf(o.id) >= 0) continue;
    const d = distSq(u.x, u.y, o.x, o.y);
    if (d > reach || d < minSq) continue;
    const rows = Math.abs(o.y - u.y);
    if (best === undefined || d < bestDist || (d === bestDist && rows < bestRows)) {
      best = o;
      bestDist = d;
      bestRows = rows;
    }
  }
  return best;
}

/**
 * Everything a melee hit triggers after its damage: lifesteal (berserker rage, bat
 * bloodthirst), on-hit statuses (poison, ultrasound), kill heal (blood frenzy), and the
 * target's defences against melee attackers (chitin thorns, ice armour).
 * Assumption: statuses and defences trigger on every melee hit, even one that was fully
 * absorbed (shield, invulnerability, heat shield). Fatally hit attackers heal no more (D-031).
 */
function meleeEffects(
  b: BattleState,
  u: UnitState,
  def: CardDef,
  target: UnitState,
  before: number,
  removed: number,
  events: Events,
): void {
  const tick = b.tick;
  let steal = def.rage === undefined ? 0 : def.rage.lifestealBps;
  if (unitHas(u, BLOODTHIRST)) steal += BLOODTHIRST_BPS;
  if (steal > 0 && u.hp > 0) u.hp = Math.min(u.maxHp, u.hp + applyBps(removed, steal));
  if (unitHas(u, POISON)) {
    applyPoison(target, scaleByLevel(POISON_DPS, u.level), POISON_TICKS, tick);
  }
  if (unitHas(u, ULTRASOUND)) applyAttackSlow(target, ULTRASOUND_BPS, ULTRASOUND_TICKS, tick);
  if (before > 0 && target.hp <= 0 && u.hp > 0 && unitHas(u, BLOOD_FRENZY)) {
    u.hp = Math.min(u.maxHp, u.hp + applyBps(u.maxHp, BLOOD_FRENZY_BPS));
  }
  if (unitHas(target, CHITIN)) {
    // Thorns scale with the beetle's level and with sudden death like any damage.
    damage(b, u, withSuddenDeath(b, scaleByLevel(CHITIN_THORNS, target.level)), events);
  }
  if (unitHas(target, ICE_ARMOR)) applySlow(u, ICE_ARMOR_BPS, ICE_ARMOR_TICKS, tick);
}

/**
 * Necromancer: summons one unit of `def.summon.card` (summoner's level, owner's upgrades of
 * that card) on the nearest free neighbouring cell of its layer: straight neighbours first,
 * then diagonals, in step order (mirrored for player 1). Skipped (until the next interval)
 * while `max` summons are alive or no neighbouring cell is free.
 */
function summon(b: BattleState, u: UnitState, def: CardDef, events: Events): void {
  if (def.summon === undefined) return;
  u.summonTick = b.tick + summonInterval(u.card, u.up);
  summonOne(b, u, events);
}

/** One summon of `u` if it has fewer than its maximum alive and a free neighbouring cell. */
function summonOne(b: BattleState, u: UnitState, events: Events): void {
  const s = CARDS[u.card].summon;
  if (s === undefined) return;
  const max = summonMax(u.card, u.up);
  let alive = 0;
  const units = b.units;
  for (let i = 0; i < units.length; i++) {
    const o = units[i] as UnitState;
    if (o.summonerId === u.id && o.hp > 0) alive++;
  }
  if (alive >= max) return;
  const layer = CARDS[s.card].layer;
  const sign = u.owner === 0 ? 1 : -1;
  for (let i = 0; i < STEP_DX.length; i++) {
    const nx = u.x + sign * (STEP_DX[i] as number);
    const ny = u.y + sign * (STEP_DY[i] as number);
    if (!isFree(b, layer, nx, ny)) continue;
    const unit = spawnUnit(b, u.owner, s.card, u.level, nx, ny);
    unit.summonerId = u.id;
    if (events !== undefined) {
      events.push({ type: 'summon', unit: unit.id, summoner: u.id, card: s.card, x: nx, y: ny });
    }
    return;
  }
}

/** True if a living enemy that `u` can attack stands within `reach` (squared cells). */
function enemyWithin(u: UnitState, def: CardDef, reach: number): boolean {
  const enemies = SIDES[u.owner === 0 ? 1 : 0];
  const hitsGround = def.targets.ground;
  const hitsAir = def.targets.air;
  for (let i = 0; i < enemies.length; i++) {
    const o = enemies[i] as UnitState;
    if (o.hp <= 0 || !(o.layer === GROUND ? hitsGround : hitsAir)) continue;
    const dx = o.x - u.x;
    const dy = o.y - u.y;
    if (dx * dx + dy * dy <= reach) return true;
  }
  return false;
}

/**
 * Assassin (D-049): teleports to the free ground cell closest to the jump target fixed at
 * battle start; ties: closest to the assassin, then scan order (mirrored for player 1).
 * The assassin's own cell counts as free. Afterwards it selects targets like everybody else.
 */
function shadowJump(b: BattleState, u: UnitState, events: Events): void {
  u.jumpTick = -1;
  const jx = u.jumpX;
  const jy = u.jumpY;
  u.jumpX = -1;
  u.jumpY = -1;
  if (jx < 0 || jy < 0) return;

  let bestX = u.x;
  let bestY = u.y;
  let bestDist = -1;
  let bestOwn = 0;
  for (let i = 0; i < GRID_CELLS; i++) {
    const cell = u.owner === 0 ? i : GRID_CELLS - 1 - i;
    const x = cell % GRID_COLS;
    const y = idiv(cell, GRID_COLS);
    const occupant = b.occ[occIndex(GROUND, x, y)];
    if (occupant !== 0 && occupant !== u.id) continue;
    const d = distSq(x, y, jx, jy);
    const own = distSq(x, y, u.x, u.y);
    if (bestDist < 0 || d < bestDist || (d === bestDist && own < bestOwn)) {
      bestX = x;
      bestY = y;
      bestDist = d;
      bestOwn = own;
    }
  }
  if (bestX !== u.x || bestY !== u.y) {
    if (events !== undefined) {
      events.push({ type: 'jump', unit: u.id, fromX: u.x, fromY: u.y, x: bestX, y: bestY });
    }
    b.occ[occIndex(u.layer, u.x, u.y)] = 0;
    b.occ[occIndex(u.layer, bestX, bestY)] = u.id;
    u.x = bestX;
    u.y = bestY;
    u.tx = bestX;
    u.ty = bestY;
  }
  // Rauchbombe: not targetable for a while after every jump.
  if (unitHas(u, SMOKE_BOMB)) status.setUntargetable(u, SMOKE_BOMB_TICKS, b.tick);
  // Normal target selection from the next tick on.
  u.targetId = 0;
  u.path = [];
  u.mode = 'attack';
  u.retargetTick = b.tick;
}

// ---------------------------------------------------------------------------
// 4. Movement
// ---------------------------------------------------------------------------

function move(b: BattleState, u: UnitState): void {
  if (u.jumpTick >= 0 || !canAct(u, b.tick)) return;
  const def = CARDS[u.card];
  const speed = effectiveMoveSpeed(u, b.tick);

  if (u.moveCost > 0) {
    u.moveProgress += speed;
    if (u.moveProgress >= u.moveCost) {
      u.moveCarry = u.moveProgress - u.moveCost;
      u.moveProgress = 0;
      u.moveCost = 0;
      u.x = u.tx;
      u.y = u.ty;
    }
    return;
  }

  const carry = u.moveCarry;
  u.moveCarry = 0;
  const target = byId(u.targetId);
  if (target === undefined || target.hp <= 0) {
    u.stuckTicks = 0;
    return;
  }
  // Stay if the target is in reach, or will be once it has finished its step.
  const reach = reachSq(u, def.attack);
  if (
    distSq(u.x, u.y, target.x, target.y) <= reach ||
    distSq(u.x, u.y, target.tx, target.ty) <= reach
  ) {
    u.stuckTicks = 0;
    if (u.path.length > 0) u.path = [];
    return;
  }

  let next = followPath(b, u);
  if (next < 0) next = greedyStep(b, u, target.tx, target.ty);
  if (next < 0) {
    u.stuckTicks++;
    if (u.stuckTicks <= STUCK_TICKS_BEFORE_PATHFINDING) return;
    u.stuckTicks = 0;
    u.path = findPath(b.occ, u.layer, u.owner, u.x, u.y, target.tx, target.ty, reach);
    next = followPath(b, u);
    if (next < 0) return;
  }

  // Start the step: reserve the new cell, release the old one (D-021).
  const nx = next % GRID_COLS;
  const ny = idiv(next, GRID_COLS);
  b.occ[occIndex(u.layer, u.x, u.y)] = 0;
  b.occ[occIndex(u.layer, nx, ny)] = u.id;
  u.tx = nx;
  u.ty = ny;
  u.moveCost = nx !== u.x && ny !== u.y ? DIAGONAL_STEP : FIELD;
  u.moved = true;
  u.moveProgress = carry + speed;
  u.stuckTicks = 0;
}

/** Next cell of the stored A* path if it can be entered now, else -1 (path is dropped). */
function followPath(b: BattleState, u: UnitState): number {
  if (u.path.length === 0) return -1;
  const cell = u.path[0] as number;
  const x = cell % GRID_COLS;
  const y = idiv(cell, GRID_COLS);
  if (distSq(u.x, u.y, x, y) > rangeSq(MELEE_RANGE) || !isFree(b, u.layer, x, y)) {
    u.path = [];
    return -1;
  }
  u.path.shift();
  return cell;
}

/** Free neighbouring cell that reduces the distance to the goal the most, else -1. */
function greedyStep(b: BattleState, u: UnitState, gx: number, gy: number): number {
  const sign = u.owner === 0 ? 1 : -1;
  let best = -1;
  let bestDist = distSq(u.x, u.y, gx, gy);
  for (let i = 0; i < STEP_DX.length; i++) {
    const nx = u.x + sign * (STEP_DX[i] as number);
    const ny = u.y + sign * (STEP_DY[i] as number);
    if (!isFree(b, u.layer, nx, ny)) continue;
    const d = distSq(nx, ny, gx, gy);
    if (d < bestDist) {
      best = cellIndex(nx, ny);
      bestDist = d;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// 5. Deaths
// ---------------------------------------------------------------------------

function resolveDeaths(b: BattleState, events: Events): void {
  const units = b.units;
  const count = units.length;
  let anyDead = false;
  for (let i = 0; i < count; i++) {
    if ((units[i] as UnitState).hp <= 0) {
      anyDead = true;
      break;
    }
  }
  if (!anyDead) return;

  // Death effects can kill further units in the same tick, so repeat until nothing changes.
  // Death effects may also spawn units (appended with higher ids); the loops cover them too.
  const handled: boolean[] = [];
  let again = true;
  while (again) {
    again = false;
    for (let i = 0; i < units.length; i++) {
      const u = units[i] as UnitState;
      if (u.hp > 0 || handled[i] === true) continue;
      handled[i] = true;
      again = true;
      b.occ[occIndex(u.layer, u.tx, u.ty)] = 0;
      if (events !== undefined) events.push({ type: 'death', unit: u.id });
      deathEffects(b, u, events);
    }
  }
  let kept = 0;
  const total = units.length;
  for (let i = 0; i < total; i++) {
    if (handled[i] !== true) units[kept++] = units[i] as UnitState;
  }
  units.length = kept;
}

/**
 * Spawns a battle-only unit (never part of the army, D-053) on (x, y) or, if taken, the first
 * free neighbouring cell in step order (mirrored for player 1). Undefined if all are taken.
 * The new unit counts as summoned by `sourceId`.
 */
function spawnNear(
  b: BattleState,
  owner: PlayerIndex,
  card: CardId,
  level: number,
  x: number,
  y: number,
  sourceId: number,
  events: Events,
): UnitState | undefined {
  const layer = CARDS[card].layer;
  let cx = x;
  let cy = y;
  if (!isFree(b, layer, cx, cy)) {
    const sign = owner === 0 ? 1 : -1;
    let found = false;
    for (let i = 0; i < STEP_DX.length && !found; i++) {
      cx = x + sign * (STEP_DX[i] as number);
      cy = y + sign * (STEP_DY[i] as number);
      found = isFree(b, layer, cx, cy);
    }
    if (!found) return undefined;
  }
  const unit = spawnUnit(b, owner, card, level, cx, cy);
  unit.summonerId = sourceId;
  if (events !== undefined) {
    events.push({ type: 'summon', unit: unit.id, summoner: sourceId, card, x: cx, y: cy });
  }
  return unit;
}

/** Scales hit points and damage of a freshly spawned unit by `bps`. */
function scaleSpawn(unit: UnitState, bps: number): void {
  unit.maxHp = Math.max(1, applyBps(unit.maxHp, bps));
  unit.hp = unit.maxHp;
  unit.shield = applyBps(unit.shield, bps);
  unit.powerBps = applyBps(unit.powerBps, bps);
}

/**
 * Wiederbelebung: the living ally healer with the upgrade and a charge left, lowest id first,
 * whose heal range covers the dead unit brings it back on its cell with 50 % HP (a new unit
 * of the same card, battle only). Assumptions: the charge belongs to each healer; a revived
 * unit is new (fresh cooldowns and statuses) but gets no revive charge of its own.
 */
function revive(b: BattleState, dead: UnitState, events: Events): void {
  // Assumption: a necromancer with Lich-Form (and its ghost) is never revived, so that it
  // does not come back twice.
  if (unitHas(dead, LICH)) return;
  const units = b.units;
  for (let i = 0; i < units.length; i++) {
    const h = units[i] as UnitState;
    if (h.hp <= 0 || h.owner !== dead.owner || h.reviveLeft <= 0 || h === dead) continue;
    if (!unitHas(h, REVIVE)) continue;
    if (distSq(h.x, h.y, dead.x, dead.y) > rangeSq(h.range)) continue;
    const r = spawnNear(b, dead.owner, dead.card, dead.level, dead.tx, dead.ty, h.id, events);
    if (r === undefined) return;
    h.reviveLeft--;
    r.reviveLeft = 0;
    r.hp = Math.max(1, applyBps(r.maxHp, REVIVE_HP_BPS));
    return;
  }
}

/**
 * Seelenernte: every living necromancer with the upgrade that is an enemy of the dead unit
 * and within r 3 of it summons one skeleton at once (assumption: within its limit of living
 * summons; the summon timer is not touched).
 */
function soulHarvest(b: BattleState, dead: UnitState, events: Events): void {
  const units = b.units;
  for (let i = 0; i < units.length; i++) {
    const n = units[i] as UnitState;
    if (n.hp <= 0 || n.owner === dead.owner || !unitHas(n, SOUL_HARVEST)) continue;
    if (!inRadius(n.x, n.y, dead.x, dead.y, SOUL_HARVEST_RADIUS)) continue;
    summonOne(b, n, events);
  }
}

function deathEffects(b: BattleState, u: UnitState, events: Events): void {
  const def = CARDS[u.card];
  const atk = def.attack;
  if (atk.kind === 'explode') {
    if (events !== undefined) {
      events.push({ type: 'explosion', unit: u.id, x: u.x, y: u.y, radius: atk.radius });
    }
    const amount = withSuddenDeath(b, applyBps(scaleByLevel(atk.damage, u.level), u.powerBps));
    for (const o of b.units) {
      if (o.owner === u.owner || o.hp <= 0 || !canHit(def, o)) continue;
      if (inRadius(u.x, u.y, o.x, o.y, atk.radius)) hitDamage(b, o, amount, events);
    }
  }
  if (unitHas(u, BONE_HAIL)) {
    const amount = withSuddenDeath(b, scaleByLevel(BONE_HAIL_DAMAGE, u.level));
    for (const o of b.units) {
      if (o.owner === u.owner || o.hp <= 0 || !canHit(def, o)) continue;
      if (inRadius(u.x, u.y, o.x, o.y, BONE_HAIL_RADIUS)) hitDamage(b, o, amount, events);
    }
  }
  if (unitHas(u, DAUGHTER_TNT)) {
    // The daughter has no daughter of its own: its mask loses this upgrade.
    for (let k = 0; k < DAUGHTER_COUNT; k++) {
      const d = spawnNear(b, u.owner, u.card, u.level, u.tx, u.ty, u.id, events);
      if (d === undefined) break;
      d.up &= ~DAUGHTER_TNT.bit;
      d.maxHp = Math.max(1, applyBps(d.maxHp, DAUGHTER_HP_BPS));
      d.hp = d.maxHp;
      d.powerBps = applyBps(d.powerBps, DAUGHTER_DAMAGE_BPS);
    }
  }
  if (unitHas(u, RUBBLE) && u.summonerId === 0) {
    // Assumption: only army golems crumble (mini golems leave no rubble); 20 % of HP and
    // damage, speed and range unchanged.
    for (let k = 0; k < RUBBLE_COUNT; k++) {
      const g = spawnNear(b, u.owner, u.card, u.level, u.tx, u.ty, u.id, events);
      if (g === undefined) break;
      g.up &= ~RUBBLE.bit;
      scaleSpawn(g, RUBBLE_BPS);
    }
  }
  if (unitHas(u, UNDEAD)) {
    // Untot (assumption): the zombie spawns at once on the skeleton's cell but lies there
    // for 2 s (stunned, untargetable, invulnerable), then rises. It rises only once.
    const z = spawnNear(b, u.owner, u.card, u.level, u.tx, u.ty, u.id, events);
    if (z !== undefined) {
      z.up &= ~UNDEAD.bit;
      z.maxHp = Math.max(1, applyBps(z.maxHp, UNDEAD_HP_BPS));
      z.hp = z.maxHp;
      applyStun(z, UNDEAD_DELAY, b.tick);
      status.setUntargetable(z, UNDEAD_DELAY, b.tick);
      setInvulnerable(z, UNDEAD_DELAY, b.tick);
    }
  }
  revive(b, u, events);
  soulHarvest(b, u, events);
  const cloud = def.deathCloud;
  if (cloud !== undefined) {
    const id = b.nextZoneId++;
    const endTick = b.tick + cloud.durationTicks;
    b.zones.push({
      id,
      owner: u.owner,
      x: u.x,
      y: u.y,
      radius: cloud.radius,
      damagePerSecond: scaleByLevel(cloud.damagePerSecond, u.level),
      hitsGround: def.targets.ground,
      hitsAir: def.targets.air,
      startTick: b.tick,
      endTick,
      // Ansteckend: the rate of the clouds it spreads scales with this shroomling's level.
      contagiousDps: unitHas(u, CONTAGIOUS) ? scaleByLevel(CONTAGIOUS_DPS, u.level) : 0,
    });
    if (events !== undefined) {
      events.push({ type: 'zone', id, x: u.x, y: u.y, radius: cloud.radius, endTick });
    }
  }
  if (u.sporedUntil > b.tick && u.sporedDps > 0) {
    // Ansteckend: a spored unit releases a cloud for the other player (whatever killed it).
    // Its cloud spreads in turn with the same rate; the chain ends as every unit dies once.
    const spores = CARDS[CONTAGIOUS.card].targets;
    const id = b.nextZoneId++;
    const endTick = b.tick + CONTAGIOUS_TICKS;
    b.zones.push({
      id,
      owner: u.owner === 0 ? 1 : 0,
      x: u.x,
      y: u.y,
      radius: CONTAGIOUS_RADIUS,
      damagePerSecond: u.sporedDps,
      hitsGround: spores.ground,
      hitsAir: spores.air,
      startTick: b.tick,
      endTick,
      contagiousDps: u.sporedDps,
    });
    if (events !== undefined) {
      events.push({ type: 'zone', id, x: u.x, y: u.y, radius: CONTAGIOUS_RADIUS, endTick });
    }
  }
  if (unitHas(u, LICH) && !u.ghost) lichForm(b, u, events);
}

/**
 * Lich-Form: the necromancer returns at once as a flying ghost on its cell in the air (or
 * the nearest free air cell), with 50 % of its max HP, once per round (a ghost does not
 * return). Like the zombie and the revive it is a new unit with a new id (ids are never
 * reused and units stay sorted) that counts as summoned by the dead necromancer; its living
 * summons are handed over to it and its summon timer carries on.
 */
function lichForm(b: BattleState, u: UnitState, events: Events): void {
  const cell = nearestFreeCell(b, AIR, u.x, u.y, u.owner);
  if (cell < 0) return;
  const x = cell % GRID_COLS;
  const y = idiv(cell, GRID_COLS);
  const g = spawnUnit(b, u.owner, u.card, u.level, x, y, undefined, AIR);
  g.summonerId = u.id; // battle only, like the zombie and the revive (D-053)
  g.ghost = true;
  g.hp = Math.max(1, applyBps(g.maxHp, LICH_HP_BPS));
  g.summonTick = u.summonTick;
  const units = b.units;
  for (let i = 0; i < units.length; i++) {
    const o = units[i] as UnitState;
    if (o.summonerId === u.id && o.hp > 0) o.summonerId = g.id;
  }
  if (events !== undefined) {
    events.push({ type: 'summon', unit: g.id, summoner: u.id, card: u.card, x, y });
  }
}

/**
 * Nearest free cell of `layer` to (x, y), the cell itself first; ties: scan order (mirrored
 * for player 1). -1 if the layer is full.
 */
function nearestFreeCell(
  b: BattleState,
  layer: Layer,
  x: number,
  y: number,
  owner: number,
): number {
  let best = -1;
  let bestDist = 0;
  for (let i = 0; i < GRID_CELLS; i++) {
    const cell = owner === 0 ? i : GRID_CELLS - 1 - i;
    if (b.occ[layer * GRID_CELLS + cell] !== 0) continue;
    const d = distSq(cell % GRID_COLS, idiv(cell, GRID_COLS), x, y);
    if (best < 0 || d < bestDist) {
      best = cell;
      bestDist = d;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// 6. End of round
// ---------------------------------------------------------------------------

function checkEnd(b: BattleState): void {
  let unitsA = 0;
  let unitsB = 0;
  let hpA = 0;
  let hpB = 0;
  for (const u of b.units) {
    if (u.owner === 0) {
      unitsA++;
      hpA += u.hp;
    } else {
      unitsB++;
      hpB += u.hp;
    }
  }
  let winner: Winner;
  if (unitsA === 0 || unitsB === 0) {
    winner = unitsA > 0 ? 0 : unitsB > 0 ? 1 : 'draw';
    b.result = { winner, reason: 'elimination', ticks: b.tick, hp: [hpA, hpB] };
  } else if (b.tick >= TIME_LIMIT_TICKS) {
    winner = hpA > hpB ? 0 : hpB > hpA ? 1 : 'draw';
    b.result = { winner, reason: 'timeout', ticks: b.tick, hp: [hpA, hpB] };
  }
}
