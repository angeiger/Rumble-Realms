import {
  CARDS,
  MAX_LEVEL,
  UPGRADES_PER_CARD,
  type CardId,
  type UpgradeIndex,
} from '@rumble-realms/engine';
import type { ReactElement } from 'react';
import type { PlayerState } from '../backend/types.ts';
import { t, type MessageKey } from '../i18n/index.ts';
import type { UiErrorCode } from './accountText.ts';
import { cardName, rangeText } from './CardView.tsx';
import { formatNumber, getCardStats, type CardStats } from './cardStats.ts';
import {
  arenaOfCard,
  cardStatus,
  collectionErrorText,
  jokerOffer,
  levelUpInfo,
  previewText,
  upgradeStates,
  type UpgradeState,
} from './collection.ts';
import { FigureImage } from './FigureImage.tsx';
import { CloseIcon, CoinIcon, JokerIcon } from './icons.tsx';
import { upgradeName, upgradeText } from './upgradeText.ts';

/** Deck tab only: the player's state and the actions of the collection (all go to the server). */
export interface CollectionDetail {
  player: PlayerState;
  /** An action is running: all buttons are locked. */
  busy: boolean;
  /** The last failure of an action, shown as a short note. */
  error: UiErrorCode | null;
  onLevelUp: () => void;
  onUnlockUpgrade: (upgrade: UpgradeIndex) => void;
  /** Buys one copy for jokers. */
  onSpendJokers: () => void;
}

export interface CardDetailProps {
  card: CardId;
  /** Level to show the values for (battle: level of the card; deck tab: level of the player). */
  level: number;
  onClose: () => void;
  /** Upgrade (0..2) to highlight, e.g. the one of the tapped upgrade card. */
  highlightUpgrade?: number | undefined;
  /** Deck tab: shows costs, level-up, upgrade unlocking and jokers. Without it: values only. */
  collection?: CollectionDetail;
}

interface StatRow {
  key: string;
  label: string;
  value: string;
  /** Value on the next level, if it differs. */
  next: string | null;
}

function statRows(now: CardStats, next: CardStats | null): StatRow[] {
  const n = (pick: (s: CardStats) => number): string | null =>
    next === null ? null : formatNumber(pick(next));
  return [
    { key: 'count', label: t('detail.count'), value: `×${now.count}`, next: null },
    { key: 'hp', label: t('detail.hp'), value: formatNumber(now.hp), next: n((s) => s.hp) },
    {
      key: 'effect',
      label: now.effectKind === 'heal' ? t('detail.heal') : t('detail.damage'),
      value: formatNumber(now.effect),
      next: n((s) => s.effect),
    },
    {
      key: 'interval',
      label: t('detail.interval'),
      value:
        now.interval === null
          ? t('detail.intervalOnce')
          : t('unit.seconds', { value: formatNumber(now.interval) }),
      next: null,
    },
    {
      key: 'range',
      label: t('detail.range'),
      value:
        now.rangeKind === 'ranged' ? t('unit.fields', { value: rangeText(now) }) : rangeText(now),
      next: null,
    },
    {
      key: 'speed',
      label: t('detail.speed'),
      value: t('unit.fieldsPerSecond', { value: formatNumber(now.speed) }),
      next: null,
    },
    {
      key: 'targets',
      label: t('detail.targets'),
      value: t(`targets.${now.target}` as MessageKey),
      next: null,
    },
  ];
}

function Cost({ icon, text, ok }: { icon: ReactElement; text: string; ok: boolean }): ReactElement {
  return (
    <span className={`cost${ok ? '' : ' cost--missing'}`}>
      {icon}
      <span>{text}</span>
    </span>
  );
}

function LevelUpSection({ card, c }: { card: CardId; c: CollectionDetail }): ReactElement | null {
  const owned = c.player.cards[card];
  if (owned === undefined) return null;
  const info = levelUpInfo(card, owned, c.player.gold);
  if (info === null) {
    return (
      <section className="detail__section" data-testid="detail-levelup" data-state="max">
        <h3 className="detail__section-title">{t('detail.levelMax')}</h3>
      </section>
    );
  }
  const state =
    info.blocked === 'not_enough_copies'
      ? 'copies'
      : info.blocked === 'not_enough_gold'
        ? 'gold'
        : 'ready';
  const reason =
    info.blocked === 'not_enough_copies'
      ? t('detail.missingCopies', { n: info.copies - info.haveCopies })
      : info.blocked === 'not_enough_gold'
        ? t('detail.missingGold', { n: info.gold - info.haveGold })
        : null;
  return (
    <section className="detail__section" data-testid="detail-levelup" data-state={state}>
      <h3 className="detail__section-title">
        {t('detail.levelUpTitle', { level: owned.level + 1 })}
      </h3>
      <div className="detail__costs">
        <Cost
          icon={
            <span className="cost__copies" aria-hidden="true">
              ×
            </span>
          }
          text={t('detail.copiesOf', { have: info.haveCopies, need: info.copies })}
          ok={info.haveCopies >= info.copies}
        />
        <Cost
          icon={<CoinIcon size={18} />}
          text={t('detail.goldOf', { have: info.haveGold, need: info.gold })}
          ok={info.haveGold >= info.gold}
        />
      </div>
      <button
        type="button"
        className="btn btn--small detail__action"
        data-testid="level-up-button"
        disabled={c.busy || info.blocked !== null}
        onClick={c.onLevelUp}
      >
        {t('detail.levelUpButton')}
      </button>
      {reason !== null && (
        <p className="detail__reason" data-testid="level-up-reason">
          {reason}
        </p>
      )}
    </section>
  );
}

