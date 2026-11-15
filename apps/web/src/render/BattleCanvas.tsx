import { createContext, useContext, useEffect, useRef } from 'react';
import type { GameSession } from '../game/types.ts';
import { createBattleRenderer, type BattleRenderer } from './battleRenderer.ts';
import { NO_EDGE_INSETS, type EdgeInsets } from './layout.ts';

export interface BattleCanvasProps {
  session: GameSession;
}

/**
 * The battle screen measures the header and the bottom status line and provides the heights
 * here, so the field keeps clear of them without changing size between draft and battle.
 */
export const EdgeInsetsContext = createContext<EdgeInsets>(NO_EDGE_INSETS);

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
  const rendererRef = useRef<BattleRenderer | null>(null);
  const edge = useContext(EdgeInsetsContext);
  const edgeRef = useRef(edge);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    let cancelled = false;
    createBattleRenderer(host, session, () => cancelled, edgeRef.current).then(
      (created) => {
        if (created === null) return;
        if (cancelled) {
          created.destroy();
        } else {
          rendererRef.current = created;
          created.setEdgeInsets(edgeRef.current);
        }
      },
      (error: unknown) => {
        if (!cancelled) console.error('Battle renderer failed to start', error);
      },
    );
    return () => {
      cancelled = true;
      rendererRef.current?.destroy();
      rendererRef.current = null;
    };
  }, [session]);

  useEffect(() => {
    edgeRef.current = edge;
    rendererRef.current?.setEdgeInsets(edge);
  }, [edge]);

  return (
    <div
      ref={hostRef}
      className="battle-canvas"
      style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}
    />
  );
}
