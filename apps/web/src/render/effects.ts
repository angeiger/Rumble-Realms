/**
 * Effects: particles, projectiles, floating numbers, lingering zones and screen shake.
 * Everything comes from pools with fixed upper bounds; nothing is allocated per frame.
 */
import type { BattleState, CardId, ImpactKind, ZoneKind } from '@rumble-realms/engine';
import { BitmapText, Container, Sprite, type Texture } from 'pixi.js';
import { INTRO_MS } from '../game/config.ts';
import type { FieldLayout } from './layout.ts';
import { PALETTE } from './palette.ts';
import { clamp } from './motion.ts';
import { ARROW_SIZE, BULLET_SIZE, type EffectTextures } from './textures.ts';
import {
  BREATH_HALF_ANGLE,
  METEOR_FALL_MS,
  coneSample,
  impactShake,
  lobArcHeight,
  lobPoint,
  meteorPoint,
  zoneLook,
  type SummonStyle,
} from './unitLook.ts';
import type { NumberKind, NumberSink, UnitViews } from './unitViews.ts';

const MAX_PARTICLES = 450;
/** Numbers younger than this count as "at the same time" when fanning out. */
const FAN_WINDOW_MS = 250;
const MAX_PROJECTILES = 96;
const MAX_METEORS = 6;
const MAX_NUMBERS = 48;
const MAX_ZONES = 24;
const NUMBER_MS = 800;
const SHAKE_DECAY_MS = 130;

export const NUMBER_FONT = 'Lilita One';

export interface EffectLayers {
  /** Below rings and units: zones. */
  zones: Container;
  /** Above the units: particles and projectiles. */
  fx: Container;
  /** Topmost: floating numbers. */
  numbers: Container;
}

class Particle {
  readonly sprite = new Sprite();
  active = false;
  life = 0;
  maxLife = 1;
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  /** Added to vy per second (px/s^2). */
  gravity = 0;
  /** Drag factor per second (1 = none). */
  drag = 1;
  w0 = 1;
  w1 = 1;
  h0 = 1;
  h1 = 1;
  a0 = 1;
  a1 = 0;
  rot = 0;
  spin = 0;
}

class ProjectileView {
  readonly sprite = new Sprite();
  active = false;
  id = 0;
  targetId = 0;
  launchTick = 0;
  impactTick = 1;
  x0 = 0;
  y0 = 0;
  /** Last known end point, in case the target view is gone. */
  x1 = 0;
  y1 = 0;
  trailMs = 0;
  trail = false;
  /** Lobbed shell: flies a parabola to a fixed ground point and shows a target mark there. */
  lob = false;
  arc = 0;
  /** Radius of the blast in pixels, for the target mark. */
  markRadius = 0;
  /** Target mark on the ground: dark disc and a closing ring (lobbed shells only). */
  readonly shade = new Sprite();
  readonly mark = new Sprite();
}

class MeteorView {
  readonly sprite = new Sprite();
  readonly core = new Sprite();
  readonly shadow = new Sprite();
  active = false;
  life = 0;
  x = 0;
  y = 0;
  radius = 0;
  trailMs = 0;
}

class NumberView {
  active = false;
  life = 0;
  x = 0;
  y = 0;
  readonly text: BitmapText;
  constructor(text: BitmapText) {
    this.text = text;
  }
}

class ZoneView {
  readonly sprite = new Sprite();
  readonly rim = new Sprite();
  active = false;
  id = 0;
  endTick = 0;
  x = 0;
  y = 0;
  radius = 0;
  phase = 0;
  age = 0;
  sporeMs = 0;
  kind: ZoneKind = 'spores';
}

const NUMBER_COLORS: Record<NumberKind, number> = {
  hitEnemy: 0xffe36a,
  hitOwn: 0xff7a6a,
  heal: 0x66f59a,
};

export class Effects implements NumberSink {
  private readonly particles: Particle[] = [];
  private activeParticles = 0;
  private readonly projectiles: ProjectileView[] = [];
  private readonly numbers: NumberView[] = [];
  private readonly zones: ZoneView[] = [];
  private readonly meteors: MeteorView[] = [];
  private readonly scratch = { x: 0, y: 0 };
  private readonly cone = { angle: 0, dist: 0 };
  private cell = 1;
  private layout: FieldLayout | null = null;
  private shakeAmp = 0;
  /** Screen shake offset of the current frame. */
  shakeX = 0;
  shakeY = 0;

  private readonly layers: EffectLayers;
  private readonly tex: EffectTextures;

