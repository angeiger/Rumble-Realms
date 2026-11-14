/**
 * Placeholder vector figures of the units (SPEC 11): comic style with thick dark
 * outlines, saturated colours and chibi proportions.
 */
import type { CardId } from '@rumble-realms/engine';
import type { Graphics } from 'pixi.js';

export type Team = 'own' | 'enemy';

/**
 * Drawing area in design units. (0, 0) is the centre of the unit's cell, where the
 * figure stands; the figure extends upwards (negative y).
 */
export const FIGURE_BOX = { left: -50, right: 50, top: -95, bottom: 15 } as const;

/** Draws the standing figure of `card` in the colours of `team` into `g`. */
export function drawFigure(g: Graphics, card: CardId, team: Team): void {
  // Placeholder until the figures work package lands.
  void card;
  g.circle(0, -30, 30)
    .fill(team === 'own' ? 0x3b78f0 : 0xff6a2b)
    .stroke({ color: 0x14172e, width: 6 });
}

/** Draws the team ring with its flag symbol that lies on the ground under a figure. */
export function drawTeamRing(g: Graphics, team: Team): void {
  // Placeholder until the figures work package lands.
  g.ellipse(0, 0, 38, 16).stroke({ color: team === 'own' ? 0x3b78f0 : 0xff6a2b, width: 6 });
}
