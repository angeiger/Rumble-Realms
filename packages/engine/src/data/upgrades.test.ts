import { describe, expect, it } from 'vitest';
import { CARD_IDS } from './cards.ts';
import { UPGRADES } from './upgrades.ts';

/** The upgrades implemented so far (M3b-1 and M3b-2). */
const IMPLEMENTED = [
  'archer.eagle_eye',
  'tnt.short_fuse',
  'tnt.armored_crate',
  'skeleton.rattle_gang',
  'bat.swarm',
  'golem.stone_skin',
  'whelp.ember_scales',
  'archer.fire_arrows',
  'pyromancer.inferno',
  'assassin.poison',
  'bat.ultrasound',
  'frost_shaman.ice_block',
  'frost_shaman.ice_armor',
  'beetle.chitin_armor',
  'bat.bloodthirst',
  'musketeer.headshot',
  'berserker.blood_frenzy',
  'berserker.unstoppable',
  'pyromancer.heat_shield',
  'knight.shield',
  'berserker.whirlwind',
  'healer.heal_circle',
  'healer.blessing',
  'knight.charge',
  'musketeer.bayonet',
  'archer.volley',
  'musketeer.pierce',
  'skeleton.bone_hail',
  'tnt.daughter_tnt',
  'golem.rubble',
  'necromancer.soul_harvest',
  'necromancer.bone_army',
  'skeleton.undead',
  'healer.revive',
  'shroomling.mycelium',
  'pyromancer.meteor',
  'golem.earthquake',
  'frost_shaman.frost_nova',
  'whelp.growth',
  'beetle.acid_pool',
  'assassin.shadow_step',
  'assassin.smoke_bomb',
  'knight.taunt',
  'beetle.double_load',
  'shroomling.giant_mushroom',
  'shroomling.contagious',
  'necromancer.lich_form',
  'whelp.fire_breath',
];

describe('upgrade data (SPEC 5.4)', () => {
  it('has three upgrades for each of the 16 cards with unique ids', () => {
    expect(Object.keys(UPGRADES)).toEqual([...CARD_IDS]);
    const ids = CARD_IDS.flatMap((card) => UPGRADES[card].map((u) => u.id));
    expect(ids).toHaveLength(48);
    expect(new Set(ids).size).toBe(48);
    for (const card of CARD_IDS) {
      expect(UPGRADES[card]).toHaveLength(3);
      for (const u of UPGRADES[card]) expect(u.id).toMatch(new RegExp(`^${card}\\.[a-z_]+$`));
    }
  });

  it('has only positive integer parameters, at least one per upgrade', () => {
    for (const card of CARD_IDS) {
      for (const u of UPGRADES[card]) {
        const values = Object.values(u.params);
        expect(values.length, u.id).toBeGreaterThan(0);
        for (const v of values) {
          expect(Number.isInteger(v), u.id).toBe(true);
          expect(v, u.id).toBeGreaterThan(0);
        }
      }
    }
  });

  it('marks exactly the finished upgrades as implemented', () => {
    const implemented = CARD_IDS.flatMap((card) =>
      UPGRADES[card].filter((u) => u.implemented).map((u) => u.id),
    );
    expect(implemented.sort()).toEqual([...IMPLEMENTED].sort());
  });

  it('keeps the SPEC order (spot checks)', () => {
    expect(UPGRADES.archer.map((u) => u.id)).toEqual([
      'archer.fire_arrows',
      'archer.volley',
      'archer.eagle_eye',
    ]);
    expect(UPGRADES.golem[0].params).toEqual({ armorBps: 2000 });
    expect(UPGRADES.skeleton[2].params).toEqual({ extraUnits: 2 });
    expect(UPGRADES.whelp[1].params).toEqual({ hpBonusBps: 4000 });
  });
});
