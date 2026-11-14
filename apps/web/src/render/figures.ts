/**
 * Placeholder vector figures of the units (SPEC 11): comic style with thick dark
 * outlines, saturated colours and chibi proportions. All figures are static (D-037):
 * only Graphics calls, no state, no animation.
 */
import type { CardId } from '@rumble-realms/engine';
import type { Graphics } from 'pixi.js';
import { PALETTE as P, type TeamColors } from './palette.ts';

export type Team = 'own' | 'enemy';

/**
 * Drawing area in design units. (0, 0) is the centre of the unit's cell, where the
 * figure stands; the figure extends upwards (negative y).
 */
export const FIGURE_BOX = { left: -50, right: 50, top: -95, bottom: 15 } as const;

/** Outline width in design units. */
const OW = 6;

type Pts = number[];
type Build = (g: Graphics) => void;

function teamColors(team: Team): TeamColors {
  return team === 'own' ? P.teamOwn : P.teamEnemy;
}

/** Fills and outlines the path that was just built. */
function done(g: Graphics, color: number, width: number = OW): void {
  g.fill(color).stroke({ color: P.outline, width, join: 'round', cap: 'round' });
}

/** Thick outlined stroke (shaft, limb); `build` creates the path and is called twice. */
function bar(g: Graphics, build: Build, color: number, width: number): void {
  build(g);
  g.stroke({ color: P.outline, width: width + OW, join: 'round', cap: 'round' });
  build(g);
  g.stroke({ color, width, join: 'round', cap: 'round' });
}

function seg(
  g: Graphics,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: number,
  w: number,
) {
  bar(g, (h) => h.moveTo(x1, y1).lineTo(x2, y2), color, w);
}

function mirror(pts: Pts): Pts {
  return pts.map((v, i) => (i % 2 === 0 ? -v : v));
}

function foot(g: Graphics, x: number, color: number = P.leather, rx = 10): void {
  g.ellipse(x, -3, rx, 6);
  done(g, color);
}

function eye(g: Graphics, x: number, y: number, r = 5): void {
  g.ellipse(x, y, r, r * 1.2).fill(P.white);
  g.circle(x + r * 0.2, y + r * 0.3, r * 0.6).fill(P.outline);
}

function brow(g: Graphics, x1: number, y1: number, x2: number, y2: number): void {
  g.moveTo(x1, y1).lineTo(x2, y2).stroke({ color: P.outline, width: 4, cap: 'round' });
}

function star(cx: number, cy: number, outer: number, inner: number, n: number): Pts {
  const pts: Pts = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI * i) / n - Math.PI / 2;
    pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  return pts;
}

function drawArcher(g: Graphics, t: TeamColors): void {
  foot(g, -8);
  foot(g, 8);
  // Hood tip behind the head.
  g.poly([-4, -74, 14, -91, 20, -68]);
  done(g, t.main);
  // Tunic.
  g.roundRect(-15, -36, 30, 30, 10);
  done(g, t.main);
  g.rect(-13, -21, 26, 6).fill(P.leather);
  // Hood and face.
  g.circle(0, -56, 23);
  done(g, t.main);
  g.ellipse(0, -52, 14, 12);
  done(g, P.skin, 4);
  eye(g, -5, -52, 3.5);
  eye(g, 5, -52, 3.5);
  // Bow arm and bow.
  seg(g, 12, -28, 38, -44, t.dark, 8);
  bar(g, (h) => h.moveTo(22, -86).quadraticCurveTo(64, -46, 22, -6), P.wood, 6);
  g.moveTo(22, -86).lineTo(22, -6).stroke({ color: P.cream, width: 2.5 });
  g.circle(40, -44, 6);
  done(g, P.skin, 4);
}

function drawKnight(g: Graphics, t: TeamColors): void {
  foot(g, -9, P.steelDark);
  foot(g, 9, P.steelDark);
  g.roundRect(-17, -36, 34, 30, 8);
  done(g, t.main);
  g.rect(-15, -20, 30, 6).fill(P.leather);
  // Plume, helmet, visor.
  g.ellipse(0, -80, 8, 11);
  done(g, t.main);
  g.circle(0, -56, 22);
  done(g, P.steel);
  g.roundRect(-14, -60, 28, 8, 3).fill(P.outline);
  // Shield.
  g.poly([-46, -52, -16, -52, -16, -28, -31, -9, -46, -28]);
  done(g, P.steel);
  g.poly([-40, -47, -22, -47, -22, -30, -31, -17, -40, -30]).fill(t.main);
  // Sword.
  g.poly([24, -38, 34, -38, 34, -80, 29, -90, 24, -80]);
  done(g, P.steel);
  g.roundRect(18, -42, 22, 7, 2);
  done(g, P.gold, 4);
  g.circle(29, -31, 6);
  done(g, P.steelDark, 4);
}

