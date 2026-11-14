/**
 * Renders a unit figure once into an image (for cards, dialogs, ...) so that the UI does
 * not need its own WebGL canvas. Results are cached per (card, team). Without WebGL or
 * DOM (tests, SSR) the promise resolves to an empty string and the UI shows a placeholder.
 */
import type { CardId } from '@rumble-realms/engine';
import { Application, Graphics } from 'pixi.js';
import { DESTROY_RENDERER } from './destroy.ts';
import { drawFigure, FIGURE_BOX, type Team } from './figures.ts';

/** Pixels per design unit of the rendered image. */
const IMAGE_SCALE = 3;

const cache = new Map<string, Promise<string>>();
/** Renders run one after the other on one shared, short-lived renderer. */
let queue: Promise<unknown> = Promise.resolve();
let pending = 0;
let shared: Application | null = null;

async function sharedApp(): Promise<Application> {
  if (shared !== null) return shared;
  const app = new Application();
  await app.init({
    width: (FIGURE_BOX.right - FIGURE_BOX.left) * IMAGE_SCALE,
    height: (FIGURE_BOX.bottom - FIGURE_BOX.top) * IMAGE_SCALE,
    backgroundAlpha: 0,
    antialias: true,
    resolution: 1,
    preference: 'webgl',
  });
  shared = app;
  return app;
}

/** Frees the extra WebGL context once nothing is left to draw. */
function releaseSharedApp(): void {
  const app = shared;
  shared = null;
  if (app === null) return;
  try {
    app.destroy(DESTROY_RENDERER, { children: true });
  } catch {
    // Already gone; nothing to release.
  }
}

async function renderFigure(card: CardId, team: Team): Promise<string> {
  if (typeof document === 'undefined') return '';
  try {
    const app = await sharedApp();
    const g = new Graphics();
    drawFigure(g, card, team);
    g.scale.set(IMAGE_SCALE);
    g.position.set(-FIGURE_BOX.left * IMAGE_SCALE, -FIGURE_BOX.top * IMAGE_SCALE);
    app.stage.addChild(g);
    try {
      app.render();
      return await app.renderer.extract.base64({ target: app.stage, resolution: 1 });
    } finally {
      app.stage.removeChild(g);
      g.destroy();
    }
  } catch {
    return '';
  }
}

/** Data URL (PNG) of the standing figure without team ring, or '' if it cannot be drawn. */
export function getFigureImage(card: CardId, team: Team): Promise<string> {
  const key = `${card}:${team}`;
  const hit = cache.get(key);
  if (hit) return hit;
  pending++;
  const result = queue
    .then(() => renderFigure(card, team))
    .finally(() => {
      pending--;
      if (pending === 0) releaseSharedApp();
    });
  queue = result.catch(() => undefined);
  cache.set(key, result);
  return result;
}

/** Renders all figures of `cards` in the background so that cards show them instantly. */
export function preloadFigures(cards: readonly CardId[], team: Team = 'own'): void {
  for (const card of cards) void getFigureImage(card, team);
}
