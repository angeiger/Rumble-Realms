/**
 * Bot decisions (SPEC 8.1). A bot only chooses a slot of the offer; applying it is up to
 * the caller. Random numbers come from the caller's own stream, so a bot never shifts the
 * match streams.
 *
 * - easy: every slot with equal probability.
 * - medium: no battle simulation, but a battle estimate from the card data (D-079): for every
 *   slot the own army with that pick against everything the opponent has played in this
 *   match (D-046: the army grows) plus a prior for the opponent's unknown cards. Mixing
 *   follows from the estimate: melee beyond the front line, flyers the enemy cannot hit,
 *   ground units against flyers or more healing than there is damage to cancel add little.
 * - hard: Monte Carlo. For every slot the rest of the round is played on copies of the
 *   state with random picks for both sides, the battle simulated and the result scored. The
 *   simulations only see the current round, so the estimate of the medium bot is added with
 *   a weight: it rates what the pick means for the growing army (D-079).
 *
 * Everything is integer arithmetic and depends only on the state and the bot stream.
 */
import { simulateToEnd } from './battle/sim.ts';
import { BOT_LEVELS, MEDIUM_HEURISTIC, type BotLevelId } from './data/bots.ts';
import {
  BPS,
  DECK_SIZE,
  FIELD,
  MELEE_RANGE,
  PICKS_PER_ROUND,
  TICKS_PER_SECOND,
} from './data/balance.ts';
import { CARD_IDS, CARDS } from './data/cards.ts';
import { UPGRADES, UPGRADES_PER_CARD } from './data/upgrades.ts';
import { applyPick, getOffer, picksRemaining, startBattle } from './match.ts';
import { applyBps, idiv, scaleByLevel } from './math.ts';
import { nextInt, nextU32, seedRng, STREAM_BATTLE, STREAM_OFFERS } from './rng.ts';
import { AIR } from './types.ts';
import type {
  CardId,
  Layer,
  MatchState,
  Offer,
  OfferSlot,
  PlayerIndex,
  RngState,
  UpgradeDef,
  UpgradeIndex,
} from './types.ts';
import { hasUpgrade, summonMax, unitCount, unitStats } from './upgrades.ts';

/** Stream number for bot decisions; 1..4 are used by the match (rng.ts). */
export const STREAM_BOT = 5;

/**
 * First stream number of `botPickRng`: decision `pickIndex` uses stream
 * BOT_PICK_STREAM_BASE + pickIndex. Far above the match streams 1..4 and STREAM_BOT, so the
 * ranges can never overlap (room for 65 536 further fixed streams below it).
 */
export const BOT_PICK_STREAM_BASE = 0x10000;
/** Highest `pickIndex` `botPickRng` accepts (a match has fewer than 50 picks). */
export const BOT_PICK_INDEX_MAX = 0xffff;

/**
 * Random stream of ONE bot decision (D-084): derived from the match seed and the global index
 * of the pick in the match (`state.picks.length` before the pick). Every decision has its own,
 * independent stream, so a single decision can be recomputed (and checked by the server)
 * without replaying the bot's earlier decisions; the bot's luck never carries over from one
 * pick to the next.
 *
 * Distinct (seed, pickIndex) give distinct generator states: for a fixed seed every state word
 * of `seedRng` is a bijection of the stream number (rng.ts), and the streams
 * BOT_PICK_STREAM_BASE .. BOT_PICK_STREAM_BASE + BOT_PICK_INDEX_MAX are disjoint from the match
 * streams. Throws for a pickIndex outside 0..BOT_PICK_INDEX_MAX or an invalid seed.
 */
export function botPickRng(seed: number, pickIndex: number): RngState {
  if (!Number.isInteger(pickIndex) || pickIndex < 0 || pickIndex > BOT_PICK_INDEX_MAX) {
    throw new Error(
      `botPickRng: pickIndex must be an integer 0..${BOT_PICK_INDEX_MAX}, got ${pickIndex}`,
    );
  }
  return seedRng(seed, BOT_PICK_STREAM_BASE + pickIndex);
}

type Strategy = (state: MatchState, offer: Offer, rng: RngState) => number;

/** Deep copy of a match state (plain JSON data, D-019). The copy shares nothing. */
export function cloneMatchState(state: MatchState): MatchState {
  return JSON.parse(JSON.stringify(state)) as MatchState;
}

