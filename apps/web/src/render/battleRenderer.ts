/**
 * The battle scene: owns the Pixi application, builds the layers, drives the session
 * clock once per frame and turns battle state and events into pictures.
 * The battle state is only read (SPEC 6.4).
 */
import { DESTROY_RENDERER } from './destroy.ts';
import type { BattleEvent, BattleState, PlayerIndex } from '@rumble-realms/engine';
import { Application, Container, Graphics } from 'pixi.js';
import type { GameSession, SessionPhase } from '../game/types.ts';
import { CANVAS_BACKGROUND, drawBackdrop } from './backdrop.ts';
import { Effects, NUMBER_FONT } from './effects.ts';
import {
  NO_EDGE_INSETS,
  computeLayout,
  fieldToScreen,
  type EdgeInsets,
  type FieldLayout,
  type Point,
} from './layout.ts';
import {
  FigureTextures,
  createEffectTextures,
  destroyEffectTextures,
  type EffectTextures,
} from './textures.ts';
import { UnitViews } from './unitViews.ts';

export interface BattleRendererStats {
  frames: number;
  /** Sum of the time spent in the per-frame update (without the GPU), in ms. */
  updateMs: number;
  maxUpdateMs: number;
  units: number;
}

export interface BattleRenderer {
  readonly stats: BattleRendererStats;
  /** Space at the top and bottom edge of the canvas that stays free of the field. */
  setEdgeInsets(insets: EdgeInsets): void;
  destroy(): void;
}

const MAX_RESOLUTION = 2;

/**
 * Creates the renderer inside `host`. Resolves to null if `isCancelled()` turned true while
 * the asynchronous setup was running (React StrictMode mounts, unmounts and mounts again);
 * everything created so far is then released again.
 */
export async function createBattleRenderer(
  host: HTMLElement,
  session: GameSession,
  isCancelled: () => boolean,
  edge: EdgeInsets = NO_EDGE_INSETS,
): Promise<BattleRenderer | null> {
  const app = new Application();
  const width = Math.max(1, host.clientWidth);
  const height = Math.max(1, host.clientHeight);
  try {
    await app.init({
      width,
      height,
      resolution: Math.min(window.devicePixelRatio || 1, MAX_RESOLUTION),
      autoDensity: true,
      antialias: true,
      background: CANVAS_BACKGROUND,
    });
  } catch (error) {
    if (isCancelled()) return null;
    throw error;
  }
  if (isCancelled()) {
    app.destroy(DESTROY_RENDERER, { children: true });
    return null;
  }
  try {
    await document.fonts.load(`36px "${NUMBER_FONT}"`);
  } catch {
    // The numbers fall back to a system font.
  }
  if (isCancelled()) {
    app.destroy(DESTROY_RENDERER, { children: true });
    return null;
  }
  return new Scene(app, host, session, edge);
}

class Scene implements BattleRenderer {
  readonly stats: BattleRendererStats = { frames: 0, updateMs: 0, maxUpdateMs: 0, units: 0 };

  private readonly world = new Container();
  private readonly backdrop = new Graphics();
  private readonly figureTextures: FigureTextures;
  private readonly effectTextures: EffectTextures;
  private readonly views: UnitViews;
  private readonly effects: Effects;
  private readonly observer: ResizeObserver;
  private layout: FieldLayout;
  private edge: EdgeInsets;
  private me: PlayerIndex;
  private battle: BattleState;
  private now = 0;
  private phase: SessionPhase;
  private readonly reducedMotion: boolean;
  private destroyed = false;
  private readonly a: Point = { x: 0, y: 0 };
  private readonly b: Point = { x: 0, y: 0 };

  private readonly app: Application;
  private readonly host: HTMLElement;
  private readonly session: GameSession;

  constructor(app: Application, host: HTMLElement, session: GameSession, edge: EdgeInsets) {
    this.edge = edge;
    this.app = app;
    this.host = host;
    this.session = session;
    const zones = new Container();
    const floor = new Container();
    const units = new Container();
    const fx = new Container();
    const numbers = new Container();
    this.world.addChild(this.backdrop, zones, floor, units, fx, numbers);
    this.world.interactiveChildren = false;
    app.stage.interactiveChildren = false;
    app.stage.addChild(this.world);

    this.figureTextures = new FigureTextures(app.renderer);
    this.effectTextures = createEffectTextures(app.renderer);
    this.effects = new Effects({ zones, fx, numbers }, this.effectTextures);
    this.views = new UnitViews(
      { floor, units },
      this.figureTextures,
      this.effectTextures.dot,
      this.effects,
    );

    this.me = session.getSnapshot().me;
    this.phase = session.getSnapshot().phase;
    this.reducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.battle = session.battle;
    this.layout = computeLayout(app.screen.width, app.screen.height, this.edge);
    this.relayout();

    const canvas = app.canvas;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    host.appendChild(canvas);

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    app.ticker.add(this.tick);

    if (import.meta.env.DEV) {
      (window as unknown as { __rrStats?: BattleRendererStats }).__rrStats = this.stats;
    }
  }

  // ---- layout -------------------------------------------------------------------------

