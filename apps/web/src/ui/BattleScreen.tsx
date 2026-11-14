import type { ReactElement } from 'react';
import { BattleCanvas } from '../render/BattleCanvas.tsx';
import { useGameStore } from '../game/store.ts';
import { BattleView } from './BattleView.tsx';

/** Container: reads the game store and hands the snapshot to the pure view. */
export function BattleScreen(): ReactElement | null {
  const session = useGameStore((s) => s.session);
  const snapshot = useGameStore((s) => s.snapshot);
  const play = useGameStore((s) => s.play);
  const setSpeed = useGameStore((s) => s.setSpeed);
  const backToTitle = useGameStore((s) => s.backToTitle);
  const startMatch = useGameStore((s) => s.startMatch);
  if (session === null || snapshot === null) return null;
  return (
    <BattleView
      snapshot={snapshot}
      actions={{ play, setSpeed, leave: backToTitle, playAgain: startMatch }}
      field={<BattleCanvas session={session} />}
    />
  );
}
