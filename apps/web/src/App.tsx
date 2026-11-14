import { useGameStore } from './game/store.ts';
import { t } from './i18n/index.ts';
import { BattleScreen } from './ui/BattleScreen.tsx';
import { TitleScreen } from './ui/TitleScreen.tsx';

export function App() {
  const screen = useGameStore((s) => s.screen);
  const startMatch = useGameStore((s) => s.startMatch);
  return (
    <div className="app-shell">
      <div className="app-column">
        {screen === 'title' ? <TitleScreen onPlay={startMatch} /> : <BattleScreen />}
      </div>
      <div className="rotate-hint" role="alert">
        <span className="rotate-hint__icon" aria-hidden="true">
          ⟳
        </span>
        <span>{t('rotate.hint')}</span>
      </div>
    </div>
  );
}
