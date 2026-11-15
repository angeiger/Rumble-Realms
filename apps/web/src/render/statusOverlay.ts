/**
 * Status overlays of one unit view (burn, poison, slow, ice, stun, shield, heat shield,
 * invulnerability, damage bonus). Plain sprites from shared textures, created once per
 * pooled view and only when the unit first has a status; hidden or shown per flag, so a
 * frame without statuses costs nothing.
 */
import { Container, Sprite } from 'pixi.js';
import { PALETTE } from './palette.ts';
import type { EffectTextures } from './textures.ts';
import {
  FX_BONUS,
  FX_BURN,
  FX_FROZEN,
  FX_HEAT,
  FX_INVULN,
  FX_POISON,
  FX_SHIELD,
  FX_SLOW,
  FX_STUN,
} from './unitLook.ts';

const FLAMES = 3;
const BUBBLES = 3;
const STARS = 3;

function make(tex: EffectTextures['dot'], anchorX = 0.5, anchorY = 0.5): Sprite {
  const s = new Sprite(tex);
  s.anchor.set(anchorX, anchorY);
  s.visible = false;
  return s;
}

export class StatusOverlay {
  /** Behind the figure (glow). */
  readonly under = new Container();
  /** In front of the figure. */
  readonly over = new Container();

  private flags = 0;
  private readonly glow: Sprite;
  private readonly shield: Sprite;
  private readonly heat: Sprite;
  private readonly flames: Sprite[] = [];
  private readonly bubbles: Sprite[] = [];
  private readonly ice: Sprite;
  private readonly snow: Sprite;
  private readonly stars: Sprite[] = [];
  private readonly arrow: Sprite;

  constructor(tex: EffectTextures) {
    this.glow = make(tex.dot);
    this.glow.blendMode = 'add';
    this.glow.tint = PALETTE.gold;
    this.under.addChild(this.glow);

    this.shield = make(tex.shield);
    this.shield.tint = 0x9fe0ff;
    this.heat = make(tex.ring);
    this.heat.blendMode = 'add';
    this.heat.tint = 0xff8a1c;
    this.over.addChild(this.shield, this.heat);
    for (let i = 0; i < FLAMES; i++) {
      const f = make(tex.flame, 0.5, 1);
      this.flames.push(f);
      this.over.addChild(f);
    }
    for (let i = 0; i < BUBBLES; i++) {
      const b = make(tex.bubble);
      b.tint = 0x7dff6a;
      this.bubbles.push(b);
      this.over.addChild(b);
    }
    this.ice = make(tex.ice, 0.5, 1);
    this.snow = make(tex.snow);
    this.snow.tint = 0xd8f4ff;
    this.over.addChild(this.ice, this.snow);
    for (let i = 0; i < STARS; i++) {
      const s = make(tex.spark);
      s.tint = PALETTE.gold;
      this.stars.push(s);
      this.over.addChild(s);
    }
    this.arrow = make(tex.arrowUp);
    this.over.addChild(this.arrow);
  }

  /** Hides everything (the view goes back to the pool). */
  reset(): void {
    if (this.flags === 0) return;
    this.show(0);
  }

  private show(flags: number): void {
    const changed = this.flags ^ flags;
    this.flags = flags;
    if (changed === 0) return;
    if (changed & FX_INVULN) this.glow.visible = (flags & FX_INVULN) !== 0;
    if (changed & FX_SHIELD) this.shield.visible = (flags & FX_SHIELD) !== 0;
    if (changed & FX_HEAT) this.heat.visible = (flags & FX_HEAT) !== 0;
    if (changed & FX_BURN) for (const f of this.flames) f.visible = (flags & FX_BURN) !== 0;
    if (changed & FX_POISON) for (const b of this.bubbles) b.visible = (flags & FX_POISON) !== 0;
    if (changed & FX_FROZEN) this.ice.visible = (flags & FX_FROZEN) !== 0;
    if (changed & FX_SLOW) this.snow.visible = (flags & FX_SLOW) !== 0;
    if (changed & FX_STUN) for (const s of this.stars) s.visible = (flags & FX_STUN) !== 0;
    if (changed & FX_BONUS) this.arrow.visible = (flags & FX_BONUS) !== 0;
  }

