import type { ReactElement } from 'react';
import type { Tab } from '../game/store.ts';
import { t } from '../i18n/index.ts';
import { CardsIcon, SwordsIcon } from './icons.tsx';

/** Order of the menu tabs from left to right (also the order of the swipe pages). */
export const TAB_ORDER: readonly Tab[] = ['deck', 'battle'];

export interface TabBarProps {
  tab: Tab;
  onSelect: (tab: Tab) => void;
}

/** Bottom navigation of the menu screens: "Deck" (left) and "Kampf" (right), the same order as the pages of the pager. Not shown during a battle. */
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
      {item('deck', t('tab.deck'), <CardsIcon />)}
      {item('battle', t('tab.battle'), <SwordsIcon />)}
    </nav>
  );
}
