/**
 * The deterministic battle simulation (SPEC 6). One call of `stepTick` advances the
 * field by one tick (1/20 s) in the fixed order of SPEC 6.2:
 *
 *   1. lingering effects (zones) and projectile impacts
 *   2. target selection
 *   3. attacks and abilities
 *   4. movement
 *   5. deaths and death effects
 *   6. end of round check
 *
 * Units are always processed in ascending id order. Damage is applied immediately, but
 * units only leave the field in step 5, so fatally hit units still act in that tick.
 */
import * as balance from '../data/balance.ts';
import * as cards from '../data/cards.ts';
import * as math from '../math.ts';
import type {
  AttackDef,
  BattleEvent,
  BattleResult,
  BattleState,
  CardDef,
  UnitMode,
  UnitState,
  Winner,
} from '../types.ts';
import * as types from '../types.ts';
import * as pathfinding from './pathfinding.ts';
import * as state from './state.ts';

// Local copies of everything imported that the inner loops use. Behaviour is identical;
// test runners that turn every imported name into a property look-up (Vitest's module
// runner) would otherwise pay for it on each access, which slowed the simulation down
// about threefold there.
const {
  DIAGONAL_STEP,
  FIELD,
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
const { GROUND } = types;
const { findPath, STEP_DX, STEP_DY } = pathfinding;
const { cellIndex, isFree, occIndex } = state;

type Events = BattleEvent[] | undefined;

/**
 * Work data, never part of the state: the units of each owner in ascending id order and a
 * table from id to unit, filled at the start of every `stepTick` and emptied before the
 * deaths are resolved. Units only leave the field in that last step (and none join during
 * a tick), so both stay complete until then; hit points must still be checked. They only
 * save the owner tests and the binary search and never change a result or an order.
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
  if (atk.kind === 'ranged') return rangeSq(atk.range);
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

/** Applies final damage and returns how many hit points were actually removed. */
function damage(target: UnitState, amount: number, events: Events): number {
  const removed = target.hp > 0 ? Math.min(amount, target.hp) : 0;
  target.hp -= amount;
  if (events !== undefined) events.push({ type: 'damage', unit: target.id, amount });
  return removed;
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
// 1. Zones and projectiles
// ---------------------------------------------------------------------------

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
        if (inRadius(u.x, u.y, z.x, z.y, z.radius)) damage(u, amount, events);
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
    // Homing shot: hits if the target is still alive, otherwise it fizzles (SPEC 6.2).
    const target = byId(p.targetId);
    if (target !== undefined && target.hp > 0) {
      damage(target, withSuddenDeath(b, p.damage), events);
    }
  }
  projectiles.length = kept;
}

// ---------------------------------------------------------------------------
// 2. Target selection
// ---------------------------------------------------------------------------

/** Nearest attackable enemy; ties: smaller row distance, then smaller id (SPEC 6.2). */
function nearestEnemy(u: UnitState, def: CardDef): UnitState | undefined {
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
    const dx = o.x - ux;
    const dy = o.y - uy;
    const d = dx * dx + dy * dy;
    if (best !== undefined && d > bestDist) continue;
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
  const valid = current !== undefined && current.hp > 0;
  if (def.attack.kind === 'heal') {
    const healed = u.mode === 'heal' && valid && current.hp >= current.maxHp;
    if (valid && !healed && b.tick < u.retargetTick) return;
    chooseHealerTarget(b, u, def);
    return;
  }
  if (valid && b.tick < u.retargetTick) return;
  setTarget(b, u, nearestEnemy(u, def), 'attack');
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
  if (!fighterLeft) setTarget(b, u, nearestEnemy(u, def), 'attack');
  else if (weakest !== undefined) setTarget(b, u, weakest, 'heal');
  else if (nearestInjured !== undefined) setTarget(b, u, nearestInjured, 'heal');
  else setTarget(b, u, nearestAlly, 'follow');
}