  /**
   * Shows `flags` and animates them. `h` is the height of the figure in pixels, `w` its
   * width, `lift` the hover height, `now` the animation time in ms.
   */
  update(
    flags: number,
    now: number,
    phase: number,
    cell: number,
    w: number,
    h: number,
    lift: number,
  ): void {
    this.show(flags);
    if (flags === 0) return;
    this.under.y = -lift;
    this.over.y = -lift;

    if (flags & FX_INVULN) {
      const g = this.glow;
      g.position.set(0, -h * 0.5);
      g.width = w * 1.9;
      g.height = h * 1.5;
      g.alpha = 0.6 + 0.2 * Math.sin(now * 0.008 + phase);
    }
    if (flags & FX_SHIELD) {
      const s = this.shield;
      s.position.set(0, -h * 0.5);
      s.width = w * 1.3;
      s.height = h * 1.18;
      s.alpha = 0.75 + 0.15 * Math.sin(now * 0.005 + phase);
    }
    if (flags & FX_HEAT) {
      const s = this.heat;
      s.position.set(0, -h * 0.5);
      s.width = w * 1.5;
      s.height = h * 1.3;
      s.alpha = 0.75 + 0.25 * Math.sin(now * 0.012 + phase);
    }
    if (flags & FX_BURN) {
      const base = (cell * 0.36) / 48;
      for (let i = 0; i < FLAMES; i++) {
        const f = this.flames[i] as Sprite;
        const flick = Math.sin(now * 0.021 + phase * 3 + i * 2.1);
        f.position.set((i - 1) * w * 0.3, -h * (0.28 + 0.22 * (i % 2)));
        f.scale.set(base * (1 - 0.12 * flick), base * (1 + 0.28 * flick));
      }
    }
    if (flags & FX_POISON) {
      for (let i = 0; i < BUBBLES; i++) {
        const b = this.bubbles[i] as Sprite;
        const frac = (now * 0.0007 + i / BUBBLES + phase * 0.13) % 1;
        b.position.set(
          Math.sin(i * 2.4 + phase) * w * 0.3 + Math.sin(now * 0.004 + i) * cell * 0.04,
          -h * (0.12 + 0.85 * frac),
        );
        b.scale.set((cell * (0.15 + 0.07 * (i % 2))) / 32);
        b.alpha = 0.9 * (1 - frac);
      }
    }
    if (flags & FX_FROZEN) {
      const s = this.ice;
      s.position.set(0, cell * 0.06);
      s.width = w * 1.25;
      s.height = h + cell * 0.2;
      s.alpha = 0.9;
    }
    if (flags & FX_SLOW) {
      const s = this.snow;
      s.position.set(w * 0.36, -h * 0.98);
      s.rotation = now * 0.0018 + phase;
      s.scale.set((cell * 0.4) / 64);
    }
    if (flags & FX_STUN) {
      for (let i = 0; i < STARS; i++) {
        const s = this.stars[i] as Sprite;
        const a = now * 0.0065 + (i * Math.PI * 2) / STARS;
        s.position.set(Math.cos(a) * w * 0.36, -h * 1.02 + Math.sin(a) * cell * 0.09);
        s.rotation = a * 2;
        s.scale.set((cell * 0.3) / 32);
      }
    }
    if (flags & FX_BONUS) {
      const s = this.arrow;
      const bob = Math.abs(Math.sin(now * 0.006 + phase)) * cell * 0.1;
      s.position.set(-w * 0.4, -h * 0.82 - bob);
      s.scale.set((cell * 0.38) / 40);
    }
  }
}
