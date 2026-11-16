import { useEffect, useState, type ReactElement } from 'react';
import { t, type MessageKey } from '../i18n/index.ts';
import { errorText, type UiErrorCode } from './accountText.ts';
import { canSubmitUsername, createUsernameChecker, type UsernameState } from './usernameCheck.ts';

export const USERNAME_MAX_LENGTH = 16;

const SERVER_NAME_STATES: Partial<Record<UiErrorCode, UsernameState>> = {
  username_taken: 'taken',
  username_blocked: 'blocked',
  username_invalid: 'invalid',
};

/** The status-line state for a server verdict on the name, or undefined for other errors. */
export function stateOfServerError(code: UiErrorCode): UsernameState | undefined {
  return SERVER_NAME_STATES[code];
}

export interface UsernameFormViewProps {
  value: string;
  state: UsernameState;
  /** Answer of the server to the last submit. */
  error: UiErrorCode | null;
  busy: boolean;
  submitLabel: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel?: (() => void) | undefined;
}

/** Input, live status line and buttons for choosing a username (pure view). */
export function UsernameFormView({
  value,
  state,
  error,
  busy,
  submitLabel,
  onChange,
  onSubmit,
  onCancel,
}: UsernameFormViewProps): ReactElement {
  return (
    <form
      className="username-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <label className="field__label" htmlFor="username-input">
        {t('username.label')}
      </label>
      <input
        id="username-input"
        className="field__input"
        data-testid="username-input"
        type="text"
        value={value}
        maxLength={USERNAME_MAX_LENGTH}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="done"
        aria-describedby="username-status"
        onChange={(event) => onChange(event.target.value)}
      />
      <p
        id="username-status"
        className="field__status"
        data-testid="username-status"
        data-state={state}
        aria-live="polite"
      >
        {t(`username.state.${state}` as MessageKey)}
      </p>
      {error !== null && (
        <p className="field__error" data-testid="username-error" role="alert">
          {errorText(error)}
        </p>
      )}
      <div className="form-buttons">
        <button
          type="submit"
          className="btn"
          data-testid="username-submit"
          disabled={busy || !canSubmitUsername(state)}
        >
          {submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            className="btn btn--small btn--quiet"
            data-testid="username-cancel"
            onClick={onCancel}
          >
            {t('username.cancel')}
          </button>
        )}
      </div>
    </form>
  );
}

export interface UsernameFormProps {
  submitLabel: string;
  /** Server lookup whether the name is free. */
  checkFree: (name: string) => Promise<boolean>;
  /** Saves the name; resolves to the error to show, or null on success. */
  onSubmit: (name: string) => Promise<UiErrorCode | null>;
  onCancel?: () => void;
}

/** The username input with live check (SPEC 9.3), shared by onboarding and renaming. */
export function UsernameForm({
  submitLabel,
  checkFree,
  onSubmit,
  onCancel,
}: UsernameFormProps): ReactElement {
  const [value, setValue] = useState('');
  const [state, setState] = useState<UsernameState>('empty');
  const [error, setError] = useState<UiErrorCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [checker] = useState(() => createUsernameChecker(checkFree, setState));
  useEffect(() => () => checker.stop(), [checker]);

  const submit = (): void => {
    if (busy || !canSubmitUsername(state)) return;
    setBusy(true);
    setError(null);
    onSubmit(value)
      .then((failure) => {
        // The server knows better than the lookup: name problems go to the status line.
        const asState = failure === null ? undefined : stateOfServerError(failure);
        if (asState !== undefined) setState(asState);
        setError(asState === undefined ? failure : null);
      })
      .finally(() => setBusy(false));
  };

  return (
    <UsernameFormView
      value={value}
      state={state}
      error={error}
      busy={busy}
      submitLabel={submitLabel}
      onChange={(next) => {
        setValue(next);
        setError(null);
        checker.update(next);
      }}
      onSubmit={submit}
      onCancel={onCancel}
    />
  );
}
