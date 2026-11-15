/**
 * Bot decisions (SPEC 8.1). A bot only chooses a slot of the offer; applying it is up to
 * the caller. Random numbers come from the caller's own stream, so a bot never shifts the
 * match streams.
 *
 * - easy: every slot with equal probability.
 * - medium: counter heuristic from the card data (targets, range, area, unit count, layer)
 *   against everything the opponent has played in this match (D-046: the army grows).
 * - hard: Monte Carlo. For every slot the rest of the round is played on copies of the
 *   state with random picks for both sides, the battle simulated and the result scored.
 *
 * Everything is integer arithmetic and depends only on the state and the bot stream.
 */
import { simulateToEnd } from './battle/sim.ts';
import { BOT_LEVELS, type BotLevelId } from './data/bots.ts';
import { BPS, DECK_SIZE, PICKS_PER_ROUND } from './data/balance.ts';
import { CARDS } from './data/cards.ts';
import { applyPick, getOffer, startBattle } from './match.ts';
import { isqrt, scaleByLevel } from './math.ts';
import { nextInt, nextU32, seedRng, STREAM_BATTLE, STREAM_OFFERS } from './rng.ts';
import type {
  CardDef,
  CardId,
  MatchState,
  Offer,
  OfferSlot,
  PlayerIndex,
  RngState,
} from './types.ts';
import { unitCount } from './upgrades.ts';

/** Stream number for bot decisions; 1..4 are used by the match (rng.ts). */
export const STREAM_BOT = 5;

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
// Medium: counter heuristic
// ---------------------------------------------------------------------------

/** Damage per second of one unit (heal: healing per second), times 20 ticks. */
function attackRate(def: CardDef): number {
  const a = def.attack;
  switch (a.kind) {
    case 'melee':
    case 'ranged':
    case 'artillery':
      return Math.floor((a.damage * 20) / a.intervalTicks);
    case 'heal':
      return Math.floor((a.amount * 20) / a.intervalTicks);
    case 'explode':
      // One blast; counted as if spread over its run-up, fuse and lifetime (about 5 s).
      return Math.floor(a.damage / 5);
  }
}

/** True if the card hits several enemies at once (splash, shell, blast, spore cloud). */
export function hasAreaDamage(def: CardDef): boolean {
  const a = def.attack;
  if (a.kind === 'artillery' || a.kind === 'explode') return true;
  if (a.kind === 'ranged' && a.splashRadius !== undefined) return true;
  return def.deathCloud !== undefined;
}

/** Ranged (or artillery) attacker that stays out of melee. */
function isShooter(def: CardDef): boolean {
  return def.attack.kind === 'ranged' || def.attack.kind === 'artillery';
}

/** Many weak units per card: what area damage is good against. */
function isSwarm(def: CardDef): boolean {
  return def.count >= 3 && def.hp <= 150;
}

/** Sturdy unit that holds the front for shooters behind it. */
function isFrontline(def: CardDef): boolean {
  return def.zone === 'front' && def.layer === 0 && def.hp >= 300;
}

/**
 * Rough fighting value of one unit at `level`: the geometric mean of hit points and damage
 * per second (Lanchester: a unit is worth hp x dps, so many weak units are not overrated).
 * Area damage counts 1.6 times, shooters 1.3 times (they attack from behind), a spore cloud
 * adds its damage, a summoner half the value of its maximum summons.
 */
export function unitValue(card: CardId, level: number): number {
  const def = CARDS[card];
  let rate = attackRate(def);
  if (def.deathCloud !== undefined) {
    rate += Math.floor((def.deathCloud.damagePerSecond * def.deathCloud.durationTicks) / 60);
  }
  if (hasAreaDamage(def)) rate = Math.floor((rate * 16) / 10);
  if (isShooter(def)) rate = Math.floor((rate * 13) / 10);
  let value = isqrt(def.hp * rate * 100);
  if (def.summon !== undefined) {
    value += Math.floor((unitValue(def.summon.card, 1) * def.summon.max) / 2);
  }
  return scaleByLevel(value, level);
}

/** Shares (basis points) of the opponent's and own army values by feature. */
interface ArmyProfile {
  total: number;
  air: number;
  swarm: number;
  tank: number;
  front: number;
  shooters: number;
  /** Units that can attack flyers. */
  antiAir: number;
}

export function profileOf(state: MatchState, player: PlayerIndex): ArmyProfile {
  const p: ArmyProfile = {
    total: 0,
    air: 0,
    swarm: 0,
    tank: 0,
    front: 0,
    shooters: 0,
    antiAir: 0,
  };
  for (const entry of state.army) {
    if (entry.player !== player) continue;
    const def = CARDS[entry.card];
    const mask = state.activeUpgrades[player][entry.card] ?? 0;
    const v = unitValue(entry.card, entry.level) * unitCount(entry.card, mask, entry.double);
    p.total += v;
    if (def.layer === 1) p.air += v;
    if (isSwarm(def)) p.swarm += v;
    if (def.role === 'tank' || def.hp >= 600) p.tank += v;
    if (isFrontline(def)) p.front += v;
    if (isShooter(def)) p.shooters += v;
    if (def.targets.air) p.antiAir += v;
  }
  return p;
}

/** Share of `part` in `total` in basis points; 0 for an empty army. */
function share(part: number, total: number): number {
  return total > 0 ? Math.floor((part * BPS) / total) : 0;
}

/**
 * Multiplier (basis points, 10000 = neutral) for adding `card` against the opponent's
 * army `opp` next to the own army `own`.
 */
