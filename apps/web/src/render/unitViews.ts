/**
 * Unit views: one pooled bundle of sprites per living (or just dying) unit. The engine
 * state is only read. Figures are sprites with cached textures; all animation is a
 * transformation of the whole figure (D-037).
 */
import { CARDS, type BattleState, type CardId, type PlayerIndex } from '@rumble-realms/engine';
import { Container, Sprite, Texture } from 'pixi.js';
import { FIGURE_BOX, type Team } from './figures.ts';
import { fieldToScreen, type FieldLayout, type Point } from './layout.ts';
import { PALETTE } from './palette.ts';
import { easeOutBack, unitFieldPosition } from './motion.ts';
import type { AnchoredTexture, FigureTextures } from './textures.ts';

/** Height and width of a figure in field widths (SPEC 10). */
export const FIGURE_CELLS = 1.3;
const SPAWN_MS = 380;
const ATTACK_MS = 240;
const HIT_MS = 170;
const DEATH_MS = 400;
const NUMBER_INTERVAL_MS = 300;
/** Air units hover this high above the ground point, in cells. */
const AIR_LIFT_CELLS = 0.6;
const AIR_ZINDEX = 100000;

export type NumberKind = 'hitOwn' | 'hitEnemy' | 'heal';

/** Receives the floating numbers of the views. */
export interface NumberSink {
  number(x: number, y: number, amount: number, kind: NumberKind): void;
}

export class UnitView {
  id = 0;
  card: CardId = 'archer';
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

  /** Ground position on screen (centre of the unit's cell, interpolated). */
  sx = 0;
  sy = 0;
  /** Current hover height in pixels (air units, falling when dying). */
  lift = 0;
  /** Top of the figure above the ground point in pixels, for bars and numbers. */
  topPx = 0;

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
  private readonly sink: NumberSink;

  constructor(layers: Layers, textures: FigureTextures, shadowTexture: Texture, sink: NumberSink) {
    this.layers = layers;
    this.textures = textures;
    this.shadowTexture = shadowTexture;
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
      v.topPx = v.fig.anchor.y * v.fig.texture.height * this.k;
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
    }
    this.pool.length = 0;
  }

  /** Attack, shot or heal of `id` aimed at `targetId`: lunge towards the target. */
  attack(id: number, targetId: number): void {
    const v = this.map.get(id);
    if (v === undefined || v.dying) return;
    const t = this.map.get(targetId);
    let dx = 0;
    let dy = -1;
    if (t !== undefined) {
      dx = t.sx - v.sx;
      dy = t.sy - v.sy;
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
    if (v !== undefined) v.age = 0;
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
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (u === undefined) continue;
      let v = this.map.get(u.id);
      if (v === undefined) v = this.create(u.id, u.card, u.owner, u.layer === 1, me);
      v.seen = frameNo;
      if (v.texGen !== gen) this.applyTextures(v);

      unitFieldPosition(u, v.moveSpeed, alpha, this.pos);
      fieldToScreen(layout, me, this.pos.x, this.pos.y, this.pos);
      v.sx = this.pos.x;
      v.sy = this.pos.y;

      if (u.hp !== v.hp || u.maxHp !== v.maxHp) this.setHp(v, u.hp, u.maxHp);
      const charging = u.jumpTick >= 0 && battle.started;
      this.animate(v, dt, now, u.moveCost > 0, charging);
      if (v.dmgAcc > 0 && now >= v.dmgNextAt) this.flushNumber(v, now);
    }

    // Views whose unit is gone start dying; dying views fade out and are recycled.
    for (let i = this.list.length - 1; i >= 0; i--) {
      const v = this.list[i] as UnitView;
      if (v.seen !== frameNo && !v.dying) {
        v.dying = true;
        v.deathT = 0;
        v.bar.visible = false;
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

  private create(id: number, card: CardId, owner: PlayerIndex, air: boolean, me: PlayerIndex) {
    const v = this.pool.pop() ?? new UnitView();
    v.id = id;
    v.card = card;
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
    this.layers.floor.addChild(v.ring);
    if (air) this.layers.floor.addChild(v.shadow);
    this.layers.units.addChild(v.root);
    this.map.set(id, v);
    this.list.push(v);
    this.applyTextures(v);
    return v;
  }

  private release(v: UnitView, index: number): void {
    this.map.delete(v.id);
    const last = this.list.length - 1;
    if (index !== last) this.list[index] = this.list[last] as UnitView;
    this.list.length = last;
    v.root.removeFromParent();
    v.ring.removeFromParent();
    v.shadow.removeFromParent();
    this.pool.push(v);
  }

  private applyTextures(v: UnitView): void {
    const fig: AnchoredTexture = this.textures.figure(v.card, v.team);
    const ring: AnchoredTexture = this.textures.ring(v.team);
    v.fig.texture = fig.texture;
    v.fig.anchor.set(fig.anchorX, fig.anchorY);
    v.flash.texture = fig.texture;
    v.flash.anchor.set(fig.anchorX, fig.anchorY);
    v.ring.texture = ring.texture;
    v.ring.anchor.set(ring.anchorX, ring.anchorY);
    v.shadow.texture = this.shadowTexture;
    v.topPx = fig.anchorY * fig.texture.height * this.k;
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
  private animate(v: UnitView, dt: number, now: number, moving: boolean, charging: boolean): void {
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
    } else {
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

    if (v.age < SPAWN_MS) {
      const s = easeOutBack(v.age / SPAWN_MS);
      sx *= s;
      sy *= s;
    }

    let lift = 0;
    if (v.air) lift = AIR_LIFT_CELLS * cell + Math.sin(now * 0.004 + v.phase) * cell * 0.06;
    v.lift = lift;

    v.body.position.set(ox, oy - lift);
    v.body.scale.set(k * sx, k * sy);
    v.body.rotation = rot;
    this.placeSupport(v, flash);
  }

  private animateDeath(v: UnitView): void {
    const p = Math.min(1, v.deathT / DEATH_MS);
    const k = this.k;
    const fall = p * p;
    const lift = v.air ? AIR_LIFT_CELLS * this.cell * (1 - fall) : 0;
    v.lift = lift;
    v.body.position.set(0, -lift);
    v.body.rotation = v.deathDir * (Math.PI / 2) * (1 - (1 - p) * (1 - p));
    v.body.scale.set(k * (1 + 0.15 * p), k * (1 - 0.45 * p));
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
    v.ring.scale.set(k * 0.95);
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
