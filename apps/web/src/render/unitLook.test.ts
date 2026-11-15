import { describe, expect, it } from 'vitest';
import {
  BREATH_HALF_ANGLE,
  FX_BONUS,
  FX_BURN,
  FX_FROZEN,
  FX_HEAT,
  FX_INVULN,
  FX_POISON,
  FX_SHIELD,
  FX_SLOW,
  FX_STUN,
  FX_UNTARGET,
  bodyAlpha,
  bodyTint,
  coneSample,
  figureFor,
  impactShake,
  isHeld,
  lobArcHeight,
  lobPoint,
  meteorPoint,
  overlayFlags,
  sizeFactor,
  summonStyle,
  zombieLying,
  zoneLook,
  type LookUnit,
} from './unitLook.ts';

function unit(over: Partial<LookUnit> = {}): LookUnit {
  return {
    card: 'archer',
    variant: 'normal',
    giant: false,
    ghost: false,
    stacks: 0,
    shield: 0,
    ignoreHits: 0,
    burnUntil: 0,
    poisonUntil: 0,
    slowUntil: 0,
    atkSlowUntil: 0,
    frozenUntil: 0,
    stunUntil: 0,
    invulnUntil: 0,
    untargetableUntil: 0,
    dmgBonusUntil: 0,
    ...over,
  };
}

describe('overlayFlags', () => {
  it('is empty for a plain unit', () => {
    expect(overlayFlags(unit(), 100)).toBe(0);
  });
  it('is active while tick < until and not at the end tick', () => {
    expect(overlayFlags(unit({ burnUntil: 100 }), 99)).toBe(FX_BURN);
    expect(overlayFlags(unit({ burnUntil: 100 }), 100)).toBe(0);
  });
  it('maps every state to its own flag', () => {
    const t = 10;
    expect(overlayFlags(unit({ poisonUntil: 20 }), t)).toBe(FX_POISON);
    expect(overlayFlags(unit({ slowUntil: 20 }), t)).toBe(FX_SLOW);
    expect(overlayFlags(unit({ atkSlowUntil: 20 }), t)).toBe(FX_SLOW);
    expect(overlayFlags(unit({ shield: 5 }), t)).toBe(FX_SHIELD);
    expect(overlayFlags(unit({ ignoreHits: 2 }), t)).toBe(FX_HEAT);
    expect(overlayFlags(unit({ invulnUntil: 20 }), t)).toBe(FX_INVULN);
    expect(overlayFlags(unit({ untargetableUntil: 20 }), t)).toBe(FX_UNTARGET);
    expect(overlayFlags(unit({ dmgBonusUntil: 20 }), t)).toBe(FX_BONUS);
  });
  it('shows ice for a frozen unit and stars only for a plain stun', () => {
    expect(overlayFlags(unit({ stunUntil: 20, frozenUntil: 20 }), 10)).toBe(FX_FROZEN);
    expect(overlayFlags(unit({ stunUntil: 20 }), 10)).toBe(FX_STUN);
    expect(overlayFlags(unit({ stunUntil: 20, frozenUntil: 5 }), 10)).toBe(FX_STUN);
  });
  it('combines several states', () => {
    const f = overlayFlags(unit({ burnUntil: 50, slowUntil: 50, shield: 30 }), 10);
    expect(f).toBe(FX_BURN | FX_SLOW | FX_SHIELD);
  });
  it('shows no stars, glow or fade for a lying zombie', () => {
    const lying = unit({
      variant: 'zombie',
      stunUntil: 40,
      invulnUntil: 40,
      untargetableUntil: 40,
    });
    expect(zombieLying(lying, 10)).toBe(true);
    expect(overlayFlags(lying, 10)).toBe(0);
    expect(zombieLying(lying, 40)).toBe(false);
  });
  it('keeps the glow of a non-zombie that is stunned and invulnerable', () => {
    const u = unit({ stunUntil: 40, invulnUntil: 40 });
    expect(zombieLying(u, 10)).toBe(false);
    expect(overlayFlags(u, 10)).toBe(FX_STUN | FX_INVULN);
  });
});

describe('isHeld', () => {
  it('holds frozen and stunned units only', () => {
    expect(isHeld(FX_FROZEN)).toBe(true);
    expect(isHeld(FX_STUN | FX_BURN)).toBe(true);
    expect(isHeld(FX_BURN | FX_SLOW)).toBe(false);
  });
});

describe('figureFor and sizeFactor', () => {
  it('picks the figure by variant and ghost flag', () => {
    expect(figureFor(unit({ card: 'skeleton' }))).toBe('skeleton');
    expect(figureFor(unit({ card: 'skeleton', variant: 'zombie' }))).toBe('zombie');
    expect(figureFor(unit({ card: 'golem', variant: 'mini' }))).toBe('mini_golem');
    expect(figureFor(unit({ card: 'tnt', variant: 'daughter' }))).toBe('tnt');
    expect(figureFor(unit({ card: 'healer', variant: 'revived' }))).toBe('healer');
    expect(figureFor(unit({ card: 'necromancer', ghost: true }))).toBe('ghost');
  });
  it('sizes giants, daughters, minis and growth', () => {
    expect(sizeFactor(unit())).toBe(1);
    expect(sizeFactor(unit({ giant: true }))).toBeCloseTo(1.6, 12);
    expect(sizeFactor(unit({ card: 'tnt', variant: 'daughter' }))).toBeCloseTo(0.7, 12);
    expect(sizeFactor(unit({ card: 'golem', variant: 'mini' }))).toBeLessThan(1);
    expect(sizeFactor(unit({ card: 'whelp', stacks: 3 }))).toBeCloseTo(1.3, 12);
    expect(sizeFactor(unit({ card: 'whelp', stacks: 1 }))).toBeCloseTo(1.1, 12);
  });
});

