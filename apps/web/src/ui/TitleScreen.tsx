import { CARD_IDS, ENGINE_VERSION } from '@rumble-realms/engine';
import { useEffect, type ReactElement } from 'react';
import { preloadFigures } from '../render/figureImages.ts';
import { t } from '../i18n/index.ts';

export function TitleScreen({ onPlay }: { onPlay: () => void }): ReactElement {
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
      </div>
      <footer className="version">
        {t('title.engineVersion', { version: ENGINE_VERSION })}
        {__BUILD_ID__ ? ` · ${t('title.buildId', { id: __BUILD_ID__ })}` : ''}
      </footer>
    </main>
  );
}
