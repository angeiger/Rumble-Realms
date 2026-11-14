import { useEffect, useRef } from 'react';
import type { GameSession } from '../game/types.ts';
import { createBattleRenderer, type BattleRenderer } from './battleRenderer.ts';

export interface BattleCanvasProps {
  session: GameSession;
}

/**
 * Draws the field of `session` and drives its clock: calls `session.advance(dt)` once per
 * frame. Fills its parent element and adapts to size changes.
 *
 * The scene is thin glue here; see `battleRenderer.ts`. The Pixi setup is asynchronous,
 * so an effect that is cleaned up before it finished (React StrictMode) simply discards
 * the result.
 */
export function BattleCanvas({ session }: BattleCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    let cancelled = false;
    let renderer: BattleRenderer | null = null;
    createBattleRenderer(host, session, () => cancelled).then(
      (created) => {
        if (created === null) return;
        if (cancelled) created.destroy();
        else renderer = created;
      },
      (error: unknown) => {
        if (!cancelled) console.error('Battle renderer failed to start', error);
      },
    );
    return () => {
      cancelled = true;
      renderer?.destroy();
      renderer = null;
    };
  }, [session]);

  return (
    <div
      ref={hostRef}
      className="battle-canvas"
      style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}
    />
  );
}
