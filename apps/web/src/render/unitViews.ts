/**
 * Unit views: one pooled bundle of sprites per living (or just dying) unit. The engine
 * state is only read. Figures are sprites with cached textures; all animation is a
 * transformation of the whole figure (D-037).
 */
import {
  AIR,
  CARDS,
  type BattleState,
  type CardId,
  type PlayerIndex,
  type UnitState,
} from '@rumble-realms/engine';
import { Container, Sprite, Texture } from 'pixi.js';
import { FIGURE_BOX, type FigureId, type Team } from './figures.ts';
import { fieldToScreen, type FieldLayout, type Point } from './layout.ts';
import { PALETTE } from './palette.ts';
import { clamp, easeOutBack, unitFieldPosition } from './motion.ts';
import { StatusOverlay } from './statusOverlay.ts';
import type { AnchoredTexture, EffectTextures, FigureTextures } from './textures.ts';
import {
  bodyAlpha,
  bodyTint,
  figureFor,
  isHeld,
  overlayFlags,
  sizeFactor,
  zombieLying,
} from './unitLook.ts';

/** Height and width of a figure in field widths (SPEC 10). */
export const FIGURE_CELLS = 1.3;
const SPAWN_MS = 380;
/** Plop of a crowd appearing at once (new round): shorter, and spread over `CROWD_SPREAD_MS`. */
const CROWD_SPAWN_MS = 260;
const CROWD_SPREAD_MS = 380;
/** More new units than this in one frame count as a crowd. */
const CROWD_MIN = 4;
/** Units that change cells during the draft glide to the new place in this time. */
const GLIDE_MS = 250;
const ATTACK_MS = 240;
const HIT_MS = 170;
const DEATH_MS = 400;
const NUMBER_INTERVAL_MS = 300;
/** Air units hover this high above the ground point, in cells. */
const AIR_LIFT_CELLS = 0.6;
const AIR_ZINDEX = 100000;
/** A changing size (growth, giant) eases in this time constant. */
const SIZE_EASE_MS = 140;
/** A risen zombie lies down at once and gets up in this time. */
const RISE_MS = 320;

export type NumberKind = 'hitOwn' | 'hitEnemy' | 'heal';

/** Receives the floating numbers of the views. */
export interface NumberSink {
  number(x: number, y: number, amount: number, kind: NumberKind): void;
  /** A spark of the burning TNT fuse at (x, y); `intensity` 0..1. */
  fuseSpark(x: number, y: number, intensity: number): void;
}

/** Fuse flash colours: red and white, alternating. */
const FUSE_RED = 0xff3b22;
const FUSE_WHITE = 0xffffff;

export class UnitView {
  id = 0;
  card: CardId = 'archer';
  /** Figure currently drawn (differs from the card for zombies, ghosts and mini golems). */
  figure: FigureId = 'archer';
  owner: PlayerIndex = 0;
  air = false;
  moveSpeed = 0;
  team: Team = 'own';

  readonly root = new Container();
  readonly body = new Container();
  readonly fig = new Sprite();
  readonly flash = new Sprite();
  readonly bar = new Container();
  readonly barBack = new Sprite(Texture.WHITE);
  readonly barFill = new Sprite(Texture.WHITE);
  readonly ring = new Sprite();
  readonly shadow = new Sprite();
  /** Assassin: faint mark on the cell the shadow jump aims at (only while charging). */
  readonly marker = new Sprite();

  /** Ground position on screen (centre of the unit's cell, interpolated). */
  sx = 0;
  sy = 0;
  /** Current hover height in pixels (air units, falling when dying). */
  lift = 0;
  /** Top of the figure above the ground point in pixels, for bars and numbers. */
  topPx = 0;
  /** Same for size 1. */
  topBase = 0;
  /** Size factor now (eases) and wanted (giant, daughter, growth). 0 = not set yet. */
  size = 0;
  sizeTarget = 1;
  /** Status overlay bits of this frame and the overlay sprites (made on first use). */
  fxFlags = 0;
  overlay: StatusOverlay | null = null;
  tintApplied = 0xffffff;
  bodyAlphaWanted = 1;
  /** Zombie: 1 = lying flat, 0 = standing; eases in between while getting up. */
  lie = 0;

