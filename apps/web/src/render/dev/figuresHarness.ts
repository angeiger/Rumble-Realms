/** Harness /?harness=figures: all figures in both team colours, large and in game size. */
import { Application, Container, Graphics } from 'pixi.js';
import { drawFigure, drawTeamRing, FIGURE_IDS, type FigureId, type Team } from '../figures.ts';
import { PALETTE } from '../palette.ts';

const TEAMS: Team[] = ['own', 'enemy'];
const WIDTH = 900;

const BIG_SCALE = 1.5;
const BIG_COLS = 5;
const BIG_CELL_W = 170;
const BIG_CELL_H = 190;
/** Design units to pixels so that a ~80-unit figure is ~36 px high. */
const SMALL_SCALE = 0.45;
const SMALL_COLS = 10;
const SMALL_CELL_W = 86;
const SMALL_CELL_H = 72;

function label(
  root: HTMLElement,
  text: string,
  x: number,
  y: number,
  width: number,
  size = 12,
): void {
  const el = document.createElement('div');
  el.textContent = text;
  el.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${width}px;text-align:center;font:600 ${size}px system-ui,sans-serif;color:#fff6d6;pointer-events:none;`;
  root.appendChild(el);
}

function placeFigure(
  stage: Container,
  card: FigureId,
  team: Team,
  x: number,
  y: number,
  scale: number,
): void {
  const holder = new Container();
  holder.position.set(x, y);
  holder.scale.set(scale);
  const ring = new Graphics();
  drawTeamRing(ring, team);
  const fig = new Graphics();
  drawFigure(fig, card, team);
  holder.addChild(ring, fig);
  stage.addChild(holder);
}

export async function mountFiguresHarness(root: HTMLElement): Promise<void> {
  const ids = FIGURE_IDS;
  const bigRows = Math.ceil(ids.length / BIG_COLS);
  const smallRows = Math.ceil(ids.length / SMALL_COLS);
  const height =
    24 +
    TEAMS.length * (bigRows * BIG_CELL_H + 10) +
    24 +
    TEAMS.length * smallRows * SMALL_CELL_H +
    40;
  root.style.cssText = `position:relative;width:${WIDTH}px;height:${height}px;overflow:hidden;`;
  document.body.style.overflow = 'auto';
  const app = new Application();
  await app.init({ width: WIDTH, height, background: PALETTE.grayDark, antialias: true });
  root.appendChild(app.canvas);

  const offX = (WIDTH - BIG_COLS * BIG_CELL_W) / 2;
  let y = 10;
  label(root, 'Large (scale 1.5, with ring)', 0, y, WIDTH);
  y += 24;
  for (const team of TEAMS) {
    ids.forEach((card, i) => {
      const cx = offX + (i % BIG_COLS) * BIG_CELL_W + BIG_CELL_W / 2;
      const cy = y + Math.floor(i / BIG_COLS) * BIG_CELL_H;
      placeFigure(app.stage, card, team, cx, cy + 150, BIG_SCALE);
      label(root, `${card} (${team})`, cx - BIG_CELL_W / 2, cy + 172, BIG_CELL_W);
    });
    y += bigRows * BIG_CELL_H + 10;
  }

  label(root, `Game size (scale ${SMALL_SCALE}) on field`, 0, y, WIDTH);
  y += 24;
  const fieldH = TEAMS.length * smallRows * SMALL_CELL_H + 10;
  const smallOffX = (WIDTH - SMALL_COLS * SMALL_CELL_W) / 2;
  const field = new Graphics();
  field.rect(0, y, WIDTH, fieldH).fill(PALETTE.fieldGreen);
  for (let c = 0; c < SMALL_COLS; c += 2) {
    field.rect(smallOffX + c * SMALL_CELL_W, y, SMALL_CELL_W, fieldH).fill(PALETTE.fieldGreenDark);
  }
  app.stage.addChild(field);
  let row = 0;
  for (const team of TEAMS) {
    for (let r = 0; r < smallRows; r++, row++) {
      const top = y + 4 + row * SMALL_CELL_H;
      ids.slice(r * SMALL_COLS, (r + 1) * SMALL_COLS).forEach((card, c) => {
        const cx = smallOffX + c * SMALL_CELL_W + SMALL_CELL_W / 2;
        placeFigure(app.stage, card, team, cx, top + 46, SMALL_SCALE);
        if (team === 'own') label(root, card, cx - SMALL_CELL_W / 2, top + 52, SMALL_CELL_W, 10);
      });
    }
  }
}
