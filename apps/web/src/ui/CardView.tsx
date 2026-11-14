import type { CardId } from '@rumble-realms/engine';
import { CARDS } from '@rumble-realms/engine';
import { useEffect, useRef, type CSSProperties, type PointerEvent, type ReactElement } from 'react';
import { t, type MessageKey } from '../i18n/index.ts';
import { formatNumber, getCardStats, type CardStats } from './cardStats.ts';
import { FigureImage } from './FigureImage.tsx';
import {
  ClockIcon,
  DamageIcon,
  HealIcon,
  HpIcon,
  InfoIcon,
  RangeIcon,
  SpeedIcon,
} from './icons.tsx';

/** Press duration that opens the detail view (SPEC 4.3). */
export const LONG_PRESS_MS = 450;
const MOVE_TOLERANCE_PX = 10;

export function cardName(card: CardId): string {
  return t(`card.${card}.name` as MessageKey);
}

export function rangeText(s: CardStats): string {
  if (s.rangeKind === 'melee') return t('detail.rangeMelee');
  if (s.rangeKind === 'contact') return t('detail.rangeContact');
  return formatNumber(s.range);
}

/** Long press without a tap afterwards: `consumeClick()` tells the click handler to ignore it. */
export function useLongPress(onLongPress: () => void) {
  const timer = useRef<number | null>(null);
  const fired = useRef(false);
  const origin = useRef({ x: 0, y: 0 });
  const cancel = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => cancel, []);
  return {
    handlers: {
      onPointerDown(e: PointerEvent) {
        cancel();
        fired.current = false;
        origin.current = { x: e.clientX, y: e.clientY };
        timer.current = window.setTimeout(() => {
          timer.current = null;
          fired.current = true;
          onLongPress();
        }, LONG_PRESS_MS);
      },
      onPointerMove(e: PointerEvent) {
        const dx = e.clientX - origin.current.x;
        const dy = e.clientY - origin.current.y;
        if (dx * dx + dy * dy > MOVE_TOLERANCE_PX * MOVE_TOLERANCE_PX) cancel();
      },
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onPointerLeave: cancel,
    },
    consumeClick(): boolean {
      const was = fired.current;
      fired.current = false;
      return was;
    },
  };
}

export interface CardViewProps {
  card: CardId;
  level: number;
  testId?: string;
  onTap?: () => void;
  onInfo?: () => void;
}

/** An offer card: figure, name, count, key values, frame colour by rarity. */
export function CardView({ card, level, testId, onTap, onInfo }: CardViewProps): ReactElement {
  const def = CARDS[card];
  const s = getCardStats(card, level);
  const press = useLongPress(() => onInfo?.());
  const name = cardName(card);
  return (
    <div
      className={`card card--${def.rarity}`}
      data-testid={testId}
      data-card={card}
      role="button"
      tabIndex={0}
      aria-label={name}
      {...press.handlers}
      onClick={() => {
        if (!press.consumeClick()) onTap?.();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onTap?.();
        }
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="card__art">
        <FigureImage card={card} />
        <span className="card__level">{t('detail.level', { level })}</span>
        <span className="card__count">{`×${s.count}`}</span>
        <button
          type="button"
          className="card__info"
          aria-label={t('draft.info', { name })}
          data-testid="card-info"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onInfo?.();
          }}
        >
          <InfoIcon size={18} />
        </button>
      </div>
      <div className="card__name" style={{ '--len': name.length } as CSSProperties}>
        {name}
      </div>
      <div className="card__stats">
        <span className="chip">
          <HpIcon />
          {formatNumber(s.hp)}
        </span>
        <span className="chip">
          {s.effectKind === 'heal' ? <HealIcon /> : <DamageIcon />}
          {formatNumber(s.effect)}
        </span>
      </div>
      <div className="card__stats card__stats--more">
        <span className="chip">
          {s.rangeKind !== 'contact' && <RangeIcon />}
          {rangeText(s)}
        </span>
        <span className="chip">
          <ClockIcon />
          {s.interval === null ? '–' : `${formatNumber(s.interval)} s`}
        </span>
        <span className="chip">
          <SpeedIcon />
          {formatNumber(s.speed)}
        </span>
      </div>
    </div>
  );
}

/** Face-down card while the opponent chooses. */
export function CardBack(): ReactElement {
  return (
    <div className="card card--back" aria-label={t('draft.hiddenCard')} data-testid="card-back">
      <span className="card__qmark">?</span>
    </div>
  );
}