/** Index of the highest score; ties are broken with exactly one draw of `rng`. */
function pickBest(scores: readonly number[], rng: RngState): number {
  let best = -Infinity;
  for (const s of scores) if (s > best) best = s;
  const ties: number[] = [];
  scores.forEach((s, i) => {
    if (s === best) ties.push(i);
  });
  return ties[nextInt(rng, ties.length)] as number;
}

// ---------------------------------------------------------------------------
// Medium: battle estimate from the card data
// ---------------------------------------------------------------------------

const MH = MEDIUM_HEURISTIC;

/** Rates are kept per 100 seconds, only for integer precision. */
const RATE_SECONDS = 100;
/** Times of the estimate are in milliseconds. */
const MS_PER_SECOND = 1000;

/**
 * Upgrade parameters the estimate reads through `unitStats` and `unitCount`; area healing
 * (`healBps` with `radius`) is read by `areaHealing`.
 */
const MODELED_UPGRADE_PARAMS: readonly string[] = [
  'extraUnits',
  'hpBonusBps',
  'bonusRange',
  'armorBps',
  'shieldPoints',
];

/**
 * Units of one kind for the battle estimate of the medium bot. `weight` is the number of
 * units times BPS, so expected future copies can count with a fraction.
 */
export interface UnitGroup {
  layer: Layer;
  hitsGround: boolean;
  hitsAir: boolean;
  /** Fights in contact (melee, blast): only the front line can fight at once. */
  melee: boolean;
  /** Fields, for shooters; MELEE_RANGE otherwise. */
  range: number;
  /** Milli-fields per tick. */
  speed: number;
  /** Area radius of `dps` in milli-fields; 0 = one target per hit. */
  areaRadius: number;
  /** Effective hit points of one unit (shield and armor included). */
  hp: number;
  /** Damage per RATE_SECONDS of one unit. */
  dps: number;
  /** One-off damage of one unit (blast, spore cloud on death) per target. */
  burst: number;
  /** Area radius of `burst` in milli-fields. */
  burstRadius: number;
  /** Healing per RATE_SECONDS of one unit (allies, or itself by lifesteal). */
  heal: number;
  /**
   * Area healing (upgrade with `healBps` and `radius`): every heal also reaches the allies
   * within `healRadius` milli-fields with `healAreaBps` of the amount.
   */
  healRadius: number;
  healAreaBps: number;
  /** True for units whose attack is healing allies. */
  healer: boolean;
  weight: number;
}

/** `amount` per `intervalTicks`, as amount per RATE_SECONDS. */
function rate(amount: number, intervalTicks: number): number {
  return idiv(amount * RATE_SECONDS * TICKS_PER_SECOND, intervalTicks);
}

/** The active, implemented upgrades of `card` in `mask`. */
function activeUpgrades(card: CardId, mask: number): UpgradeDef[] {
  const out: UpgradeDef[] = [];
  for (let i = 0; i < UPGRADES_PER_CARD; i++) {
    const def = UPGRADES[card][i as UpgradeIndex];
    if (def.implemented && hasUpgrade(mask, i)) out.push(def);
  }
  return out;
}

function isAreaHealing(def: UpgradeDef): boolean {
  return def.params['healBps'] !== undefined && def.params['radius'] !== undefined;
}

/** Active upgrades of `card` in `mask` whose effect the estimate does not model in detail. */
function unmodeledUpgrades(card: CardId, mask: number): number {
  let n = 0;
  for (const def of activeUpgrades(card, mask)) {
    if (isAreaHealing(def)) continue;
    if (!MODELED_UPGRADE_PARAMS.some((name) => def.params[name] !== undefined)) n++;
  }
  return n;
}

/** Radius and share of the area healing of the active upgrades of `card`; zero if none. */
function areaHealing(card: CardId, mask: number): { radius: number; bps: number } {
  let radius = 0;
  let bps = 0;
  for (const def of activeUpgrades(card, mask)) {
    if (!isAreaHealing(def)) continue;
    radius = Math.max(radius, def.params['radius'] ?? 0);
    bps += def.params['healBps'] ?? 0;
  }
  return { radius, bps };
}

type Masks = Readonly<Partial<Record<CardId, number>>>;

/**
 * Appends the groups of `units` (times BPS) units of `card` at `level` with the owner's
 * upgrade masks: the units themselves and a summoner's summons (with the reduced hit points
 * and damage of a summon, D-077).
 */
