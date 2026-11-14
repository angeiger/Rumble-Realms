/**
 * Renders a unit figure once into an image (for cards, dialogs, ...) so that the UI does
 * not need its own WebGL canvas. Results are cached per (card, team). Without WebGL or
 * DOM (tests, SSR) the promise resolves to an empty string and the UI shows a placeholder.
 */
import type { CardId } from '@rumble-realms/engine';
import { Application, Graphics } from 'pixi.js';
import { drawFigure, FIGURE_BOX, type Team } from './figures.ts';

/** Pixels per design unit of the rendered image. */
const IMAGE_SCALE = 3;

const cache = new Map<string, Promise<string>>();
/** Renders run one after the other so that at most one extra WebGL context exists. */
let queue: Promise<unknown> = Promise.resolve();

async function renderFigure(card: CardId, team: Team): Promise<string> {
  if (typeof document === 'undefined') return '';
  const width = (FIGURE_BOX.right - FIGURE_BOX.left) * IMAGE_SCALE;
  const height = (FIGURE_BOX.bottom - FIGURE_BOX.top) * IMAGE_SCALE;
  const app = new Application();
  try {
    await app.init({
      width,
      height,
      backgroundAlpha: 0,
      antialias: true,
      resolution: 1,
      preference: 'webgl',
    });
    const g = new Graphics();
    drawFigure(g, card, team);
    g.scale.set(IMAGE_SCALE);
    g.position.set(-FIGURE_BOX.left * IMAGE_SCALE, -FIGURE_BOX.top * IMAGE_SCALE);
    app.stage.addChild(g);
    app.render();
    return await app.renderer.extract.base64({ target: app.stage, resolution: 1 });
  } catch {
    return '';
  } finally {
    try {
      app.destroy(true, { children: true });
    } catch {
      // The renderer never came up; nothing to release.
    }
  }
}

/** Data URL (PNG) of the standing figure without team ring, or '' if it cannot be drawn. */
export function getFigureImage(card: CardId, team: Team): Promise<string> {
  const key = `${card}:${team}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const result = queue.then(() => renderFigure(card, team));
  queue = result.catch(() => undefined);
  cache.set(key, result);
  return result;
}

/** Renders all figures of `cards` in the background so that cards show them instantly. */
export function preloadFigures(cards: readonly CardId[], team: Team = 'own'): void {
  for (const card of cards) void getFigureImage(card, team);
}