  private resize(): void {
    if (this.destroyed) return;
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    if (w === this.app.screen.width && h === this.app.screen.height) return;
    this.app.renderer.resize(w, h);
    this.relayout();
  }

  setEdgeInsets(insets: EdgeInsets): void {
    if (this.destroyed) return;
    if (insets.top === this.edge.top && insets.bottom === this.edge.bottom) return;
    this.edge = insets;
    this.relayout();
  }

  private relayout(): void {
    this.layout = computeLayout(this.app.screen.width, this.app.screen.height, this.edge);
    this.views.setLayout(this.layout);
    this.effects.setLayout(this.layout);
    this.figureTextures.setPixelsPerUnit(
      UnitViews.pixelsPerUnit(this.layout.cell) * this.app.renderer.resolution,
    );
    this.backdrop.clear();
    drawBackdrop(this.backdrop, this.layout, this.me);
  }

  private resetField(): void {
    this.views.clear();
    this.effects.clear();
  }

  // ---- per frame ----------------------------------------------------------------------

  private readonly tick = (ticker: { deltaMS: number }): void => {
    if (this.destroyed) return;
    const t0 = performance.now();
    const dt = ticker.deltaMS;
    const frame = this.session.advance(dt);
    // A snapshot change inside `advance` can make React unmount the canvas synchronously.
    if (this.destroyed) return;
    this.now += dt;

    const snapshot = this.session.getSnapshot();
    if (snapshot.phase !== this.phase) {
      // Smoke over the middle of the field while the session is in its `intro` phase (D-045).
      if (snapshot.phase === 'intro') this.effects.introSmoke(this.reducedMotion);
      this.phase = snapshot.phase;
    }
    const me = snapshot.me;
    if (me !== this.me) {
      this.me = me;
      this.resetField();
      this.relayout();
    }
    const battle = this.session.battle;
    if (frame.fieldReset || battle !== this.battle) {
      this.battle = battle;
      this.resetField();
    }

    const events = frame.events;
    for (let i = 0; i < events.length; i++) this.handleEvent(events[i] as BattleEvent, battle);

    this.views.update(battle, this.me, this.layout, frame.alpha, dt, this.now);
    this.effects.update(battle, this.views, frame.alpha, dt, this.now);
    this.world.position.set(this.effects.shakeX, this.effects.shakeY);

    const ms = performance.now() - t0;
    const s = this.stats;
    s.frames++;
    s.updateMs += ms;
    if (ms > s.maxUpdateMs) s.maxUpdateMs = ms;
    s.units = this.views.count;
  };

  private handleEvent(e: BattleEvent, battle: BattleState): void {
    const cell = this.layout.cell;
    switch (e.type) {
      case 'attack':
        this.views.attack(e.unit, e.target);
        break;
      case 'shot': {
        this.views.attack(e.unit, e.target);
        const shooter = this.views.get(e.unit);
        if (shooter === undefined) break;
        const projectiles = battle.projectiles;
        for (let i = 0; i < projectiles.length; i++) {
          const p = projectiles[i];
          if (p === undefined || p.id !== e.id) continue;
          const target = this.views.get(e.target);
          this.effects.shot(
            e.id,
            shooter.card,
            shooter.sx,
            shooter.sy - shooter.lift,
            e.target,
            p.launchTick,
            e.impactTick,
            target?.sx ?? shooter.sx,
            target?.sy ?? shooter.sy,
          );
          break;
        }
        break;
      }
      case 'damage':
        this.views.damage(e.unit, e.amount, this.now);
        break;
      case 'heal': {
        this.views.attack(e.unit, e.target);
        const healer = this.views.get(e.unit);
        const target = this.views.get(e.target);
        if (healer === undefined || target === undefined) break;
        this.effects.healBeam(
          healer.sx,
          healer.sy - healer.lift - cell * 0.55,
          target.sx,
          target.sy - target.lift - cell * 0.5,
        );
        this.effects.number(target.sx, target.sy - target.topPx - target.lift, e.amount, 'heal');
        break;
      }
      case 'death': {
        const v = this.views.get(e.unit);
        if (v !== undefined) this.effects.dust(v.sx, v.sy);
        break;
      }
      case 'explosion': {
        fieldToScreen(this.layout, this.me, e.x, e.y, this.a);
        this.effects.explosion(this.a.x, this.a.y, (e.radius / 1000) * cell);
        break;
      }
      case 'jump': {
        fieldToScreen(this.layout, this.me, e.fromX, e.fromY, this.a);
        fieldToScreen(this.layout, this.me, e.x, e.y, this.b);
        this.effects.jumpSmoke(this.a.x, this.a.y, this.b.x, this.b.y);
        this.views.appear(e.unit);
        break;
      }
      case 'zone': {
        fieldToScreen(this.layout, this.me, e.x, e.y, this.a);
        this.effects.zone(e.id, this.a.x, this.a.y, (e.radius / 1000) * cell, e.endTick);
        break;
      }
    }
  }

  // ---- cleanup ------------------------------------------------------------------------

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.observer.disconnect();
    this.app.ticker.remove(this.tick);
    this.views.destroy();
    this.effects.destroy();
    this.figureTextures.destroy();
    this.app.destroy(DESTROY_RENDERER, { children: true });
    destroyEffectTextures(this.effectTextures);
  }
}
