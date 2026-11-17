import type { ReactElement } from 'react';
import { BattleCanvas } from '../render/BattleCanvas.tsx';
import { usePackUi } from '../game/packUi.ts';
import { useGameStore } from '../game/store.ts';
import { BattleView } from './BattleView.tsx';

/** Container: reads the game store and hands the snapshot to the pure view. */
export function BattleScreen(): ReactElement | null {
  const session = useGameStore((s) => s.session);
  const snapshot = useGameStore((s) => s.snapshot);
  const play = useGameStore((s) => s.play);
  const setSpeed = useGameStore((s) => s.setSpeed);
  const report = useGameStore((s) => s.report);
  const backToMenu = useGameStore((s) => s.backToMenu);
  const startMatch = useGameStore((s) => s.startMatch);
  const retryReport = useGameStore((s) => s.retryReport);
  if (session === null || snapshot === null) return null;
  return (
    <BattleView
      snapshot={snapshot}
      report={report}
      actions={{
        play,
        setSpeed,
        leave: backToMenu,
        // "Play again": the finished match is booked, so a new one is never a resume.
        playAgain: () => void startMatch(),
        retryReport: () => void retryReport(),
        openPack: (packId) => usePackUi.getState().show(packId),
      }}
      field={<BattleCanvas session={session} />}
    />
  );
}