  seen = -1;
  hp = -1;
  maxHp = -1;
  texGen = -1;
  phase = 0;
  age = 0;
  attackT = -1;
  attackDx = 0;
  attackDy = 0;
  hitT = -1;
  dying = false;
  deathT = 0;
  deathDir = 1;
  dmgAcc = 0;
  dmgNextAt = 0;
  /** Duration of the "plop" on appearing. */
  spawnMs = SPAWN_MS;
  /** Explosive cards: ticks of the fuse (0 = none). */
  fuseTicks = 0;
  fusePhase = 0;
  sparkAcc = 0;
  /** Whether `baseX`/`baseY` hold the position of the previous frame. */
  hasPos = false;
  /** Field cell and screen position without glide offset in the previous frame. */
  lastFx = 0;
  lastFy = 0;
  baseX = 0;
  baseY = 0;
  /** Glide offset in pixels at the start of the glide, and its age. */
  glideX = 0;
  glideY = 0;
  glideT = GLIDE_MS;

  constructor() {
    this.flash.blendMode = 'add';
    this.flash.visible = false;
    this.body.addChild(this.fig, this.flash);
    this.barBack.tint = PALETTE.outline;
    this.barBack.alpha = 0.85;
    this.bar.addChild(this.barBack, this.barFill);
    this.bar.visible = false;
    this.root.addChild(this.body, this.bar);
    this.shadow.tint = 0x000000;
    this.shadow.anchor.set(0.5);
    this.marker.anchor.set(0.5);
    this.marker.tint = 0xff4a3a;
    this.marker.visible = false;
  }
}

interface Layers {
  /** Below all units: rings and shadows. */
  floor: Container;
  /** Sorted by depth. */
  units: Container;
}

export class UnitViews {
  private readonly map = new Map<number, UnitView>();
  private readonly list: UnitView[] = [];
  private readonly pool: UnitView[] = [];
  private readonly pos: Point = { x: 0, y: 0 };
  private frameNo = 0;
  /** Pixels per design unit of the figures on screen. */
  private k = 1;
  private cell = 1;

  private readonly layers: Layers;
  private readonly textures: FigureTextures;
  private readonly shadowTexture: Texture;
  private readonly fxTextures: EffectTextures;
  private readonly sink: NumberSink;

  constructor(
    layers: Layers,
    textures: FigureTextures,
    fxTextures: EffectTextures,
    sink: NumberSink,
  ) {
    this.layers = layers;
    this.textures = textures;
    this.fxTextures = fxTextures;
    this.shadowTexture = fxTextures.dot;
    this.sink = sink;
    layers.units.sortableChildren = true;
  }

  get(id: number): UnitView | undefined {
    return this.map.get(id);
  }

  get count(): number {
    return this.list.length;
  }

  /** Pixels per design unit for a layout (figures are about 1.3 cells wide). */
  static pixelsPerUnit(cell: number): number {
    return (cell * FIGURE_CELLS) / (FIGURE_BOX.right - FIGURE_BOX.left);
  }

  setLayout(layout: FieldLayout): void {
    this.cell = layout.cell;
    this.k = UnitViews.pixelsPerUnit(layout.cell);
    // Everything measured in pixels is recomputed on the next frame.
    for (const v of this.list) {
      v.topBase = v.fig.anchor.y * v.fig.texture.height * this.k;
      v.topPx = v.topBase * Math.max(v.size, 0.1);
      v.hp = -1;
    }
  }

  /** Removes all views (new round or new session). */
  clear(): void {
    for (let i = this.list.length - 1; i >= 0; i--) this.release(this.list[i] as UnitView, i);
  }

  destroy(): void {
    this.clear();
    for (const v of this.pool) {
      v.root.destroy({ children: true });
      v.ring.destroy();
      v.shadow.destroy();
      v.marker.destroy();
    }
    this.pool.length = 0;
  }

