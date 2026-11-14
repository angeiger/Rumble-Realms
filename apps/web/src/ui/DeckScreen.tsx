import { CARD_IDS, CARDS, DECK_SIZE, type CardId } from '@rumble-realms/engine';
import { useEffect, useState, type ReactElement } from 'react';
import { levelOf, useDeckStore } from '../game/deckStore.ts';
import { t } from '../i18n/index.ts';
import { CardDetail } from './CardDetail.tsx';
import { cardName, useLongPress } from './CardView.tsx';
import { FigureImage } from './FigureImage.tsx';
import { preloadFigures } from '../render/figureImages.ts';

interface TileProps {
  card: CardId;
  level: number;
  testId: string;
  /** Slot tiles show the place number instead of the "in deck" mark. */
  slotNumber?: number;
  inDeck?: boolean;
  selected?: boolean;
  onTap: () => void;
  onInfo: () => void;
}

/** Small card: figure, name, level. Tap = `onTap`, long press = `onInfo`. */
function Tile({
  card,
  level,
  testId,
  slotNumber,
  inDeck = false,
  selected = false,
  onTap,
  onInfo,
}: TileProps): ReactElement {
  const press = useLongPress(onInfo);
  const name = cardName(card);
  return (
    <div
      className={`tile card--${CARDS[card].rarity}${selected ? ' tile--selected' : ''}${
        inDeck ? ' tile--in-deck' : ''
      }`}
      data-testid={testId}
      data-card={card}
      data-selected={selected}
      data-in-deck={inDeck}
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
        <span className="tile__level">{t('detail.level', { level })}</span>
        {slotNumber !== undefined && <span className="tile__slot">{slotNumber}</span>}
        {inDeck && slotNumber === undefined && (
          <span className="tile__mark">{t('deck.inDeck')}</span>
        )}
      </div>
      <div className="tile__name">{name}</div>
    </div>
  );
}

/** "Deck" tab: four places on top, all cards below (D-048). */
export function DeckScreen(): ReactElement {
  const deck = useDeckStore((s) => s.deck);
  const levels = useDeckStore((s) => s.levels);
  const setSlot = useDeckStore((s) => s.setSlot);
  const setLevel = useDeckStore((s) => s.setLevel);
  const [slot, setSlotChoice] = useState<number | null>(null);
  const [detail, setDetail] = useState<CardId | null>(null);

  useEffect(() => {
    const id = window.setTimeout(() => preloadFigures(CARD_IDS), 100);
    return () => window.clearTimeout(id);
  }, []);

  const pickSlot = (i: number): void => setSlotChoice((cur) => (cur === i ? null : i));
  const pickCard = (card: CardId): void => {
    if (slot === null) {
      setDetail(card);
      return;
    }
    setSlot(slot, card);
    setSlotChoice(null);
  };

  const hint = slot === null ? t('deck.slotHint') : t('deck.slotChosen', { n: slot + 1 });

  return (
    <main className="deck-screen" data-testid="deck-screen">
      <h1 className="deck-screen__title">{t('deck.title')}</h1>
      <div className="deck-slots">
        {Array.from({ length: DECK_SIZE }, (_, i) => {
          const card = deck[i] as CardId;
          return (
            <Tile
              key={i}
              card={card}
              level={levelOf(levels, card)}
              testId={`deck-slot-${i}`}
              slotNumber={i + 1}
              selected={slot === i}
              onTap={() => pickSlot(i)}
              onInfo={() => setDetail(card)}
            />
          );
        })}
      </div>
      <p className="deck-screen__hint" data-testid="deck-hint" data-slot={slot ?? ''}>
        {hint}
      </p>
      <h2 className="deck-screen__subtitle">{t('deck.allCards')}</h2>
      <div className="deck-grid-scroll">
        <div className="deck-grid" data-testid="deck-grid">
          {CARD_IDS.map((card) => (
            <Tile
              key={card}
              card={card}
              level={levelOf(levels, card)}
              testId={`deck-card-${card}`}
              inDeck={deck.includes(card)}
              onTap={() => pickCard(card)}
              onInfo={() => setDetail(card)}
            />
          ))}
        </div>
        <p className="deck-screen__hint deck-screen__hint--end">{t('deck.detailHint')}</p>
      </div>
      {detail !== null && (
        <CardDetail
          card={detail}
          level={levelOf(levels, detail)}
          onClose={() => setDetail(null)}
          onLevelChange={(level) => setLevel(detail, level)}
        />
      )}
    </main>
  );
}