function drawTnt(g: Graphics, t: TeamColors): void {
  foot(g, -12);
  foot(g, 12);
  // Fuse and spark.
  bar(g, (h) => h.moveTo(0, -60).quadraticCurveTo(-8, -72, 8, -78), P.woodDark, 4);
  g.poly(star(8, -80, 11, 5, 5));
  done(g, P.fire, 4);
  g.circle(8, -80, 3.5).fill(P.fireLight);
  // Crate.
  g.roundRect(-14, -64, 28, 10, 3);
  done(g, P.leather, 4);
  g.roundRect(-27, -56, 54, 48, 8);
  done(g, t.main);
  g.rect(-24, -49, 48, 7).fill(P.gold);
  g.rect(-24, -22, 48, 7).fill(P.gold);
  // Face between the bands.
  eye(g, -9, -34, 4.5);
  eye(g, 9, -34, 4.5);
  brow(g, -15, -42, -4, -39);
  brow(g, 15, -42, 4, -39);
  g.ellipse(0, -25, 5, 2.5).fill(P.outline);
}

function drawSkeleton(g: Graphics, t: TeamColors): void {
  seg(g, -6, -22, -7, -6, P.bone, 5);
  seg(g, 6, -22, 7, -6, P.bone, 5);
  foot(g, -7, P.bone, 8);
  foot(g, 7, P.bone, 8);
  // Club.
  seg(g, 22, -26, 33, -66, P.bone, 6);
  g.circle(35, -74, 11);
  done(g, P.bone);
  // Ribcage with tattered tunic.
  g.roundRect(-14, -37, 28, 22, 6);
  done(g, t.main);
  g.moveTo(0, -35).lineTo(0, -17).stroke({ color: P.boneDark, width: 4, cap: 'round' });
  seg(g, 12, -30, 24, -27, P.bone, 5);
  // Skull.
  g.circle(0, -54, 21);
  done(g, P.bone);
  g.roundRect(-11, -42, 22, 11, 3);
  done(g, P.bone, 4);
  g.ellipse(-8, -56, 6.5, 7.5).fill(P.outline);
  g.ellipse(8, -56, 6.5, 7.5).fill(P.outline);
  g.circle(-8, -55, 2.6).fill(t.light);
  g.circle(8, -55, 2.6).fill(t.light);
  g.poly([-3, -47, 3, -47, 0, -52]).fill(P.outline);
  for (const x of [-5, 0, 5]) {
    g.moveTo(x, -41).lineTo(x, -33).stroke({ color: P.outline, width: 2.5 });
  }
  // Headband.
  g.roundRect(-17, -72, 34, 7, 3);
  done(g, t.main, 4);
}

function drawHealer(g: Graphics, t: TeamColors): void {
  foot(g, -9, P.cream);
  foot(g, 9, P.cream);
  // Staff with glowing cross.
  seg(g, 33, -4, 33, -66, P.wood, 5);
  g.circle(33, -78, 12);
  done(g, 0xc9ffd8, 5);
  const c = 2.8;
  const l = 8;
  g.poly([
    33 - c,
    -78 - l,
    33 + c,
    -78 - l,
    33 + c,
    -78 - c,
    33 + l,
    -78 - c,
    33 + l,
    -78 + c,
    33 + c,
    -78 + c,
    33 + c,
    -78 + l,
    33 - c,
    -78 + l,
    33 - c,
    -78 + c,
    33 - l,
    -78 + c,
    33 - l,
    -78 - c,
    33 - c,
    -78 - c,
  ]).fill(P.green);
  // Robe.
  g.poly([-14, -42, 14, -42, 27, -5, -27, -5]);
  done(g, t.main);
  g.poly([-26, -5, 26, -5, 24, -13, -24, -13]).fill(P.cream);
  g.ellipse(0, -41, 13, 6);
  done(g, P.cream, 4);
  g.circle(33, -34, 6);
  done(g, P.skin, 4);
  // Head, hood and halo.
  g.ellipse(0, -83, 14, 5);
  g.stroke({ color: P.outline, width: 10 });
  g.ellipse(0, -83, 14, 5);
  g.stroke({ color: P.gold, width: 4 });
  g.circle(0, -56, 23);
  done(g, P.cream);
  g.ellipse(0, -53, 15, 13);
  done(g, P.skin, 4);
  eye(g, -5.5, -53, 3.5);
  eye(g, 5.5, -53, 3.5);
  g.ellipse(-10, -47, 3, 2).fill({ color: P.red, alpha: 0.5 });
  g.ellipse(10, -47, 3, 2).fill({ color: P.red, alpha: 0.5 });
}

