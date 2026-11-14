/** Harness /?harness=figures: all figures in both team colours, large and in game size. */
import type { CardId } from '@rumble-realms/engine';
import { Application, Container, Graphics } from 'pixi.js';
import { drawFigure, drawTeamRing, type Team } from '../figures.ts';
import { PALETTE } from '../palette.ts';

const CARDS: CardId[] = [
  'archer',
  'knight',
  'tnt',
  'skeleton',
  'healer',
  'musketeer',
  'bat',
  'assassin',
  'berserker',
  'shroomling',
];
const TEAMS: Team[] = ['own', 'enemy'];

const BIG_SCALE = 1.5;
const BIG_COLS = 5;
const BIG_CELL_W = 170;
const BIG_CELL_H = 190;
/** Design units to pixels so that a ~80-unit figure is ~36 px high. */
const SMALL_SCALE = 0.45;
const SMALL_CELL_W = 86;
const SMALL_CELL_H = 80;

function label(root: HTMLElement, text: string, x: number, y: number, width: number): void {
  const el = document.createElement('div');
  el.textContent = text;
  el.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${width}px;text-align:center;font:600 12px system-ui,sans-serif;color:#fff6d6;pointer-events:none;`;
  root.appendChild(el);
}

function placeFigure(
  stage: Container,
  card: CardId,
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
  root.style.cssText = 'position:relative;width:900px;height:1400px;overflow:hidden;';
  document.body.style.overflow = 'auto';
  const app = new Application();
  await app.init({ width: 900, height: 1400, background: PALETTE.grayDark, antialias: true });
  root.appendChild(app.canvas);

  const offX = (900 - BIG_COLS * BIG_CELL_W) / 2;
  let y = 10;
  label(root, 'Large (scale 1.5, with ring)', 0, y, 900);
  y += 24;
  for (const team of TEAMS) {
    for (let i = 0; i < CARDS.length; i++) {
      const col = i % BIG_COLS;
      const row = Math.floor(i / BIG_COLS);
      const cx = offX + col * BIG_CELL_W + BIG_CELL_W / 2;
      const cy = y + row * BIG_CELL_H;
      const card = CARDS[i] as CardId;
      placeFigure(app.stage, card, team, cx, cy + 150, BIG_SCALE);
      label(root, `${card} (${team})`, cx - BIG_CELL_W / 2, cy + 172, BIG_CELL_W);
    }
    y += 2 * BIG_CELL_H + 10;
  }

  label(root, `Game size (scale ${SMALL_SCALE}) on field`, 0, y, 900);
  y += 24;
  const field = new Graphics();
  field.rect(0, y, 900, TEAMS.length * SMALL_CELL_H + 70).fill(PALETTE.fieldGreen);
  for (let i = 0; i < CARDS.length; i++) {
    if (i % 2 === 0) {
      field
        .rect(
          i * SMALL_CELL_W + (900 - CARDS.length * SMALL_CELL_W) / 2,
          y,
          SMALL_CELL_W,
          2 * SMALL_CELL_H + 70,
        )
        .fill(PALETTE.fieldGreenDark);
    }
  }
  app.stage.addChild(field);
  const smallOffX = (900 - CARDS.length * SMALL_CELL_W) / 2;
  TEAMS.forEach((team, r) => {
    CARDS.forEach((card, i) => {
      const cx = smallOffX + i * SMALL_CELL_W + SMALL_CELL_W / 2;
      const cy = y + 14 + r * SMALL_CELL_H;
      placeFigure(app.stage, card, team, cx, cy + 50, SMALL_SCALE);
    });
  });
  CARDS.forEach((card, i) => {
    label(root, card, smallOffX + i * SMALL_CELL_W, y + 2 * SMALL_CELL_H + 40, SMALL_CELL_W);
  });
}
