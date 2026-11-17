import { ENGINE_VERSION, FREE_RENAMES } from '@rumble-realms/engine';
import { useState, type ReactElement } from 'react';
import type { AuthUser, PlayerState } from '../backend/types.ts';
import { chooseLocale, t, type Locale } from '../i18n/index.ts';
import { useLocale } from '../i18n/useLocale.ts';
import type { UiErrorCode } from './accountText.ts';
import { EmailForm } from './EmailForm.tsx';
import { UsernameForm } from './UsernameForm.tsx';
import type { AuthMethods } from './WelcomeScreen.tsx';
import { arenaName } from './TitleScreen.tsx';

/** The player may still use a free rename (SPEC 9.3). */
export function canRename(player: PlayerState): boolean {
  return player.usernameChanges < FREE_RENAMES;
}

const LOCALES: readonly { id: Locale; label: () => string }[] = [
  { id: 'de', label: () => t('profile.langDe') },
  { id: 'en', label: () => t('profile.langEn') },
];

export interface ProfileScreenProps {
  player: PlayerState;
  user: AuthUser | null;
  mode: 'supabase' | 'local';
  methods: AuthMethods;
  checkFree: (name: string) => Promise<boolean>;
  /** Saves the new name; resolves to the error to show, or null on success. */
  onRename: (name: string) => Promise<UiErrorCode | null>;
  onLinkGoogle: () => Promise<boolean>;
  onLinkEmail: (email: string) => Promise<boolean>;
  onSignOut: () => void;
  /** Only for tests. */
  initialRenaming?: boolean;
  initialConfirmSignOut?: boolean;
  initialLinkingEmail?: boolean;
}

function Row({ id, label, value }: { id: string; label: string; value: string }): ReactElement {
  return (
    <div className="profile-row">
      <dt>{label}</dt>
      <dd data-testid={id}>{value}</dd>
    </div>
  );
}

/** Version line at the bottom of the profile: engine version and build. */
export function VersionLine(): ReactElement {
  return (
    <footer className="version" data-testid="version">
      {t('title.engineVersion', { version: ENGINE_VERSION })}
      {__BUILD_ID__ ? ` · ${t('title.buildId', { id: __BUILD_ID__ })}` : ''}
    </footer>
  );
}

/** "Profil" tab: name, statistics, language, account and sign-out. */
export function ProfileScreen({
  player,
  user,
  mode,
  methods,
  checkFree,
  onRename,
  onLinkGoogle,
  onLinkEmail,
  onSignOut,
  initialRenaming = false,
  initialConfirmSignOut = false,
  initialLinkingEmail = false,
}: ProfileScreenProps): ReactElement {
  const locale = useLocale();
  const [renaming, setRenaming] = useState(initialRenaming);
  const [confirmSignOut, setConfirmSignOut] = useState(initialConfirmSignOut);
  const [linkingEmail, setLinkingEmail] = useState(initialLinkingEmail);
  const isGuest = user?.isGuest ?? false;
  const renameAllowed = canRename(player);
  return (
    <main className="profile-screen" data-testid="profile-screen">
      <h1 className="profile-screen__title">{t('profile.title')}</h1>

      <section className="profile-card">
        <h2 className="profile-card__title">{t('profile.name')}</h2>
        {renaming ? (
          <UsernameForm
            submitLabel={t('username.save')}
            checkFree={checkFree}
            onSubmit={async (name) => {
              const failure = await onRename(name);
              if (failure === null) setRenaming(false);
              return failure;
            }}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <>
            <div className="profile-name">
              <span className="profile-name__value" data-testid="profile-username">
                {player.username}
              </span>
              {renameAllowed && (
                <button
                  type="button"
                  className="btn btn--small"
                  data-testid="rename-button"
                  onClick={() => setRenaming(true)}
                >
                  {t('profile.rename')}
                </button>
              )}
            </div>
            <p className="profile-card__hint" data-testid="rename-hint">
              {renameAllowed ? t('profile.renameHint') : t('profile.renameLocked')}
            </p>
          </>
        )}
        <dl className="profile-stats">
          <Row id="profile-elo" label={t('profile.elo')} value={String(player.elo)} />
          <Row
            id="profile-arena"
            label={t('profile.highestArena')}
            value={arenaName(player.highestArena)}
          />
          <Row id="profile-games" label={t('profile.games')} value={String(player.gamesPlayed)} />
        </dl>
      </section>

      <section className="profile-card">
        <h2 className="profile-card__title" id="language-label">
          {t('profile.language')}
        </h2>
        <div className="bot-picker__buttons" role="radiogroup" aria-labelledby="language-label">
          {LOCALES.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={id === locale}
              className={`bot-picker__btn${id === locale ? ' bot-picker__btn--on' : ''}`}
              data-testid={`lang-${id}`}
              onClick={() => chooseLocale(id)}
            >
              {label()}
            </button>
          ))}
        </div>
      </section>

      <section className="profile-card" data-testid="account-section">
        <h2 className="profile-card__title">{t('profile.account')}</h2>
        {mode === 'local' ? (
          <p className="profile-card__hint" data-testid="local-note">
            {t('profile.localNote')}
          </p>
        ) : (
          <>
            {isGuest ? (
              <p className="profile-card__hint" data-testid="guest-note">
                {t('profile.guestNote')}
              </p>
            ) : (
              user?.email && (
                <p className="profile-card__hint" data-testid="signed-in-as">
                  {t('profile.signedInAs', { email: user.email })}
                </p>
              )
            )}
            {isGuest && methods.google && (
              <button
                type="button"
                className="btn btn--small profile-card__button"
                data-testid="link-google"
                onClick={() => void onLinkGoogle()}
              >
                {t('profile.linkGoogle')}
              </button>
            )}
            {isGuest && methods.email && !linkingEmail && (
              <button
                type="button"
                className="btn btn--small profile-card__button"
                data-testid="link-email"
                onClick={() => setLinkingEmail(true)}
              >
                {t('profile.linkEmail')}
              </button>
            )}
            {isGuest && methods.email && linkingEmail && (
              <EmailForm onSubmit={onLinkEmail} onCancel={() => setLinkingEmail(false)} />
            )}
          </>
        )}
        {confirmSignOut ? (
          <div className="pending-match__ask" data-testid="sign-out-ask" role="alertdialog">
            <p data-testid="sign-out-text">
              {isGuest ? t('profile.signOutAskGuest') : t('profile.signOutAsk')}
            </p>
            <div className="form-buttons">
              <button
                type="button"
                className="btn btn--small"
                data-testid="sign-out-yes"
                onClick={() => {
                  setConfirmSignOut(false);
                  onSignOut();
                }}
              >
                {t('profile.signOutYes')}
              </button>
              <button
                type="button"
                className="btn btn--small btn--quiet"
                data-testid="sign-out-no"
                onClick={() => setConfirmSignOut(false)}
              >
                {t('profile.signOutNo')}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="btn btn--small btn--quiet profile-card__button"
            data-testid="sign-out"
            onClick={() => setConfirmSignOut(true)}
          >
            {t('profile.signOut')}
          </button>
        )}
      </section>

      <VersionLine />
    </main>
  );
}