export function addGroups(
  out: UnitGroup[],
  card: CardId,
  level: number,
  masks: Masks,
  units: number,
): void {
  const def = CARDS[card];
  const mask = masks[card] ?? 0;
  const stats = unitStats(card, level, mask);
  const a = def.attack;
  let dps = 0;
  let heal = 0;
  let melee = true;
  let range = MELEE_RANGE;
  let areaRadius = 0;
  let burst = 0;
  let burstRadius = 0;
  switch (a.kind) {
    case 'melee':
      dps = rate(a.damage, a.intervalTicks);
      break;
    case 'ranged':
      dps = rate(a.damage, a.intervalTicks);
      melee = false;
      range = stats.range;
      areaRadius = a.splashRadius ?? 0;
      break;
    case 'artillery':
      dps = rate(a.damage, a.intervalTicks);
      melee = false;
      range = MH.artilleryRange;
      areaRadius = a.radius;
      break;
    case 'heal':
      // Its emergency melee is ignored.
      heal = rate(a.amount, a.intervalTicks);
      break;
    case 'explode':
      burst = a.damage;
      burstRadius = a.radius;
      break;
  }
  const cloud = def.deathCloud;
  if (cloud !== undefined) {
    burst += idiv(cloud.damagePerSecond * cloud.durationTicks, TICKS_PER_SECOND);
    burstRadius = Math.max(burstRadius, cloud.radius);
  }
  const bonus = BPS + MH.upgradeDamageBps * unmodeledUpgrades(card, mask);
  dps = applyBps(scaleByLevel(dps, level), bonus);
  heal = applyBps(scaleByLevel(heal, level), bonus);
  const healArea = areaHealing(card, mask);
  burst = applyBps(scaleByLevel(burst, level), bonus);
  if (def.rage !== undefined) heal += applyBps(dps, def.rage.lifestealBps);
  out.push({
    layer: def.layer,
    hitsGround: def.targets.ground,
    hitsAir: def.targets.air,
    melee,
    range,
    speed: stats.speed,
    areaRadius,
    hp: idiv((stats.maxHp + stats.shield) * BPS, Math.max(1, BPS - stats.armorBps)),
    dps,
    burst,
    burstRadius,
    heal,
    healRadius: healArea.radius,
    healAreaBps: healArea.bps,
    healer: a.kind === 'heal',
    weight: units,
  });
  const s = def.summon;
  if (s !== undefined) {
    const first = out.length;
    const alive = idiv(units * summonMax(card, mask) * MH.summonUptimeBps, BPS);
    addGroups(out, s.card, level, masks, alive);
    for (let i = first; i < out.length; i++) {
      const g = out[i] as UnitGroup;
      g.hp = applyBps(g.hp, s.hpBps);
      g.dps = applyBps(g.dps, s.damageBps);
      g.burst = applyBps(g.burst, s.damageBps);
      g.heal = applyBps(g.heal, s.damageBps);
    }
  }
}

/** Groups of everything `player` has played, with the given upgrade masks. */
export function armyGroups(state: MatchState, player: PlayerIndex, masks: Masks): UnitGroup[] {
  const out: UnitGroup[] = [];
  for (const entry of state.army) {
    if (entry.player !== player) continue;
    const units = unitCount(entry.card, masks[entry.card] ?? 0, entry.double);
    addGroups(out, entry.card, entry.level, masks, units * BPS);
  }
  return out;
}

/**
 * What the medium bot assumes about `opponent`: everything it has played (with its active
 * upgrades) plus its unknown cards (the bot does not know the opponent's deck, D-065):
 * `opponentPriorPicks` picks spread evenly over all cards, one pick less for every card the
 * opponent has played, down to `opponentPriorMinPicks`.
 */
export function opponentGroups(state: MatchState, opponent: PlayerIndex): UnitGroup[] {
  const out = armyGroups(state, opponent, state.activeUpgrades[opponent]);
  let played = 0;
  for (const entry of state.army) if (entry.player === opponent) played++;
  const prior = Math.max(MH.opponentPriorMinPicks, MH.opponentPriorPicks - played);
  if (prior === 0) return out;
  for (const card of CARD_IDS) {
    const units = idiv(CARDS[card].count * prior * BPS, CARD_IDS.length);
    addGroups(out, card, 1, {}, units);
  }
  return out;
}

