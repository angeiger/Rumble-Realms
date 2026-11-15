import type { CardId } from '@rumble-realms/engine';
import { useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../i18n/index.ts';
import type { Team } from '../render/figures.ts';
import { cardName } from './CardView.tsx';
import { FigureImage } from './FigureImage.tsx';
import { CloseIcon } from './icons.tsx';
import {
  activeUpgradeList,
  type ActiveUpgrade,
  maskIndices,
  upgradeName,
  upgradeText,
} from './upgradeText.ts';

export interface ActiveUpgradesProps {
  /** Activated upgrade masks of one player (SPEC 4.5). */
  masks: Partial<Record<CardId, number>>;
  /** Shown in the aria label and the list title. */
  name: string;
  team: Team;
  testId: string;
}

/**
 * Small symbols next to the lives: one mini figure per unit with active upgrades and one dot per
 * upgrade. Tapping opens a list with name and effect. Renders nothing without active upgrades.
 */
/** Dialog with name and effect of every listed upgrade. */
export function UpgradeList({
  list,
  name,
  team,
  onClose,
}: {
  list: ActiveUpgrade[];
  name: string;
  team: Team;
  onClose: () => void;
}): ReactElement {
  return (
    <div className="modal" onClick={onClose} data-testid="upgrade-list-backdrop">
      <div
        className="dialog dialog--small upg-list"
        role="dialog"
        aria-modal="true"
        aria-label={t('battle.upgradesOf', { name })}
        data-testid="upgrade-list"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="dialog__close"
          aria-label={t('detail.close')}
          data-testid="upgrade-list-close"
          onClick={onClose}
        >
          <CloseIcon />
        </button>
        <h2 className="dialog__title upg-list__title">{t('battle.upgradesOf', { name })}</h2>
        <ul className="upg-list__items">
          {list.map(({ card, index }) => (
            <li className="upg-list__item" key={`${card}.${index}`} data-card={card}>
              <span className="upg-list__fig">
                <FigureImage card={card} team={team} />
              </span>
              <span className="upg-list__body">
                <span className="upg-list__name">
                  {`${cardName(card)} – ${upgradeName(card, index)}`}
                </span>
                <span className="upg-list__text">{upgradeText(card, index)}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function ActiveUpgrades({
  masks,
  name,
  team,
  testId,
}: ActiveUpgradesProps): ReactElement | null {
  // The list is a dialog over the whole battle screen, not inside the (small) header or status line.
  const [host, setHost] = useState<Element | null>(null);
  const list = activeUpgradeList(masks);
  if (list.length === 0) return null;
  const cards = [...new Set(list.map((u) => u.card))];
  return (
    <>
      <button
        type="button"
        className="upg-strip"
        data-testid={testId}
        data-count={list.length}
        aria-label={t('battle.upgradesCount', { name, count: list.length })}
        onClick={(e) => setHost(e.currentTarget.closest('.battle') ?? document.body)}
      >
        {cards.map((card) => (
          <span className="upg-chip" key={card} data-card={card}>
            <FigureImage card={card} team={team} />
            <span className="upg-chip__dots" aria-hidden="true">
              {maskIndices(masks[card] ?? 0).map((i) => (
                <span className="upg-chip__dot" key={i} />
              ))}
            </span>
          </span>
        ))}
      </button>
      {host !== null &&
        createPortal(
          <UpgradeList list={list} name={name} team={team} onClose={() => setHost(null)} />,
          host,
        )}
    </>
  );
}
