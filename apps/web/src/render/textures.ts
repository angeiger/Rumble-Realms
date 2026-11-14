/**
 * Texture caches of the renderer (SPEC 15: sprites instead of per-frame Graphics).
 * Figures and team rings are drawn once per (card, team) with the shared drawing code of
 * `figures.ts` and then used as sprites. Effect textures are generated once.
 */
import type { CardId } from '@rumble-realms/engine';
import { Graphics, Rectangle, Texture, type Renderer } from 'pixi.js';
import { drawFigure, drawTeamRing, type Team } from './figures.ts';
import { PALETTE } from './palette.ts';

/** A texture plus where the unit's ground point lies in it (fractions of its size). */
export interface AnchoredTexture {
  texture: Texture;
  anchorX: number;
  anchorY: number;
}

/** Space around the drawing so that outlines are not cut off, in design units. */
const PAD = 3;
/** Textures never get smaller than this many pixels per design unit. */
const MIN_RES = 0.5;
const RES_STEP = 0.25;

/** Rounds up to a multiple of `RES_STEP`, so that small size changes reuse the textures. */
export function quantizeResolution(pxPerUnit: number): number {
  return Math.max(MIN_RES, Math.ceil(pxPerUnit / RES_STEP) * RES_STEP);
}

/** Figure and ring textures, generated lazily and at the resolution the screen needs. */
export class FigureTextures {
  private resolution = 0;
  /** Counts rebuilds; views compare it to know when to fetch their textures again. */
  generation = 0;
  private readonly figures = new Map<string, AnchoredTexture>();
  private readonly rings = new Map<Team, AnchoredTexture>();

  private readonly renderer: Renderer;

  constructor(renderer: Renderer) {
    this.renderer = renderer;
  }

  /** Device pixels per design unit that figures are displayed with. */
  setPixelsPerUnit(pxPerUnit: number): boolean {
    const res = quantizeResolution(pxPerUnit);
    if (res === this.resolution) return false;
    this.clear();
    this.resolution = res;
    this.generation++;
    return true;
  }

  figure(card: CardId, team: Team): AnchoredTexture {
    const key = `${card}:${team}`;
    let entry = this.figures.get(key);
    if (entry === undefined) {
      const g = new Graphics();
      drawFigure(g, card, team);
      entry = this.bake(g);
      this.figures.set(key, entry);
    }
    return entry;
  }

  ring(team: Team): AnchoredTexture {
    let entry = this.rings.get(team);
    if (entry === undefined) {
      const g = new Graphics();
      drawTeamRing(g, team);
      entry = this.bake(g);
      this.rings.set(team, entry);
    }
    return entry;
  }

  private bake(g: Graphics): AnchoredTexture {
    const b = g.getLocalBounds();
    const frame = new Rectangle(
      Math.floor(b.x - PAD),
      Math.floor(b.y - PAD),
      Math.ceil(b.width + 2 * PAD),
      Math.ceil(b.height + 2 * PAD),
    );
    const texture = this.renderer.generateTexture({
      target: g,
      frame,
      resolution: this.resolution,
      antialias: true,
    });
    g.destroy();
    return {
      texture,
      anchorX: -frame.x / frame.width,
      anchorY: -frame.y / frame.height,
    };
  }

  private clear(): void {
    for (const e of this.figures.values()) e.texture.destroy(true);
    for (const e of this.rings.values()) e.texture.destroy(true);
    this.figures.clear();
    this.rings.clear();
  }

  destroy(): void {
    this.clear();
  }
}

function canvasTexture(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('2D canvas is not available');
  draw(ctx);
  return Texture.from(canvas);
}

/** Textures of the effects, all white (tinted when used) unless noted. */
export interface EffectTextures {
  /** Soft round glow, 64 px, white. */
  dot: Texture;
  /** Thin ring, 128 px, white. */
  ring: Texture;
  /** Horizontal beam with soft ends (anchored left-centre when used), 64 x 16 px, white. */
  beam: Texture;
  /** Four-pointed spark, 32 px, white. */
  spark: Texture;
  /** Arrow pointing right, drawn in design units of 44 x 12. */
  arrow: Texture;
  /** Musket ball, design size 14 x 14. */
  bullet: Texture;
  /** 4 x 4 white square. */
  pixel: Texture;
}

export const ARROW_SIZE = { w: 44, h: 12 } as const;
export const BULLET_SIZE = 14;

export function createEffectTextures(renderer: Renderer): EffectTextures {
  const dot = canvasTexture(64, 64, (c) => {
    const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.65)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 64, 64);
  });
  const ring = canvasTexture(128, 128, (c) => {
    const g = c.createRadialGradient(64, 64, 40, 64, 64, 62);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.8, 'rgba(255,255,255,0.7)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 128);
  });
  const beam = canvasTexture(64, 16, (c) => {
    const g = c.createLinearGradient(0, 0, 0, 16);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 64, 16);
  });
  const spark = canvasTexture(32, 32, (c) => {
    c.fillStyle = '#fff';
    c.beginPath();
    c.moveTo(16, 0);
    c.quadraticCurveTo(18, 14, 32, 16);
    c.quadraticCurveTo(18, 18, 16, 32);
    c.quadraticCurveTo(14, 18, 0, 16);
    c.quadraticCurveTo(14, 14, 16, 0);
    c.fill();
  });
  const pixel = canvasTexture(4, 4, (c) => {
    c.fillStyle = '#fff';
    c.fillRect(0, 0, 4, 4);
  });

  const a = new Graphics();
  // Shaft, head and fletching; tip at the right edge, centre line at y = 0.
  a.moveTo(-20, 0).lineTo(14, 0).stroke({ color: PALETTE.outline, width: 6, cap: 'round' });
  a.moveTo(-20, 0).lineTo(14, 0).stroke({ color: PALETTE.wood, width: 3, cap: 'round' });
  a.poly([12, -5, 22, 0, 12, 5])
    .fill(PALETTE.steel)
    .stroke({ color: PALETTE.outline, width: 2.5, join: 'round' });
  a.poly([-22, -5, -14, 0, -22, 5, -18, 0])
    .fill(PALETTE.cream)
    .stroke({ color: PALETTE.outline, width: 2, join: 'round' });
  const arrow = renderer.generateTexture({
    target: a,
    frame: new Rectangle(-ARROW_SIZE.w / 2, -ARROW_SIZE.h / 2, ARROW_SIZE.w, ARROW_SIZE.h),
    resolution: 3,
    antialias: true,
  });
  a.destroy();

  const b = new Graphics();
  b.circle(0, 0, 5).fill(PALETTE.grayDark).stroke({ color: PALETTE.outline, width: 2.5 });
  b.circle(-1.5, -1.5, 1.6).fill(PALETTE.steel);
  const bullet = renderer.generateTexture({
    target: b,
    frame: new Rectangle(-BULLET_SIZE / 2, -BULLET_SIZE / 2, BULLET_SIZE, BULLET_SIZE),
    resolution: 3,
    antialias: true,
  });
  b.destroy();

  return { dot, ring, beam, spark, arrow, bullet, pixel };
}

export function destroyEffectTextures(t: EffectTextures): void {
  for (const tex of Object.values(t)) tex.destroy(true);
}