/** Damage of one army against another (rates per RATE_SECONDS) and the defender's hit points. */
export interface Clash {
  hpGround: number;
  hpAir: number;
  /** Damage of the attackers that can hit the defender's ground units. */
  toGround: number;
  /** Damage of the attackers that can hit the defender's air units. */
  toAir: number;
  /** Damage of all attackers that can hit one of the defender's layers. */
  total: number;
  /** One-off damage to the defender's ground units, air units and in all. */
  burstGround: number;
  burstAir: number;
  burstTotal: number;
}

/** Targets one hit of area damage with `radius` finds among `units` (times BPS) enemies, times BPS. */
function areaHitsBps(radius: number, units: number): number {
  if (radius === 0) return BPS;
  const perUnit = idiv(units * MH.areaHitsPerUnitBps, BPS);
  const extra = idiv(perUnit * radius * radius, FIELD * FIELD);
  return BPS + Math.min(MH.areaMaxExtraHitsBps, extra);
}

/**
 * Damage `att` deals to `def` per RATE_SECONDS (Lanchester style, D-079):
 * - only units that can hit a layer the defender has count,
 * - melee units of a layer beyond its frontage add no damage (they wait behind the front),
 * - shooters fire freely while the defenders close in: the lead in range over the
 *   defenders' average range, crossed at their average speed (one-off damage),
 * - area damage gains with the number of enemy units,
 * - the defender's healing cancels incoming damage up to `healMaxShareBps`, if there is
 *   anybody besides healers to heal.
 */
export function clash(att: readonly UnitGroup[], def: readonly UnitGroup[]): Clash {
  let hpGround = 0;
  let hpAir = 0;
  let unitsGround = 0;
  let unitsAir = 0;
  let heal = 0;
  let fighters = false;
  let rangeSum = 0;
  let speedSum = 0;
  for (const g of def) {
    if (!g.healer) fighters = true;
    const hp = idiv(g.hp * g.weight, BPS);
    rangeSum += hp * g.range;
    speedSum += hp * g.speed;
    if (g.layer === AIR) {
      hpAir += hp;
      unitsAir += g.weight;
    } else {
      hpGround += hp;
      unitsGround += g.weight;
    }
  }
  for (const g of def) {
    let h = idiv(g.heal * g.weight, BPS);
    if (g.healAreaBps > 0) {
      const others = areaHitsBps(g.healRadius, unitsGround + unitsAir) - BPS;
      h += applyBps(h, idiv(others * g.healAreaBps, BPS));
    }
    heal += h;
  }
  const hpDef = Math.max(1, hpGround + hpAir);
  const defRange = idiv(rangeSum * FIELD, hpDef);
  const defSpeed = Math.max(1, idiv(speedSum, hpDef));
  const freeFireMax = MH.freeFireMaxSeconds * MS_PER_SECOND;
  let crowdGround = 0;
  let crowdAir = 0;
  for (const g of att) {
    if (!g.melee || g.dps === 0) continue;
    if (g.layer === AIR) crowdAir += g.weight;
    else crowdGround += g.weight;
  }
  let toGround = 0;
  let toAir = 0;
  let total = 0;
  // One-off damage: blasts (capped: they all go off at the nearest units) and free fire.
  let blastGround = 0;
  let blastAir = 0;
  let blastTotal = 0;
  let freeGround = 0;
  let freeAir = 0;
  let freeTotal = 0;
  for (const g of att) {
    const ground = g.hitsGround && hpGround > 0;
    const air = g.hitsAir && hpAir > 0;
    if (!ground && !air) continue;
    const targets = (ground ? unitsGround : 0) + (air ? unitsAir : 0);
    let d = idiv(g.dps * g.weight, BPS);
    if (g.melee) {
      const crowd = g.layer === AIR ? crowdAir : crowdGround;
      const front = (g.layer === AIR ? MH.airFrontage : MH.meleeFrontage) * BPS;
      if (crowd > front) d = idiv(d * front, crowd);
    } else {
      d = applyBps(d, BPS + (g.range - MELEE_RANGE) * MH.rangeBonusBps);
    }
    d = applyBps(applyBps(d, areaHitsBps(g.areaRadius, targets)), MH.damageEfficiencyBps);
    const blast = applyBps(
      applyBps(idiv(g.burst * g.weight, BPS), areaHitsBps(g.burstRadius, targets)),
      MH.damageEfficiencyBps,
    );
    let free = 0;
    const lead = g.range * FIELD - defRange;
    if (!g.melee && lead > 0) {
      const ms = Math.min(freeFireMax, idiv(lead * MS_PER_SECOND, defSpeed * TICKS_PER_SECOND));
      free = idiv(d * ms, RATE_SECONDS * MS_PER_SECOND);
    }
    if (ground) {
      toGround += d;
      blastGround += blast;
      freeGround += free;
    }
    if (air) {
      toAir += d;
      blastAir += blast;
      freeAir += free;
    }
    total += d;
    blastTotal += blast;
    freeTotal += free;
  }
  blastGround = Math.min(blastGround, applyBps(hpGround, MH.blastMaxShareBps));
  blastAir = Math.min(blastAir, applyBps(hpAir, MH.blastMaxShareBps));
  const burstGround = blastGround + freeGround;
  const burstAir = blastAir + freeAir;
  const burstTotal = Math.min(blastTotal, blastGround + blastAir) + freeTotal;
  if (fighters && heal > 0 && total > 0) {
    const cancelled = Math.min(heal, applyBps(total, MH.healMaxShareBps));
    const keep = BPS - idiv(cancelled * BPS, total);
    toGround = applyBps(toGround, keep);
    toAir = applyBps(toAir, keep);
    total = applyBps(total, keep);
  }
  return { hpGround, hpAir, toGround, toAir, total, burstGround, burstAir, burstTotal };
}

