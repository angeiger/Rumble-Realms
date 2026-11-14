/**
 * Effects: particles, projectiles, floating numbers, lingering zones and screen shake.
 * Everything comes from pools with fixed upper bounds; nothing is allocated per frame.
 */
import type { BattleState, CardId } from '@rumble-realms/engine';
import { BitmapText, Container, Sprite, type Texture } from 'pixi.js';
import { INTRO_MS } from '../game/config.ts';
import type { FieldLayout } from './layout.ts';
import { PALETTE } from './palette.ts';
import { clamp } from './motion.ts';
import { ARROW_SIZE, BULLET_SIZE, type EffectTextures } from './textures.ts';
import type { NumberKind, NumberSink, UnitViews } from './unitViews.ts';

const MAX_PARTICLES = 450;
const MAX_PROJECTILES = 64;
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
      this.projectiles.push(p);
      layers.fx.addChild(p.sprite);
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
  ): void {
    const p = this.alloc(this.tex.dot, tint, add);
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

  /** Lingering cloud (spore cloud). */
  zone(id: number, x: number, y: number, radiusPx: number, endTick: number): void {
    for (const z of this.zones) {
      if (z.active && z.id === id) return;
    }
    for (const z of this.zones) {
      if (z.active) continue;
      z.active = true;
      z.id = id;
      z.x = x;
      z.y = y;
      z.radius = radiusPx;
      z.endTick = endTick;
      z.phase = (id * 1.7) % (Math.PI * 2);
      z.age = 0;
      z.sporeMs = 0;
      z.sprite.tint = 0x7fd13a;
      z.rim.tint = 0xb6f05a;
      z.sprite.position.set(x, y);
      z.rim.position.set(x, y);
      z.sprite.visible = true;
      z.rim.visible = true;
      return;
    }
  }

  number(x: number, y: number, amount: number, kind: NumberKind): void {
    for (const n of this.numbers) {
      if (n.active) continue;
      n.active = true;
      n.life = 0;
      n.x = x + (((amount * 13) % 7) - 3) * this.cell * 0.04;
      n.y = y;
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
      const fadeIn = clamp(z.age / 250, 0, 1);
      const fadeOut = clamp(remaining / 10, 0, 1);
      const f = fadeIn * fadeOut;
      const breath = 1 + 0.05 * Math.sin(z.age * 0.004 + z.phase);
      const d = z.radius * 2 * 1.15 * breath;
      z.sprite.width = z.sprite.height = d;
      z.sprite.alpha = (0.5 + 0.1 * Math.sin(z.age * 0.006 + z.phase)) * f;
      z.rim.width = z.rim.height = z.radius * 2 * 1.02 * breath;
      z.rim.alpha = 0.28 * f;
      z.sporeMs += dt;
      if (z.sporeMs >= 140) {
        z.sporeMs = 0;
        const a = (z.age * 0.37 + z.phase) % (Math.PI * 2);
        const rr = z.radius * (0.2 + 0.6 * ((z.age * 0.0013) % 1));
        this.puff(
          z.x + Math.cos(a) * rr,
          z.y + Math.sin(a) * rr * 0.8,
          0,
          -this.cell * 0.5,
          900,
          this.cell * 0.12,
          this.cell * 0.2,
          0.7 * f,
          0xe3ff8a,
        );
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
      n.text.scale.set((c / 48) * pop);
      n.text.alpha = t < 0.65 ? 1 : 1 - (t - 0.65) / 0.35;
    }
  }
}
