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

/**
 * Skeleton summoned by the necromancer (weaker than the card skeleton, D-077): violet bones,
 * glowing green eyes, a short bone dagger instead of the club, no headband. The team colour
 * stays on the tunic so that the owner is still clear.
 */
function drawSummonedSkeleton(g: Graphics, t: TeamColors): void {
  seg(g, -6, -22, -7, -6, P.spiritBone, 5);
  seg(g, 6, -22, 7, -6, P.spiritBone, 5);
  foot(g, -7, P.spiritBone, 8);
  foot(g, 7, P.spiritBone, 8);
  // Short dagger.
  seg(g, 22, -26, 31, -52, P.spiritBone, 5);
  g.poly([27, -52, 35, -52, 31, -68]);
  done(g, P.spiritBoneDark, 4);
  g.roundRect(-14, -37, 28, 22, 6);
  done(g, t.main);
  g.moveTo(0, -35).lineTo(0, -17).stroke({ color: P.spiritBoneDark, width: 4, cap: 'round' });
  seg(g, 12, -30, 24, -27, P.spiritBone, 5);
  // Skull with glowing eyes.
  g.circle(0, -54, 21);
  done(g, P.spiritBone);
  g.roundRect(-11, -42, 22, 11, 3);
  done(g, P.spiritBone, 4);
  g.ellipse(-8, -56, 6.5, 7.5).fill(P.necroDark);
  g.ellipse(8, -56, 6.5, 7.5).fill(P.necroDark);
  g.circle(-8, -55, 3.4).fill(P.necro);
  g.circle(8, -55, 3.4).fill(P.necro);
  g.poly([-3, -47, 3, -47, 0, -52]).fill(P.necroDark);
  for (const x of [-5, 0, 5]) {
    g.moveTo(x, -41).lineTo(x, -33).stroke({ color: P.necroDark, width: 2.5 });
  }
  // Small dark horns instead of the headband.
  g.poly([-16, -68, -12, -82, -6, -71]);
  done(g, P.necroDark, 4);
  g.poly([16, -68, 12, -82, 6, -71]);
  done(g, P.necroDark, 4);
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

/** Flame blob with its tip at (x, y - h); used for fire balls, hair and the dragon's breath. */
function flame(g: Graphics, x: number, y: number, w: number, h: number, outer = P.fire): void {
  g.moveTo(x - w, y)
    .quadraticCurveTo(x - w * 1.1, y - h * 0.5, x - w * 0.1, y - h * 0.65)
    .quadraticCurveTo(x - w * 0.1, y - h * 0.9, x + w * 0.2, y - h)
    .quadraticCurveTo(x + w * 0.4, y - h * 0.6, x + w, y - h * 0.3)
    .quadraticCurveTo(x + w * 0.9, y, x, y + w * 0.4)
    .quadraticCurveTo(x - w * 0.8, y + w * 0.3, x - w, y)
    .closePath();
  done(g, outer, 4);
  g.ellipse(x, y - h * 0.18, w * 0.5, h * 0.2).fill(P.fireLight);
}

function drawPyromancer(g: Graphics, t: TeamColors): void {
  foot(g, -8, P.leather);
  foot(g, 8, P.leather);
  // Staff with fire ball (left).
  seg(g, -33, -4, -33, -52, P.wood, 5);
  flame(g, -33, -58, 12, 34);
  // Robe and belt.
  g.poly([-13, -42, 13, -42, 25, -5, -25, -5]);
  done(g, t.main);
  g.poly([-24, -5, 24, -5, 22, -12, -22, -12]).fill(P.gold);
  g.rect(-14, -32, 28, 6).fill(P.leather);
  g.circle(-33, -34, 6);
  done(g, P.skin, 4);
  // Flaming hair behind the head.
  flame(g, -17, -46, 8, 24);
  flame(g, 17, -46, 8, 24);
  // Head.
  g.circle(0, -53, 18);
  done(g, P.skin);
  eye(g, -6, -52, 3.5);
  eye(g, 6, -52, 3.5);
  g.ellipse(0, -44, 4, 2.5).fill(P.outline);
  // Pointed hat with bent tip, gold band and wide brim.
  g.poly([-15, -64, 15, -64, 9, -79, 24, -85, 8, -92, -6, -84]);
  done(g, t.dark);
  g.poly([-14, -69, 14, -69, 12, -75, -12, -75]).fill(P.gold);
  g.ellipse(0, -64, 29, 7);
  done(g, t.dark);
}

function drawNecromancer(g: Graphics, t: TeamColors): void {
  foot(g, -8, P.necroDark);
  foot(g, 8, P.necroDark);
  // Staff with skull and green glow (right).
  seg(g, 35, -4, 35, -66, P.woodDark, 5);
  g.circle(35, -78, 17).fill({ color: P.necro, alpha: 0.35 });
  g.circle(35, -77, 11);
  done(g, P.bone, 4);
  g.rect(30, -70, 10, 5).fill(P.bone);
  g.ellipse(31, -78, 3, 3.5).fill(P.outline);
  g.ellipse(39, -78, 3, 3.5).fill(P.outline);
  g.circle(31, -78, 1.2).fill(P.necro);
  g.circle(39, -78, 1.2).fill(P.necro);
  // Robe, mantle and rope belt.
  g.poly([-15, -42, 15, -42, 27, -4, -27, -4]);
  done(g, t.dark);
  g.poly([-26, -4, 26, -4, 24, -11, -24, -11]).fill(P.necro);
  g.rect(-14, -30, 28, 5).fill(P.leather);
  g.circle(0, -27, 4.5);
  done(g, P.bone, 3);
  g.ellipse(0, -41, 20, 8);
  done(g, t.main);
  g.circle(35, -34, 6);
  done(g, P.bone, 4);
  // Big hood with dark opening and green eyes.
  g.poly([-6, -74, 12, -92, 20, -64]);
  done(g, t.main);
  g.circle(0, -57, 23);
  done(g, t.main);
  g.ellipse(0, -55, 14, 13);
  done(g, P.necroDark, 4);
  g.ellipse(-6, -57, 3.8, 4.8).fill(P.necro);
  g.ellipse(6, -57, 3.8, 4.8).fill(P.necro);
  g.moveTo(-6, -47).lineTo(6, -47).stroke({ color: P.necro, width: 2.5, cap: 'round' });
}

function drawBeetle(g: Graphics, t: TeamColors): void {
  // Legs.
  for (const x of [-22, -6, 12]) {
    seg(g, x, -14, x - 4, -2, P.grayDark, 5);
  }
  // Cannon barrel pointing up from the back, with muzzle ring and smoke.
  seg(g, -10, -42, -16, -80, P.steelDark, 15);
  g.ellipse(-16, -82, 11, 5);
  done(g, P.gold, 4);
  g.circle(-9, -88, 5).fill({ color: P.cream, alpha: 0.85 });
  g.circle(-21, -89, 4).fill({ color: P.cream, alpha: 0.7 });
  // Fat abdomen shell with stripe and spots.
  g.ellipse(-8, -30, 31, 23);
  done(g, t.main);
  g.moveTo(-8, -52).lineTo(-8, -8).stroke({ color: P.outline, width: 4, cap: 'round' });
  g.circle(-22, -34, 5).fill(t.light);
  g.circle(6, -24, 5).fill(t.light);
  g.circle(-22, -17, 3.5).fill(t.light);
  // Head with eyes and antennae.
  bar(g, (h) => h.moveTo(28, -42).quadraticCurveTo(30, -62, 44, -66), P.grayDark, 3);
  bar(g, (h) => h.moveTo(22, -42).quadraticCurveTo(18, -60, 28, -72), P.grayDark, 3);
  g.circle(27, -29, 15);
  done(g, P.grayDark);
  eye(g, 32, -34, 5.5);
  eye(g, 22, -36, 4.5);
  g.ellipse(34, -22, 5, 2.5).fill(P.outline);
}

function drawGolem(g: Graphics, t: TeamColors): void {
  // Legs.
  g.roundRect(-27, -28, 24, 26, 6);
  done(g, P.stoneDark);
  g.roundRect(3, -28, 24, 26, 6);
  done(g, P.stoneDark);
  // Arms with big fists.
  seg(g, -30, -62, -42, -32, P.stoneDark, 17);
  seg(g, 30, -62, 42, -32, P.stoneDark, 17);
  g.poly([-48, -32, -44, -42, -34, -38, -32, -24, -43, -16, -48, -22]);
  done(g, P.stone);
  g.poly([48, -32, 44, -42, 34, -38, 32, -24, 43, -16, 48, -22]);
  done(g, P.stone);
  // Boulder body.
  g.poly([-32, -64, -20, -76, 20, -76, 33, -64, 36, -38, 24, -24, -24, -24, -36, -38]);
  done(g, P.stone);
  // Team-coloured rune plate on the chest.
  g.poly([-17, -64, 17, -64, 19, -42, 0, -32, -19, -42]);
  done(g, t.main, 5);
  g.moveTo(0, -58).lineTo(0, -40).stroke({ color: t.light, width: 3.5, cap: 'round' });
  g.moveTo(-8, -52).lineTo(8, -52).stroke({ color: t.light, width: 3.5, cap: 'round' });
  // Cracks and moss.
  g.moveTo(-28, -50).lineTo(-23, -44).lineTo(-27, -36).stroke({ color: P.stoneDark, width: 3 });
  g.moveTo(26, -70).lineTo(22, -62).lineTo(27, -56).stroke({ color: P.stoneDark, width: 3 });
  // Small blocky head with glowing eyes.
  g.poly([-15, -72, -17, -85, -8, -91, 8, -91, 17, -85, 15, -72]);
  done(g, P.stoneLight);
  g.roundRect(-12, -84, 10, 7, 2).fill(P.fireLight);
  g.roundRect(2, -84, 10, 7, 2).fill(P.fireLight);
  g.moveTo(-14, -87).lineTo(-3, -83).stroke({ color: P.outline, width: 4, cap: 'round' });
  g.moveTo(14, -87).lineTo(3, -83).stroke({ color: P.outline, width: 4, cap: 'round' });
}

function drawFrostShaman(g: Graphics, t: TeamColors): void {
  foot(g, -9, P.leather);
  foot(g, 9, P.leather);
  // Staff with ice crystal (right).
  seg(g, 36, -4, 36, -62, P.wood, 5);
  g.poly([36, -92, 45, -77, 36, -58, 27, -77]);
  done(g, P.ice, 4);
  g.poly([36, -88, 40, -78, 36, -67, 32, -78]).fill(P.iceLight);
  g.poly([48, -66, 53, -58, 48, -50, 44, -58]);
  done(g, P.ice, 3);
  // Robe with fur hem and fur cloak.
  g.poly([-15, -42, 15, -42, 27, -5, -27, -5]);
  done(g, t.main);
  g.ellipse(0, -7, 26, 7);
  done(g, P.fur, 4);
  g.ellipse(0, -40, 24, 10);
  done(g, P.fur);
  g.circle(36, -34, 6.5);
  done(g, P.fur, 4);
  // Fur hood, bone mask with horns.
  g.poly([-18, -70, -34, -86, -10, -78]);
  done(g, P.bone, 4);
  g.poly([18, -70, 34, -86, 10, -78]);
  done(g, P.bone, 4);
  g.circle(0, -57, 24);
  done(g, P.fur);
  g.ellipse(0, -55, 15, 15);
  done(g, P.bone, 4);
  g.ellipse(-6, -58, 4, 2.8).fill(P.outline);
  g.ellipse(6, -58, 4, 2.8).fill(P.outline);
  g.circle(-6, -58, 1.5).fill(P.ice);
  g.circle(6, -58, 1.5).fill(P.ice);
  g.poly([-12, -49, 12, -49, 0, -42]).fill(t.main);
  g.poly([-9, -78, 9, -78, 0, -71]).fill(t.main);
}

function drawWhelp(g: Graphics, t: TeamColors): void {
  g.ellipse(0, 0, 22, 6).fill({ color: P.outline, alpha: 0.25 });
  // Tail with spade tip.
  bar(g, (h) => h.moveTo(-14, -34).quadraticCurveTo(-34, -30, -34, -16), t.main, 8);
  g.poly([-34, -8, -41, -18, -27, -18]);
  done(g, t.dark, 4);
  // Wings.
  const wing = [-10, -52, -25, -80, -43, -83, -38, -67, -46, -54, -35, -56, -37, -40, -20, -46];
  for (const pts of [wing, mirror(wing)]) {
    g.poly(pts);
    done(g, t.dark);
  }
  for (const s of [-1, 1]) {
    g.moveTo(s * 12, -52)
      .lineTo(s * 40, -74)
      .stroke({ color: t.light, width: 3, cap: 'round' });
    g.moveTo(s * 12, -48)
      .lineTo(s * 42, -56)
      .stroke({ color: t.light, width: 3, cap: 'round' });
  }
  // Round body with belly.
  g.ellipse(0, -38, 21, 19);
  done(g, t.main);
  g.ellipse(2, -34, 12, 13).fill(P.cream);
  for (const y of [-31, -37, -43]) {
    g.moveTo(-6, y).lineTo(10, y).stroke({ color: P.boneDark, width: 2.5, cap: 'round' });
  }
  // Head, snout, horns, eye.
  for (const x of [-4, 10]) {
    g.poly([x - 4, -70, x + 1, -84, x + 5, -70]);
    done(g, P.gold, 4);
  }
  g.circle(2, -60, 17);
  done(g, t.main);
  g.ellipse(17, -56, 11, 8);
  done(g, t.main);
  g.circle(19, -59, 1.8).fill(P.outline);
  eye(g, 4, -65, 5);
  brow(g, -3, -73, 10, -70);
  // Small flame and smoke at the snout.
  flame(g, 36, -53, 7, 20);
  g.circle(30, -72, 3.5).fill({ color: P.cream, alpha: 0.8 });
  g.circle(36, -80, 4.5).fill({ color: P.cream, alpha: 0.6 });
}

function drawZombie(g: Graphics, t: TeamColors): void {
  seg(g, -6, -22, -7, -6, P.zombie, 6);
  seg(g, 6, -22, 7, -6, P.zombie, 6);
  foot(g, -7, P.zombieDark, 8);
  foot(g, 7, P.zombieDark, 8);
  // Arms reaching forward.
  seg(g, 11, -34, 38, -44, P.zombie, 7);
  g.circle(40, -44, 6.5);
  done(g, P.zombieDark, 4);
  seg(g, 11, -28, 32, -30, P.zombie, 7);
  g.circle(34, -30, 6);
  done(g, P.zombieDark, 4);
  // Ragged tunic with torn hem and visible ribs.
  g.poly([-15, -38, 15, -38, 15, -14, 10, -9, 5, -15, 0, -8, -5, -15, -10, -9, -15, -14]);
  done(g, t.main);
  g.moveTo(-8, -31).lineTo(-1, -29).stroke({ color: P.boneDark, width: 3, cap: 'round' });
  g.moveTo(-8, -24).lineTo(-1, -22).stroke({ color: P.boneDark, width: 3, cap: 'round' });
  // Greenish skull-like head with one hanging eye.
  g.circle(0, -55, 21);
  done(g, P.zombie);
  g.ellipse(-8, -57, 6.5, 7.5).fill(P.outline);
  g.ellipse(-8, -57, 3, 3.6).fill(P.necro);
  g.ellipse(8, -57, 5.5, 6.5).fill(P.white);
  g.circle(8, -56, 2.5).fill(P.outline);
  g.moveTo(8, -50).lineTo(9, -44).stroke({ color: P.red, width: 2.5, cap: 'round' });
  g.moveTo(-9, -43).quadraticCurveTo(0, -38, 9, -43).stroke({
    color: P.outline,
    width: 3,
    cap: 'round',
  });
  for (const x of [-4, 0, 4]) {
    g.moveTo(x, -43).lineTo(x, -39).stroke({ color: P.outline, width: 2 });
  }
  // Torn headband and hair tufts.
  g.poly([-17, -73, 17, -73, 17, -66, 8, -68, 0, -65, -8, -68, -17, -66]);
  done(g, t.main, 4);
  g.poly([-6, -73, -3, -84, 0, -73]);
  done(g, P.hair, 3);
  g.poly([4, -73, 8, -82, 11, -73]);
  done(g, P.hair, 3);
}

function drawGhost(g: Graphics, t: TeamColors): void {
  g.ellipse(0, 0, 20, 6).fill({ color: P.outline, alpha: 0.25 });
  // Wispy sleeves.
  g.poly([-20, -44, -40, -30, -34, -24, -18, -34]);
  g.fill({ color: P.ghost, alpha: 0.75 }).stroke({ color: P.outline, width: OW, join: 'round' });
  g.poly([20, -44, 40, -30, 34, -24, 18, -34]);
  g.fill({ color: P.ghost, alpha: 0.75 }).stroke({ color: P.outline, width: OW, join: 'round' });
  // Body with a wavy, tapering tail instead of legs.
  g.poly([
    -24, -52, -27, -34, -20, -20, -12, -28, -4, -12, 4, -26, 12, -16, 20, -24, 27, -36, 24, -52,
  ]);
  g.fill({ color: P.ghost, alpha: 0.78 }).stroke({ color: P.outline, width: OW, join: 'round' });
  g.moveTo(-14, -36).lineTo(-9, -24).stroke({ color: P.white, width: 3, cap: 'round', alpha: 0.7 });
  // Hood in team colour with dark opening and glowing eyes.
  g.poly([-6, -76, 12, -90, 19, -66]);
  g.fill({ color: t.main, alpha: 0.9 }).stroke({ color: P.outline, width: OW, join: 'round' });
  g.circle(0, -57, 23);
  g.fill({ color: t.main, alpha: 0.9 }).stroke({ color: P.outline, width: OW, join: 'round' });
  g.ellipse(0, -55, 14, 14);
  done(g, P.necroDark, 4);
  g.ellipse(-6, -58, 3.8, 5).fill(P.necro);
  g.ellipse(6, -58, 3.8, 5).fill(P.necro);
  g.ellipse(0, -47, 4, 3).fill(P.necro);
}

function drawMiniGolem(g: Graphics, t: TeamColors): void {
  g.roundRect(-16, -14, 13, 12, 4);
  done(g, P.stoneDark);
  g.roundRect(3, -14, 13, 12, 4);
  done(g, P.stoneDark);
  g.circle(-27, -26, 8);
  done(g, P.stone, 5);
  g.circle(27, -26, 8);
  done(g, P.stone, 5);
  g.poly([-22, -14, -26, -34, -14, -50, 6, -54, 22, -44, 26, -24, 18, -12]);
  done(g, P.stone);
  g.poly([-8, -56, 0, -70, 8, -56, 0, -46]);
  done(g, t.main, 4);
  g.poly([-14, -24, 14, -24, 12, -17, -12, -17]).fill(t.main);
  g.roundRect(-14, -42, 10, 8, 2).fill(P.fireLight);
  g.roundRect(4, -42, 10, 8, 2).fill(P.fireLight);
  g.moveTo(-15, -45).lineTo(-3, -40).stroke({ color: P.outline, width: 4, cap: 'round' });
  g.moveTo(15, -45).lineTo(3, -40).stroke({ color: P.outline, width: 4, cap: 'round' });
  g.moveTo(16, -34).lineTo(10, -28).lineTo(14, -22).stroke({ color: P.stoneDark, width: 2.5 });
}

/** Neutral stand-in for a key that has no figure yet. */
function drawPlaceholder(g: Graphics, t: TeamColors): void {
  foot(g, -8, P.grayDark);
  foot(g, 8, P.grayDark);
  g.roundRect(-16, -62, 32, 56, 12);
  done(g, P.steel);
  g.circle(0, -34, 8);
  done(g, t.main, 4);
}

/** Keys of all figures; the last ones are for units the engine may not know yet. */
export type FigureId =
  | CardId
  | 'pyromancer'
  | 'necromancer'
  | 'beetle'
  | 'golem'
  | 'frost_shaman'
  | 'whelp'
  | 'zombie'
  | 'ghost'
  | 'mini_golem'
  | 'summoned_skeleton';

const FIGURES: Record<FigureId, (g: Graphics, t: TeamColors) => void> = {
  archer: drawArcher,
  knight: drawKnight,
  tnt: drawTnt,
  skeleton: drawSkeleton,
  healer: drawHealer,
  musketeer: drawMusketeer,
  bat: drawBat,
  assassin: drawAssassin,
  berserker: drawBerserker,
  shroomling: drawShroomling,
  pyromancer: drawPyromancer,
  necromancer: drawNecromancer,
  beetle: drawBeetle,
  golem: drawGolem,
  frost_shaman: drawFrostShaman,
  whelp: drawWhelp,
  zombie: drawZombie,
  ghost: drawGhost,
  mini_golem: drawMiniGolem,
  summoned_skeleton: drawSummonedSkeleton,
};

export const FIGURE_IDS: readonly FigureId[] = Object.keys(FIGURES) as FigureId[];

/** Draws the standing figure of `card` in the colours of `team` into `g`. */
export function drawFigure(g: Graphics, card: FigureId, team: Team): void {
  const draw = (FIGURES as Partial<Record<string, (g: Graphics, t: TeamColors) => void>>)[card];
  (draw ?? drawPlaceholder)(g, teamColors(team));
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
