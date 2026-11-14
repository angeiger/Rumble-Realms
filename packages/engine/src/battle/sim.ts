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
import {
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
} from '../data/balance.ts';
import { CARDS } from '../data/cards.ts';
import { applyBps, distSq, idiv, isqrt, rangeSq, scaleByLevel } from '../math.ts';
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
import { GROUND } from '../types.ts';
import { findPath } from './pathfinding.ts';
import { cellIndex, isFree, occIndex, unitById } from './state.ts';

type Events = BattleEvent[] | undefined;

/**
 * Step directions seen from player 0 (forward = towards higher rows): straight steps
 * first, then diagonals. Player 1 uses the same list rotated by 180 degrees, so ties
 * are resolved mirror-symmetrically.
 */
const STEP_DX = [0, -1, 1, 0, -1, 1, -1, 1];
const STEP_DY = [1, 0, 0, -1, 1, 1, -1, -1];

/** Advances the battle by one tick. Pass `events` to collect what happened for rendering. */
export function stepTick(b: BattleState, events?: BattleEvent[]): void {
  if (b.result !== null) return;
  if (!b.started) beginBattle(b);
  const units = b.units;
  const count = units.length;

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
  resolveDeaths(b, events);
  b.tick++;
  checkEnd(b);
}

/** Runs the battle to its end (at most TIME_LIMIT_TICKS ticks) and returns the result. */
export function simulateToEnd(b: BattleState): BattleResult {
  while (b.result === null) stepTick(b);
  return b.result;
}

function beginBattle(b: BattleState): void {
  b.started = true;
  for (const u of b.units) {
    const jump = CARDS[u.card].shadowJump;
    if (jump !== undefined) u.jumpTick = b.tick + jump.chargeTicks;
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
    const target = unitById(b, p.targetId);
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
function nearestEnemy(b: BattleState, u: UnitState, def: CardDef): UnitState | undefined {
  let best: UnitState | undefined;
  let bestDist = 0;
  let bestRows = 0;
  for (const o of b.units) {
    if (o.owner === u.owner || o.hp <= 0 || !canHit(def, o)) continue;
    const d = distSq(u.x, u.y, o.x, o.y);
    const rows = Math.abs(u.y - o.y);
    if (best === undefined || d < bestDist || (d === bestDist && rows < bestRows)) {
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
  const current = u.targetId === 0 ? undefined : unitById(b, u.targetId);
  const valid = current !== undefined && current.hp > 0;
  if (def.attack.kind === 'heal') {
    const healed = u.mode === 'heal' && valid && current.hp >= current.maxHp;
    if (valid && !healed && b.tick < u.retargetTick) return;
    chooseHealerTarget(b, u, def);
    return;
  }
  if (valid && b.tick < u.retargetTick) return;
  setTarget(b, u, nearestEnemy(b, u, def), 'attack');
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
  for (const o of b.units) {
    if (o.owner !== u.owner || o.id === u.id || o.hp <= 0) continue;
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
  if (!fighterLeft) setTarget(b, u, nearestEnemy(b, u, def), 'attack');
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
    // Detonates on contact, even in mid-step; the blast itself is a death effect.
    if (enemyAdjacent(b, u, def)) u.hp = 0;
    return;
  }
  if (u.moveCost > 0 || u.targetId === 0 || u.mode === 'follow') return;
  if (b.tick < u.nextAttackTick) return;
  const target = unitById(b, u.targetId);
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

function enemyAdjacent(b: BattleState, u: UnitState, def: CardDef): boolean {
  const reach = rangeSq(MELEE_RANGE);
  for (const o of b.units) {
    if (o.owner === u.owner || o.hp <= 0 || !canHit(def, o)) continue;
    if (distSq(u.x, u.y, o.x, o.y) <= reach) return true;
  }
  return false;
}

/** Assassin: teleport next to the farthest ground enemy (SPEC 5.3, D-028). */
function shadowJump(b: BattleState, u: UnitState, events: Events): void {
  u.jumpTick = -1;
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
  if (far === undefined) return;

  // Free ground cell closest to that enemy; ties: closest to the assassin, then scan
  // order (mirrored for player 1). The assassin's own cell counts as free.
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
    const d = distSq(x, y, far.tx, far.ty);
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
  setTarget(b, u, far, 'attack');
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
  const target = u.targetId === 0 ? undefined : unitById(b, u.targetId);
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