/** Time to destroy `hp` hit points (less `burst`) at `perRate` damage per RATE_SECONDS. */
function timeMs(hp: number, burst: number, perRate: number): number {
  if (hp <= burst) return 0;
  return perRate > 0 ? idiv((hp - burst) * RATE_SECONDS * MS_PER_SECOND, perRate) : NEVER_MS;
}

/** Stands for "never" in the estimate: longer than any battle. */
const NEVER_MS = 1_000_000_000;

/**
 * Milliseconds until the attackers have destroyed every defender (each layer needs
 * attackers that reach it); NEVER_MS if they cannot.
 */
export function killMs(c: Clash): number {
  let t = timeMs(c.hpGround + c.hpAir, c.burstTotal, c.total);
  if (c.hpGround > 0) t = Math.max(t, timeMs(c.hpGround, c.burstGround, c.toGround));
  if (c.hpAir > 0) t = Math.max(t, timeMs(c.hpAir, c.burstAir, c.toAir));
  return Math.min(t, NEVER_MS);
}

/** Hit points the attackers destroy within `ms`: no more than each layer holds or they reach. */
function destroyedHp(c: Clash, ms: number): number {
  const per = RATE_SECONDS * MS_PER_SECOND;
  const ground = Math.min(c.hpGround, c.burstGround + idiv(c.toGround * ms, per));
  const air = Math.min(c.hpAir, c.burstAir + idiv(c.toAir * ms, per));
  return Math.min(ground + air, c.burstTotal + idiv(c.total * ms, per));
}

/**
 * Expected hit point lead of `own` over `opp` at the end of a battle: both armies lose hit
 * points at the rates of `clash` until one side is destroyed or `battleSeconds` have passed
 * (time limit: the larger sum of hit points wins, SPEC 4.2). Positive = own army ahead.
 */
export function battleMargin(own: readonly UnitGroup[], opp: readonly UnitGroup[]): number {
  return estimate(own, opp).margin;
}

function estimate(
  own: readonly UnitGroup[],
  opp: readonly UnitGroup[],
): { margin: number; survivedMs: number } {
  const attack = clash(own, opp);
  const defence = clash(opp, own);
  const limit = MH.battleSeconds * MS_PER_SECOND;
  const end = Math.min(killMs(attack), killMs(defence), limit);
  const ownLeft = defence.hpGround + defence.hpAir - destroyedHp(defence, end);
  const oppLeft = attack.hpGround + attack.hpAir - destroyedHp(attack, end);
  return { margin: ownLeft - oppLeft, survivedMs: Math.min(killMs(defence), limit) };
}

/**
 * What a pick is worth for the own side: the `battleMargin` first; between equal margins
 * the one whose army survives longer (in whole seconds, up to the time limit), e.g. when
 * the enemy has units the own army cannot hit and every pick loses the same way.
 */
export function battleValue(own: readonly UnitGroup[], opp: readonly UnitGroup[]): number {
  const e = estimate(own, opp);
  return e.margin * (MH.battleSeconds + 1) + idiv(e.survivedMs, MS_PER_SECOND);
}

