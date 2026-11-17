import type { ReactElement } from 'react';
import { t } from '../i18n/index.ts';
import { PackChest } from './PackChest.tsx';

export interface PackButtonProps {
  count: number;
  onClick: () => void;
}

/** "Open pack" button of the battle tab; only shown while unopened packs wait. */
export function PackButton({ count, onClick }: PackButtonProps): ReactElement | null {
  if (count <= 0) return null;
  return (
    <button
      type="button"
      className="btn btn--blue pack-button"
      data-testid="pack-button"
      data-count={count}
      aria-label={t('pack.buttonCount', { n: count })}
      onClick={onClick}
    >
      <PackChest size={40} />
      <span>{t('pack.button')}</span>
      <span className="pack-button__count" data-testid="pack-button-count">
        {count}
      </span>
    </button>
  );
}
