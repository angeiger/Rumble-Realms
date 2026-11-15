import {
  BOT_LEVELS,
  CARD_IDS,
  ENGINE_VERSION,
  upgradesForLevel,
  type BotLevelId,
  type CardId,
} from '@rumble-realms/engine';
import { useEffect, type ReactElement } from 'react';
import { preloadFigures } from '../render/figureImages.ts';
import { BOT_LEVEL_IDS } from '../game/botStore.ts';
import { levelOf, type CardLevels } from '../game/deckStore.ts';
import { t } from '../i18n/index.ts';
import { cardName } from './CardView.tsx';
import { FigureImage } from './FigureImage.tsx';
import { maskIndices } from './upgradeText.ts';

function upgradesText(count: number): string {
  if (count === 0) return t('botLevel.upgradesNone');
  return count === 1 ? t('botLevel.upgradesOne') : t('botLevel.upgradesMany', { count });
}

/** Three buttons for the bot level and a line with the card level of the chosen one (D-073). */
export function BotLevelPicker({
  value,
  onChange,
}: {
  value: BotLevelId;
  onChange: (level: BotLevelId) => void;
}): ReactElement {
  const info = BOT_LEVELS[value];
  return (
    <div className="bot-picker" data-testid="bot-picker">
      <span className="bot-picker__label" id="bot-picker-label">
        {t('title.botLevel')}
      </span>
      <div className="bot-picker__buttons" role="radiogroup" aria-labelledby="bot-picker-label">
        {BOT_LEVEL_IDS.map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={id === value}
            className={`bot-picker__btn${id === value ? ' bot-picker__btn--on' : ''}`}
            data-testid={`bot-level-${id}`}
            onClick={() => onChange(id)}
          >
            {t(`botLevel.${id}`)}
          </button>
        ))}
      </div>
      <span className="bot-picker__info" data-testid="bot-level-info">
        {t('botLevel.info', {
          level: info.cardLevel,
          upgrades: upgradesText(maskIndices(upgradesForLevel(info.cardLevel)).length),
        })}
      </span>
    </div>
  );
}

/** "Kampf" tab: title, play button and a small view of the current deck. */
export function TitleScreen({
  onPlay,
  deck,
  levels,
  botLevel,
  onBotLevel,
}: {
  onPlay: () => void;
  deck: readonly CardId[];
  levels: CardLevels;
  botLevel: BotLevelId;
  onBotLevel: (level: BotLevelId) => void;
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
        <BotLevelPicker value={botLevel} onChange={onBotLevel} />
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
