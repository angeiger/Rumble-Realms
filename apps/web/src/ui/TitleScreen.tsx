import { CARD_IDS, ENGINE_VERSION, type CardId } from '@rumble-realms/engine';
import { useEffect, type ReactElement } from 'react';
import { preloadFigures } from '../render/figureImages.ts';
import { levelOf, type CardLevels } from '../game/deckStore.ts';
import { t } from '../i18n/index.ts';
import { cardName } from './CardView.tsx';
import { FigureImage } from './FigureImage.tsx';

/** "Kampf" tab: title, play button and a small view of the current deck. */
export function TitleScreen({
  onPlay,
  deck,
  levels,
}: {
  onPlay: () => void;
  deck: readonly CardId[];
  levels: CardLevels;
}): ReactElement {
  // Draw the card figures while the player is still on the title screen.
  useEffect(() => {
    const id = window.setTimeout(() => preloadFigures(CARD_IDS), 200);
    return () => window.clearTimeout(id);
  }, []);
  return (
    <main className="title-screen" data-testid="title-screen">
      <div className="title-center">
        <h1 className="logo">{t('app.title')}</h1>
        <button type="button" className="btn btn--big" data-testid="play-button" onClick={onPlay}>
          {t('title.play')}
        </button>
        <p className="hint">{t('title.prototype')}</p>
        <div className="mini-deck" data-testid="mini-deck" aria-label={t('title.yourDeck')}>
          {deck.map((card) => (
            <div className="mini-deck__card" key={card} data-card={card}>
              <FigureImage card={card} />
              <span className="mini-deck__name">{cardName(card)}</span>
              <span className="mini-deck__level">
                {t('detail.level', { level: levelOf(levels, card) })}
              </span>
            </div>
          ))}
        </div>
      </div>
      <footer className="version">
        {t('title.engineVersion', { version: ENGINE_VERSION })}
        {__BUILD_ID__ ? ` · ${t('title.buildId', { id: __BUILD_ID__ })}` : ''}
      </footer>
    </main>
  );
}