function UpgradeAction({
  index,
  state,
  busy,
  onUnlock,
}: {
  index: UpgradeIndex;
  state: UpgradeState;
  busy: boolean;
  onUnlock: () => void;
}): ReactElement {
  switch (state.kind) {
    case 'unlocked':
      return (
        <span
          className="upgrade-row__state upgrade-row__state--on"
          data-testid={`upgrade-on-${index}`}
        >
          {t('detail.upgradeUnlocked')}
        </span>
      );
    case 'level':
      return (
        <span className="upgrade-row__state" data-testid={`upgrade-level-${index}`}>
          {t('detail.upgradeFromLevel', { level: state.level })}
        </span>
      );
    default:
      return (
        <button
          type="button"
          className="btn btn--small upgrade-row__btn"
          data-testid={`unlock-upgrade-${index}`}
          disabled={busy || state.kind === 'no_gold'}
          onClick={onUnlock}
        >
          <CoinIcon size={16} />
          <span>{t('detail.upgradeUnlockFor', { gold: state.gold })}</span>
        </button>
      );
  }
}

function JokerSection({ card, c }: { card: CardId; c: CollectionDetail }): ReactElement | null {
  const offer = jokerOffer(c.player, card);
  if (offer === null) return null;
  return (
    <section className="detail__section" data-testid="detail-jokers" data-enough={offer.enough}>
      <h3 className="detail__section-title">{t('detail.jokersTitle')}</h3>
      <div className="detail__costs">
        <Cost
          icon={<JokerIcon size={18} />}
          text={t('detail.jokersOffer', { cost: offer.cost })}
          ok={offer.enough}
        />
        <span className="detail__have">{t('detail.jokersHave', { n: offer.have })}</span>
      </div>
      <button
        type="button"
        className="btn btn--blue btn--small detail__action"
        data-testid="spend-jokers-button"
        disabled={c.busy || !offer.enough}
        onClick={c.onSpendJokers}
      >
        {t('detail.jokersButton')}
      </button>
      {!offer.enough && (
        <p className="detail__reason" data-testid="jokers-reason">
          {t('detail.missingJokers', { n: offer.cost - offer.have })}
        </p>
      )}
    </section>
  );
}

/** Dialog with all values of a card. Closes on tap outside or on the X. */
export function CardDetail({
  card,
  level,
  onClose,
  highlightUpgrade,
  collection,
}: CardDetailProps): ReactElement {
  const def = CARDS[card];
  const status = collection === undefined ? 'owned' : cardStatus(collection.player, card);
  const owned = collection?.player.cards[card];
  // Cards that are not owned show their level 1 values.
  const shownLevel = collection === undefined ? level : (owned?.level ?? 1);
  const showNext = collection !== undefined && owned !== undefined && shownLevel < MAX_LEVEL;
  const rows = statRows(
    getCardStats(card, shownLevel),
    showNext ? getCardStats(card, shownLevel + 1) : null,
  );
  const arena = arenaOfCard(card);
  const states =
    collection !== undefined && owned !== undefined
      ? upgradeStates(owned, collection.player.gold)
      : null;
  return (
    <div className="modal" onClick={onClose} data-testid="card-detail-backdrop">
      <div
        className={`dialog dialog--card card--${def.rarity}`}
        role="dialog"
        aria-modal="true"
        aria-label={cardName(card)}
        data-testid="card-detail"
        data-card={card}
        data-status={collection === undefined ? undefined : status}
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
          {status !== 'locked' && status !== 'missing' && (
            <span className="tag" data-testid="detail-level" data-level={shownLevel}>
              {t('detail.level', { level: shownLevel })}
            </span>
          )}
        </div>
        {status === 'locked' && (
          <p className="detail__note" data-testid="detail-locked">
            {t('detail.fromArena', { arena: arena.arena, elo: arena.minElo })}
          </p>
        )}
        {status === 'missing' && (
          <p className="detail__note" data-testid="detail-missing">
            {t('collection.notFound')}
          </p>
        )}
        <dl className="detail__stats">
          {rows.map((row) => (
            <div key={row.key} className="detail__row" data-testid={`detail-stat-${row.key}`}>
              <dt>{row.label}</dt>
              <dd>{previewText(row.value, row.next)}</dd>
            </div>
          ))}
        </dl>
        <p className="detail__text">{t(`card.${card}.text` as MessageKey)}</p>
        {collection !== undefined && <LevelUpSection card={card} c={collection} />}
        {(collection === undefined || owned !== undefined) && (
          <section className="detail__upgrades" data-testid="detail-upgrades">
            <h3 className="detail__upgrades-title">{t('detail.upgrades')}</h3>
            <ul className="upgrade-list">
              {Array.from({ length: UPGRADES_PER_CARD }, (_, i) => {
                const state = states?.[i];
                return (
                  <li
                    key={i}
                    className={`upgrade-row${highlightUpgrade === i ? ' upgrade-row--highlight' : ''}`}
                    data-testid={`detail-upgrade-${i}`}
                    data-highlight={highlightUpgrade === i}
                    data-state={state?.kind}
                  >
                    <span className="upgrade-row__body">
                      <span className="upgrade-row__name">{upgradeName(card, i)}</span>
                      <span className="upgrade-row__text">{upgradeText(card, i)}</span>
                    </span>
                    {collection !== undefined && state !== undefined && (
                      <UpgradeAction
                        index={i as UpgradeIndex}
                        state={state}
                        busy={collection.busy}
                        onUnlock={() => collection.onUnlockUpgrade(i as UpgradeIndex)}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        {collection !== undefined && <JokerSection card={card} c={collection} />}
        {collection?.error != null && (
          <p
            className="detail__error"
            role="alert"
            data-testid="detail-error"
            data-code={collection.error}
          >
            {collectionErrorText(collection.error)}
          </p>
        )}
      </div>
    </div>
  );
}
