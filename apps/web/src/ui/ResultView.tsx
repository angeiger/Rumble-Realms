import type { ReactElement } from 'react';
import { t } from '../i18n/index.ts';
import type { MatchReport } from '../game/store.ts';
import type { SessionSnapshot } from '../game/types.ts';
import { Hearts } from './Hearts.tsx';

export type Outcome = 'win' | 'loss' | 'draw';

export function outcomeOf(snapshot: SessionSnapshot): Outcome {
  if (snapshot.winner === 'draw' || snapshot.winner === null) return 'draw';
  return snapshot.winner === snapshot.me ? 'win' : 'loss';
}

export interface ResultViewProps {
  snapshot: SessionSnapshot;
  /** State of the report to the server; defaults to "not started". */
  report?: MatchReport;
  onPlayAgain: () => void;
  onToTitle: () => void;
  onRetry?: () => void;
  /** Opens the reward pack of this match (SPEC 10); the button shows only after a win. */
  onOpenPack?: (packId: string) => void;
}

const IDLE: MatchReport = { state: 'idle', result: null, error: null };

/** Elo change with a sign: +12, −8 or ±0. */
export function formatDelta(delta: number): string {
  if (delta > 0) return `+${delta}`;
  if (delta < 0) return `\u2212${-delta}`;
  return '\u00b10';
}

/** Reasons of `match_rejected` after which the server booked the match as a loss (D-084). */
const REJECTED_AS_LOSS: readonly (string | undefined)[] = ['bot_mismatch', 'bad_picks', 'leftover'];

/** The explanation of a failed report; `retry` says whether trying again can help. */
function failure(report: MatchReport): { text: string; retry: boolean } {
  switch (report.error) {
    case 'unavailable':
      return { text: t('result.failedUnavailable'), retry: true };
    case 'match_rejected':
      return REJECTED_AS_LOSS.includes(report.detail)
        ? { text: t('result.failedRejectedLoss'), retry: false }
        : { text: t('result.failedRejected'), retry: false };
    case 'match_not_found':
      return { text: t('result.failedRejected'), retry: false };
    case 'engine_mismatch':
      return { text: t('result.failedOutdated'), retry: false };
    default:
      return { text: t('result.failedOther'), retry: true };
  }
}

/** What the server booked, or why it could not (between the score and the buttons). */
function ReportInfo({
  report,
  onRetry,
  onOpenPack,
}: {
  report: MatchReport;
  onRetry?: (() => void) | undefined;
  onOpenPack?: ((packId: string) => void) | undefined;
}): ReactElement | null {
  if (report.state === 'idle') return null;
  const state = report.state;
  if (state === 'sending') {
    return (
      <div className="result__report" data-testid="result-report-state" data-state={state}>
        {t('result.saving')}
      </div>
    );
  }
  if (state === 'failed') {
    const f = failure(report);
    return (
      <div className="result__report" data-testid="result-report-state" data-state={state}>
        <p className="result__note">{f.text}</p>
        {f.retry && onRetry !== undefined && (
          <button type="button" className="btn" data-testid="result-retry" onClick={onRetry}>
            {t('result.retry')}
          </button>
        )}
      </div>
    );
  }
  const r = report.result;
  return (
    <div className="result__report" data-testid="result-report-state" data-state={state}>
      {r !== null && (
        <>
          <p className="result__note result__note--elo" data-testid="result-elo">
            {t('result.elo', { delta: formatDelta(r.eloDelta), elo: r.elo })}
          </p>
          {r.gold > 0 && (
            <p className="result__note" data-testid="result-gold">
              {t('result.gold', { gold: r.gold })}
            </p>
          )}
          {r.packId !== null && (
            <p className="result__note result__note--pack" data-testid="result-pack">
              {t('result.pack')}
            </p>
          )}
          {r.packId !== null && onOpenPack !== undefined && (
            <button
              type="button"
              className="btn btn--small result__open-pack"
              data-testid="result-open-pack"
              onClick={() => onOpenPack(r.packId as string)}
            >
              {t('result.openPack')}
            </button>
          )}
          {r.arenaUnlocked && (
            <p className="result__note" data-testid="result-arena">
              {t('result.arena')}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** End of the match: outcome, final lives, number of rounds, buttons. */
export function ResultView({
  snapshot,
  report = IDLE,
  onPlayAgain,
  onToTitle,
  onRetry,
  onOpenPack,
}: ResultViewProps): ReactElement {
  const outcome = outcomeOf(snapshot);
  const me = snapshot.me;
  const opp = me === 0 ? 1 : 0;
  const rounds = snapshot.roundResult?.round ?? snapshot.round;
  const oppName = snapshot.players[opp].name;
  return (
    <div className="modal modal--result" data-testid="result-screen">
      <div className={`result result--${outcome}`}>
        <h2 className="result__title" data-testid="result-title" data-outcome={outcome}>
          {t(`result.${outcome}`)}
        </h2>
        <div className="result__score">
          <div className="result__label">{t('result.score')}</div>
          <div className="result__row">
            <span className="result__name">{t('battle.you')}</span>
            <Hearts
              lives={snapshot.lives[me]}
              size={26}
              testId="result-lives-me"
              label={t('battle.livesOf', { name: t('battle.you'), lives: snapshot.lives[me] })}
            />
          </div>
          <div className="result__row">
            <span className="result__name">{oppName}</span>
            <Hearts
              lives={snapshot.lives[opp]}
              size={26}
              testId="result-lives-opponent"
              label={t('battle.livesOf', { name: oppName, lives: snapshot.lives[opp] })}
            />
          </div>
          <div className="result__rounds">{t('result.rounds', { rounds })}</div>
        </div>
        <ReportInfo report={report} onRetry={onRetry} onOpenPack={onOpenPack} />
        <div className="result__buttons">
          <button
            type="button"
            className="btn btn--big"
            data-testid="play-again"
            disabled={report.state === 'sending'}
            onClick={onPlayAgain}
          >
            {t('result.playAgain')}
          </button>
          <button
            type="button"
            className="btn btn--blue"
            data-testid="back-to-title"
            onClick={onToTitle}
          >
            {t('result.toTitle')}
          </button>
        </div>
      </div>
    </div>
  );
}