export function counterFactor(card: CardId, opp: ArmyProfile, own: ArmyProfile): number {
  const def = CARDS[card];
  const air = share(opp.air, opp.total);
  const swarm = share(opp.swarm, opp.total);
  const tank = share(opp.tank, opp.total);
  let f = BPS;
  // Enemy flyers: useless if it cannot hit them, good if it can (best from range) and the
  // own army lacks anti-air so far.
  if (!def.targets.air) f -= Math.floor((air * 6) / 10);
  else {
    const ownAntiAir = share(own.antiAir, own.total);
    f += Math.floor((air * (BPS - ownAntiAir)) / BPS / 2);
    if (isShooter(def)) f += Math.floor((air * 3) / 10);
  }
  // Own flyers: strong while less than half of the enemy army can hit the air (they are
  // then nearly untouchable), neutral otherwise and while the enemy army is unknown.
  if (def.layer === 1 && opp.total > 0) {
    f += Math.max(0, BPS / 2 - share(opp.antiAir, opp.total)) * 4;
  }
  // Area damage against swarms; a swarm of its own would melt in the opponent's area damage.
  if (hasAreaDamage(def)) f += Math.floor((swarm * 7) / 10);
  // Tanks: high single-target damage or many small attackers wear them down.
  if (!hasAreaDamage(def) && (def.count >= 3 || attackRate(def) >= 50)) {
    f += Math.floor((tank * 3) / 10);
  }
  // Balance front and back: a frontline in front of an army of shooters (or an empty
  // field), shooters behind a strong frontline.
  const front = share(own.front, own.total);
  if (own.total === 0 || front < 2500) {
    if (isFrontline(def)) f += 4000;
    else if (isShooter(def) && share(own.shooters, own.total) >= 5000) f -= 1500;
  } else if (front >= 5000) {
    if (isShooter(def)) f += 4000;
    else if (isFrontline(def)) f -= 2000;
  }
  // Healers need allies to heal.
  if (def.attack.kind === 'heal' && own.total === 0) f -= 5000;
  return Math.max(500, f);
}

/** Rounds the match is still expected to last, at least 1 (both lose a life per round at most). */
function roundsLeft(state: MatchState): number {
  return Math.max(1, Math.min(state.lives[0], state.lives[1]));
}

/** Upgrades raise the value of every unit of that card for the rest of the match. */
const UPGRADE_VALUE_BPS = 3000;

/** Heuristic value of one offer slot for the player whose pick is due. */
export function scoreSlot(state: MatchState, slot: OfferSlot, player: PlayerIndex): number {
  const opponent: PlayerIndex = player === 0 ? 1 : 0;
  const own = profileOf(state, player);
  const opp = profileOf(state, opponent);
  const card = slot.card;
  const level = state.config.players[player].levels[card] ?? 1;
  const mask = state.activeUpgrades[player][card] ?? 0;
  const factor = counterFactor(card, opp, own);
  const perUnit = unitValue(card, level);
  if (slot.kind !== 'upgrade') {
    const units = unitCount(card, mask, slot.kind === 'double');
    return Math.floor((perUnit * units * factor) / BPS);
  }
  // Upgrade: units already played gain (more units directly, the rest as a flat share),
  // plus copies of the card that will still be played in later rounds.
  const newMask = mask | (1 << slot.upgrade);
  let existing = 0;
  let extra = 0;
  for (const entry of state.army) {
    if (entry.player !== player || entry.card !== card) continue;
    const before = unitCount(card, mask, entry.double);
    existing += perUnit * before;
    extra += perUnit * (unitCount(card, newMask, entry.double) - before);
  }
  const futureCopies = Math.floor(((roundsLeft(state) - 1) * PICKS_PER_ROUND * BPS) / DECK_SIZE);
  const future = Math.floor((perUnit * unitCount(card, mask, false) * futureCopies) / BPS);
  const gain = Math.floor(((existing + future) * UPGRADE_VALUE_BPS) / BPS) + extra;
  return Math.floor((gain * factor) / BPS);
}

const medium: Strategy = (state, offer, rng) =>
  pickBest(
    offer.slots.map((slot) => scoreSlot(state, slot, offer.player)),
    rng,
  );

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

/**
 * The same seeds are used for every slot (common random numbers), so the slots are compared
 * under the same follow-up luck.
 */
function hardWith(simulations: number): Strategy {
  return (state, offer, rng) => {
    const seeds: number[] = [];
    for (let i = 0; i < simulations; i++) seeds.push(nextU32(rng));
    const scores = offer.slots.map((_, slot) => {
      let sum = 0;
      for (const seed of seeds) sum += rollout(state, slot, seed);
      return sum;
    });
    return pickBest(scores, rng);
  };
}

const STRATEGIES: Record<BotLevelId, Strategy> = {
  easy: (_state, offer, rng) => nextInt(rng, offer.slots.length),
  medium,
  hard: hardWith(BOT_LEVELS.hard.simulations),
};

/** Slot (index into the current offer) the bot picks. Throws outside the draft. */
export function chooseBotPick(state: MatchState, level: BotLevelId, rng: RngState): number {
  const offer = getOffer(state);
  const strategy = Object.hasOwn(STRATEGIES, level) ? STRATEGIES[level] : undefined;
  if (strategy === undefined) throw new Error(`chooseBotPick: unknown bot level ${String(level)}`);
  return strategy(state, offer, rng);
}
