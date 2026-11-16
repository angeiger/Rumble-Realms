/**
 * Texture caches of the renderer (SPEC 15: sprites instead of per-frame Graphics).
 * Figures and team rings are drawn once per (card, team) with the shared drawing code of
 * `figures.ts` and then used as sprites. Effect textures are generated once.
 */
import { Graphics, Rectangle, Texture, type Renderer } from 'pixi.js';
import { drawFigure, drawTeamRing, type FigureId, type Team } from './figures.ts';
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

  figure(card: FigureId, team: Team): AnchoredTexture {
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
  /** Acid shell of the beetle, design size 14 x 14, green. */
  shell: Texture;
  /** Small comic flame (orange with yellow core and outline), 48 x 64 px, anchor bottom-centre. */
  flame: Texture;
  /** Snowflake, 64 px, white (tinted when used). */
  snow: Texture;
  /** Translucent ice block with outline and highlights, 64 x 80 px. */
  ice: Texture;
  /** Soap bubble: white rim, faint fill, 32 px (tinted when used). */
  bubble: Texture;
  /** Big translucent shield bubble with a bright rim, 128 px (tinted when used). */
  shield: Texture;
  /** Red up arrow with outline (damage bonus), 32 x 40 px. */
  arrowUp: Texture;
  /** 90 degree wedge with its apex at the left-centre, 128 x 256 px, fading out (flame cone). */
  cone: Texture;
  /** Irregular flat puddle blob with a darker rim, 128 x 128 px, white (tinted when used). */
  puddle: Texture;
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

  const flame = canvasTexture(48, 64, (c) => {
    const path = () => {
      c.beginPath();
      c.moveTo(24, 4);
      c.bezierCurveTo(30, 22, 44, 30, 40, 46);
      c.bezierCurveTo(38, 60, 10, 60, 8, 46);
      c.bezierCurveTo(6, 36, 16, 32, 18, 20);
      c.bezierCurveTo(20, 26, 22, 22, 24, 4);
      c.closePath();
    };
    path();
    c.fillStyle = '#ff9d1c';
    c.fill();
    c.lineWidth = 4;
    c.lineJoin = 'round';
    c.strokeStyle = '#14172e';
    c.stroke();
    c.save();
    c.translate(24, 52);
    c.scale(0.5, 0.5);
    c.translate(-24, -52);
    path();
    c.fillStyle = '#ffee6a';
    c.fill();
    c.restore();
  });
  const snow = canvasTexture(64, 64, (c) => {
    const arms = (color: string, width: number) => {
      c.strokeStyle = color;
      c.lineWidth = width;
      c.lineCap = 'round';
      for (let i = 0; i < 6; i++) {
        c.save();
        c.translate(32, 32);
        c.rotate((i * Math.PI) / 3);
        c.beginPath();
        c.moveTo(0, 0);
        c.lineTo(0, -26);
        c.moveTo(0, -15);
        c.lineTo(-7, -22);
        c.moveTo(0, -15);
        c.lineTo(7, -22);
        c.stroke();
        c.restore();
      }
    };
    arms('#14172e', 9);
    arms('#ffffff', 5);
  });
  const ice = canvasTexture(64, 80, (c) => {
    const r = 12;
    c.beginPath();
    c.moveTo(6 + r, 4);
    c.lineTo(58 - r, 4);
    c.quadraticCurveTo(58, 4, 58, 4 + r);
    c.lineTo(58, 76 - r);
    c.quadraticCurveTo(58, 76, 58 - r, 76);
    c.lineTo(6 + r, 76);
    c.quadraticCurveTo(6, 76, 6, 76 - r);
    c.lineTo(6, 4 + r);
    c.quadraticCurveTo(6, 4, 6 + r, 4);
    c.closePath();
    c.fillStyle = 'rgba(143,227,255,0.5)';
    c.fill();
    c.lineWidth = 4;
    c.lineJoin = 'round';
    c.strokeStyle = '#14172e';
    c.stroke();
    c.strokeStyle = 'rgba(255,255,255,0.85)';
    c.lineWidth = 4;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(16, 14);
    c.lineTo(16, 40);
    c.moveTo(24, 12);
    c.lineTo(36, 12);
    c.stroke();
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(44, 60);
    c.lineTo(52, 50);
    c.stroke();
  });
  const bubble = canvasTexture(32, 32, (c) => {
    c.beginPath();
    c.arc(16, 16, 12, 0, Math.PI * 2);
    c.fillStyle = 'rgba(255,255,255,0.3)';
    c.fill();
    c.lineWidth = 3;
    c.strokeStyle = 'rgba(255,255,255,1)';
    c.stroke();
    c.beginPath();
    c.arc(16, 16, 7, Math.PI * 1.1, Math.PI * 1.55);
    c.lineWidth = 2.5;
    c.lineCap = 'round';
    c.stroke();
  });
  const shield = canvasTexture(128, 128, (c) => {
    const g = c.createRadialGradient(64, 64, 22, 64, 64, 60);
    g.addColorStop(0, 'rgba(255,255,255,0.04)');
    g.addColorStop(0.8, 'rgba(255,255,255,0.32)');
    g.addColorStop(1, 'rgba(255,255,255,0.5)');
    c.beginPath();
    c.arc(64, 64, 58, 0, Math.PI * 2);
    c.fillStyle = g;
    c.fill();
    c.lineWidth = 5;
    c.strokeStyle = 'rgba(255,255,255,1)';
    c.stroke();
    c.beginPath();
    c.arc(64, 64, 44, Math.PI * 1.05, Math.PI * 1.45);
    c.lineWidth = 6;
    c.lineCap = 'round';
    c.stroke();
  });
  const arrowUp = canvasTexture(32, 40, (c) => {
    c.beginPath();
    c.moveTo(16, 3);
    c.lineTo(29, 19);
    c.lineTo(21, 19);
    c.lineTo(21, 37);
    c.lineTo(11, 37);
    c.lineTo(11, 19);
    c.lineTo(3, 19);
    c.closePath();
    c.fillStyle = '#e23d3d';
    c.fill();
    c.lineWidth = 3;
    c.lineJoin = 'round';
    c.strokeStyle = '#14172e';
    c.stroke();
  });
  const cone = canvasTexture(128, 256, (c) => {
    const g = c.createRadialGradient(0, 128, 0, 0, 128, 128);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(0, 128);
    c.arc(0, 128, 128, -Math.PI / 4, Math.PI / 4);
    c.closePath();
    c.fill();
  });
  const puddle = canvasTexture(128, 128, (c) => {
    c.beginPath();
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const r = 56 * (1 + 0.07 * Math.sin(a * 5 + 0.6) + 0.04 * Math.sin(a * 3));
      const x = 64 + Math.cos(a) * r;
      const y = 64 + Math.sin(a) * r;
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.closePath();
    c.fillStyle = '#ffffff';
    c.fill();
    c.lineWidth = 6;
    c.lineJoin = 'round';
    c.strokeStyle = 'rgba(0,0,0,0.28)';
    c.stroke();
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

  const sh = new Graphics();
  sh.circle(0, 0, 6).fill(0x8fd12a).stroke({ color: PALETTE.outline, width: 2.5 });
  sh.circle(-2, -2, 2).fill(0xe4ff7a);
  const shell = renderer.generateTexture({
    target: sh,
    frame: new Rectangle(-BULLET_SIZE / 2, -BULLET_SIZE / 2, BULLET_SIZE, BULLET_SIZE),
    resolution: 3,
    antialias: true,
  });
  sh.destroy();

  return {
    dot,
    ring,
    beam,
    spark,
    arrow,
    bullet,
    pixel,
    shell,
    flame,
    snow,
    ice,
    bubble,
    shield,
    arrowUp,
    cone,
    puddle,
  };
}

export function destroyEffectTextures(t: EffectTextures): void {
  for (const tex of Object.values(t)) tex.destroy(true);
}