/** Rounds the match is still expected to last, at least 1 (both lose a life per round at most). */
function roundsLeft(state: MatchState): number {
  return Math.max(1, Math.min(state.lives[0], state.lives[1]));
}

/**
 * Copies of `card` (times BPS) the player is expected to play later in the match: the picks
 * still to come times the share of the card in the own picks so far (smoothed towards an
 * even share of the deck), weighted with `futureCopiesBps`. A card the bot does not play
 * gains little from an upgrade.
 */
export function futureCopies(state: MatchState, player: PlayerIndex, card: CardId): number {
  const picks = picksRemaining(state, player) - 1 + (roundsLeft(state) - 1) * PICKS_PER_ROUND;
  let played = 0;
  let copies = 0;
  for (const entry of state.army) {
    if (entry.player !== player) continue;
    played++;
    if (entry.card === card) copies++;
  }
  const share = idiv((copies * DECK_SIZE + 1) * BPS, (played + 1) * DECK_SIZE);
  return applyBps(Math.max(0, picks) * share, MH.futureCopiesBps);
}

/**
 * Heuristic value of one offer slot for the player whose pick is due: the `battleValue` of
 * the own army with the slot against `mediumOpponent`. A normal card or double pack joins
 * the army (a double pack with twice the units). An upgrade lasts for the rest of the match:
 * it scores the value without a new card plus the gain the upgrade brings to the units
 * already played and to the copies still expected (`futureCopies`: more early in the match,
 * little for a card the bot does not play).
 */
export function scoreSlot(state: MatchState, slot: OfferSlot, player: PlayerIndex): number {
  return scoreAgainst(state, slot, player, mediumOpponent(state, player));
}

/**
 * The opponent's army as the medium bot of `player` rates its picks against it:
 * `opponentGroups`, scaled towards the own army (`scaledTo`).
 */
export function mediumOpponent(state: MatchState, player: PlayerIndex): UnitGroup[] {
  const own = armyGroups(state, player, state.activeUpgrades[player]);
  return scaledTo(opponentGroups(state, player === 0 ? 1 : 0), own);
}

/** Hit points of all units in `groups`. */
function totalHp(groups: readonly UnitGroup[]): number {
  let hp = 0;
  for (const g of groups) hp += idiv(g.hp * g.weight, BPS);
  return hp;
}

/**
 * `opp` with the hit points, damage and healing of its units moved `opponentScaleBps` of the
 * way towards the hit points of `own`: the picks are compared in a battle of about even
 * strength, where the mix decides, since both armies keep growing (a hopeless or easy battle
 * this round says little about which card helps later). The number of units stays, so area
 * damage and the front line see the real army. Unchanged while the own army is empty.
 */
export function scaledTo(opp: UnitGroup[], own: readonly UnitGroup[]): UnitGroup[] {
  const hpOwn = totalHp(own);
  const hpOpp = totalHp(opp);
  if (hpOwn === 0 || hpOpp === 0) return opp;
  const full = idiv(hpOwn * BPS, hpOpp);
  const f = BPS + idiv((full - BPS) * MH.opponentScaleBps, BPS);
  return opp.map((g) => ({
    ...g,
    hp: applyBps(g.hp, f),
    dps: applyBps(g.dps, f),
    burst: applyBps(g.burst, f),
    heal: applyBps(g.heal, f),
  }));
}

function scoreAgainst(
  state: MatchState,
  slot: OfferSlot,
  player: PlayerIndex,
  opp: readonly UnitGroup[],
): number {
  const card = slot.card;
  const level = state.config.players[player].levels[card] ?? 1;
  const masks = state.activeUpgrades[player];
  const mask = masks[card] ?? 0;
  const own = armyGroups(state, player, masks);
  if (slot.kind !== 'upgrade') {
    addGroups(own, card, level, masks, unitCount(card, mask, slot.kind === 'double') * BPS);
    return battleValue(own, opp);
  }
  const upgraded: Masks = { ...masks, [card]: mask | (1 << slot.upgrade) };
  const future = futureCopies(state, player, card);
  const before = battleValue(own, opp);
  addGroups(own, card, level, masks, unitCount(card, mask, false) * future);
  const withoutUpgrade = battleValue(own, opp);
  const after = armyGroups(state, player, upgraded);
  addGroups(after, card, level, upgraded, unitCount(card, upgraded[card] ?? 0, false) * future);
  return before + battleValue(after, opp) - withoutUpgrade;
}