function drawMusketeer(g: Graphics, t: TeamColors): void {
  foot(g, -9, P.woodDark);
  foot(g, 9, P.woodDark);
  g.roundRect(-16, -36, 32, 30, 8);
  done(g, t.main);
  g.poly([-14, -34, -6, -34, 14, -10, 6, -10]).fill(P.cream);
  g.circle(0, -26, 2.5).fill(P.gold);
  g.circle(0, -17, 2.5).fill(P.gold);
  // Head with moustache.
  g.circle(0, -48, 19);
  done(g, P.skin);
  eye(g, -6, -47, 3.5);
  eye(g, 6, -47, 3.5);
  g.ellipse(-5, -39, 5, 3).fill(P.hair);
  g.ellipse(5, -39, 5, 3).fill(P.hair);
  // Feather, hat.
  g.moveTo(12, -80)
    .quadraticCurveTo(30, -94, 44, -78)
    .quadraticCurveTo(30, -84, 12, -74)
    .closePath();
  done(g, P.white, 4);
  g.roundRect(-17, -88, 34, 26, 8);
  done(g, t.main);
  g.rect(-15, -78, 30, 6).fill(P.gold);
  g.ellipse(0, -63, 35, 8);
  done(g, t.dark);
  // Musket.
  seg(g, -32, -10, -6, -26, P.wood, 9);
  seg(g, -6, -26, 44, -60, P.steelDark, 4);
  g.circle(18, -43, 5.5);
  done(g, P.skin, 4);
}

function drawBat(g: Graphics, t: TeamColors): void {
  g.ellipse(0, 0, 24, 7).fill({ color: P.outline, alpha: 0.25 });
  const wing = [
    -8, -58, -24, -74, -46, -76, -38, -60, -47, -44, -33, -47, -33, -28, -17, -40, -8, -40,
  ];
  for (const pts of [wing, mirror(wing)]) {
    g.poly(pts);
    done(g, t.main);
  }
  for (const s of [-1, 1]) {
    g.moveTo(s * 10, -50)
      .lineTo(s * 40, -68)
      .stroke({ color: t.dark, width: 3, cap: 'round' });
    g.moveTo(s * 10, -46)
      .lineTo(s * 38, -46)
      .stroke({ color: t.dark, width: 3, cap: 'round' });
    g.moveTo(s * 10, -42)
      .lineTo(s * 30, -32)
      .stroke({ color: t.dark, width: 3, cap: 'round' });
  }
  g.ellipse(0, -30, 10, 9);
  done(g, P.purple);
  // Ears.
  for (const s of [-1, 1]) {
    g.poly([s * 18, -62, s * 12, -88, s * 2, -68]);
    done(g, P.purple);
    g.poly([s * 13, -66, s * 11, -80, s * 6, -68]).fill(t.light);
  }
  g.circle(0, -52, 20);
  done(g, P.purple);
  g.ellipse(0, -46, 11, 8).fill(P.purpleLight);
  eye(g, -8, -55, 6);
  eye(g, 8, -55, 6);
  g.ellipse(0, -44, 7, 4).fill(P.outline);
  g.poly([-5, -45, -2, -45, -3.5, -39]).fill(P.white);
  g.poly([5, -45, 2, -45, 3.5, -39]).fill(P.white);
}

function drawAssassin(g: Graphics, t: TeamColors): void {
  foot(g, -8, P.grayDark);
  foot(g, 8, P.grayDark);
  // Scarf tail.
  g.poly([-14, -34, -24, -30, -33, -9, -22, -16, -14, -22]);
  done(g, t.light, 4);
  // Cloak.
  g.roundRect(-14, -37, 28, 31, 8);
  done(g, t.dark);
  // Daggers.
  for (const s of [-1, 1]) {
    g.poly([s * 29, -38, s * 39, -38, s * 34, -78]);
    done(g, P.steel, 5);
    g.roundRect(s > 0 ? 27 : -41, -41, 14, 5, 2);
    done(g, P.leather, 4);
    g.circle(s * 34, -33, 5.5);
    done(g, P.skin, 4);
  }
  g.roundRect(-16, -41, 32, 9, 4);
  done(g, t.light, 4);
  // Hood and mask.
  g.poly([-6, -74, 14, -90, 18, -66]);
  done(g, t.main);
  g.circle(0, -56, 22);
  done(g, t.main);
  g.roundRect(-14, -61, 28, 13, 6);
  done(g, P.grayDark, 4);
  g.ellipse(-6, -55, 4.5, 3).fill(P.white);
  g.ellipse(6, -55, 4.5, 3).fill(P.white);
  g.circle(-6, -55, 1.6).fill(P.outline);
  g.circle(6, -55, 1.6).fill(P.outline);
}