describe('bodyTint and bodyAlpha', () => {
  it('leaves a plain unit alone', () => {
    expect(bodyTint(0, false)).toBe(0xffffff);
    expect(bodyAlpha(0, false)).toBe(1);
  });
  it('multiplies tints of several states and darkens', () => {
    const both = bodyTint(FX_POISON | FX_SLOW, false);
    expect((both >> 16) & 255).toBeLessThan((bodyTint(FX_POISON, false) >> 16) & 255);
    expect(both).not.toBe(bodyTint(FX_POISON, false));
  });
  it('makes ghosts and untargetable units see-through, together even more', () => {
    expect(bodyAlpha(0, true)).toBeLessThan(1);
    expect(bodyAlpha(FX_UNTARGET, false)).toBeLessThan(1);
    expect(bodyAlpha(FX_UNTARGET, true)).toBeLessThan(bodyAlpha(FX_UNTARGET, false));
  });
});

describe('summonStyle', () => {
  it('chooses the effect by origin', () => {
    expect(summonStyle('skeleton', 'normal', false)).toBe('bones');
    expect(summonStyle('healer', 'revived', false)).toBe('light');
    expect(summonStyle('necromancer', 'normal', true)).toBe('ghost');
    expect(summonStyle('skeleton', 'zombie', false)).toBe('zombie');
    expect(summonStyle('tnt', 'daughter', false)).toBe('dust');
    expect(summonStyle('golem', 'mini', false)).toBe('dust');
  });
});

describe('zones and impacts', () => {
  it('tells spore clouds and acid puddles apart', () => {
    const s = zoneLook('spores');
    const a = zoneLook('acid');
    expect(s.fill).not.toBe(a.fill);
    expect(a.squash).toBeLessThan(s.squash);
    expect(a.bubbles).toBe(true);
    expect(s.bubbles).toBe(false);
  });
  it('shakes hardest for the meteor and not for splash or nova', () => {
    expect(impactShake('meteor')).toBeGreaterThan(impactShake('quake'));
    expect(impactShake('quake')).toBeGreaterThan(impactShake('shell'));
    expect(impactShake('splash')).toBe(0);
    expect(impactShake('nova')).toBe(0);
  });
});

describe('lob geometry', () => {
  const o = { x: 0, y: 0 };
  it('starts at the shooter and lands on the target', () => {
    expect(lobPoint(0, 10, 100, 110, 200, 40, o)).toEqual({ x: 10, y: 100 });
    expect(lobPoint(1, 10, 100, 110, 200, 40, o)).toEqual({ x: 110, y: 200 });
  });
  it('peaks in the middle by the arc height', () => {
    const p = lobPoint(0.5, 0, 100, 0, 100, 40, o);
    expect(p.y).toBeCloseTo(60, 12);
  });
  it('clamps t', () => {
    expect(lobPoint(2, 0, 0, 10, 10, 5, o)).toEqual({ x: 10, y: 10 });
  });
  it('limits the arc height', () => {
    expect(lobArcHeight(0, 50)).toBe(75);
    expect(lobArcHeight(100000, 50)).toBe(300);
    expect(lobArcHeight(400, 50)).toBeCloseTo(140, 12);
  });
});

describe('coneSample', () => {
  it('keeps every sample inside the 45 degree cone and the range', () => {
    const o = { angle: 0, dist: 0 };
    let minA = Infinity;
    let maxA = -Infinity;
    for (let i = 0; i < 200; i++) {
      coneSample(i, BREATH_HALF_ANGLE, 300, o);
      expect(Math.abs(o.angle)).toBeLessThanOrEqual(BREATH_HALF_ANGLE + 1e-12);
      expect(o.dist).toBeGreaterThan(0);
      expect(o.dist).toBeLessThanOrEqual(300);
      minA = Math.min(minA, o.angle);
      maxA = Math.max(maxA, o.angle);
    }
    // The whole opening is used, on both sides.
    expect(minA).toBeLessThan(-BREATH_HALF_ANGLE * 0.9);
    expect(maxA).toBeGreaterThan(BREATH_HALF_ANGLE * 0.9);
  });
});

describe('meteorPoint', () => {
  const o = { x: 0, y: 0 };
  it('falls from above onto the target', () => {
    const start = meteorPoint(0, 100, 200, 300, { x: 0, y: 0 });
    expect(start.y).toBe(-100);
    expect(start.x).toBeLessThan(100);
    expect(meteorPoint(1, 100, 200, 300, o)).toEqual({ x: 100, y: 200 });
  });
  it('accelerates', () => {
    const half = meteorPoint(0.5, 0, 0, 100, o).y;
    expect(half).toBeLessThan(-50); // less than half the way after half the time
  });
});
