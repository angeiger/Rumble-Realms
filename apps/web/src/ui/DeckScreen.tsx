import { CARD_IDS, CARDS, DECK_SIZE, type CardId, type UpgradeIndex } from '@rumble-realms/engine';
import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import type { PlayerState } from '../backend/types.ts';
import { useAccountStore } from '../game/accountStore.ts';
import { t } from '../i18n/index.ts';
import { uiErrorOf, type UiErrorCode } from './accountText.ts';
import { CardDetail } from './CardDetail.tsx';
import { cardName, useLongPress } from './CardView.tsx';
import {
  arenaOfCard,
  cardStatus,
  collectionErrorText,
  levelProgress,
  placeInDeck,
  progressText,
  type CardStatus,
} from './collection.ts';
import { FigureImage } from './FigureImage.tsx';
import { maskIndices } from './upgradeText.ts';
import { preloadFigures } from '../render/figureImages.ts';

function LockIcon(): ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M7 11V8a5 5 0 0 1 10 0v3"
        fill="none"
        stroke="var(--outline)"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <rect
        x="4.5"
        y="10.5"
        width="15"
        height="11"
        rx="3"
        fill="#ffc83a"
        stroke="var(--outline)"
        strokeWidth="2.4"
      />
    </svg>
  );
}

interface TileProps {
  card: CardId;
  status: CardStatus;
  level: number;
  /** Unlocked upgrades (bit mask); shown as small symbols. */
  upgradeMask: number;
  testId: string;
  /** Slot tiles show the place number instead of the "in deck" mark. */
  slotNumber?: number;
  inDeck?: boolean;
  selected?: boolean;
  /** Collection tiles: copies progress and the "level-up possible" hint. */
  progress?: { text: string; ratio: number; canLevel: boolean } | undefined;
  onTap: () => void;
  onInfo: () => void;
}

