import { CARDS, type CardId } from '@rumble-realms/engine';
import type { ReactElement } from 'react';
import { t, type MessageKey } from '../i18n/index.ts';
import { cardName, rangeText } from './CardView.tsx';
import { formatNumber, getCardStats } from './cardStats.ts';
import { FigureImage } from './FigureImage.tsx';
import { CloseIcon } from './icons.tsx';

export interface CardDetailProps {
  card: CardId;
  level: number;
  onClose: () => void;
}

/** Dialog with all values of a card. Closes on tap outside or on the X. */
export function CardDetail({ card, level, onClose }: CardDetailProps): ReactElement {
  const def = CARDS[card];
  const s = getCardStats(card, level);
  const rows: [string, string][] = [
    [t('detail.count'), `×${s.count}`],
    [t('detail.hp'), formatNumber(s.hp)],
    [s.effectKind === 'heal' ? t('detail.heal') : t('detail.damage'), formatNumber(s.effect)],
    [
      t('detail.interval'),
      s.interval === null
        ? t('detail.intervalOnce')
        : t('unit.seconds', { value: formatNumber(s.interval) }),
    ],
    [
      t('detail.range'),
      s.rangeKind === 'ranged' ? t('unit.fields', { value: rangeText(s) }) : rangeText(s),
    ],
    [t('detail.speed'), t('unit.fieldsPerSecond', { value: formatNumber(s.speed) })],
    [t('detail.targets'), t(`targets.${s.target}` as MessageKey)],
  ];
  return (
    <div className="modal" onClick={onClose} data-testid="card-detail-backdrop">
      <div
        className={`dialog dialog--card card--${def.rarity}`}
        role="dialog"
        aria-modal="true"
        aria-label={cardName(card)}
        data-testid="card-detail"
        data-card={card}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="dialog__close"
          aria-label={t('detail.close')}
          data-testid="card-detail-close"
          onClick={onClose}
        >
          <CloseIcon />
        </button>
        <div className="detail__art">
          <FigureImage card={card} />
        </div>
        <h2 className="detail__name">{cardName(card)}</h2>
        <div className="detail__tags">
          <span className="tag tag--rarity">{t(`rarity.${def.rarity}` as MessageKey)}</span>
          <span className="tag">{t(`role.${def.role}` as MessageKey)}</span>
          <span className="tag">{t('detail.level', { level })}</span>
        </div>
        <dl className="detail__stats">
          {rows.map(([label, value]) => (
            <div key={label} className="detail__row">
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <p className="detail__text">{t(`card.${card}.text` as MessageKey)}</p>
      </div>
    </div>
  );
}
