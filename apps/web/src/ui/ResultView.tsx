import type { ReactElement } from 'react';
import { t } from '../i18n/index.ts';
import type { SessionSnapshot } from '../game/types.ts';
import { Hearts } from './Hearts.tsx';

export type Outcome = 'win' | 'loss' | 'draw';

export function outcomeOf(snapshot: SessionSnapshot): Outcome {
  if (snapshot.winner === 'draw' || snapshot.winner === null) return 'draw';
  return snapshot.winner === snapshot.me ? 'win' : 'loss';
}

export interface ResultViewProps {
  snapshot: SessionSnapshot;
  onPlayAgain: () => void;
  onToTitle: () => void;
}

/** End of the match: outcome, final lives, number of rounds, buttons. */
export function ResultView({ snapshot, onPlayAgain, onToTitle }: ResultViewProps): ReactElement {
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
        <div className="result__buttons">
          <button
            type="button"
            className="btn btn--big"
            data-testid="play-again"
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