  constructor(layers: EffectLayers, tex: EffectTextures) {
    this.layers = layers;
    this.tex = tex;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = new Particle();
      p.sprite.anchor.set(0.5);
      p.sprite.visible = false;
      this.particles.push(p);
      layers.fx.addChild(p.sprite);
    }
    for (let i = 0; i < MAX_PROJECTILES; i++) {
      const p = new ProjectileView();
      p.sprite.anchor.set(0.5);
      p.sprite.visible = false;
      p.shade.texture = tex.dot;
      p.shade.anchor.set(0.5);
      p.shade.tint = 0x000000;
      p.shade.visible = false;
      p.mark.texture = tex.ring;
      p.mark.anchor.set(0.5);
      p.mark.tint = 0xff5a3a;
      p.mark.visible = false;
      this.projectiles.push(p);
      layers.zones.addChild(p.shade, p.mark);
      layers.fx.addChild(p.sprite);
    }
    for (let i = 0; i < MAX_METEORS; i++) {
      const m = new MeteorView();
      m.shadow.texture = tex.dot;
      m.shadow.tint = 0x000000;
      m.sprite.texture = tex.dot;
      m.sprite.tint = 0xff7a1c;
      m.core.texture = tex.bullet;
      m.core.tint = 0xc87a3a;
      for (const sp of [m.shadow, m.sprite, m.core]) {
        sp.anchor.set(0.5);
        sp.visible = false;
      }
      this.meteors.push(m);
      layers.zones.addChild(m.shadow);
      layers.fx.addChild(m.sprite, m.core);
    }
    for (let i = 0; i < MAX_ZONES; i++) {
      const z = new ZoneView();
      z.sprite.texture = tex.dot;
      z.sprite.anchor.set(0.5);
      z.rim.texture = tex.ring;
      z.rim.anchor.set(0.5);
      z.sprite.visible = false;
      z.rim.visible = false;
      this.zones.push(z);
      layers.zones.addChild(z.sprite, z.rim);
    }
    for (let i = 0; i < MAX_NUMBERS; i++) {
      const text = new BitmapText({
        text: '0',
        style: {
          fontFamily: NUMBER_FONT,
          fontSize: 36,
          fill: 0xffffff,
          stroke: { color: PALETTE.outline, width: 7, join: 'round' },
        },
      });
      text.anchor.set(0.5);
      text.visible = false;
      this.numbers.push(new NumberView(text));
      layers.numbers.addChild(text);
    }
  }

  setLayout(layout: FieldLayout): void {
    this.cell = layout.cell;
    this.layout = layout;
  }

  /** Drops everything that is on screen (new round, new session). */
  clear(): void {
    for (const p of this.particles) {
      p.active = false;
      p.sprite.visible = false;
    }
    this.activeParticles = 0;
    for (const p of this.projectiles) {
      p.active = false;
      p.sprite.visible = false;
      p.shade.visible = false;
      p.mark.visible = false;
    }
    for (const m of this.meteors) {
      m.active = false;
      m.sprite.visible = false;
      m.core.visible = false;
      m.shadow.visible = false;
    }
    for (const n of this.numbers) {
      n.active = false;
      n.text.visible = false;
    }
    for (const z of this.zones) {
      z.active = false;
      z.sprite.visible = false;
      z.rim.visible = false;
    }
    this.shakeAmp = 0;
    this.shakeX = 0;
    this.shakeY = 0;
  }

  destroy(): void {
    this.clear();
    // Sprites and texts are children of the layers and are destroyed with them.
  }

  // ---- spawning -----------------------------------------------------------------------

  private alloc(tex: Texture, tint: number, add: boolean): Particle | null {
    if (this.activeParticles >= MAX_PARTICLES) return null;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.particles[i] as Particle;
      if (p.active) continue;
      p.active = true;
      this.activeParticles++;
      p.life = 0;
      p.vx = 0;
      p.vy = 0;
      p.gravity = 0;
      p.drag = 1;
      p.a0 = 1;
      p.a1 = 0;
      p.rot = 0;
      p.spin = 0;
      p.sprite.texture = tex;
      p.sprite.tint = tint;
      p.sprite.blendMode = add ? 'add' : 'normal';
      p.sprite.visible = true;
      return p;
    }
    return null;
  }

  /** A soft round puff growing from `s0` to `s1` pixels. */
  private puff(
    x: number,
    y: number,
    vx: number,
    vy: number,
    life: number,
    s0: number,
    s1: number,
    a0: number,
    tint: number,
    add = false,
    tex: Texture = this.tex.dot,
  ): void {
    const p = this.alloc(tex, tint, add);
    if (p === null) return;
    p.x = x;
    p.y = y;
    p.vx = vx;
    p.vy = vy;
    p.maxLife = life;
    p.w0 = p.h0 = s0;
    p.w1 = p.h1 = s1;
    p.a0 = a0;
    p.a1 = 0;
    p.drag = 0.15;
  }

  private spark(
    x: number,
    y: number,
    vx: number,
    vy: number,
    life: number,
    size: number,
    tint: number,
  ): void {
    const p = this.alloc(this.tex.spark, tint, false);
    if (p === null) return;
    p.x = x;
    p.y = y;
    p.vx = vx;
    p.vy = vy;
    p.maxLife = life;
    p.w0 = p.h0 = size;
    p.w1 = p.h1 = size * 0.2;
    p.spin = (vx > 0 ? 1 : -1) * 6;
    p.drag = 0.3;
  }

  /** Small dust cloud where a unit died. */
  dust(x: number, y: number): void {
    const c = this.cell;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + x;
      this.puff(
        x + Math.cos(a) * c * 0.15,
        y - c * 0.1,
        Math.cos(a) * c * 0.9,
        Math.sin(a) * c * 0.35 - c * 0.3,
        480,
        c * 0.3,
        c * 0.75,
        0.7,
        0xdccfa6,
      );
    }
  }

  /**
   * Transition before the battle (D-045, about 0.9 s): dust rolls in from both sides over the
   * middle line of the field. With `reduced` motion the clouds do not move, they only fade.
   */
  introSmoke(reduced: boolean): void {
    const l = this.layout;
    if (l === null) return;
    const c = this.cell;
    const midY = l.top + l.height / 2;
    const cols = 11;
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < cols; i++) {
        const u = (i + (row % 2) * 0.5) / (cols - 1);
        const x = l.left + u * l.width;
        const y = midY + (row - 1) * c * 0.9 + Math.sin(i * 2.1 + row) * c * 0.25;
        // Left half drifts to the right, right half to the left: they meet in the middle.
        const dir = u < 0.5 ? 1 : -1;
        const speed = reduced ? 0 : dir * c * (2.2 + 1.2 * Math.abs(Math.sin(i * 1.7 + row)));
        this.puff(
          x,
          y,
          speed,
          reduced ? 0 : -c * 0.25,
          INTRO_MS * (0.9 + 0.1 * ((i + row) % 3)),
          c * 2.6,
          c * 5,
          reduced ? 0.55 : 0.85,
          (i + row) % 2 === 0 ? 0xd8d0b8 : 0xb7b09c,
        );
      }
    }
  }

  /** Smoke cloud of the assassin's jump. */
  jumpSmoke(fromX: number, fromY: number, toX: number, toY: number): void {
    const c = this.cell;
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      this.puff(
        fromX,
        fromY - c * 0.2,
        Math.cos(a) * c * 1.4,
        Math.sin(a) * c * 0.6 - c * 0.4,
        650,
        c * 0.4,
        c * 1.1,
        0.75,
        i % 2 === 0 ? 0x4a3d66 : 0x7a6a9a,
      );
    }
    // Arrival: a short purple ring and a flash.
    const ring = this.alloc(this.tex.ring, 0xb48cff, true);
    if (ring !== null) {
      ring.x = toX;
      ring.y = toY - c * 0.2;
      ring.maxLife = 380;
      ring.w0 = ring.h0 = c * 0.5;
      ring.w1 = ring.h1 = c * 2.2;
      ring.a0 = 0.9;
    }
    this.puff(toX, toY - c * 0.3, 0, 0, 260, c * 0.8, c * 1.6, 0.8, 0xd6bfff, true);
  }

  /** Flash, expanding ring, sparks, smoke and screen shake. `radiusPx` is the blast radius. */
  explosion(x: number, y: number, radiusPx: number): void {
    const c = this.cell;
    const r = Math.max(radiusPx, c * 0.9);
    this.puff(x, y - c * 0.2, 0, 0, 240, r * 0.8, r * 2.6, 1, 0xfff0a0, true);
    this.puff(x, y - c * 0.2, 0, 0, 380, r * 0.6, r * 2.1, 0.9, 0xff8a1c, true);
    const ring = this.alloc(this.tex.ring, 0xff9d1c, false);
    if (ring !== null) {
      ring.x = x;
      ring.y = y;
      ring.maxLife = 420;
      ring.w0 = ring.h0 = r * 0.5;
      ring.w1 = ring.h1 = r * 2.3;
      ring.h1 = r * 2.3;
      ring.a0 = 1;
    }
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + ((x * 7 + y) % 1);
      const speed = r * (1.6 + (i % 3) * 0.7);
      this.spark(
        x,
        y - c * 0.2,
        Math.cos(a) * speed,
        Math.sin(a) * speed * 0.8,
        420 + (i % 4) * 110,
        c * 0.55,
        i % 2 === 0 ? PALETTE.fire : PALETTE.fireLight,
      );
    }
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.4;
      this.puff(
        x + Math.cos(a) * r * 0.3,
        y + Math.sin(a) * r * 0.2 - c * 0.2,
        Math.cos(a) * r * 0.7,
        Math.sin(a) * r * 0.5 - c * 0.5,
        850,
        c * 0.5,
        c * 1.5,
        0.65,
        0x4a4e5c,
      );
    }
    this.shakeAmp = Math.min(this.shakeAmp + Math.min(c * 0.4, r * 0.28), c * 0.6);
  }

  /** Healing beam from the healer to its target with a few rising sparks. */
  healBeam(x0: number, y0: number, x1: number, y1: number): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    const beam = this.alloc(this.tex.beam, 0x7dffb0, true);
    if (beam !== null) {
      beam.x = (x0 + x1) / 2;
      beam.y = (y0 + y1) / 2;
      beam.rot = Math.atan2(dy, dx);
      beam.maxLife = 320;
      beam.w0 = beam.w1 = Math.max(len, 4);
      beam.h0 = this.cell * 0.34;
      beam.h1 = this.cell * 0.1;
      beam.a0 = 0.95;
    }
    for (let i = 0; i < 6; i++) {
      this.spark(
        x1 + (i - 2.5) * this.cell * 0.12,
        y1 - this.cell * 0.2,
        (i - 2.5) * this.cell * 0.2,
        -this.cell * (1.1 + (i % 3) * 0.4),
        520 + i * 40,
        this.cell * 0.4,
        0x8dffb4,
      );
    }
  }

  /** Starts a projectile of `card`'s kind at the shooter's position. */
  shot(
    id: number,
    card: CardId,
    sx: number,
    sy: number,
    targetId: number,
    launchTick: number,
    impactTick: number,
    tx: number,
    ty: number,
  ): void {
    for (const p of this.projectiles) {
      if (p.active) continue;
      p.active = true;
      p.id = id;
      p.targetId = targetId;
      p.launchTick = launchTick;
      p.impactTick = Math.max(impactTick, launchTick + 1);
      p.x0 = sx;
      p.y0 = sy - this.cell * 0.55;
      p.x1 = tx;
      p.y1 = ty - this.cell * 0.45;
      p.trailMs = 0;
      p.lob = false;
      p.sprite.tint = 0xffffff;
      p.shade.visible = false;
      p.mark.visible = false;
      const arrow = card === 'archer';
      p.trail = !arrow;
      p.sprite.texture = arrow ? this.tex.arrow : this.tex.bullet;
      const size = arrow ? ARROW_SIZE.w : BULLET_SIZE;
      const scale = (this.cell * (arrow ? 0.95 : 0.4)) / size;
      p.sprite.scale.set(scale);
      p.sprite.visible = true;
      return;
    }
  }

  /** Lingering area: a spore cloud or an acid puddle. */
  zone(id: number, kind: ZoneKind, x: number, y: number, radiusPx: number, endTick: number): void {
    for (const z of this.zones) {
      if (z.active && z.id === id) return;
    }
    const look = zoneLook(kind);
    for (const z of this.zones) {
      if (z.active) continue;
      z.active = true;
      z.id = id;
      z.kind = kind;
      z.x = x;
      z.y = y;
      z.radius = radiusPx;
      z.endTick = endTick;
      z.phase = (id * 1.7) % (Math.PI * 2);
      z.age = 0;
      z.sporeMs = 0;
      z.sprite.texture = look.bubbles ? this.tex.puddle : this.tex.dot;
      z.sprite.tint = look.fill;
      z.rim.tint = look.rim;
      z.sprite.position.set(x, y);
      z.rim.position.set(x, y);
      z.sprite.visible = true;
      z.rim.visible = true;
      return;
    }
  }

  /**
   * Lobbed shell (beetle): a slow shell on a parabola from (`x0`, `y0`) to the ground point
   * (`x1`, `y1`) with a target mark there until it lands. `radiusPx` is the blast radius.
   */
  lob(
    id: number,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    launchTick: number,
    impactTick: number,
    radiusPx: number,
  ): void {
    for (const p of this.projectiles) {
      if (p.active) continue;
      p.active = true;
      p.id = id;
      p.targetId = 0;
      p.launchTick = launchTick;
      p.impactTick = Math.max(impactTick, launchTick + 1);
      p.x0 = x0;
      p.y0 = y0;
      p.x1 = x1;
      p.y1 = y1;
      p.trailMs = 0;
      p.trail = true;
      p.lob = true;
      p.arc = lobArcHeight(Math.hypot(x1 - x0, y1 - y0), this.cell);
      p.markRadius = Math.max(radiusPx, this.cell * 0.9);
      p.sprite.texture = this.tex.shell;
      p.sprite.scale.set((this.cell * 0.55) / BULLET_SIZE);
      p.sprite.visible = true;
      p.shade.position.set(x1, y1);
      p.mark.position.set(x1, y1);
      p.shade.visible = true;
      p.mark.visible = true;
      return;
    }
  }

  /** Area hit of `kind` around (`x`, `y`) with a radius of `radiusPx`. */
  impact(kind: ImpactKind, x: number, y: number, radiusPx: number): void {
    const c = this.cell;
    const r = Math.max(radiusPx, c * 0.6);
    switch (kind) {
      case 'shell':
        this.acidBurst(x, y, r);
        break;
      case 'splash':
        this.fireball(x, y, r);
        break;
      case 'quake':
        this.quake(x, y, r);
        break;
      case 'nova':
        this.nova(x, y, r);
        break;
      case 'meteor':
        this.meteor(x, y, r);
        return; // shake comes with the landing
    }
    this.shake(c * impactShake(kind), c * 0.6);
  }

  /** Acid and steam burst of a beetle shell. */
  private acidBurst(x: number, y: number, r: number): void {
    const c = this.cell;
    this.puff(x, y - c * 0.15, 0, 0, 260, r * 0.6, r * 2.2, 0.85, 0xe4ff7a, true);
    this.ring(x, y, r * 0.4, r * 2.1, 420, 0xb6f05a, false, 1);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + (x % 1);
      this.puff(
        x + Math.cos(a) * r * 0.3,
        y + Math.sin(a) * r * 0.2 - c * 0.2,
        Math.cos(a) * r * 1.1,
        Math.sin(a) * r * 0.7 - c * 0.9,
        700,
        c * 0.35,
        c * 1.1,
        0.6,
        i % 2 === 0 ? 0xcff58a : 0xf4ffd0,
      );
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.3;
      this.spark(
        x,
        y - c * 0.2,
        Math.cos(a) * r * 2,
        Math.sin(a) * r * 1.5,
        420 + (i % 3) * 90,
        c * 0.4,
        i % 2 === 0 ? 0xb6f05a : 0xf2ff9a,
      );
    }
  }

  /** Small fireball of the pyromancer and the whelp. */
  private fireball(x: number, y: number, r: number): void {
    const c = this.cell;
    // Normal blending for the body: additive light vanishes on the bright meadow.
    this.puff(x, y - c * 0.2, 0, 0, 340, r * 0.8, r * 2.4, 0.95, 0xff6a1c);
    this.puff(x, y - c * 0.2, 0, 0, 260, r * 0.6, r * 1.7, 1, 0xffd23a);
    this.puff(x, y - c * 0.2, 0, 0, 160, r * 0.4, r * 1.1, 1, 0xfff6c0, true);
    this.ring(x, y, r * 0.4, r * 1.9, 340, 0xff7a1c, false, 1);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + (y % 1);
      this.spark(
        x,
        y - c * 0.2,
        Math.cos(a) * r * 1.7,
        Math.sin(a) * r * 1.3,
        320 + (i % 3) * 80,
        c * 0.4,
        i % 2 === 0 ? PALETTE.fire : PALETTE.fireLight,
      );
    }
  }

  /** Earthquake of the golem: ground shock waves, dust and stones. */
  private quake(x: number, y: number, r: number): void {
    const c = this.cell;
    // Normal blending throughout: dark rings and dust read well on the bright meadow.
    this.puff(x, y, 0, 0, 380, r * 0.9, r * 2.4, 0.45, 0x6d5230);
    this.ring(x, y, r * 0.3, r * 2.3, 560, 0x5c4326, false, 1);
    this.ring(x, y, r * 0.2, r * 1.6, 420, 0xd9bd8a, false, 1);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + 0.2;
      this.puff(
        x + Math.cos(a) * r * 0.5,
        y + Math.sin(a) * r * 0.35,
        Math.cos(a) * r * 1.5,
        Math.sin(a) * r * 1.0 - c * 0.2,
        640,
        c * 0.45,
        c * 1.2,
        0.85,
        i % 2 === 0 ? 0xb39a6a : 0x8a7650,
      );
    }
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.5;
      this.spark(
        x,
        y - c * 0.1,
        Math.cos(a) * r * 1.2,
        Math.sin(a) * r * 0.9 - c * 1.6,
        480,
        c * 0.34,
        PALETTE.stoneLight,
      );
    }
  }

  /** Frost nova: an icy ring spreading out, snow and shards. */
  private nova(x: number, y: number, r: number): void {
    const c = this.cell;
    this.puff(x, y - c * 0.1, 0, 0, 460, r * 0.5, r * 2.1, 0.5, 0x7fd8ff);
    this.ring(x, y, r * 0.3, r * 2.2, 560, 0x2fb4ff, false, 1);
    this.ring(x, y, r * 0.2, r * 1.7, 440, 0xffffff, false, 1);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + 0.1;
      this.spark(
        x,
        y - c * 0.2,
        Math.cos(a) * r * 2.2,
        Math.sin(a) * r * 1.6,
        480 + (i % 3) * 80,
        c * 0.45,
        i % 2 === 0 ? PALETTE.ice : PALETTE.iceLight,
      );
    }
  }

  /** Meteor: falls from above onto the target (display only), then a big explosion. */
  private meteor(x: number, y: number, r: number): void {
    for (const m of this.meteors) {
      if (m.active) continue;
      m.active = true;
      m.life = 0;
      m.x = x;
      m.y = y;
      m.radius = r;
      m.trailMs = 0;
      m.shadow.visible = true;
      m.sprite.visible = true;
      m.core.visible = true;
      return;
    }
    // No free slot: show the landing at once.
    this.explosion(x, y, r * 1.3);
    this.shake(this.cell * impactShake('meteor'), this.cell * 0.9);
  }

  /** A ring that grows from `r0` to `r1` pixels and fades out. */
  private ring(
    x: number,
    y: number,
    r0: number,
    r1: number,
    life: number,
    tint: number,
    add: boolean,
    a0: number,
  ): void {
    const ring = this.alloc(this.tex.ring, tint, add);
    if (ring === null) return;
    ring.x = x;
    ring.y = y;
    ring.maxLife = life;
    ring.w0 = ring.h0 = r0 * 2;
    ring.w1 = ring.h1 = r1 * 2;
    ring.a0 = a0;
  }

  /**
   * Fire breath: a translucent flame cone from (`ox`, `oy`) towards (`tx`, `ty`) that reaches
   * `rangePx` pixels, with flames flying along it. Half opening angle 45 degrees.
   */
  breath(ox: number, oy: number, tx: number, ty: number, rangePx: number): void {
    const c = this.cell;
    const dir = Math.atan2(ty - oy, tx - ox);
    const range = Math.max(rangePx, c);
    const cone = this.alloc(this.tex.cone, 0xff8a1c, false);
    if (cone !== null) {
      // The wedge texture is 128 x 256 with its apex at the left-centre: its middle lies
      // half the range away from the apex along the axis.
      cone.x = ox + Math.cos(dir) * range * 0.5;
      cone.y = oy + Math.sin(dir) * range * 0.5;
      cone.rot = dir;
      cone.maxLife = 420;
      cone.w0 = cone.w1 = range;
      cone.h0 = cone.h1 = range * 2;
      cone.a0 = 0.6;
    }
    const o = this.cone;
    for (let i = 0; i < 22; i++) {
      coneSample(i, BREATH_HALF_ANGLE, range, o);
      const a = dir + o.angle;
      const life = 300 + (i % 4) * 60;
      // Fly the distance in the particle's life (drag 0.15 per second slows it down a bit).
      const speed = (o.dist / life) * 1000 * 1.5;
      this.puff(
        ox + Math.cos(a) * c * 0.2,
        oy + Math.sin(a) * c * 0.2,
        Math.cos(a) * speed,
        Math.sin(a) * speed,
        life,
        c * 0.3,
        c * (0.7 + 0.4 * (i % 3)),
        0.9,
        i % 3 === 0 ? 0xfff0a0 : i % 3 === 1 ? 0xff9d1c : 0xff5a1c,
        i % 3 === 0,
      );
    }
    this.puff(ox, oy, 0, 0, 200, c * 0.6, c * 1.4, 0.9, 0xfff0a0, true);
  }

  /** Appear effect of a unit that showed up in mid-battle at (`x`, `y`). */
  summon(style: SummonStyle, x: number, y: number): void {
    const c = this.cell;
    switch (style) {
      case 'bones':
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          this.puff(
            x,
            y - c * 0.15,
            Math.cos(a) * c * 0.9,
            Math.sin(a) * c * 0.4 - c * 0.3,
            480,
            c * 0.3,
            c * 0.8,
            0.7,
            i % 2 === 0 ? 0x5a4a7a : 0x8a7aa8,
          );
        }
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2 + 0.4;
          this.spark(
            x,
            y - c * 0.2,
            Math.cos(a) * c * 1.2,
            Math.sin(a) * c * 0.6 - c * 1.4,
            420,
            c * 0.3,
            PALETTE.bone,
          );
        }
        this.ring(x, y, c * 0.2, c * 0.9, 360, PALETTE.necro, true, 0.8);
        break;
      case 'light': {
        const col = this.alloc(this.tex.beam, 0xfff2b0, true);
        if (col !== null) {
          col.rot = -Math.PI / 2;
          col.x = x;
          col.y = y - c * 1.1;
          col.maxLife = 520;
          col.w0 = col.w1 = c * 2.4;
          col.h0 = c * 1.0;
          col.h1 = c * 0.3;
          col.a0 = 0.95;
        }
        this.ring(x, y, c * 0.2, c * 1.0, 460, 0xffe27a, true, 0.9);
        for (let i = 0; i < 6; i++) {
          this.spark(
            x + (i - 2.5) * c * 0.14,
            y - c * 0.2,
            (i - 2.5) * c * 0.12,
            -c * (1.2 + (i % 3) * 0.5),
            560 + i * 40,
            c * 0.34,
            0xfff2b0,
          );
        }
        break;
      }
      case 'ghost':
        this.puff(x, y - c * 0.5, 0, 0, 520, c * 0.5, c * 1.7, 0.7, PALETTE.ghost, true);
        this.ring(x, y - c * 0.3, c * 0.3, c * 1.1, 520, 0x9fe8ff, true, 0.8);
        for (let i = 0; i < 6; i++) {
          this.puff(
            x + (i - 2.5) * c * 0.2,
            y - c * 0.2,
            0,
            -c * (0.6 + 0.2 * (i % 3)),
            700,
            c * 0.25,
            c * 0.5,
            0.7,
            i % 2 === 0 ? 0xbfe8ff : PALETTE.necro,
            true,
          );
        }
        break;
      case 'zombie':
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2;
          this.puff(
            x + Math.cos(a) * c * 0.3,
            y + c * 0.05,
            Math.cos(a) * c * 0.6,
            -c * 0.5,
            600,
            c * 0.25,
            c * 0.8,
            0.7,
            i % 2 === 0 ? PALETTE.zombie : 0x6b5a3a,
          );
        }
        break;
      case 'dust':
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2 + 0.5;
          this.puff(
            x,
            y - c * 0.1,
            Math.cos(a) * c * 0.8,
            Math.sin(a) * c * 0.3 - c * 0.2,
            380,
            c * 0.22,
            c * 0.6,
            0.6,
            0xdccfa6,
          );
        }
        break;
    }
  }

  /** Adds screen shake (pixels), never above `cap`. */
  shake(amount: number, cap: number): void {
    if (amount <= 0) return;
    this.shakeAmp = Math.min(this.shakeAmp + amount, Math.max(cap, this.shakeAmp));
  }

  /** A spark flying off the fuse of a burning TNT; livelier and brighter the closer the blast. */
  fuseSpark(x: number, y: number, intensity: number): void {
    const c = this.cell;
    const a = Math.random() * Math.PI * 2;
    const speed = c * (1.2 + 2.2 * Math.random()) * (0.7 + 0.6 * intensity);
    this.spark(
      x,
      y,
      Math.cos(a) * speed,
      Math.sin(a) * speed - c * 1.2,
      180 + 160 * Math.random(),
      c * (0.34 + 0.26 * intensity),
      Math.random() < 0.5 ? 0xffd23a : 0xff7a2b,
    );
  }

  /**
   * Many hits in the same instant (TNT blast) land on neighbouring units whose numbers
   * would pile up: a fresh number near other fresh ones is fanned out sideways and upwards.
   */
  private fanOut(x: number, y: number): { dx: number; dy: number } {
    const c = this.cell;
    let near = 0;
    for (const n of this.numbers) {
      if (!n.active || n.life > FAN_WINDOW_MS) continue;
      if (Math.abs(n.x - x) < c * 0.4 && Math.abs(n.y - y) < c * 0.3) near++;
    }
    if (near === 0) return { dx: 0, dy: 0 };
    const side = near % 2 === 1 ? 1 : -1;
    return { dx: side * Math.ceil(near / 2) * c * 0.17, dy: -(near % 3) * c * 0.11 };
  }

  number(x: number, y: number, amount: number, kind: NumberKind): void {
    for (const n of this.numbers) {
      if (n.active) continue;
      const fan = this.fanOut(x, y);
      n.active = true;
      n.life = 0;
      n.x = x + (((amount * 13) % 7) - 3) * this.cell * 0.04 + fan.dx;
      n.y = y + fan.dy;
      n.text.text = kind === 'heal' ? `+${amount}` : String(amount);
      n.text.tint = NUMBER_COLORS[kind];
      n.text.visible = true;
      return;
    }
  }

  // ---- per frame ----------------------------------------------------------------------

  update(battle: BattleState, views: UnitViews, alpha: number, dt: number, now: number): void {
    this.updateParticles(dt);
    this.updateProjectiles(battle, views, alpha, dt);
    this.updateMeteors(dt);
    this.updateZones(battle, alpha, dt);
    this.updateNumbers(dt);
    this.shakeAmp *= Math.exp(-dt / SHAKE_DECAY_MS);
    if (this.shakeAmp < 0.05) {
      this.shakeAmp = 0;
      this.shakeX = 0;
      this.shakeY = 0;
    } else {
      this.shakeX = Math.sin(now * 0.091) * this.shakeAmp;
      this.shakeY = Math.cos(now * 0.117) * this.shakeAmp;
    }
  }

  private updateParticles(dt: number): void {
    if (this.activeParticles === 0) return;
    const sec = dt / 1000;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.particles[i] as Particle;
      if (!p.active) continue;
      p.life += dt;
      if (p.life >= p.maxLife) {
        p.active = false;
        p.sprite.visible = false;
        this.activeParticles--;
        continue;
      }
      const t = p.life / p.maxLife;
      const damp = Math.pow(p.drag, sec);
      p.vx *= damp;
      p.vy = p.vy * damp + p.gravity * sec;
      p.x += p.vx * sec;
      p.y += p.vy * sec;
      p.rot += p.spin * sec;
      const s = p.sprite;
      s.position.set(p.x, p.y);
      s.width = p.w0 + (p.w1 - p.w0) * t;
      s.height = p.h0 + (p.h1 - p.h0) * t;
      s.rotation = p.rot;
      s.alpha = p.a0 + (p.a1 - p.a0) * t;
    }
  }

  private updateProjectiles(
    battle: BattleState,
    views: UnitViews,
    alpha: number,
    dt: number,
  ): void {
    const now = battle.tick + alpha;
    for (const p of this.projectiles) {
      if (!p.active) continue;
      const progress = (now - p.launchTick) / (p.impactTick - p.launchTick);
      if (progress >= 1) {
        p.active = false;
        p.sprite.visible = false;
        p.shade.visible = false;
        p.mark.visible = false;
        continue;
      }
      if (p.lob) {
        this.updateLob(p, progress, dt);
        continue;
      }
      const target = views.get(p.targetId);
      if (target !== undefined) {
        p.x1 = target.sx;
        p.y1 = target.sy - target.lift - this.cell * 0.45;
      }
      const t = clamp(progress, 0, 1);
      const x = p.x0 + (p.x1 - p.x0) * t;
      const y = p.y0 + (p.y1 - p.y0) * t;
      p.sprite.position.set(x, y);
      p.sprite.rotation = Math.atan2(p.y1 - p.y0, p.x1 - p.x0);
      if (p.trail) {
        p.trailMs += dt;
        if (p.trailMs >= 28) {
          p.trailMs = 0;
          this.puff(x, y, 0, 0, 340, this.cell * 0.22, this.cell * 0.5, 0.5, 0xd5d8e0);
        }
      }
    }
  }

  private updateLob(p: ProjectileView, progress: number, dt: number): void {
    const c = this.cell;
    const t = clamp(progress, 0, 1);
    const pt = lobPoint(t, p.x0, p.y0, p.x1, p.y1, p.arc, this.scratch);
    p.sprite.position.set(pt.x, pt.y);
    p.sprite.rotation = t * 9;
    p.trailMs += dt;
    if (p.trailMs >= 45) {
      p.trailMs = 0;
      this.puff(pt.x, pt.y, 0, 0, 380, c * 0.2, c * 0.5, 0.55, 0xcff58a);
    }
    // Target mark: a dark disc that darkens, and a ring that closes in on the blast radius.
    const r = p.markRadius;
    p.shade.width = r * 1.9;
    p.shade.height = r * 1.9 * 0.62;
    p.shade.alpha = 0.15 + 0.3 * t;
    const pulse = 0.5 + 0.5 * Math.sin(t * 40);
    const size = r * 2 * (1.5 - 0.5 * t);
    p.mark.width = size;
    p.mark.height = size;
    p.mark.alpha = 0.35 + 0.35 * t + 0.15 * pulse;
  }

  private updateMeteors(dt: number): void {
    const c = this.cell;
    for (const m of this.meteors) {
      if (!m.active) continue;
      m.life += dt;
      const t = m.life / METEOR_FALL_MS;
      if (t >= 1) {
        m.active = false;
        m.sprite.visible = false;
        m.core.visible = false;
        m.shadow.visible = false;
        this.explosion(m.x, m.y, m.radius * 1.3);
        this.ring(m.x, m.y, m.radius * 0.3, m.radius * 2.6, 520, 0xff5a1c, false, 1);
        this.shake(c * impactShake('meteor'), c * 0.9);
        continue;
      }
      const pt = meteorPoint(t, m.x, m.y, c * 8, this.scratch);
      m.sprite.position.set(pt.x, pt.y);
      m.sprite.width = m.sprite.height = c * 2.1;
      m.sprite.alpha = 1;
      m.core.position.set(pt.x, pt.y);
      m.core.width = m.core.height = c * 0.8;
      m.core.rotation = t * 10;
      // Ground shadow grows as the meteor comes down.
      m.shadow.position.set(m.x, m.y);
      m.shadow.width = m.radius * 2 * (0.4 + 0.6 * t);
      m.shadow.height = m.radius * 2 * (0.4 + 0.6 * t) * 0.62;
      m.shadow.alpha = 0.15 + 0.3 * t;
      m.trailMs += dt;
      if (m.trailMs >= 22) {
        m.trailMs = 0;
        this.puff(
          pt.x,
          pt.y,
          0,
          0,
          320,
          c * 0.8,
          c * 1.5,
          0.7,
          t < 0.5 ? 0xff8a1c : 0xffd23a,
          true,
        );
        this.puff(pt.x - c * 0.1, pt.y - c * 0.3, 0, 0, 480, c * 0.6, c * 1.3, 0.5, 0x4a4e5c);
      }
    }
  }

  private updateZones(battle: BattleState, alpha: number, dt: number): void {
    const now = battle.tick + alpha;
    for (const z of this.zones) {
      if (!z.active) continue;
      z.age += dt;
      const remaining = z.endTick - now;
      if (remaining <= 0) {
        z.active = false;
        z.sprite.visible = false;
        z.rim.visible = false;
        continue;
      }
      const look = zoneLook(z.kind);
      const fadeIn = clamp(z.age / 250, 0, 1);
      const fadeOut = clamp(remaining / 10, 0, 1);
      const f = fadeIn * fadeOut;
      const breath = 1 + 0.05 * Math.sin(z.age * 0.004 + z.phase);
      const d = z.radius * 2 * 1.15 * breath;
      z.sprite.width = d;
      z.sprite.height = d * look.squash;
      z.sprite.alpha = (look.alpha + 0.1 * Math.sin(z.age * 0.006 + z.phase)) * f;
      z.rim.width = z.radius * 2 * 1.02 * breath;
      z.rim.height = z.rim.width * look.squash;
      z.rim.alpha = (look.bubbles ? 0.55 : 0.28) * f;
      z.sporeMs += dt;
      if (z.sporeMs >= (look.bubbles ? 170 : 140)) {
        z.sporeMs = 0;
        const a = (z.age * 0.37 + z.phase) % (Math.PI * 2);
        const rr = z.radius * (0.2 + 0.6 * ((z.age * 0.0013) % 1));
        const px = z.x + Math.cos(a) * rr;
        const py = z.y + Math.sin(a) * rr * 0.8 * look.squash;
        if (look.bubbles) {
          // A bubble swells on the puddle and pops: it hardly moves, grows and fades.
          this.puff(
            px,
            py,
            0,
            -this.cell * 0.12,
            600,
            this.cell * 0.1,
            this.cell * 0.3,
            0.9 * f,
            look.speck,
            false,
            this.tex.bubble,
          );
        } else {
          this.puff(
            px,
            py,
            0,
            -this.cell * 0.5,
            900,
            this.cell * 0.12,
            this.cell * 0.2,
            0.7 * f,
            look.speck,
          );
        }
      }
    }
  }

  private updateNumbers(dt: number): void {
    const c = this.cell;
    for (const n of this.numbers) {
      if (!n.active) continue;
      n.life += dt;
      const t = n.life / NUMBER_MS;
      if (t >= 1) {
        n.active = false;
        n.text.visible = false;
        continue;
      }
      // Hop up fast, then drift; fade out in the last third.
      const rise = 1 - (1 - Math.min(1, t * 1.6)) * (1 - Math.min(1, t * 1.6));
      n.text.position.set(n.x, n.y - rise * c * 1.1 - t * c * 0.3);
      const pop = t < 0.15 ? 0.6 + (t / 0.15) * 0.7 : 1.3 - Math.min(0.3, (t - 0.15) * 0.6);
      // Half the former size (c / 48); the bitmap font stays at 36 px, so it is only scaled down.
      n.text.scale.set((c / 96) * pop);
      n.text.alpha = t < 0.65 ? 1 : 1 - (t - 0.65) / 0.35;
    }
  }
}
