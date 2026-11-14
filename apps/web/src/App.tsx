import type { CardId } from '@rumble-realms/engine';
import { type CardLevels, useDeckStore } from './game/deckStore.ts';
import { type Screen, type Tab, useGameStore } from './game/store.ts';
import { t } from './i18n/index.ts';
import { BattleScreen } from './ui/BattleScreen.tsx';
import { DeckScreen } from './ui/DeckScreen.tsx';
import { TabBar } from './ui/TabBar.tsx';
import { TitleScreen } from './ui/TitleScreen.tsx';

export interface AppViewProps {
  screen: Screen;
  tab: Tab;
  deck: readonly CardId[];
  levels: CardLevels;
  onTab: (tab: Tab) => void;
  onPlay: () => void;
}

/** The whole app for given state: battle without tab bar, or menu tabs with the tab bar. */
export function AppView({ screen, tab, deck, levels, onTab, onPlay }: AppViewProps) {
  return (
    <div className="app-shell">
      <div className="app-column">
        {screen === 'battle' ? (
          <BattleScreen />
        ) : (
          <div className="menu">
            <div className="menu__main">
              {tab === 'deck' ? (
                <DeckScreen />
              ) : (
                <TitleScreen onPlay={onPlay} deck={deck} levels={levels} />
              )}
            </div>
            <TabBar tab={tab} onSelect={onTab} />
          </div>
        )}
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

export function App() {
  const screen = useGameStore((s) => s.screen);
  const tab = useGameStore((s) => s.tab);
  const setTab = useGameStore((s) => s.setTab);
  const startMatch = useGameStore((s) => s.startMatch);
  const deck = useDeckStore((s) => s.deck);
  const levels = useDeckStore((s) => s.levels);
  return (
    <AppView
      screen={screen}
      tab={tab}
      deck={deck}
      levels={levels}
      onTab={setTab}
      onPlay={startMatch}
    />
  );
}
