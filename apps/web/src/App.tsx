import { ENGINE_VERSION } from '@rumble-realms/engine';
import { t } from './i18n/index.ts';

export function App() {
  return (
    <main className="title-screen">
      <div className="title-center">
        <h1 className="logo">{t('app.title')}</h1>
        <p className="hint">{t('title.underConstruction')}</p>
      </div>
      <footer className="version">
        {t('title.engineVersion', { version: ENGINE_VERSION })}
        {__BUILD_ID__ ? ` · ${t('title.buildId', { id: __BUILD_ID__ })}` : ''}
      </footer>
    </main>
  );
}