  /** Attack, shot or heal of `id` aimed at `targetId`: lunge towards the target. */
  attack(id: number, targetId: number): void {
    const t = this.map.get(targetId);
    this.lunge(id, t?.sx, t?.sy);
  }

  /** Attack of `id` aimed at a point on the screen (lobbed shell): lunge towards it. */
  attackAt(id: number, x: number, y: number): void {
    this.lunge(id, x, y);
  }

  private lunge(id: number, tx: number | undefined, ty: number | undefined): void {
    const v = this.map.get(id);
    if (v === undefined || v.dying) return;
    let dx = 0;
    let dy = -1;
    if (tx !== undefined && ty !== undefined) {
      dx = tx - v.sx;
      dy = ty - v.sy;
      const len = Math.hypot(dx, dy);
      if (len > 1e-3) {
        dx /= len;
        dy /= len;
      } else {
        dx = 0;
        dy = -1;
      }
    }
    v.attackT = 0;
    v.attackDx = dx;
    v.attackDy = dy;
  }

  /** `amount` of damage on `id`: flash and a (collected) number. */
  damage(id: number, amount: number, now: number): void {
    const v = this.map.get(id);
    if (v === undefined) return;
    v.hitT = 0;
    v.dmgAcc += amount;
    if (now >= v.dmgNextAt) this.flushNumber(v, now);
  }

  /** The unit appeared somewhere (assassin jump): plays the "plop" again. */
  appear(id: number): void {
    const v = this.map.get(id);
    if (v === undefined) return;
    v.age = 0;
    v.spawnMs = SPAWN_MS;
    v.hasPos = false;
    v.glideT = GLIDE_MS;
  }

  /**
   * Brings the views in line with the battle state and animates them.
   * Allocation-free per unit and frame except for newly appearing units.
   */
  update(
    battle: BattleState,
    me: PlayerIndex,
    layout: FieldLayout,
    alpha: number,
    dt: number,
    now: number,
  ): void {
    this.frameNo++;
    const frameNo = this.frameNo;
    const gen = this.textures.generation;
    const units = battle.units;
    // Many new units in one frame (new round): they pop up one after the other, quickly.
    const fresh = units.length - this.list.length;
    const crowd = fresh >= CROWD_MIN;
    let newIndex = 0;
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (u === undefined) continue;
      let v = this.map.get(u.id);
      if (v === undefined) {
        v = this.create(u.id, u.card, u.owner, u.layer === AIR, me);
        if (crowd) {
          v.spawnMs = CROWD_SPAWN_MS;
          v.age = -(newIndex / fresh) * CROWD_SPREAD_MS;
          newIndex++;
        }
      }
      v.seen = frameNo;
      const figure = figureFor(u);
      if (v.texGen !== gen || v.figure !== figure) {
        v.figure = figure;
        this.applyTextures(v);
      }
      if (v.air !== (u.layer === AIR)) this.setAir(v, u.layer === AIR);
      this.applyLook(v, u, battle.tick, dt);

      unitFieldPosition(u, v.moveSpeed, alpha, this.pos);
      fieldToScreen(layout, me, this.pos.x, this.pos.y, this.pos);
      this.place(v, u.x, u.y, this.pos.x, this.pos.y, dt, battle.started);

      if (u.hp !== v.hp || u.maxHp !== v.maxHp) this.setHp(v, u.hp, u.maxHp);
      const charging = u.jumpTick >= 0 && battle.started;
      let fuse = -1;
      if (u.fuseTick >= 0 && v.fuseTicks > 0) {
        fuse = clamp(1 - (u.fuseTick - (battle.tick + alpha)) / v.fuseTicks, 0, 1);
      }
      this.animate(v, dt, now, u.moveCost > 0 && !isHeld(v.fxFlags), charging, fuse);
      if (v.marker.visible !== charging) v.marker.visible = charging;
      if (charging) this.placeMarker(v, u.jumpX, u.jumpY, layout, me, now);
      if (v.dmgAcc > 0 && now >= v.dmgNextAt) this.flushNumber(v, now);
    }

