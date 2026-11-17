import type { CardId } from '@rumble-realms/engine';
import type { PackReward } from '@rumble-realms/shared';
import { useState, type ReactElement } from 'react';
import type { PackInfo } from '../backend/types.ts';
import { t } from '../i18n/index.ts';
import type { UiErrorCode } from './accountText.ts';
import { cardName } from './CardView.tsx';
import { collectionErrorText } from './collection.ts';
import { FigureImage } from './FigureImage.tsx';
import { CoinIcon, JokerIcon } from './icons.tsx';
import { PackChest } from './PackChest.tsx';
import { nextPack, packTitle, pickPack, rewardLine } from './packLogic.ts';

export interface OpenedPack {
  reward: PackReward;
  cardUnlocked: boolean;
}

export type OpenOutcome = ({ ok: true } & OpenedPack) | { ok: false; error: UiErrorCode };

export interface PackModalProps {
  /** Unopened packs (oldest first). */
  packs: readonly PackInfo[];
  /** Pack to show first, if still unopened. */
  preferId: string | null;
  busy: boolean;
  onOpen: (packId: string) => Promise<OpenOutcome>;
  onClose: () => void;
  /** Only for tests: start with this reward already shown. */
  initialOpened?: OpenedPack;
}

interface Shown {
  id: string;
  kind: PackInfo['kind'];
  opened: OpenedPack | null;
}

function RewardView({ opened }: { opened: OpenedPack }): ReactElement {
  const { reward } = opened;
  const line = rewardLine(reward, opened.cardUnlocked);
  return (
    <div className="pack-reward" data-testid="pack-reward" data-kind={reward.kind}>
      {reward.kind === 'cards' && (
        <div className="pack-reward__art" data-card={reward.card}>
          <FigureImage card={reward.card as CardId} />
        </div>
      )}
      {reward.kind === 'gold' && (
        <div className="pack-reward__art pack-reward__art--icon">
          <CoinIcon size={72} />
        </div>
      )}
      {reward.kind === 'jokers' && (
        <div className="pack-reward__art pack-reward__art--icon">
          <JokerIcon size={72} />
        </div>
      )}
      {reward.kind === 'cards' && (
        <div className="pack-reward__name" data-testid="pack-reward-name">
          {cardName(reward.card)}
        </div>
      )}
      <div className="pack-reward__text" data-testid="pack-reward-text">
        {line.text}
      </div>
      {line.isNew && (
        <div className="pack-reward__new" data-testid="pack-reward-new">
          {t('pack.newCard')}
        </div>
      )}
    </div>
  );
}

/** Dialog that opens the unopened packs one after the other (SPEC 7.4; the full animation is M6). */
export function PackModal({
  packs,
  preferId,
  busy,
  onOpen,
  onClose,
  initialOpened,
}: PackModalProps): ReactElement | null {
  const [shown, setShown] = useState<Shown | null>(() => {
    const first = pickPack(packs, preferId);
    return first === null
      ? null
      : { id: first.id, kind: first.kind, opened: initialOpened ?? null };
  });
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<UiErrorCode | null>(null);
  if (shown === null) return null;

  const more = packs.filter((p) => p.id !== shown.id).length;
  const phase = shown.opened !== null ? 'opened' : opening ? 'opening' : 'closed';

  const open = async (): Promise<void> => {
    if (opening || busy) return;
    setOpening(true);
    setError(null);
    const res = await onOpen(shown.id);
    setOpening(false);
    if (res.ok)
      setShown({ ...shown, opened: { reward: res.reward, cardUnlocked: res.cardUnlocked } });
    else setError(res.error);
  };

  const next = (): void => {
    const following = nextPack(packs, shown.id);
    if (following === null) {
      onClose();
      return;
    }
    setShown({ id: following.id, kind: following.kind, opened: null });
    setError(null);
  };

  return (
    <div
      className="modal modal--pack"
      data-testid="pack-modal"
      data-phase={phase}
      data-kind={shown.kind}
    >
      <div
        className="dialog pack-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={packTitle(shown.kind)}
      >
        <h2 className="dialog__title" data-testid="pack-title">
          {packTitle(shown.kind)}
        </h2>
        {shown.opened === null ? (
          <>
            <div className={`pack-stage${opening ? ' pack-stage--shake' : ''}`}>
              <PackChest />
            </div>
            <button
              type="button"
              className="btn btn--big pack-dialog__btn"
              data-testid="pack-open"
              disabled={opening || busy}
              onClick={() => void open()}
            >
              {opening ? t('pack.opening') : t('pack.open')}
            </button>
          </>
        ) : (
          <>
            <RewardView opened={shown.opened} />
            <button
              type="button"
              className="btn btn--big pack-dialog__btn"
              data-testid="pack-next"
              onClick={next}
            >
              {t('pack.next')}
            </button>
          </>
        )}
        {error !== null && (
          <p className="pack-dialog__error" role="alert" data-testid="pack-error" data-code={error}>
            {collectionErrorText(error)}
          </p>
        )}
        {more > 0 && (
          <p className="pack-dialog__more" data-testid="pack-remaining" data-count={more}>
            {t('pack.remaining', { n: more })}
          </p>
        )}
        {shown.opened === null && !opening && (
          <button
            type="button"
            className="btn btn--quiet btn--small pack-dialog__later"
            data-testid="pack-close"
            onClick={onClose}
          >
            {t('pack.later')}
          </button>
        )}
      </div>
    </div>
  );
}