const medium: Strategy = (state, offer, rng) => {
  const opp = mediumOpponent(state, offer.player);
  return pickBest(
    offer.slots.map((slot) => scoreAgainst(state, slot, offer.player, opp)),
    rng,
  );
};

// ---------------------------------------------------------------------------
// Hard: Monte Carlo
// ---------------------------------------------------------------------------

/** Score of one simulated round for `player`: win 2000, draw 1000, loss 0, +-1000 by HP share. */
function rolloutScore(state: MatchState, player: PlayerIndex): number {
  const result = state.battle.result;
  if (result === null) throw new Error('rolloutScore: battle without result');
  const own = result.hp[player];
  const opp = result.hp[player === 0 ? 1 : 0];
  const base = result.winner === 'draw' ? 1000 : result.winner === player ? 2000 : 0;
  const total = own + opp;
  return base + (total > 0 ? Math.floor(((own - opp) * 1000) / total) : 0);
}

/**
 * Plays the rest of the round on a copy: `slot` now, then random picks for both sides.
 * The copy gets fresh offer and battle streams from `seed`, so the bot never
 * peeks at the real future offers or battle random numbers.
 */
export function rollout(state: MatchState, slot: number, seed: number): number {
  const player = getOffer(state).player;
  const copy = cloneMatchState(state);
  copy.rng.offers = seedRng(seed, STREAM_OFFERS);
  copy.battle.rng = seedRng(seed, STREAM_BATTLE);
  const picks = seedRng(seed, STREAM_BOT);
  applyPick(copy, slot);
  while (copy.phase === 'draft') {
    applyPick(copy, nextInt(picks, getOffer(copy).slots.length));
  }
  simulateToEnd(startBattle(copy));
  return rolloutScore(copy, player);
}

/** Points per unit of `estimateShare`: a lead of all hit points on the field. */
const ESTIMATE_SCALE = 1000;

/**
 * The medium estimate of every slot as a share of the hit points on the field, times
 * ESTIMATE_SCALE: the estimated lead (`scoreSlot` without its tie-breaker) over the hit points
 * of the own army before the pick plus those of the opponent as the medium bot sees it.
 */
export function estimateShares(state: MatchState, offer: Offer): number[] {
  const player = offer.player;
  const opp = mediumOpponent(state, player);
  const own = armyGroups(state, player, state.activeUpgrades[player]);
  const total = Math.max(1, totalHp(own) + totalHp(opp));
  return offer.slots.map((slot) => {
    const margin = idiv(scoreAgainst(state, slot, player, opp), MH.battleSeconds + 1);
    return idiv(margin * ESTIMATE_SCALE, total);
  });
}

/**
 * The same seeds are used for every slot (common random numbers), so the slots are compared
 * under the same follow-up luck. With `estimateWeight` the medium estimate counts as well:
 * `estimateWeight` points per simulation for a lead of all hit points on the field.
 */
function hardWith(simulations: number, estimateWeight: number): Strategy {
  return (state, offer, rng) => {
    const seeds: number[] = [];
    for (let i = 0; i < simulations; i++) seeds.push(nextU32(rng));
    const shares = estimateWeight > 0 ? estimateShares(state, offer) : [];
    const scores = offer.slots.map((_, slot) => {
      let sum = 0;
      for (const seed of seeds) sum += rollout(state, slot, seed);
      const share = shares[slot] ?? 0;
      return sum + idiv(simulations * estimateWeight * share, ESTIMATE_SCALE);
    });
    return pickBest(scores, rng);
  };
}

const STRATEGIES: Record<BotLevelId, Strategy> = {
  easy: (_state, offer, rng) => nextInt(rng, offer.slots.length),
  medium,
  hard: hardWith(BOT_LEVELS.hard.simulations, BOT_LEVELS.hard.estimateWeight),
};

/** Slot (index into the current offer) the bot picks. Throws outside the draft. */
export function chooseBotPick(state: MatchState, level: BotLevelId, rng: RngState): number {
  const offer = getOffer(state);
  const strategy = Object.hasOwn(STRATEGIES, level) ? STRATEGIES[level] : undefined;
  if (strategy === undefined) throw new Error(`chooseBotPick: unknown bot level ${String(level)}`);
  return strategy(state, offer, rng);
}