/** Small card: figure, name, level. Tap = `onTap`, long press = `onInfo`. */
function Tile({
  card,
  status,
  level,
  upgradeMask,
  testId,
  slotNumber,
  inDeck = false,
  selected = false,
  progress,
  onTap,
  onInfo,
}: TileProps): ReactElement {
  const press = useLongPress(onInfo);
  const name = cardName(card);
  const owned = status === 'owned';
  const upgrades = maskIndices(upgradeMask);
  return (
    <div
      className={`tile card--${CARDS[card].rarity}${selected ? ' tile--selected' : ''}${
        inDeck ? ' tile--in-deck' : ''
      }${owned ? '' : ' tile--gray'}`}
      data-testid={testId}
      data-card={card}
      data-selected={selected}
      data-in-deck={inDeck}
      data-status={status}
      data-can-level={progress?.canLevel ?? false}
      role="button"
      tabIndex={0}
      aria-pressed={slotNumber !== undefined ? selected : undefined}
      aria-label={slotNumber !== undefined ? `${t('deck.slot', { n: slotNumber })}: ${name}` : name}
      {...press.handlers}
      onClick={() => {
        if (!press.consumeClick()) onTap();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onTap();
        }
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="tile__art">
        <FigureImage card={card} />
        {owned && <span className="tile__level">{t('detail.level', { level })}</span>}
        {owned && (
          <span
            className="tile__upgrades"
            data-testid="tile-upgrades"
            data-count={upgrades.length}
            role="img"
            aria-label={t('deck.upgradesUnlocked', { count: upgrades.length })}
          >
            {upgrades.map((i) => (
              <span className="tile__upgrade" key={i} />
            ))}
          </span>
        )}
        {slotNumber !== undefined && <span className="tile__slot">{slotNumber}</span>}
        {inDeck && slotNumber === undefined && (
          <span className="tile__mark">{t('deck.inDeck')}</span>
        )}
        {progress?.canLevel === true && (
          <span
            className="tile__up"
            data-testid="tile-can-level"
            aria-label={t('collection.canLevel')}
          >
            ▲
          </span>
        )}
      </div>
      <div className="tile__name" style={{ '--len': name.length } as CSSProperties}>
        {name}
      </div>
      {progress !== undefined && owned && (
        <div className="tile__progress" data-testid="tile-progress">
          <span className="tile__bar">
            <span
              className="tile__bar-fill"
              style={{ width: `${Math.round(progress.ratio * 100)}%` }}
            />
          </span>
          <span className="tile__progress-text">{progress.text}</span>
        </div>
      )}
      {status === 'locked' && (
        <div className="tile__note" data-testid="tile-locked">
          <LockIcon />
          <span>{t('collection.arena', { n: arenaOfCard(card).arena })}</span>
        </div>
      )}
      {status === 'missing' && (
        <div className="tile__note" data-testid="tile-missing">
          {t('collection.notFound')}
        </div>
      )}
    </div>
  );
}

export interface DeckViewProps {
  player: PlayerState;
  busy: boolean;
  onSetDeck: (cards: CardId[]) => Promise<UiErrorCode | null>;
  onLevelUp: (card: CardId) => Promise<UiErrorCode | null>;
  onUnlockUpgrade: (card: CardId, upgrade: UpgradeIndex) => Promise<UiErrorCode | null>;
  onSpendJokers: (card: CardId) => Promise<UiErrorCode | null>;
  /** Only for tests. */
  initialDetail?: CardId;
  initialSlot?: number;
  initialError?: UiErrorCode;
}

/** "Deck" tab: four places on top, all cards of the game below (SPEC 10, D-087). */
export function DeckView({
  player,
  busy,
  onSetDeck,
  onLevelUp,
  onUnlockUpgrade,
  onSpendJokers,
  initialDetail,
  initialSlot,
  initialError,
}: DeckViewProps): ReactElement {
  const [slot, setSlotChoice] = useState<number | null>(initialSlot ?? null);
  const [detail, setDetail] = useState<CardId | null>(initialDetail ?? null);
  /** Deck shown before the server has answered (optimistic); null = the server's deck. */
  const [optimistic, setOptimistic] = useState<CardId[] | null>(null);
  const [error, setError] = useState<UiErrorCode | null>(initialError ?? null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const id = window.setTimeout(() => preloadFigures(CARD_IDS), 100);
    return () => {
      alive.current = false;
      window.clearTimeout(id);
    };
  }, []);

  const deck = optimistic ?? player.deck;

  const run = async (action: () => Promise<UiErrorCode | null>): Promise<void> => {
    setError(null);
    const code = await action();
    if (alive.current) setError(code);
  };

  const changeDeck = async (next: CardId[]): Promise<void> => {
    setOptimistic(next);
    await run(() => onSetDeck(next));
    // Success: the player was reloaded. Failure: back to the server's deck.
    if (alive.current) setOptimistic(null);
  };

  const pickSlot = (i: number): void => {
    if (busy) return;
    setSlotChoice((cur) => (cur === i ? null : i));
  };
  const openDetail = (card: CardId): void => {
    setError(null);
    setDetail(card);
  };
  const pickCard = (card: CardId): void => {
    if (slot === null || cardStatus(player, card) !== 'owned') {
      openDetail(card);
      return;
    }
    if (busy) return;
    const next = placeInDeck(deck, slot, card);
    setSlotChoice(null);
    if (next.some((c, i) => c !== deck[i])) void changeDeck(next);
  };

  const hint = slot === null ? t('deck.slotHint') : t('deck.slotChosen', { n: slot + 1 });
  const detailOwned = detail === null ? undefined : player.cards[detail];

  return (
    <main className="deck-screen" data-testid="deck-screen" data-busy={busy}>
      <h1 className="deck-screen__title">{t('deck.title')}</h1>
      <div className="deck-slots">
        {Array.from({ length: DECK_SIZE }, (_, i) => {
          const card = deck[i];
          if (card === undefined) return null;
          const owned = player.cards[card];
          return (
            <Tile
              key={i}
              card={card}
              status={cardStatus(player, card)}
              level={owned?.level ?? 1}
              upgradeMask={owned?.unlockedUpgrades ?? 0}
              testId={`deck-slot-${i}`}
              slotNumber={i + 1}
              selected={slot === i}
              onTap={() => pickSlot(i)}
              onInfo={() => openDetail(card)}
            />
          );
        })}
      </div>
      <p className="deck-screen__hint" data-testid="deck-hint" data-slot={slot ?? ''}>
        {hint}
      </p>
      {error !== null && detail === null && (
        <p className="deck-screen__error" role="alert" data-testid="deck-error" data-code={error}>
          {collectionErrorText(error)}
        </p>
      )}
      <h2 className="deck-screen__subtitle">{t('deck.allCards')}</h2>
      <div className="deck-grid-scroll">
        <div className="deck-grid" data-testid="deck-grid">
          {CARD_IDS.map((card) => {
            const owned = player.cards[card];
            const status = cardStatus(player, card);
            const p = owned === undefined ? undefined : levelProgress(card, owned, player.gold);
            return (
              <Tile
                key={card}
                card={card}
                status={status}
                level={owned?.level ?? 1}
                upgradeMask={owned?.unlockedUpgrades ?? 0}
                testId={`deck-card-${card}`}
                inDeck={deck.includes(card)}
                progress={
                  p === undefined
                    ? undefined
                    : { text: progressText(p), ratio: p.ratio, canLevel: p.canLevel }
                }
                onTap={() => pickCard(card)}
                onInfo={() => openDetail(card)}
              />
            );
          })}
        </div>
        <p className="deck-screen__hint deck-screen__hint--end">{t('deck.detailHint')}</p>
      </div>
      {detail !== null && (
        <CardDetail
          card={detail}
          level={detailOwned?.level ?? 1}
          onClose={() => setDetail(null)}
          collection={{
            player,
            busy,
            error,
            onLevelUp: () => void run(() => onLevelUp(detail)),
            onUnlockUpgrade: (upgrade) => void run(() => onUnlockUpgrade(detail, upgrade)),
            onSpendJokers: () => void run(() => onSpendJokers(detail)),
          }}
        />
      )}
    </main>
  );
}

/** Container: connects the view to the account store. */
export function DeckScreen({ player }: { player: PlayerState }): ReactElement {
  const busy = useAccountStore((s) => s.busy);
  const setDeck = useAccountStore((s) => s.setDeck);
  const levelUp = useAccountStore((s) => s.levelUp);
  const unlockUpgrade = useAccountStore((s) => s.unlockUpgrade);
  const spendJokers = useAccountStore((s) => s.spendJokers);
  return (
    <DeckView
      player={player}
      busy={busy}
      onSetDeck={async (cards) => uiErrorOf(await setDeck(cards))}
      onLevelUp={async (card) => uiErrorOf(await levelUp(card))}
      onUnlockUpgrade={async (card, upgrade) => uiErrorOf(await unlockUpgrade(card, upgrade))}
      onSpendJokers={async (card) => uiErrorOf(await spendJokers(card, 1))}
    />
  );
}
