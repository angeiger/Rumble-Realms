import type { ReactElement } from 'react';
import type { Tab } from '../game/store.ts';
import { t } from '../i18n/index.ts';
import { CardsIcon, SwordsIcon } from './icons.tsx';

export interface TabBarProps {
  tab: Tab;
  onSelect: (tab: Tab) => void;
}

/** Bottom navigation of the menu screens: "Kampf" and "Deck". Not shown during a battle. */
export function TabBar({ tab, onSelect }: TabBarProps): ReactElement {
  const item = (id: Tab, label: string, icon: ReactElement): ReactElement => (
    <button
      type="button"
      className={`tabbar__item${tab === id ? ' tabbar__item--active' : ''}`}
      data-testid={`tab-${id}`}
      aria-current={tab === id ? 'page' : undefined}
      onClick={() => onSelect(id)}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
  return (
    <nav className="tabbar" aria-label={t('tab.nav')} data-testid="tab-bar">
      {item('battle', t('tab.battle'), <SwordsIcon />)}
      {item('deck', t('tab.deck'), <CardsIcon />)}
    </nav>
  );
}
