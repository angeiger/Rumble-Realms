import { CARDS, MAX_LEVEL, UPGRADES_PER_CARD, type CardId } from '@rumble-realms/engine';
import type { ReactElement } from 'react';
import { t, type MessageKey } from '../i18n/index.ts';
import { cardName, rangeText } from './CardView.tsx';
import { formatNumber, getCardStats } from './cardStats.ts';
import { FigureImage } from './FigureImage.tsx';
import { CloseIcon } from './icons.tsx';
import { upgradeName, upgradeText } from './upgradeText.ts';

export interface CardDetailProps {
  card: CardId;
  level: number;
  onClose: () => void;
  /**
   * Deck tab only (test mode, D-048): shows a "- Level N +" control; the caller stores the
   * level and passes the new one back in `level`. In the battle there is no control.
   */
  onLevelChange?: (level: number) => void;
  /** Upgrade (0..2) to highlight, e.g. the one of the tapped upgrade card. */
  highlightUpgrade?: number | undefined;
  /**
   * Deck tab only (test mode, D-073): the switched-on upgrades (bit mask) and the handler that
   * toggles one. Without the handler the upgrades are only listed.
   */
  upgradeMask?: number;
  onToggleUpgrade?: (index: number) => void;
}

/** Dialog with all values of a card. Closes on tap outside or on the X. */
export function CardDetail({
  card,
  level,
  onClose,
  onLevelChange,
  highlightUpgrade,
  upgradeMask = 0,
  onToggleUpgrade,
}: CardDetailProps): ReactElement {
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
          {onLevelChange === undefined && (
            <span className="tag">{t('detail.level', { level })}</span>
          )}
        </div>
        {onLevelChange !== undefined && (
          <div className="level-picker" data-testid="level-picker">
            <div className="level-picker__row">
              <button
                type="button"
                className="icon-btn level-picker__btn"
                data-testid="level-minus"
                aria-label={t('detail.levelDown')}
                disabled={level <= 1}
                onClick={() => onLevelChange(level - 1)}
              >
                −
              </button>
              <span className="level-picker__value" data-testid="level-value" data-level={level}>
                {t('detail.level', { level })}
              </span>
              <button
                type="button"
                className="icon-btn level-picker__btn"
                data-testid="level-plus"
                aria-label={t('detail.levelUp')}
                disabled={level >= MAX_LEVEL}
                onClick={() => onLevelChange(level + 1)}
              >
                +
              </button>
            </div>
            <p className="level-picker__hint">{t('detail.levelTestMode')}</p>
          </div>
        )}
        <dl className="detail__stats">
          {rows.map(([label, value]) => (
            <div key={label} className="detail__row">
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <p className="detail__text">{t(`card.${card}.text` as MessageKey)}</p>
        <section className="detail__upgrades" data-testid="detail-upgrades">
          <h3 className="detail__upgrades-title">{t('detail.upgrades')}</h3>
          <ul className="upgrade-list">
            {Array.from({ length: UPGRADES_PER_CARD }, (_, i) => {
              const on = (upgradeMask & (1 << i)) !== 0;
              return (
                <li
                  key={i}
                  className={`upgrade-row${highlightUpgrade === i ? ' upgrade-row--highlight' : ''}`}
                  data-testid={`detail-upgrade-${i}`}
                  data-highlight={highlightUpgrade === i}
                  data-on={onToggleUpgrade !== undefined ? on : undefined}
                >
                  <span className="upgrade-row__body">
                    <span className="upgrade-row__name">{upgradeName(card, i)}</span>
                    <span className="upgrade-row__text">{upgradeText(card, i)}</span>
                  </span>
                  {onToggleUpgrade !== undefined && (
                    <button
                      type="button"
                      className={`switch${on ? ' switch--on' : ''}`}
                      role="switch"
                      aria-checked={on}
                      aria-label={t('detail.upgradeOn', { name: upgradeName(card, i) })}
                      data-testid={`upgrade-switch-${i}`}
                      onClick={() => onToggleUpgrade(i)}
                    >
                      <span className="switch__knob" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {onToggleUpgrade !== undefined && (
            <p className="level-picker__hint">{t('detail.upgradesTestMode')}</p>
          )}
        </section>
      </div>
    </div>
  );
}