    // Views whose unit is gone start dying; dying views fade out and are recycled.
    for (let i = this.list.length - 1; i >= 0; i--) {
      const v = this.list[i] as UnitView;
      if (v.seen !== frameNo && !v.dying) {
        v.dying = true;
        v.deathT = 0;
        v.bar.visible = false;
        v.overlay?.reset();
        v.fxFlags = 0;
        if (v.dmgAcc > 0) this.flushNumber(v, now);
      }
      if (v.dying) {
        v.deathT += dt;
        if (v.deathT >= DEATH_MS) {
          this.release(v, i);
          continue;
        }
        this.animateDeath(v);
      }
    }
  }

  // ---- internals ----------------------------------------------------------------------

  /**
   * Sets the screen position of a view. In the draft a unit that changes its cell (the
   * formation moved up) glides there instead of jumping; in battle steps are continuous.
   */
  private place(
    v: UnitView,
    fx: number,
    fy: number,
    bx: number,
    by: number,
    dt: number,
    battleStarted: boolean,
  ): void {
    if (v.hasPos && !battleStarted && (fx !== v.lastFx || fy !== v.lastFy)) {
      // Keep the picture continuous: the offset is where the figure was drawn minus where it belongs now.
      const k = this.glideFactor(v);
      v.glideX = v.baseX + v.glideX * k - bx;
      v.glideY = v.baseY + v.glideY * k - by;
      v.glideT = 0;
    }
    v.hasPos = true;
    v.lastFx = fx;
    v.lastFy = fy;
    v.baseX = bx;
    v.baseY = by;
    if (v.glideT < GLIDE_MS) v.glideT += dt;
    const k = this.glideFactor(v);
    v.sx = bx + v.glideX * k;
    v.sy = by + v.glideY * k;
  }

  /** Remaining share (1 -> 0) of the glide offset. */
  private glideFactor(v: UnitView): number {
    if (v.glideT >= GLIDE_MS) return 0;
    const u = 1 - v.glideT / GLIDE_MS;
    return u * u * u;
  }

  private placeMarker(
    v: UnitView,
    jx: number,
    jy: number,
    layout: FieldLayout,
    me: PlayerIndex,
    now: number,
  ): void {
    if (jx < 0 || jy < 0) {
      v.marker.visible = false;
      return;
    }
    fieldToScreen(layout, me, jx, jy, this.pos);
    const c = this.cell;
    const pulse = 0.5 + 0.5 * Math.sin(now * 0.008);
    v.marker.position.set(this.pos.x, this.pos.y + c * 0.05);
    v.marker.scale.set((c * (1.0 + 0.15 * pulse)) / 64, (c * (0.55 + 0.08 * pulse)) / 64);
    v.marker.alpha = 0.4 + 0.3 * pulse;
    v.marker.zIndex = 0;
  }

  private create(id: number, card: CardId, owner: PlayerIndex, air: boolean, me: PlayerIndex) {
    const v = this.pool.pop() ?? new UnitView();
    v.id = id;
    v.card = card;
    v.figure = card;
    v.size = 0;
    v.sizeTarget = 1;
    v.fxFlags = 0;
    v.overlay?.reset();
    v.fig.tint = 0xffffff;
    v.tintApplied = 0xffffff;
    v.bodyAlphaWanted = 1;
    v.lie = 0;
    v.owner = owner;
    v.air = air;
    v.moveSpeed = CARDS[card].moveSpeed;
    v.team = owner === me ? 'own' : 'enemy';
    v.phase = (id * 2.399963) % (Math.PI * 2);
    v.age = 0;
    v.attackT = -1;
    v.hitT = -1;
    v.dying = false;
    v.deathT = 0;
    v.deathDir = id % 2 === 0 ? 1 : -1;
    v.dmgAcc = 0;
    v.dmgNextAt = 0;
    v.spawnMs = SPAWN_MS;
    const attack = CARDS[card].attack;
    v.fuseTicks = attack.kind === 'explode' ? attack.fuseTicks : 0;
    v.fusePhase = 0;
    v.sparkAcc = 0;
    v.hasPos = false;
    v.glideT = GLIDE_MS;
    v.flash.tint = FUSE_WHITE;
    v.marker.visible = false;
    v.hp = -1;
    v.maxHp = -1;
    v.texGen = -1;
    v.seen = this.frameNo;
    v.lift = air ? AIR_LIFT_CELLS * this.cell : 0;
    v.body.rotation = 0;
    v.body.alpha = 1;
    v.ring.alpha = 1;
    v.shadow.alpha = 0.3;
    v.flash.visible = false;
    v.barFill.tint = (v.team === 'own' ? PALETTE.teamOwn : PALETTE.teamEnemy).main;
    v.bar.visible = false;
    v.root.visible = true;
    v.root.alpha = 1;
    v.root.scale.set(1);
    v.ring.visible = true;
    v.shadow.visible = true;
    this.layers.floor.addChild(v.ring);
    if (CARDS[card].shadowJump !== undefined) this.layers.floor.addChild(v.marker);
    if (air) this.layers.floor.addChild(v.shadow);
    this.layers.units.addChild(v.root);
    this.map.set(id, v);
    this.list.push(v);
    this.applyTextures(v);
    return v;
  }

  /** Moves a view to the air or the ground layer (a lich ghost floats up). */
  private setAir(v: UnitView, air: boolean): void {
    v.air = air;
    if (air) this.layers.floor.addChild(v.shadow);
    else v.shadow.removeFromParent();
  }

  /** Reads the status and variant of `u` into the view: size, tint, opacity, overlay flags. */
  private applyLook(v: UnitView, u: UnitState, tick: number, dt: number): void {
    v.sizeTarget = sizeFactor(u);
    if (v.size === 0) v.size = v.sizeTarget;
    else v.size += (v.sizeTarget - v.size) * Math.min(1, dt / SIZE_EASE_MS);
    v.topPx = v.topBase * v.size;

    const flags = overlayFlags(u, tick);
    v.fxFlags = flags;
    if (zombieLying(u, tick)) v.lie = 1;
    else if (v.lie > 0) v.lie = Math.max(0, v.lie - dt / RISE_MS);
    const tint = bodyTint(flags, u.ghost);
    if (tint !== v.tintApplied) {
      v.tintApplied = tint;
      v.fig.tint = tint;
    }
    v.bodyAlphaWanted = bodyAlpha(flags, u.ghost);
    if (flags !== 0 && v.overlay === null) {
      const o = new StatusOverlay(this.fxTextures);
      v.overlay = o;
      v.root.addChildAt(o.under, 0);
      v.root.addChildAt(o.over, v.root.getChildIndex(v.bar));
    }
  }

  private release(v: UnitView, index: number): void {
    this.map.delete(v.id);
    const last = this.list.length - 1;
    if (index !== last) this.list[index] = this.list[last] as UnitView;
    this.list.length = last;
    v.root.removeFromParent();
    v.ring.removeFromParent();
    v.shadow.removeFromParent();
    v.marker.removeFromParent();
    this.pool.push(v);
  }

  private applyTextures(v: UnitView): void {
    const fig: AnchoredTexture = this.textures.figure(v.figure, v.team);
    const ring: AnchoredTexture = this.textures.ring(v.team);
    v.fig.texture = fig.texture;
    v.fig.anchor.set(fig.anchorX, fig.anchorY);
    v.flash.texture = fig.texture;
    v.flash.anchor.set(fig.anchorX, fig.anchorY);
    v.ring.texture = ring.texture;
    v.ring.anchor.set(ring.anchorX, ring.anchorY);
    v.shadow.texture = this.shadowTexture;
    v.marker.texture = this.shadowTexture;
    v.topBase = fig.anchorY * fig.texture.height * this.k;
    v.topPx = v.topBase * Math.max(v.size, 0.1);
    v.texGen = this.textures.generation;
  }

  private setHp(v: UnitView, hp: number, maxHp: number): void {
    v.hp = hp;
    v.maxHp = maxHp;
    const show = hp < maxHp && hp > 0;
    v.bar.visible = show && !v.dying;
    if (!show) return;
    const w = this.cell * 0.8;
    const h = Math.max(3, this.cell * 0.12);
    const pad = Math.max(1, h * 0.2);
    v.barBack.position.set(-w / 2 - pad, -pad);
    v.barBack.width = w + 2 * pad;
    v.barBack.height = h + 2 * pad;
    v.barFill.position.set(-w / 2, 0);
    v.barFill.width = Math.max(1, (w * hp) / maxHp);
    v.barFill.height = h;
  }

  private flushNumber(v: UnitView, now: number): void {
    if (v.dmgAcc <= 0) return;
    this.sink.number(
      v.sx,
      v.sy - v.topPx - v.lift,
      v.dmgAcc,
      v.team === 'own' ? 'hitOwn' : 'hitEnemy',
    );
    v.dmgAcc = 0;
    v.dmgNextAt = now + NUMBER_INTERVAL_MS;
  }

  /** Transform of the whole figure for the current state (D-037). */
  private animate(
    v: UnitView,
    dt: number,
    now: number,
    moving: boolean,
    charging: boolean,
    fuse: number,
  ): void {
    const cell = this.cell;
    const k = this.k;
    v.age += dt;
    let sx = 1;
    let sy = 1;
    let ox = 0;
    let oy = 0;
    let rot = 0;
    let flash = 0;

    if (moving) {
      const w = now * 0.0135 + v.phase;
      oy -= Math.abs(Math.sin(w)) * cell * 0.14;
      rot = Math.sin(w) * 0.07;
      const s = Math.cos(w * 2) * 0.04;
      sx += s;
      sy -= s;
    } else if (!isHeld(v.fxFlags)) {
      const b = Math.sin(now * 0.0055 + v.phase);
      sy += b * 0.03;
      sx -= b * 0.015;
    }

    if (v.attackT >= 0) {
      v.attackT += dt;
      const p = v.attackT / ATTACK_MS;
      if (p >= 1) {
        v.attackT = -1;
      } else {
        const lunge = Math.sin(Math.PI * p) * cell * 0.3;
        ox += v.attackDx * lunge;
        oy += v.attackDy * lunge * 0.8;
        const sq = Math.sin(2 * Math.PI * p) * 0.18;
        sx *= 1 + sq;
        sy *= 1 - sq;
      }
    }

    if (v.hitT >= 0) {
      v.hitT += dt;
      const p = v.hitT / HIT_MS;
      if (p >= 1) {
        v.hitT = -1;
      } else {
        flash = 0.85 * (1 - p);
        const pop = 1 + 0.08 * (1 - p);
        sx *= pop;
        sy *= pop;
      }
    }

    if (charging) {
      const c = 0.5 + 0.5 * Math.sin(now * 0.02);
      const pop = 1 + 0.1 * c;
      sx *= pop;
      sy *= pop;
      flash = Math.max(flash, 0.45 * c);
    }

    let flashTint = FUSE_WHITE;
    if (fuse >= 0) {
      // Burning fuse (D-050): blinks red and white ever faster, swells and trembles.
      v.fusePhase += (dt / 1000) * (2 + 12 * fuse) * Math.PI * 2;
      const on = Math.sin(v.fusePhase) > 0;
      flashTint = Math.sin(v.fusePhase * 0.5) > 0 ? FUSE_RED : FUSE_WHITE;
      flash = Math.max(flash, on ? 0.7 + 0.3 * fuse : 0.12);
      const swell = 1 + 0.05 + 0.24 * fuse * fuse;
      sx *= swell;
      sy *= swell;
      const shake = cell * (0.012 + 0.05 * fuse);
      ox += Math.sin(now * 0.13 + v.phase) * shake;
      oy += Math.cos(now * 0.17 + v.phase) * shake * 0.6;
      this.fuseSparks(v, dt, fuse);
    } else {
      v.fusePhase = 0;
      v.sparkAcc = 0;
    }
    if (v.flash.tint !== flashTint) v.flash.tint = flashTint;

    // A negative age is the delay of a crowd appearing: not visible yet.
    const waiting = v.age < 0;
    if (v.root.visible === waiting) {
      v.root.visible = !waiting;
      v.ring.visible = !waiting;
      v.shadow.visible = !waiting;
    }
    if (v.age < v.spawnMs) {
      const s = easeOutBack(v.age / v.spawnMs);
      sx *= s;
      sy *= s;
    }
    sx *= v.size;
    sy *= v.size;

    if (v.lie > 0) {
      // Risen zombie: flat on the ground, then it gets up.
      const e = v.lie * v.lie * (3 - 2 * v.lie);
      rot += v.deathDir * (Math.PI / 2) * e;
      sy *= 1 - 0.3 * e;
      ox -= v.deathDir * v.topPx * 0.35 * e;
      oy -= cell * 0.12 * e;
    }

    let lift = 0;
    if (v.air) lift = AIR_LIFT_CELLS * cell + Math.sin(now * 0.004 + v.phase) * cell * 0.06;
    v.lift = lift;

    v.body.position.set(ox, oy - lift);
    v.body.scale.set(k * sx, k * sy);
    v.body.rotation = rot;
    if (v.body.alpha !== v.bodyAlphaWanted) v.body.alpha = v.bodyAlphaWanted;
    v.overlay?.update(v.fxFlags, now, v.phase, cell, cell * 0.95 * v.size, v.topPx * 0.95, lift);
    this.placeSupport(v, flash);
  }

  /** Sparks at the fuse tip: more and more of them as the blast comes closer. */
  private fuseSparks(v: UnitView, dt: number, fuse: number): void {
    v.sparkAcc += (dt / 1000) * (10 + 40 * fuse);
    if (v.sparkAcc < 1) return;
    const n = Math.min(3, Math.floor(v.sparkAcc));
    v.sparkAcc -= n;
    const x = v.sx + this.cell * 0.12;
    const y = v.sy - v.topPx * 0.92 - v.lift;
    for (let i = 0; i < n; i++) this.sink.fuseSpark(x, y, fuse);
  }

  private animateDeath(v: UnitView): void {
    const p = Math.min(1, v.deathT / DEATH_MS);
    const k = this.k;
    const fall = p * p;
    const lift = v.air ? AIR_LIFT_CELLS * this.cell * (1 - fall) : 0;
    v.lift = lift;
    v.body.position.set(0, -lift);
    v.body.rotation = v.deathDir * (Math.PI / 2) * (1 - (1 - p) * (1 - p));
    v.body.scale.set(k * v.size * (1 + 0.15 * p), k * v.size * (1 - 0.45 * p));
    v.body.alpha = p < 0.5 ? 1 : 1 - (p - 0.5) * 2;
    v.ring.alpha = 1 - p;
    v.shadow.alpha = 0.3 * (1 - p);
    this.placeSupport(v, 0);
  }

  /** Root, ring, shadow and bar follow the ground point. */
  private placeSupport(v: UnitView, flash: number): void {
    const cell = this.cell;
    const k = this.k;
    v.root.position.set(v.sx, v.sy);
    v.root.zIndex = (v.air ? AIR_ZINDEX : 0) + v.sy;
    v.ring.position.set(v.sx, v.sy);
    v.ring.scale.set(k * 0.95 * (0.6 + 0.4 * v.size));
    if (v.air) {
      v.shadow.position.set(v.sx, v.sy + cell * 0.05);
      const near = 1 - Math.min(1, v.lift / (AIR_LIFT_CELLS * cell * 1.4));
      v.shadow.scale.set(
        (cell * 0.9 * (0.7 + 0.3 * near)) / 64,
        (cell * 0.4 * (0.7 + 0.3 * near)) / 64,
      );
    }
    v.flash.visible = flash > 0.01;
    v.flash.alpha = flash;
    v.bar.position.set(0, -(v.topPx + v.lift + cell * 0.18));
  }
}
