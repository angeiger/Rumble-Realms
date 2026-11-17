import { BOT_LEVELS, CARD_IDS, upgradesForLevel, type BotLevelId } from '@rumble-realms/engine';
import { botProfileOf } from '@rumble-realms/shared';
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import type { PlayerState } from '../backend/types.ts';
import { currentArena } from '../game/accountStore.ts';
import { BOT_LEVEL_IDS } from '../game/botStore.ts';
import type { StartError } from '../game/store.ts';
import { t, type MessageKey } from '../i18n/index.ts';
import { preloadFigures } from '../render/figureImages.ts';
import { cardName } from './CardView.tsx';
import { FigureImage } from './FigureImage.tsx';
import { maskIndices } from './upgradeText.ts';

function upgradesText(count: number): string {
  if (count === 0) return t('botLevel.upgradesNone');
  return count === 1 ? t('botLevel.upgradesOne') : t('botLevel.upgradesMany', { count });
}

/** Three buttons for the bot level and a line with the card level of the chosen one (D-073). */
export function BotLevelPicker({
  value,
  onChange,
}: {
  value: BotLevelId;
  onChange: (level: BotLevelId) => void;
}): ReactElement {
  const info = BOT_LEVELS[value];
  return (
    <div className="bot-picker" data-testid="bot-picker">
      <span className="bot-picker__label" id="bot-picker-label">
        {t('title.botLevel')}
      </span>
      <div className="bot-picker__buttons" role="radiogroup" aria-labelledby="bot-picker-label">
        {BOT_LEVEL_IDS.map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={id === value}
            className={`bot-picker__btn${id === value ? ' bot-picker__btn--on' : ''}`}
            data-testid={`bot-level-${id}`}
            onClick={() => onChange(id)}
          >
            {t(`botLevel.${id}`)}
          </button>
        ))}
      </div>
      <span className="bot-picker__info" data-testid="bot-level-info">
        {t('botLevel.info', {
          level: info.cardLevel,
          upgrades: upgradesText(maskIndices(upgradesForLevel(info.cardLevel)).length),
        })}
      </span>
    </div>
  );
}

/** Display name of an arena (SPEC 7.5). */
export function arenaName(arena: number): string {
  return t(`arena.${Math.min(5, Math.max(1, arena))}` as MessageKey);
}

/** Explains why a match could not be started; "engine_mismatch" offers a reload. */
export function StartErrorNotice({
  error,
  onReload,
}: {
  error: StartError;
  onReload: () => void;
}): ReactElement {
  if (error === 'engine_mismatch') {
    return (
      <div className="notice" data-testid="start-error" role="alert">
        <p>{t('title.engineMismatch')}</p>
        <button
          type="button"
          className="btn btn--small"
          data-testid="start-error-reload"
          onClick={onReload}
        >
          {t('title.reload')}
        </button>
      </div>
    );
  }
  return (
    <div className="notice" data-testid="start-error" role="alert">
      <p>{error === 'unavailable' ? t('title.noConnection') : t('title.startFailed')}</p>
    </div>
  );
}

/** The unfinished match: resume it, or give up (counts as a loss, asks first). */
export function PendingMatchBox({
  botName,
  disabled,
  onResume,
  onForfeit,
  initialConfirming = false,
}: {
  botName: string;
  disabled: boolean;
  onResume: () => void;
  onForfeit: () => void;
  /** Only for tests. */
  initialConfirming?: boolean;
}): ReactElement {
  const [confirming, setConfirming] = useState(initialConfirming);
  return (
    <div className="pending-match" data-testid="pending-match">
      <p className="pending-match__title">{t('pending.title', { name: botName })}</p>
      <button
        type="button"
        className="btn btn--big"
        data-testid="pending-resume"
        disabled={disabled}
        onClick={onResume}
      >
        {t('pending.resume')}
      </button>
      {confirming ? (
        <div className="pending-match__ask" data-testid="pending-forfeit-ask" role="alertdialog">
          <p>{t('pending.forfeitAsk')}</p>
          <div className="form-buttons">
            <button
              type="button"
              className="btn btn--small"
              data-testid="pending-forfeit-yes"
              disabled={disabled}
              onClick={() => {
                setConfirming(false);
                onForfeit();
              }}
            >
              {t('pending.forfeitYes')}
            </button>
            <button
              type="button"
              className="btn btn--small btn--quiet"
              data-testid="pending-forfeit-no"
              onClick={() => setConfirming(false)}
            >
              {t('pending.forfeitNo')}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="btn btn--small btn--quiet"
          data-testid="pending-forfeit"
          disabled={disabled}
          onClick={() => setConfirming(true)}
        >
          {t('pending.forfeit')}
        </button>
      )}
    </div>
  );
}

export interface TitleScreenProps {
  player: PlayerState;
  botLevel: BotLevelId;
  onBotLevel: (level: BotLevelId) => void;
  /** `create_match` is running. */
  starting: boolean;
  startError: StartError | null;
  onPlay: () => void;
  onResume: () => void;
  onForfeit: () => void;
  /** Reloads the page (after "engine_mismatch"); defaults to `location.reload()`. */
  onReload?: () => void;
  /** Room below the fight button for other packages (e.g. "open packs"). */
  extra?: ReactNode;
  /** Only for tests. */
  initialConfirming?: boolean;
}

/** "Kampf" tab: arena, fight button (or the open match), bot level and a small view of the deck. */
export function TitleScreen({
  player,
  botLevel,
  onBotLevel,
  starting,
  startError,
  onPlay,
  onResume,
  onForfeit,
  onReload = () => window.location.reload(),
  extra,
  initialConfirming,
}: TitleScreenProps): ReactElement {
  // Draw the card figures while the player is still on the title screen.
  useEffect(() => {
    const id = window.setTimeout(() => preloadFigures(CARD_IDS), 200);
    return () => window.clearTimeout(id);
  }, []);
  const arena = currentArena(player);
  const pending = player.pendingMatch;
  const botName = pending ? (botProfileOf(pending.botProfile)?.name ?? t('battle.bot')) : '';
  return (
    <main className="title-screen" data-testid="title-screen" data-arena={arena}>
      <div className="title-center">
        <p className="arena-name" data-testid="arena-name">
          {arenaName(arena)}
        </p>
        <h1 className="logo">{t('app.title')}</h1>
        {pending ? (
          <PendingMatchBox
            botName={botName}
            disabled={starting}
            onResume={onResume}
            onForfeit={onForfeit}
            initialConfirming={initialConfirming ?? false}
          />
        ) : (
          <button
            type="button"
            className="btn btn--big"
            data-testid="play-button"
            disabled={starting}
            aria-busy={starting}
            onClick={onPlay}
          >
            {starting && (
              <span className="spinner" data-testid="starting-spinner" aria-hidden="true" />
            )}
            {starting ? t('title.starting') : t('title.fight')}
          </button>
        )}
        {startError !== null && <StartErrorNotice error={startError} onReload={onReload} />}
        {extra}
        <BotLevelPicker value={botLevel} onChange={onBotLevel} />
        <div className="mini-deck" data-testid="mini-deck" aria-label={t('title.yourDeck')}>
          {player.deck.map((card) => (
            <div className="mini-deck__card" key={card} data-card={card}>
              <FigureImage card={card} />
              <span className="mini-deck__name">{cardName(card)}</span>
              <span className="mini-deck__level">
                {t('detail.level', { level: player.cards[card]?.level ?? 1 })}
              </span>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
