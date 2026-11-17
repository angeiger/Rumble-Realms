import { useState, type ReactElement } from 'react';
import { t } from '../i18n/index.ts';

const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

export function isPlausibleEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}

export interface EmailFormProps {
  /** Sends the magic link; resolves to true if the backend accepted it. */
  onSubmit: (email: string) => Promise<boolean>;
  onCancel?: () => void;
  /** Only for tests: start in the "link sent" state. */
  initialSent?: boolean;
}

/** E-mail address input for the magic link (sign-in and linking). Shows a hint after sending. */
export function EmailForm({
  onSubmit,
  onCancel,
  initialSent = false,
}: EmailFormProps): ReactElement {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(initialSent);
  if (sent) {
    return (
      <p className="field__status field__status--ok" data-testid="email-sent" role="status">
        {t('welcome.emailSent')}
      </p>
    );
  }
  return (
    <form
      className="username-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy || !isPlausibleEmail(email)) return;
        setBusy(true);
        onSubmit(email.trim())
          .then((ok) => setSent(ok))
          .finally(() => setBusy(false));
      }}
    >
      <label className="field__label" htmlFor="email-input">
        {t('welcome.emailLabel')}
      </label>
      <input
        id="email-input"
        className="field__input"
        data-testid="email-input"
        type="email"
        value={email}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="email"
        spellCheck={false}
        enterKeyHint="send"
        onChange={(event) => setEmail(event.target.value)}
      />
      <div className="form-buttons">
        <button
          type="submit"
          className="btn"
          data-testid="email-submit"
          disabled={busy || !isPlausibleEmail(email)}
        >
          {t('welcome.emailSend')}
        </button>
        {onCancel && (
          <button
            type="button"
            className="btn btn--small btn--quiet"
            data-testid="email-cancel"
            onClick={onCancel}
          >
            {t('welcome.back')}
          </button>
        )}
      </div>
    </form>
  );
}