// ---------------------------------------------------------------------------
// 3. Attacks and abilities
// ---------------------------------------------------------------------------

function attackInterval(u: UnitState, def: CardDef): number {
  const atk = def.attack;
  if (atk.kind === 'explode') return 0;
  if (def.rage === undefined) return atk.intervalTicks;
  // Berserker: the interval shrinks linearly with the missing share of hit points.
  const missing = u.maxHp - Math.max(u.hp, 0);
  return atk.intervalTicks - idiv(def.rage.intervalReductionTicks * missing, u.maxHp);
}

function act(b: BattleState, u: UnitState, events: Events): void {
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
  if (u.moveCost > 0 || u.targetId === 0 || u.mode === 'follow') return;
  if (b.tick < u.nextAttackTick) return;
  const target = byId(u.targetId);
  if (target === undefined || target.hp <= 0) return;
  if (distSq(u.x, u.y, target.x, target.y) > reachSq(u, atk)) return;

  if (u.mode === 'heal') {
    if (atk.kind !== 'heal' || target.hp >= target.maxHp) return;
    const amount = Math.min(scaleByLevel(atk.amount, u.level), target.maxHp - target.hp);
    target.hp += amount;
    if (events !== undefined) events.push({ type: 'heal', unit: u.id, target: target.id, amount });
  } else if (atk.kind === 'ranged') {
    const dist = isqrt(distSq(u.x, u.y, target.x, target.y) * FIELD * FIELD);
    const flight = Math.max(1, idiv(dist + atk.projectileSpeed - 1, atk.projectileSpeed));
    const id = b.nextProjectileId++;
    b.projectiles.push({
      id,
      owner: u.owner,
      sourceId: u.id,
      targetId: target.id,
      damage: scaleByLevel(atk.damage, u.level),
      launchTick: b.tick,
      impactTick: b.tick + flight,
    });
    if (events !== undefined) {
      events.push({ type: 'shot', id, unit: u.id, target: target.id, impactTick: b.tick + flight });
    }
  } else {
    const base = atk.kind === 'heal' ? atk.fallbackDamage : atk.damage;
    if (events !== undefined) events.push({ type: 'attack', unit: u.id, target: target.id });
    const removed = damage(target, withSuddenDeath(b, scaleByLevel(base, u.level)), events);
    if (def.rage !== undefined && u.hp > 0) {
      u.hp = Math.min(u.maxHp, u.hp + applyBps(removed, def.rage.lifestealBps));
    }
  }
  u.nextAttackTick = b.tick + attackInterval(u, def);
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
  if (u.jumpTick >= 0) return;
  const def = CARDS[u.card];

  if (u.moveCost > 0) {
    u.moveProgress += def.moveSpeed;
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
  u.moveProgress = carry + def.moveSpeed;
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
  const handled: boolean[] = [];
  for (let i = 0; i < count; i++) handled.push(false);
  let again = true;
  while (again) {
    again = false;
    for (let i = 0; i < count; i++) {
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
  for (let i = 0; i < count; i++) {
    if (handled[i] !== true) units[kept++] = units[i] as UnitState;
  }
  units.length = kept;
}

function deathEffects(b: BattleState, u: UnitState, events: Events): void {
  const def = CARDS[u.card];
  const atk = def.attack;
  if (atk.kind === 'explode') {
    if (events !== undefined) {
      events.push({ type: 'explosion', unit: u.id, x: u.x, y: u.y, radius: atk.radius });
    }
    const amount = withSuddenDeath(b, scaleByLevel(atk.damage, u.level));
    for (const o of b.units) {
      if (o.owner === u.owner || o.hp <= 0 || !canHit(def, o)) continue;
      if (inRadius(u.x, u.y, o.x, o.y, atk.radius)) damage(o, amount, events);
    }
  }
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
    });
    if (events !== undefined) {
      events.push({ type: 'zone', id, x: u.x, y: u.y, radius: cloud.radius, endTick });
    }
  }
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
