import type { ReactElement, ReactNode } from 'react';
import { t } from '../i18n/index.ts';
import { CoinIcon, JokerIcon, TrophyIcon } from './icons.tsx';

export interface StatBarProps {
  username: string;
  elo: number;
  gold: number;
  jokers: number;
}

function Stat({
  id,
  label,
  icon,
  value,
}: {
  id: string;
  label: string;
  icon: ReactNode;
  value: number;
}): ReactElement {
  return (
    <span
      className="stat-bar__stat"
      data-testid={id}
      role="group"
      aria-label={`${label}: ${value}`}
    >
      {icon}
      <span className="stat-bar__value">{value}</span>
    </span>
  );
}

/** Header of the menu screens: name, Elo, gold and jokers. Takes the top safe area. */
export function StatBar({ username, elo, gold, jokers }: StatBarProps): ReactElement {
  return (
    <header className="stat-bar" data-testid="stat-bar">
      <span className="stat-bar__name" data-testid="stat-name">
        {username}
      </span>
      <Stat id="stat-elo" label={t('stat.elo')} icon={<TrophyIcon />} value={elo} />
      <Stat id="stat-gold" label={t('stat.gold')} icon={<CoinIcon />} value={gold} />
      <Stat id="stat-jokers" label={t('stat.jokers')} icon={<JokerIcon />} value={jokers} />
    </header>
  );
}
