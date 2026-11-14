/**
 * Card definitions of all 16 base units (SPEC 5.2, level 1), in the order of the table.
 * Values are pre-converted to engine units (SPEC 2.5, D-018 ff.):
 * - intervalTicks = seconds * 20
 * - moveSpeed     = fields per second * 50 (milli-fields per tick)
 * - projectileSpeed = milli-fields per tick, radii in milli-fields
 */
import type { CardDef } from '../types.ts';
import { AIR, GROUND } from '../types.ts';

export const CARD_IDS = [
  'archer',
  'knight',
  'tnt',
  'skeleton',
  'healer',
  'musketeer',
  'bat',
  'assassin',
  'berserker',
  'shroomling',
  'pyromancer',
  'necromancer',
  'beetle',
  'golem',
  'frost_shaman',
  'whelp',
] as const;

export type CardId = (typeof CARD_IDS)[number];

export const CARDS: Readonly<Record<CardId, CardDef>> = {
  archer: {
    id: 'archer',
    count: 3,
    role: 'ranged',
    zone: 'back',
    layer: GROUND,
    hp: 120,
    moveSpeed: 50, // 1,0 field/s
    targets: { ground: true, air: true },
    attack: {
      kind: 'ranged',
      damage: 30,
      intervalTicks: 20, // 1,0 s
      range: 5,
      projectileSpeed: 600, // assumption: 12 fields/s
    },
    rarity: 'common',
    arena: 1,
  },
  knight: {
    id: 'knight',
    count: 2,
    role: 'tank',
    zone: 'front',
    layer: GROUND,
    hp: 600,
    moveSpeed: 40, // 0,8 field/s
    targets: { ground: true, air: false },
    attack: {
      kind: 'melee',
      damage: 60,
      intervalTicks: 24, // 1,2 s
    },
    rarity: 'common',
    arena: 1,
  },
  tnt: {
    id: 'tnt',
    count: 2,
    role: 'bomb',
    zone: 'front',
    layer: GROUND,
    hp: 150,
    moveSpeed: 75, // 1,5 field/s
    targets: { ground: true, air: false },
    attack: {
      kind: 'explode',
      damage: 250,
      radius: 1500, // r 1,5 fields
      triggerRange: 2, // fuse starts when a ground enemy is within 2 fields (D-050)
      fuseTicks: 25, // 1,25 s
    },
    rarity: 'rare',
    arena: 1,
  },
  skeleton: {
    id: 'skeleton',
    count: 5,
    role: 'swarm',
    zone: 'front',
    layer: GROUND,
    hp: 60,
    moveSpeed: 90, // 1,8 field/s
    targets: { ground: true, air: false },
    attack: {
      kind: 'melee',
      damage: 20,
      intervalTicks: 14, // 0,7 s
    },
    rarity: 'common',
    arena: 1,
  },
  healer: {
    id: 'healer',
    count: 2,
    role: 'support',
    zone: 'mid',
    layer: GROUND,
    hp: 200,
    moveSpeed: 45, // 0,9 field/s
    // Heals allies; its emergency melee only hits ground enemies (SPEC 5.3).
    targets: { ground: true, air: false },
    attack: {
      kind: 'heal',
      amount: 40,
      intervalTicks: 30, // 1,5 s
      range: 3,
      followDistance: 2,
      fallbackDamage: 10,
    },
    rarity: 'rare',
    arena: 1,
  },
  musketeer: {
    id: 'musketeer',
    count: 1,
    role: 'ranged',
    zone: 'back',
    layer: GROUND,
    hp: 400,
    moveSpeed: 45, // 0,9 field/s
    targets: { ground: true, air: true },
    attack: {
      kind: 'ranged',
      damage: 140,
      intervalTicks: 50, // 2,5 s
      range: 8,
      projectileSpeed: 1000, // assumption: 20 fields/s
    },
    rarity: 'rare',
    arena: 1,
  },
  bat: {
    id: 'bat',
    count: 3,
    role: 'flyer',
    zone: 'mid',
    layer: AIR,
    hp: 70,
    moveSpeed: 80, // 1,6 field/s
    targets: { ground: true, air: true },
    attack: {
      kind: 'melee',
      damage: 22,
      intervalTicks: 16, // 0,8 s
    },
    rarity: 'common',
    arena: 1,
  },
  assassin: {
    id: 'assassin',
    count: 3,
    role: 'melee',
    zone: 'mid',
    layer: GROUND,
    hp: 200,
    moveSpeed: 70, // 1,4 field/s
    targets: { ground: true, air: false },
    attack: {
      kind: 'melee',
      damage: 40,
      intervalTicks: 18, // 0,9 s
    },
    rarity: 'rare',
    arena: 2,
    shadowJump: { chargeTicks: 50 }, // 2,5 s (D-049)
  },
  berserker: {
    id: 'berserker',
    count: 1,
    role: 'tank',
    zone: 'front',
    layer: GROUND,
    hp: 900,
    moveSpeed: 45, // 0,9 field/s
    targets: { ground: true, air: false },
    attack: {
      kind: 'melee',
      damage: 70,
      intervalTicks: 28, // 1,4 s at full HP
    },
    rarity: 'epic',
    arena: 2,
    // Interval 1,4 s - 0,8 s * missing HP share; 25 % lifesteal.
    rage: { intervalReductionTicks: 16, lifestealBps: 2500 }, // 0,8 s, 25 %
  },
  shroomling: {
    id: 'shroomling',
    count: 4,
    role: 'swarm',
    zone: 'front',
    layer: GROUND,
    hp: 90,
    moveSpeed: 50, // 1,0 field/s
    targets: { ground: true, air: false },
    attack: {
      kind: 'melee',
      damage: 18,
      intervalTicks: 20, // 1,0 s
    },
    rarity: 'common',
    arena: 2,
    // Spore cloud on death: r 1 field, 15 damage/s for 3 s.
    deathCloud: { radius: 1000, damagePerSecond: 15, durationTicks: 60 }, // r 1, 3 s
  },
  pyromancer: {
    id: 'pyromancer',
    count: 1,
    role: 'mage',
    zone: 'back',
    layer: GROUND,
    hp: 280,
    moveSpeed: 45, // 0,9 field/s
    targets: { ground: true, air: true },
    attack: {
      kind: 'ranged',
      damage: 70,
      intervalTicks: 36, // 1,8 s
      range: 4,
      projectileSpeed: 500, // assumption: 10 fields/s
      splashRadius: 1000, // r 1 field
    },
    rarity: 'rare',
    arena: 2,
  },
  necromancer: {
    id: 'necromancer',
    count: 1,
    role: 'summoner',
    zone: 'back',
    layer: GROUND,
    hp: 300,
    moveSpeed: 40, // 0,8 field/s
    targets: { ground: true, air: true },
    attack: {
      kind: 'ranged',
      damage: 25,
      intervalTicks: 24, // 1,2 s
      range: 3,
      projectileSpeed: 500, // assumption: 10 fields/s
    },
    rarity: 'epic',
    arena: 2,
    summon: { card: 'skeleton', intervalTicks: 80, max: 4 }, // every 4 s, at most 4 alive
  },
  beetle: {
    id: 'beetle',
    count: 1,
    role: 'artillery',
    zone: 'back',
    layer: GROUND,
    hp: 350,
    moveSpeed: 20, // 0,4 field/s
    targets: { ground: true, air: false },
    attack: {
      kind: 'artillery',
      damage: 160,
      radius: 1500, // r 1,5 fields
      intervalTicks: 100, // 5,0 s
      minRange: 2,
      flightTicks: 30, // 1,5 s
    },
    rarity: 'epic',
    arena: 3,
  },
  golem: {
    id: 'golem',
    count: 1,
    role: 'tank',
    zone: 'front',
    layer: GROUND,
    hp: 1600,
    moveSpeed: 25, // 0,5 field/s
    targets: { ground: true, air: false },
    attack: {
      kind: 'melee',
      damage: 90,
      intervalTicks: 40, // 2,0 s
    },
    rarity: 'epic',
    arena: 3,
  },
  frost_shaman: {
    id: 'frost_shaman',
    count: 1,
    role: 'support',
    zone: 'back',
    layer: GROUND,
    hp: 260,
    moveSpeed: 45, // 0,9 field/s
    targets: { ground: true, air: true },
    attack: {
      kind: 'ranged',
      damage: 35,
      intervalTicks: 30, // 1,5 s
      range: 5,
      projectileSpeed: 500, // assumption: 10 fields/s
      slow: { bps: 3000, durationTicks: 40 }, // 30 % slower for 2 s
    },
    rarity: 'rare',
    arena: 4,
  },
  whelp: {
    id: 'whelp',
    count: 1,
    role: 'flyer',
    zone: 'mid',
    layer: AIR,
    hp: 550,
    moveSpeed: 55, // 1,1 field/s
    targets: { ground: true, air: true },
    attack: {
      kind: 'ranged',
      damage: 55,
      intervalTicks: 32, // 1,6 s
      range: 2,
      projectileSpeed: 600, // assumption: 12 fields/s
      splashRadius: 1000, // r 1 field
    },
    rarity: 'epic',
    arena: 5,
  },
};