function drawBerserker(g: Graphics, t: TeamColors): void {
  foot(g, -14, P.leather, 12);
  foot(g, 14, P.leather, 12);
  // Axe haft and heads.
  seg(g, 34, -2, 34, -84, P.wood, 6);
  for (const pts of [
    [34, -84, 46, -90, 48, -76, 46, -62, 34, -68],
    [34, -84, 22, -90, 20, -76, 22, -62, 34, -68],
  ]) {
    g.poly(pts);
    done(g, P.steel);
  }
  // Legs and torso.
  g.roundRect(-20, -30, 40, 26, 8);
  done(g, t.dark);
  g.roundRect(-27, -60, 54, 38, 13);
  done(g, t.main);
  g.rect(-24, -29, 48, 7).fill(P.leather);
  g.rect(-5, -30, 10, 9).fill(P.gold);
  g.circle(-29, -44, 9);
  done(g, P.skin, 5);
  g.circle(34, -38, 8);
  done(g, P.skin, 5);
  seg(g, 24, -46, 33, -39, P.skin, 12);
  g.circle(34, -38, 6).fill(P.skin);
  // Head, beard, horned helmet.
  g.circle(0, -69, 21);
  done(g, P.skin);
  g.moveTo(-19, -65).lineTo(19, -65).lineTo(14, -46).lineTo(0, -40).lineTo(-14, -46).closePath();
  done(g, P.beard, 5);
  eye(g, -8, -69, 4);
  eye(g, 8, -69, 4);
  brow(g, -14, -77, -3, -72);
  brow(g, 14, -77, 3, -72);
  for (const s of [-1, 1]) {
    g.poly([s * 17, -70, s * 38, -72, s * 38, -90, s * 28, -80]);
    done(g, P.bone, 5);
  }
  g.moveTo(-21, -72).arc(0, -72, 21, Math.PI, 0).closePath();
  done(g, P.steel);
  g.rect(-21, -75, 42, 5).fill(t.main);
}

function drawShroomling(g: Graphics, t: TeamColors): void {
  foot(g, -8, P.mushroomStalk, 8);
  foot(g, 8, P.mushroomStalk, 8);
  g.roundRect(-14, -42, 28, 34, 10);
  done(g, P.mushroomStalk);
  eye(g, -6, -22, 4);
  eye(g, 6, -22, 4);
  g.ellipse(0, -13, 4, 2.5).fill(P.outline);
  g.moveTo(-37, -36)
    .bezierCurveTo(-39, -92, 39, -92, 37, -36)
    .quadraticCurveTo(0, -28, -37, -36)
    .closePath();
  done(g, t.main);
  g.circle(-17, -54, 7).fill(P.cream);
  g.circle(9, -64, 8).fill(P.cream);
  g.circle(22, -47, 5).fill(P.cream);
  g.circle(-4, -45, 3.5).fill(P.cream);
}

/** Draws the standing figure of `card` in the colours of `team` into `g`. */
export function drawFigure(g: Graphics, card: CardId, team: Team): void {
  const t = teamColors(team);
  switch (card) {
    case 'archer':
      return drawArcher(g, t);
    case 'knight':
      return drawKnight(g, t);
    case 'tnt':
      return drawTnt(g, t);
    case 'skeleton':
      return drawSkeleton(g, t);
    case 'healer':
      return drawHealer(g, t);
    case 'musketeer':
      return drawMusketeer(g, t);
    case 'bat':
      return drawBat(g, t);
    case 'assassin':
      return drawAssassin(g, t);
    case 'berserker':
      return drawBerserker(g, t);
    case 'shroomling':
      return drawShroomling(g, t);
  }
}

/** Draws the team ring with its flag symbol that lies on the ground under a figure. */
export function drawTeamRing(g: Graphics, team: Team): void {
  const t = teamColors(team);
  g.ellipse(0, 0, 38, 11).fill({ color: t.main, alpha: 0.3 });
  g.ellipse(0, 0, 38, 11).stroke({ color: P.outline, width: 9 });
  g.ellipse(0, 0, 38, 11).stroke({ color: t.main, width: 4 });
  // Symbol at the front of the ring: pennant (own) or diamond (enemy).
  if (team === 'own') {
    g.poly([-9, 14, 9, 14, 0, -1]);
  } else {
    g.poly([0, -1, 10, 6.5, 0, 14, -10, 6.5]);
  }
  done(g, t.light, 4);
}
