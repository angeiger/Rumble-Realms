import type { CardId } from '@rumble-realms/engine';
import type { ReactElement } from 'react';
import { t } from '../i18n/index.ts';
import type { SessionSnapshot } from '../game/types.ts';
import { CardBack, CardView } from './CardView.tsx';

export interface DraftBarProps {
  snapshot: SessionSnapshot;
  onSelect: (slot: number) => void;
  onConfirm: () => void;
  onInfo: (card: CardId) => void;
}

function picksText(count: number): string {
  return count === 1 ? t('draft.picksLeftOne') : t('draft.picksLeftMany', { count });
}

/** Status line with turn and remaining picks, the offer cards and the play button. */
export function DraftBar({ snapshot, onSelect, onConfirm, onInfo }: DraftBarProps): ReactElement {
  const { me, turn, offer, selectedSlot, players, picksLeft } = snapshot;
  const myTurn = turn === me && offer !== null;
  const opponent = players[me === 0 ? 1 : 0];
  const status =
    turn === null
      ? ''
      : myTurn
        ? `${t('draft.yourTurn')} · ${picksText(picksLeft[me])}`
        : `${t('draft.opponentTurn', { name: opponent.name })}`;
  return (
    <div className="draft" data-testid="draft-bar" data-my-turn={myTurn}>
      <div className="draft__status">
        <span className="draft__text" data-testid="draft-status">
          {status}
        </span>
        <button
          type="button"
          className="btn btn--small"
          data-testid="confirm-button"
          disabled={!myTurn || selectedSlot === null}
          onClick={onConfirm}
        >
          {t('draft.play')}
        </button>
      </div>
      <div className="draft__cards">
        {myTurn
          ? offer.map((slot, i) => (
              <CardView
                key={i}
                card={slot.card}
                level={players[me].levels[slot.card] ?? 1}
                selected={selectedSlot === i}
                testId={`offer-card-${i}`}
                onTap={() => onSelect(i)}
                onInfo={() => onInfo(slot.card)}
              />
            ))
          : [0, 1, 2].map((i) => <CardBack key={i} />)}
      </div>
    </div>
  );
}
