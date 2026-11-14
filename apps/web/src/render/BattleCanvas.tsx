import type { GameSession } from '../game/types.ts';

export interface BattleCanvasProps {
  session: GameSession;
}

/**
 * Draws the field of `session` and drives its clock: calls `session.advance(dt)` once per
 * frame. Fills its parent element and adapts to size changes.
 */
export function BattleCanvas({ session }: BattleCanvasProps) {
  // Placeholder until the renderer work package lands.
  void session;
  return <div className="battle-canvas" />;
}
