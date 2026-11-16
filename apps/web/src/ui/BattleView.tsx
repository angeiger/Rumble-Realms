import type { CardId } from '@rumble-realms/engine';
import {
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';
import { t } from '../i18n/index.ts';
import type { BattleSpeed, SessionSnapshot } from '../game/types.ts';
import { EdgeInsetsContext } from '../render/BattleCanvas.tsx';
import { NO_EDGE_INSETS, type EdgeInsets } from '../render/layout.ts';
import { CardDetail } from './CardDetail.tsx';
import { ActiveUpgrades } from './ActiveUpgrades.tsx';
import { cardName } from './CardView.tsx';
import { DraftBar } from './DraftBar.tsx';
import { Hearts } from './Hearts.tsx';
import { CloseIcon } from './icons.tsx';
import { ResultView } from './ResultView.tsx';
import { upgradeName } from './upgradeText.ts';

export interface BattleActions {
  play: (slot: number) => void;
  setSpeed: (speed: BattleSpeed) => void;
  leave: () => void;
  playAgain: () => void;
}

export interface BattleViewProps {
  snapshot: SessionSnapshot;
  actions: BattleActions;
  /** The field (the canvas); fills the whole screen, header and cards lie over it (D-043). */
  field: ReactNode;
}

/** "X plays Y (n)" note for the most recent pick, plus a note about forfeited units. */
export function LastPickHint({ snapshot }: { snapshot: SessionSnapshot }): ReactElement | null {
  const pick = snapshot.lastPick;
  if (snapshot.phase !== 'draft' || pick === null) return null;
  const card = cardName(pick.card);
  const count = pick.spawned.length + pick.forfeited;
  const mine = pick.player === snapshot.me;
  const name = snapshot.players[pick.player].name;
  let text: string;
  if (pick.kind === 'upgrade') {
    const upgrade = upgradeName(pick.card, pick.upgrade ?? 0);
    text = mine
      ? t('hint.youUpgrade', { card, upgrade })
      : t('hint.opponentUpgrade', { name, card, upgrade });
  } else if (pick.kind === 'double') {
    text = mine
      ? t('hint.youDouble', { card, count })
      : t('hint.opponentDouble', { name, card, count });
  } else {
    text = mine
      ? t('hint.youPlay', { card, count })
      : t('hint.opponentPlays', { name, card, count });
  }
  const key = `${snapshot.round}:${snapshot.picksLeft[0]}:${snapshot.picksLeft[1]}`;
  return (
    <div className="pick-hint" key={key} data-testid="pick-hint">
      <span
        className={`pick-hint__text pick-hint__text--p${pick.player === snapshot.me ? 'me' : 'opp'}`}
      >
        {text}
      </span>
      {pick.forfeited > 0 && (
        <span className="pick-hint__text pick-hint__text--warn">
          {pick.forfeited === 1
            ? t('hint.forfeitedOne')
            : t('hint.forfeited', { count: pick.forfeited })}
        </span>
      )}
    </div>
  );
}

export function RoundBanner({ snapshot }: { snapshot: SessionSnapshot }): ReactElement | null {
  const res = snapshot.roundResult;
  if (res === null) return null;
  const outcome =
    res.result.winner === 'draw' ? 'draw' : res.result.winner === snapshot.me ? 'win' : 'loss';
  return (
    <div className="round-banner-wrap">
      <div
        className={`round-banner round-banner--${outcome}`}
        data-testid="round-banner"
        data-outcome={outcome}
      >
        <span className="round-banner__title">{t(`round.${outcome}`)}</span>
        {res.result.reason === 'timeout' && (
          <span className="round-banner__reason">{t('round.timeout')}</span>
        )}
      </div>
    </div>
  );
}

/**
 * Measures the header (top) and a hidden probe that is as tall as the status line at the
 * bottom including the safe area; the field keeps clear of both (D-043).
 */
function useEdgeInsets(): {
  insets: EdgeInsets;
  headerRef: RefObject<HTMLElement | null>;
  probeRef: RefObject<HTMLDivElement | null>;
} {
  const headerRef = useRef<HTMLElement>(null);
  const probeRef = useRef<HTMLDivElement>(null);
  const [insets, setInsets] = useState<EdgeInsets>(NO_EDGE_INSETS);
  useLayoutEffect(() => {
    const header = headerRef.current;
    const probe = probeRef.current;
    if (header === null || probe === null) return;
    const measure = (): void => {
      // The header's scrim fades out over its last 14 px, so only part of it counts.
      const top = Math.max(0, header.offsetHeight - 6);
      const bottom = probe.offsetHeight;
      setInsets((cur) => (cur.top === top && cur.bottom === bottom ? cur : { top, bottom }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    observer.observe(probe);
    return () => observer.disconnect();
  }, []);
  return { insets, headerRef, probeRef };
}

/** Whole battle screen for one snapshot. Pure: all state of the game comes in via props. */
export function BattleView({ snapshot, actions, field }: BattleViewProps): ReactElement {
  const [detail, setDetail] = useState<{ card: CardId; upgrade?: number | undefined } | null>(null);
  const [leaving, setLeaving] = useState(false);
  const { insets, headerRef, probeRef } = useEdgeInsets();
  const { me, phase } = snapshot;
  const opp = me === 0 ? 1 : 0;
  const oppName = snapshot.players[opp].name;
  const inDraft = phase === 'draft';
  const showLoss = (phase === 'roundEnd' || phase === 'finished') && snapshot.roundResult !== null;
  const winner = snapshot.roundResult?.result.winner;
  const lostLife = (p: 0 | 1): boolean => showLoss && winner !== p;
  const level = (card: CardId): number => snapshot.players[me].levels[card] ?? 1;
  const livesPill = (
    <div className="lives-pill">
      <ActiveUpgrades
        masks={snapshot.activeUpgrades[me]}
        name={t('battle.you')}
        team="own"
        testId="upgrades-me"
      />
      <Hearts
        lives={snapshot.lives[me]}
        breaking={lostLife(me)}
        size={16}
        testId="lives-me"
        label={t('battle.livesOf', { name: t('battle.you'), lives: snapshot.lives[me] })}
      />
      <span className="battle__name battle__name--me">{t('battle.you')}</span>
    </div>
  );

  return (
    <main
      className="battle"
      data-testid="battle-screen"
      data-phase={phase}
      data-round={snapshot.round}
    >
      <div className="battle__field">
        <div className="battle__canvas">
          <EdgeInsetsContext.Provider value={insets}>{field}</EdgeInsetsContext.Provider>
        </div>
        <LastPickHint snapshot={snapshot} />
        {phase === 'roundEnd' && <RoundBanner snapshot={snapshot} />}
      </div>

      <div className="battle__bottom-probe" ref={probeRef} aria-hidden="true" />

      <header className="battle__header" ref={headerRef}>
        <div className="battle__who">
          <span className="battle__name">{oppName}</span>
          <div className="battle__heartline">
            <Hearts
              lives={snapshot.lives[opp]}
              breaking={lostLife(opp)}
              size={16}
              testId="lives-opponent"
              label={t('battle.livesOf', { name: oppName, lives: snapshot.lives[opp] })}
            />
            <span className="bot-badge">{t('battle.bot')}</span>
            <ActiveUpgrades
              masks={snapshot.activeUpgrades[opp]}
              name={oppName}
              team="enemy"
              testId="upgrades-opponent"
            />
          </div>
        </div>
        <span className="chip chip--round" data-testid="round-number">
          {t('battle.round', { round: snapshot.round })}
        </span>
        <button
          type="button"
          className="icon-btn icon-btn--speed"
          data-testid="speed-toggle"
          data-speed={snapshot.speed}
          aria-label={t('battle.speed')}
          onClick={() => actions.setSpeed(snapshot.speed === 1 ? 2 : 1)}
        >
          {t('battle.speedValue', { speed: snapshot.speed })}
        </button>
        <button
          type="button"
          className="icon-btn"
          data-testid="leave-button"
          aria-label={t('battle.leave')}
          onClick={() => setLeaving(true)}
        >
          <CloseIcon />
        </button>
      </header>

      <div className="battle__bottom" data-draft={inDraft}>
        {inDraft ? (
          <DraftBar
            snapshot={snapshot}
            onPlay={actions.play}
            onInfo={(card, upgrade) => setDetail({ card, upgrade })}
            trailing={livesPill}
          />
        ) : (
          <div className="draft__status draft__status--end">{livesPill}</div>
        )}
      </div>

      {detail !== null && (
        <CardDetail
          card={detail.card}
          level={level(detail.card)}
          highlightUpgrade={detail.upgrade}
          onClose={() => setDetail(null)}
        />
      )}

      {leaving && (
        <div className="modal" onClick={() => setLeaving(false)}>
          <div
            className="dialog dialog--small"
            role="alertdialog"
            aria-modal="true"
            aria-label={t('battle.leaveTitle')}
            data-testid="leave-dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="dialog__title">{t('battle.leaveTitle')}</h2>
            <p className="dialog__text">{t('battle.leaveText')}</p>
            <div className="dialog__buttons">
              <button
                type="button"
                className="btn btn--blue"
                data-testid="leave-cancel"
                onClick={() => setLeaving(false)}
              >
                {t('battle.leaveCancel')}
              </button>
              <button
                type="button"
                className="btn"
                data-testid="leave-confirm"
                onClick={actions.leave}
              >
                {t('battle.leaveConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {phase === 'finished' && (
        <ResultView snapshot={snapshot} onPlayAgain={actions.playAgain} onToTitle={actions.leave} />
      )}
    </main>
  );
}
