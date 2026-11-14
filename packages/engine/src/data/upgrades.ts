/**
 * The three upgrades of every card (SPEC 5.4), in the order of the table.
 * Parameters are converted to engine units (SPEC 2.5): ticks (1 s = 20), basis points
 * (1 % = 100), milli-fields for radii (1 field = 1000), fields for ranges, hit points.
 * The comment next to each entry quotes the SPEC value.
 *
 * Only upgrades with `implemented: true` can appear on offer (match.ts). Bit i of an upgrade
 * mask stands for entry i of the card's list.
 */
import type { UpgradeDef } from '../types.ts';
import type { CardId } from './cards.ts';

/** Every card has exactly three upgrades; masks use bits 0..2. */
export const UPGRADES_PER_CARD = 3;
/** Mask with all three upgrades of a card. */
export const ALL_UPGRADES_MASK = 7;

export const UPGRADES: Readonly<Record<CardId, readonly [UpgradeDef, UpgradeDef, UpgradeDef]>> = {
  archer: [
    // Feuerpfeile: hits set the target on fire for 3 s (8 damage/s)
    { id: 'archer.fire_arrows', implemented: false, params: { burnDps: 8, burnTicks: 60 } },
    // Salve: every 4th shot hits up to 3 targets
    { id: 'archer.volley', implemented: false, params: { everyNthShot: 4, maxTargets: 3 } },
    // Adlerauge: +2 range
    { id: 'archer.eagle_eye', implemented: true, params: { bonusRange: 2 } },
  ],
  knight: [
    // Schild: absorbs the first 250 damage
    { id: 'knight.shield', implemented: false, params: { shieldPoints: 250 } },
    // Ansturm: first hit after moving deals double damage + 0.5 s stun
    { id: 'knight.charge', implemented: false, params: { damageBps: 20000, stunTicks: 10 } },
    // Spott: enemies within radius 2 must attack him if they can
    { id: 'knight.taunt', implemented: false, params: { radius: 2000 } },
  ],
  tnt: [
    // Tochter-TNT: after the blast 1 mini TNT spawns (50 % HP, 50 % damage), without daughter
    {
      id: 'tnt.daughter_tnt',
      implemented: false,
      params: { count: 1, hpBps: 5000, damageBps: 5000 },
    },
    // Kurze Lunte: +60 % move speed
    { id: 'tnt.short_fuse', implemented: true, params: { speedBonusBps: 6000 } },
    // Panzerkiste: +100 % HP
    { id: 'tnt.armored_crate', implemented: true, params: { hpBonusBps: 10000 } },
  ],
  skeleton: [
    // Untot: 2 s after death rises once as a zombie with 40 % HP
    { id: 'skeleton.undead', implemented: false, params: { delayTicks: 40, hpBps: 4000 } },
    // Knochenhagel: on death 15 damage to all adjacent enemies (r 1.5 = 3 x 3 cells, D-022)
    { id: 'skeleton.bone_hail', implemented: false, params: { damage: 15, radius: 1500 } },
    // Rasselbande: +2 skeletons per card
    { id: 'skeleton.rattle_gang', implemented: true, params: { extraUnits: 2 } },
  ],
  healer: [
    // Heilkreis: heals all allies within radius 2 with 60 % of the healing each
    { id: 'healer.heal_circle', implemented: false, params: { radius: 2000, healBps: 6000 } },
    // Wiederbelebung: once per round the first ally dying in range returns with 50 % HP
    { id: 'healer.revive', implemented: false, params: { hpBps: 5000, perRound: 1 } },
    // Segen: healed allies deal +20 % damage for 3 s
    {
      id: 'healer.blessing',
      implemented: false,
      params: { damageBonusBps: 2000, durationTicks: 60 },
    },
  ],
  musketeer: [
    // Durchschlag: the bullet also hits the enemy right behind with 50 %
    { id: 'musketeer.pierce', implemented: false, params: { damageBps: 5000 } },
    // Kopfschuss: first shot of every round deals 3x damage
    { id: 'musketeer.headshot', implemented: false, params: { damageBps: 30000 } },
    // Bajonett: with an adjacent enemy, melee 45 damage / 1.0 s instead of shooting
    { id: 'musketeer.bayonet', implemented: false, params: { damage: 45, intervalTicks: 20 } },
  ],
  bat: [
    // Blutdurst: 40 % lifesteal
    { id: 'bat.bloodthirst', implemented: false, params: { lifestealBps: 4000 } },
    // Schwarm: +2 bats
    { id: 'bat.swarm', implemented: true, params: { extraUnits: 2 } },
    // Ultraschall: hits slow the target's attack speed by 25 % for 2 s
    {
      id: 'bat.ultrasound',
      implemented: false,
      params: { attackSlowBps: 2500, durationTicks: 40 },
    },
  ],
  assassin: [
    // Gift: hits poison (12 damage/s for 4 s, renewed)
    { id: 'assassin.poison', implemented: false, params: { poisonDps: 12, poisonTicks: 80 } },
    // Schattenschritt: if his target dies he jumps again to the farthest enemy (cooldown 6 s)
    { id: 'assassin.shadow_step', implemented: false, params: { cooldownTicks: 120 } },
    // Rauchbombe: not targetable for 2 s after every jump
    { id: 'assassin.smoke_bomb', implemented: false, params: { untargetableTicks: 40 } },
  ],
  berserker: [
    // Unbändig: dropping below 20 % HP -> 2 s invulnerable (once per round)
    {
      id: 'berserker.unstoppable',
      implemented: false,
      params: { hpThresholdBps: 2000, invulnerableTicks: 40, perRound: 1 },
    },
    // Wirbelwind: every 3rd attack hits all adjacent enemies
    { id: 'berserker.whirlwind', implemented: false, params: { everyNthAttack: 3 } },
    // Blutrausch: every kill heals 15 % of max HP
    { id: 'berserker.blood_frenzy', implemented: false, params: { healBps: 1500 } },
  ],
  shroomling: [
    // Riesenpilz: one of the four grows big (3x HP and 3x damage)
    {
      id: 'shroomling.giant_mushroom',
      implemented: false,
      params: { giants: 1, hpBps: 30000, damageBps: 30000 },
    },
    // Ansteckend: poisoned enemies release a spore cloud on death (cloud as the shroomling's)
    {
      id: 'shroomling.contagious',
      implemented: false,
      params: { radius: 1000, damagePerSecond: 15, durationTicks: 60 },
    },
    // Myzel: neighbouring shroomlings heal each other by 5 HP/s (neighbours: r 1.5)
    { id: 'shroomling.mycelium', implemented: false, params: { healPerSecond: 5, radius: 1500 } },
  ],
  pyromancer: [
    // Inferno: targets burn for 3 s (15 damage/s)
    { id: 'pyromancer.inferno', implemented: false, params: { burnDps: 15, burnTicks: 60 } },
    // Meteor: every 10 s a meteor on the largest enemy group (200 damage, r 1.5)
    {
      id: 'pyromancer.meteor',
      implemented: false,
      params: { intervalTicks: 200, damage: 200, radius: 1500 },
    },
    // Hitzeschild: the first 2 hits against her are ignored
    { id: 'pyromancer.heat_shield', implemented: false, params: { ignoredHits: 2 } },
  ],
  necromancer: [
    // Knochenarmee: every 3 s, at most 6 skeletons
    { id: 'necromancer.bone_army', implemented: false, params: { intervalTicks: 60, max: 6 } },
    // Seelenernte: an enemy dying within radius 3 gives +1 skeleton at once
    { id: 'necromancer.soul_harvest', implemented: false, params: { radius: 3000 } },
    // Lich-Form: on death returns once as a flying ghost with 50 % HP
    { id: 'necromancer.lich_form', implemented: false, params: { hpBps: 5000 } },
  ],
  beetle: [
    // Säurepfütze: the impact leaves acid for 3 s (25 damage/s); radius = shell radius r 1.5
    {
      id: 'beetle.acid_pool',
      implemented: false,
      params: { durationTicks: 60, damagePerSecond: 25, radius: 1500 },
    },
    // Doppelladung: 2 shells at 2 different targets, 60 % damage each
    { id: 'beetle.double_load', implemented: false, params: { shells: 2, damageBps: 6000 } },
    // Chitinpanzer: +60 % HP, melee attackers take 15 damage back
    {
      id: 'beetle.chitin_armor',
      implemented: false,
      params: { hpBonusBps: 6000, thornsDamage: 15 },
    },
  ],
  golem: [
    // Steinhaut: -20 % damage taken
    { id: 'golem.stone_skin', implemented: true, params: { armorBps: 2000 } },
    // Erdstoß: every 6 s 60 area damage (r 1.5) + 30 % slow for 2 s
    {
      id: 'golem.earthquake',
      implemented: false,
      params: { intervalTicks: 120, damage: 60, radius: 1500, slowBps: 3000, slowTicks: 40 },
    },
    // Geröll: on death 3 mini golems with 20 % of the stats
    { id: 'golem.rubble', implemented: false, params: { count: 3, statsBps: 2000 } },
  ],
  frost_shaman: [
    // Eisblock: every 4th hit freezes the target for 1 s
    {
      id: 'frost_shaman.ice_block',
      implemented: false,
      params: { everyNthHit: 4, freezeTicks: 20 },
    },
    // Frostnova: at battle start and every 12 s freezes enemies within radius 2 for 1.5 s
    {
      id: 'frost_shaman.frost_nova',
      implemented: false,
      params: { intervalTicks: 240, radius: 2000, freezeTicks: 30 },
    },
    // Eisrüstung: melee attackers are slowed (strength not in SPEC; assumption: 30 % for 2 s)
    { id: 'frost_shaman.ice_armor', implemented: false, params: { slowBps: 3000, slowTicks: 40 } },
  ],
  whelp: [
    // Feueratem: cone area damage instead of a circle, +1 range
    { id: 'whelp.fire_breath', implemented: false, params: { bonusRange: 1 } },
    // Glutschuppen: +40 % HP
    { id: 'whelp.ember_scales', implemented: true, params: { hpBonusBps: 4000 } },
    // Wachstum: every 10 s +15 % damage and size (at most 3 times)
    {
      id: 'whelp.growth',
      implemented: false,
      params: { intervalTicks: 200, damageBonusBps: 1500, maxStacks: 3 },
    },
  ],
};
