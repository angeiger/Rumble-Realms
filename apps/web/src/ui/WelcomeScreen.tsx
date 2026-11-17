import { useState, type ReactElement } from 'react';
import { t } from '../i18n/index.ts';
import type { UiErrorCode } from './accountText.ts';
import { EmailForm } from './EmailForm.tsx';

export interface AuthMethods {
  guest: boolean;
  google: boolean;
  email: boolean;
}

export type WelcomeStep = 'start' | 'choose' | 'email';

/** True if "Spielen" has to offer a choice; otherwise it signs in as a guest directly. */
export function offersChoice(methods: AuthMethods): boolean {
  return methods.google || methods.email;
}

/** What "Spielen" does: sign in as a guest at once, or open the choice of sign-in methods. */
export function playAction(methods: AuthMethods): 'guest' | 'choose' {
  return offersChoice(methods) ? 'choose' : 'guest';
}

export interface WelcomeScreenProps {
  methods: AuthMethods;
  busy: boolean;
  /** Last failure of the account store. */
  error: UiErrorCode | null;
  /** Retries restoring the session (used when no action was tried yet). */
  onRetryInit: () => void;
  onGuest: () => Promise<boolean>;
  onGoogle: () => Promise<boolean>;
  onEmail: (email: string) => Promise<boolean>;
  /** Only for tests. */
  initialStep?: WelcomeStep;
}

/** Title screen of a signed-out player: logo, "Spielen" and the choice of sign-in methods (SPEC 9.1, 9.2). */
export function WelcomeScreen({
  methods,
  busy,
  error,
  onRetryInit,
  onGuest,
  onGoogle,
  onEmail,
  initialStep = 'start',
}: WelcomeScreenProps): ReactElement {
  const [step, setStep] = useState<WelcomeStep>(initialStep);
  const [retry, setRetry] = useState<(() => void) | null>(null);

  const run = (action: () => Promise<boolean>): void => {
    const again = (): void => {
      void action();
    };
    setRetry(() => again);
    again();
  };

  const play = (): void => {
    if (playAction(methods) === 'choose') setStep('choose');
    else run(onGuest);
  };

  return (
    <main className="onboard-screen onboard-screen--welcome" data-testid="welcome-screen">
      <h1 className="logo">{t('app.title')}</h1>
      <div className="welcome__actions">
        {step === 'start' && (
          <button
            type="button"
            className="btn btn--big"
            data-testid="welcome-play"
            disabled={busy}
            onClick={play}
          >
            {t('welcome.play')}
          </button>
        )}
        {step === 'choose' && (
          <>
            <p className="welcome__question">{t('welcome.chooseTitle')}</p>
            {methods.google && (
              <button
                type="button"
                className="btn welcome__choice"
                data-testid="signin-google"
                disabled={busy}
                onClick={() => run(onGoogle)}
              >
                {t('welcome.google')}
              </button>
            )}
            {methods.email && (
              <button
                type="button"
                className="btn welcome__choice"
                data-testid="signin-email"
                disabled={busy}
                onClick={() => setStep('email')}
              >
                {t('welcome.email')}
              </button>
            )}
            <button
              type="button"
              className="btn welcome__choice"
              data-testid="signin-guest"
              disabled={busy}
              onClick={() => run(onGuest)}
            >
              {t('welcome.guest')}
            </button>
          </>
        )}
        {step === 'email' && (
          <EmailForm
            onSubmit={(email) => {
              const attempt = (): Promise<boolean> => onEmail(email);
              setRetry(() => () => void attempt());
              return attempt();
            }}
            onCancel={() => setStep('choose')}
          />
        )}
        {error !== null && (
          <div className="welcome__error" data-testid="welcome-error" role="alert">
            <p>{error === 'unavailable' ? t('welcome.unavailable') : t('welcome.failed')}</p>
            <button
              type="button"
              className="btn btn--small"
              data-testid="welcome-retry"
              disabled={busy}
              onClick={() => (retry ?? onRetryInit)()}
            >
              {t('welcome.retry')}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

/** Plain loading screen while the session is restored. */
export function LoadingScreen(): ReactElement {
  return (
    <main className="onboard-screen onboard-screen--welcome" data-testid="loading-screen">
      <h1 className="logo">{t('app.title')}</h1>
      <p className="welcome__loading" role="status">
        {t('loading.text')}
      </p>
    </main>
  );
}
