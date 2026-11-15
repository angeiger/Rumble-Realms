import type { CardId } from '@rumble-realms/engine';
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { t } from '../i18n/index.ts';
import type { SessionSnapshot } from '../game/types.ts';
import { CardView } from './CardView.tsx';

export interface DraftBarProps {
  snapshot: SessionSnapshot;
  /** One tap plays the card at once (D-044). */
  onPlay: (slot: number) => void;
  onInfo: (card: CardId) => void;
  /** Shown at the right end of the status line (the player's lives). */
  trailing?: ReactNode;
}

/** Time the played card needs to fly away; taps are ignored meanwhile (no accidental double pick). */
export const PLAY_FEEDBACK_MS = 380;

function picksText(count: number): string {
  return count === 1 ? t('draft.picksLeftOne') : t('draft.picksLeftMany', { count });
}

interface Ghost {
  slot: number;
  card: CardId;
  level: number;
  id: number;
}

/**
 * Status line with turn and remaining picks, and the offer cards. The cards lie over the
 * field (D-043); while the opponent is on turn only the status line stays.
 */
export function DraftBar({ snapshot, onPlay, onInfo, trailing }: DraftBarProps): ReactElement {
  const { me, turn, offer, players, picksLeft } = snapshot;
  const myTurn = turn === me && offer !== null;
  const opponent = players[me === 0 ? 1 : 0];
  const status =
    turn === null
      ? ''
      : myTurn
        ? `${t('draft.yourTurn')} · ${picksText(picksLeft[me])}`
        : `${t('draft.opponentTurn', { name: opponent.name })}`;

  // The played card stays visible for a moment as a "ghost" that flies away.
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const locked = useRef(false);
  const counter = useRef(0);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const play = (slot: number): void => {
    const slotData = offer?.[slot];
    if (slotData === undefined || locked.current) return;
    locked.current = true;
    counter.current++;
    setGhost({
      slot,
      card: slotData.card,
      level: players[me].levels[slotData.card] ?? 1,
      id: counter.current,
    });
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      locked.current = false;
      setGhost(null);
    }, PLAY_FEEDBACK_MS);
    onPlay(slot);
  };

  const statusText = (
    <span className="draft__text" data-testid="draft-status">
      {status}
    </span>
  );
  const showCenter = myTurn || ghost !== null;

  return (
    <div className="draft" data-testid="draft-bar" data-my-turn={myTurn}>
      {/* Bottom line: only a small note while the opponent chooses, plus the own lives. */}
      <div className="draft__status">
        {!myTurn && statusText}
        {trailing}
      </div>
      {/* The offer lies in the middle of the field, over the free meadow along the centre line. */}
      {showCenter && (
        <div className="draft__center">
          {myTurn && <div className="draft__banner">{statusText}</div>}
          <div className="draft__cards">
            {myTurn &&
              offer.map((slot, i) => (
                <div className="draft__slot" key={i} style={{ gridColumn: i + 1 }}>
                  <CardView
                    card={slot.card}
                    level={players[me].levels[slot.card] ?? 1}
                    testId={`offer-card-${i}`}
                    onTap={() => play(i)}
                    onInfo={() => onInfo(slot.card)}
                  />
                </div>
              ))}
            {ghost !== null && (
              <div
                className="draft__slot draft__slot--ghost"
                key={`ghost-${ghost.id}`}
                style={{ gridColumn: ghost.slot + 1 }}
                aria-hidden="true"
                data-testid="played-ghost"
              >
                <CardView card={ghost.card} level={ghost.level} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
