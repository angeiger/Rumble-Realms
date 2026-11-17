import { BOT_PROFILES, FREE_RENAMES } from '@rumble-realms/engine';
import type { MatchTicket } from '@rumble-realms/shared';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chooseLocale, getLocale, setLocale } from '../i18n/index.ts';
import { errorText, uiErrorOf } from './accountText.ts';
import { EmailForm, isPlausibleEmail } from './EmailForm.tsx';
import { fakePlayer } from './fakes.ts';
import { canRename, ProfileScreen, type ProfileScreenProps } from './ProfileScreen.tsx';
import { PendingMatchBox, StartErrorNotice, TitleScreen, arenaName } from './TitleScreen.tsx';
import {
  UsernameFormView,
  stateOfServerError,
  type UsernameFormViewProps,
} from './UsernameForm.tsx';
import {
  canSubmitUsername,
  createUsernameChecker,
  localUsernameState,
  type UsernameState,
} from './usernameCheck.ts';
import { LoadingScreen, WelcomeScreen, offersChoice, playAction } from './WelcomeScreen.tsx';

const noop = (): void => undefined;
const yes = async (): Promise<boolean> => true;

afterEach(() => setLocale('de'));

describe('welcome screen', () => {
  const props = {
    methods: { guest: true, google: false, email: false },
    busy: false,
    error: null,
    onRetryInit: noop,
    onGuest: yes,
    onGoogle: yes,
    onEmail: yes,
  };

  it('shows logo and the play button', () => {
    const html = renderToString(<WelcomeScreen {...props} />);
    expect(html).toContain('Rumble Realms');
    expect(html).toContain('data-testid="welcome-play"');
    expect(html).not.toContain('data-testid="signin-guest"');
  });

  it('plays as guest directly without further sign-in methods, otherwise opens the choice', () => {
    expect(playAction({ guest: true, google: false, email: false })).toBe('guest');
    expect(playAction({ guest: true, google: true, email: false })).toBe('choose');
    expect(playAction({ guest: true, google: false, email: true })).toBe('choose');
    expect(offersChoice({ guest: true, google: false, email: false })).toBe(false);
  });

  it('offers only the active sign-in methods', () => {
    const both = renderToString(
      <WelcomeScreen
        {...props}
        methods={{ guest: true, google: true, email: true }}
        initialStep="choose"
      />,
    );
    expect(both).toContain('data-testid="signin-google"');
    expect(both).toContain('data-testid="signin-email"');
    expect(both).toContain('data-testid="signin-guest"');
    const googleOnly = renderToString(
      <WelcomeScreen
        {...props}
        methods={{ guest: true, google: true, email: false }}
        initialStep="choose"
      />,
    );
    expect(googleOnly).toContain('data-testid="signin-google"');
    expect(googleOnly).not.toContain('data-testid="signin-email"');
  });

  it('asks for the e-mail address and then shows the hint', () => {
    const html = renderToString(
      <WelcomeScreen
        {...props}
        methods={{ guest: true, google: false, email: true }}
        initialStep="email"
      />,
    );
    expect(html).toContain('data-testid="email-input"');
    expect(html).toContain('data-testid="email-submit"');
    const sent = renderToString(<EmailForm onSubmit={yes} initialSent />);
    expect(sent).toContain('Wir haben dir einen Link geschickt');
    expect(isPlausibleEmail('a@b.de')).toBe(true);
    expect(isPlausibleEmail('a@b')).toBe(false);
    expect(isPlausibleEmail('hallo')).toBe(false);
  });

  it('shows a connection error with retry, other errors with the generic text', () => {
    const html = renderToString(<WelcomeScreen {...props} error="unavailable" />);
    expect(html).toContain('data-testid="welcome-error"');
    expect(html).toContain('Keine Verbindung');
    expect(html).toContain('data-testid="welcome-retry"');
    expect(renderToString(<WelcomeScreen {...props} error="internal" />)).toContain(
      'Das hat nicht geklappt',
    );
    expect(renderToString(<WelcomeScreen {...props} />)).not.toContain('welcome-error');
  });

  it('has a loading screen with the logo', () => {
    const html = renderToString(<LoadingScreen />);
    expect(html).toContain('data-testid="loading-screen"');
    expect(html).toContain('Rumble Realms');
  });
});

describe('username check', () => {
  it('judges the local rules first', () => {
    expect(localUsernameState('')).toBe('empty');
    expect(localUsernameState('ab')).toBe('invalid');
    expect(localUsernameState('hallo welt')).toBe('invalid');
    expect(localUsernameState('abcdefghijklmnopq')).toBe('invalid');
    expect(localUsernameState('Anna_01')).toBeNull();
  });

  it('only allows submitting a free name (or an unverified one)', () => {
    const allowed: UsernameState[] = ['free', 'unknown'];
    for (const s of [
      'empty',
      'invalid',
      'blocked',
      'checking',
      'taken',
      'free',
      'unknown',
    ] as const) {
      expect(canSubmitUsername(s)).toBe(allowed.includes(s));
    }
  });

  describe('live check', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    function setup(isFree: (name: string) => Promise<boolean>) {
      const states: UsernameState[] = [];
      const checker = createUsernameChecker(isFree, (s) => states.push(s), 400);
      return { states, checker };
    }

    it('reports local problems at once without asking the server', () => {
      const isFree = vi.fn(async () => true);
      const { states, checker } = setup(isFree);
      checker.update('');
      checker.update('a');
      vi.advanceTimersByTime(1000);
      expect(states).toEqual(['empty', 'invalid']);
      expect(isFree).not.toHaveBeenCalled();
    });

    it('asks the server after a pause and reports free or taken', async () => {
      const { states, checker } = setup(async (name) => name === 'Anna');
      checker.update('Anna');
      expect(states).toEqual(['checking']);
      await vi.advanceTimersByTimeAsync(399);
      expect(states).toEqual(['checking']);
      await vi.advanceTimersByTimeAsync(1);
      expect(states).toEqual(['checking', 'free']);
      checker.update('Berta');
      await vi.advanceTimersByTimeAsync(400);
      expect(states.at(-1)).toBe('taken');
    });

    it('asks only once while the player keeps typing', async () => {
      const isFree = vi.fn(async () => true);
      const { checker } = setup(isFree);
      for (const name of ['Ann', 'Anna', 'Annab']) {
        checker.update(name);
        await vi.advanceTimersByTimeAsync(200);
      }
      await vi.advanceTimersByTimeAsync(400);
      expect(isFree).toHaveBeenCalledTimes(1);
      expect(isFree).toHaveBeenCalledWith('Annab');
    });

    it('ignores a stale answer for an earlier input', async () => {
      const answers = new Map<string, (free: boolean) => void>();
      const { states, checker } = setup(
        (name) => new Promise<boolean>((resolve) => answers.set(name, resolve)),
      );
      checker.update('Anna');
      await vi.advanceTimersByTimeAsync(400); // the lookup for "Anna" is running
      checker.update('Annab');
      await vi.advanceTimersByTimeAsync(400); // the lookup for "Annab" is running
      answers.get('Annab')?.(false);
      await vi.advanceTimersByTimeAsync(0);
      answers.get('Anna')?.(true); // late answer for the older input
      await vi.advanceTimersByTimeAsync(0);
      expect(states.at(-1)).toBe('taken');
    });

    it('drops a running lookup when the input becomes invalid', async () => {
      let resolve: (free: boolean) => void = noop;
      const { states, checker } = setup(() => new Promise<boolean>((r) => (resolve = r)));
      checker.update('Anna');
      await vi.advanceTimersByTimeAsync(400);
      checker.update('An');
      resolve(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(states.at(-1)).toBe('invalid');
    });

    it('reports "unknown" if the lookup fails, and stop() cancels everything', async () => {
      const { states, checker } = setup(async () => {
        throw new Error('offline');
      });
      checker.update('Anna');
      await vi.advanceTimersByTimeAsync(400);
      expect(states.at(-1)).toBe('unknown');
      checker.update('Berta');
      checker.stop();
      await vi.advanceTimersByTimeAsync(1000);
      expect(states.at(-1)).toBe('checking');
    });
  });
});

describe('username form view', () => {
  const base: UsernameFormViewProps = {
    value: '',
    state: 'empty',
    error: null,
    busy: false,
    submitLabel: 'Weiter',
    onChange: noop,
    onSubmit: noop,
  };

  it('has the input restricted to 16 characters without autocorrection', () => {
    const html = renderToString(<UsernameFormView {...base} />);
    expect(html).toContain('data-testid="username-input"');
    expect(html).toContain('maxLength="16"');
    expect(html).toContain('autoCapitalize="off"');
    expect(html).toContain('autoCorrect="off"');
    expect(html).toContain('spellCheck="false"');
  });

  it('shows the state in the status line and enables the button only for "free"', () => {
    for (const state of ['empty', 'invalid', 'blocked', 'checking', 'taken', 'free'] as const) {
      const html = renderToString(<UsernameFormView {...base} state={state} />);
      expect(html).toMatch(new RegExp(`data-testid="username-status" data-state="${state}"`));
      const disabled = /data-testid="username-submit"[^>]*disabled/.test(html);
      expect(disabled, state).toBe(state !== 'free');
    }
  });

  it('shows texts that fit the state', () => {
    const text = (state: UsernameState): string =>
      renderToString(<UsernameFormView {...base} state={state} />);
    expect(text('taken')).toContain('schon vergeben');
    expect(text('blocked')).toContain('nicht erlaubt');
    expect(text('free')).toContain('frei');
    expect(text('checking')).toContain('prüfe');
  });

  it('disables the button while saving and shows server errors', () => {
    const busy = renderToString(<UsernameFormView {...base} state="free" busy />);
    expect(busy).toMatch(/data-testid="username-submit"[^>]*disabled/);
    const err = renderToString(<UsernameFormView {...base} state="free" error="unavailable" />);
    expect(err).toContain('data-testid="username-error"');
    expect(err).toContain('Keine Verbindung');
    const generic = renderToString(<UsernameFormView {...base} state="free" error="internal" />);
    expect(generic).toContain('Das hat nicht geklappt');
  });

  it('turns server verdicts on the name into status states', () => {
    expect(stateOfServerError('username_taken')).toBe('taken');
    expect(stateOfServerError('username_blocked')).toBe('blocked');
    expect(stateOfServerError('username_invalid')).toBe('invalid');
    expect(stateOfServerError('unavailable')).toBeUndefined();
    expect(errorText('username_taken')).toContain('vergeben');
    expect(errorText('username_blocked')).toContain('nicht erlaubt');
    expect(errorText('username_invalid')).toContain('Buchstaben');
  });

  it('maps API results to UI errors', () => {
    expect(uiErrorOf({ ok: true, data: {} })).toBeNull();
    expect(uiErrorOf({ ok: false, error: { code: 'username_taken' } })).toBe('username_taken');
    expect(uiErrorOf({ ok: false, error: { code: 'internal', detail: 'unavailable' } })).toBe(
      'unavailable',
    );
  });
});

describe('battle tab', () => {
  const ticket = (botProfile: string): MatchTicket =>
    ({
      matchId: 'm1',
      seed: 1,
      engineVersion: 1,
      botLevel: 'easy',
      botProfile,
      player: { name: '', deck: [], levels: {}, upgrades: {} },
    }) as unknown as MatchTicket;

  const view = (over: Partial<Parameters<typeof TitleScreen>[0]> = {}): string =>
    renderToString(
      <TitleScreen
        player={fakePlayer()}
        botLevel="easy"
        onBotLevel={noop}
        starting={false}
        startError={null}
        onPlay={noop}
        onResume={noop}
        onForfeit={noop}
        {...over}
      />,
    );

  it('shows the arena name by Elo and an arena backdrop', () => {
    expect(view()).toMatch(/data-testid="arena-name">Grünwiesen-Dorf</);
    expect(view()).toContain('data-arena="1"');
    const html = view({ player: fakePlayer({ elo: 1450 }) });
    expect(html).toMatch(/data-testid="arena-name">Frostgipfel</);
    expect(html).toContain('data-arena="4"');
    expect(arenaName(2)).toBe('Knochensumpf');
    expect(arenaName(3)).toBe('Goblin-Minen');
    expect(arenaName(5)).toBe('Drachenhort');
  });

  it('takes deck and levels from the player', () => {
    const html = view();
    expect(html).toContain('Ritter');
    expect(html).toContain('Level 3');
  });

  it('shows the extra slot below the button', () => {
    const html = view({ extra: <i data-testid="extra-slot" /> });
    expect(html.indexOf('play-button')).toBeLessThan(html.indexOf('extra-slot'));
  });

  it('locks the button while starting', () => {
    const html = view({ starting: true });
    expect(html).toMatch(/data-testid="play-button"[^>]*disabled/);
    expect(html).toContain('data-testid="starting-spinner"');
    expect(html).toContain('Starte');
  });

  it('shows errors of starting a match', () => {
    expect(view({ startError: 'unavailable' })).toContain('Keine Verbindung');
    const mismatch = view({ startError: 'engine_mismatch' });
    expect(mismatch).toContain('Bitte lade die App neu');
    expect(mismatch).toContain('data-testid="start-error-reload"');
    expect(view({ startError: 'internal' })).toContain('konnte nicht gestartet werden');
    expect(view()).not.toContain('data-testid="start-error"');
    expect(renderToString(<StartErrorNotice error="unavailable" onReload={noop} />)).not.toContain(
      'start-error-reload',
    );
  });

  it('offers resume and give-up for an open match instead of the plain button', () => {
    const html = view({
      player: fakePlayer({ pendingMatch: ticket(BOT_PROFILES[0]?.id ?? '') }),
    });
    expect(html).toContain(`gegen ${BOT_PROFILES[0]?.name}`);
    expect(html).toContain('data-testid="pending-match"');
    expect(html).toContain('data-testid="pending-resume"');
    expect(html).toContain('data-testid="pending-forfeit"');
    expect(html).not.toContain('data-testid="play-button"');
    expect(html).toContain('Du hast ein offenes Match gegen');
  });

  it('names the bot of the open match and asks before giving up', () => {
    const html = renderToString(
      <PendingMatchBox
        botName="Lady Knochenkralle"
        disabled={false}
        onResume={noop}
        onForfeit={noop}
      />,
    );
    expect(html).toContain('gegen Lady Knochenkralle');
    expect(html).not.toContain('pending-forfeit-ask');
    const ask = renderToString(
      <PendingMatchBox
        botName="X"
        disabled={false}
        onResume={noop}
        onForfeit={noop}
        initialConfirming
      />,
    );
    expect(ask).toContain('data-testid="pending-forfeit-ask"');
    expect(ask).toContain('zählt als Niederlage');
    expect(ask).toContain('data-testid="pending-forfeit-yes"');
  });
});

describe('profile tab', () => {
  const base: ProfileScreenProps = {
    player: fakePlayer({ elo: 1111, highestArena: 2, gamesPlayed: 12 }),
    user: { id: 'u1', isGuest: false, email: 'anna@example.com' },
    mode: 'supabase',
    methods: { guest: true, google: false, email: false },
    checkFree: async () => true,
    onRename: async () => null,
    onLinkGoogle: yes,
    onLinkEmail: yes,
    onSignOut: noop,
  };
  const view = (over: Partial<ProfileScreenProps> = {}, extra = {}): string =>
    renderToString(<ProfileScreen {...base} {...over} {...extra} />);

  it('shows name, Elo, highest arena and games', () => {
    const html = view();
    expect(html).toContain('data-testid="profile-screen"');
    expect(html).toMatch(/data-testid="profile-username">Anna</);
    expect(html).toMatch(/data-testid="profile-elo">1111</);
    expect(html).toMatch(/data-testid="profile-arena">Knochensumpf</);
    expect(html).toMatch(/data-testid="profile-games">12</);
    expect(html).toContain('Engine v');
  });

  it('allows renaming only as long as the free renames last', () => {
    expect(canRename(fakePlayer({ usernameChanges: 0 }))).toBe(true);
    expect(canRename(fakePlayer({ usernameChanges: FREE_RENAMES }))).toBe(false);
    const open = view();
    expect(open).toContain('data-testid="rename-button"');
    expect(open).toContain('Du kannst deinen Namen einmal ändern');
    const used = view({ player: fakePlayer({ usernameChanges: FREE_RENAMES }) });
    expect(used).not.toContain('data-testid="rename-button"');
    expect(used).toContain('Name kann nicht mehr geändert werden');
  });

  it('shows the same input as in onboarding while renaming', () => {
    const html = view({}, { initialRenaming: true });
    expect(html).toContain('data-testid="username-input"');
    expect(html).toContain('data-testid="username-submit"');
    expect(html).toContain('data-testid="username-cancel"');
    expect(html).not.toContain('data-testid="rename-button"');
  });

  it('switches the language in the interface', () => {
    const html = view();
    expect(html).toContain('data-testid="lang-de"');
    expect(html).toContain('data-testid="lang-en"');
    expect(html).toMatch(/aria-checked="true"[^>]*data-testid="lang-de"/);
    chooseLocale('en');
    expect(getLocale()).toBe('en');
    expect(view()).toContain('Games played');
    setLocale('de');
    expect(view()).toContain('Gespielte Spiele');
  });

  it('shows the guest note and the link buttons of the active methods', () => {
    const guest = { id: 'u1', isGuest: true, email: null };
    const none = view({ user: guest });
    expect(none).toContain('data-testid="guest-note"');
    expect(none).toContain('Fortschritt nur auf diesem Gerät');
    expect(none).not.toContain('data-testid="link-google"');
    expect(none).not.toContain('data-testid="link-email"');
    const both = view({ user: guest, methods: { guest: true, google: true, email: true } });
    expect(both).toContain('data-testid="link-google"');
    expect(both).toContain('data-testid="link-email"');
    const mail = view(
      { user: guest, methods: { guest: true, google: false, email: true } },
      { initialLinkingEmail: true },
    );
    expect(mail).toContain('data-testid="email-input"');
  });

  it('shows the e-mail of a linked account and no guest note', () => {
    const html = view();
    expect(html).toContain('anna@example.com');
    expect(html).not.toContain('data-testid="guest-note"');
    expect(html).not.toContain('data-testid="link-google"');
  });

  it('shows the local-mode note instead of the guest account block', () => {
    const html = view({
      mode: 'local',
      user: { id: 'u1', isGuest: true, email: null },
      methods: { guest: true, google: true, email: true },
    });
    expect(html).toContain('data-testid="local-note"');
    expect(html).toContain('kein Server');
    expect(html).not.toContain('data-testid="guest-note"');
    expect(html).not.toContain('data-testid="link-google"');
  });

  it('asks before signing out, guests get a clear warning', () => {
    expect(view()).toContain('data-testid="sign-out"');
    expect(view()).not.toContain('data-testid="sign-out-ask"');
    const asked = view({}, { initialConfirmSignOut: true });
    expect(asked).toContain('data-testid="sign-out-ask"');
    expect(asked).toContain('Willst du dich wirklich abmelden');
    expect(asked).toContain('data-testid="sign-out-yes"');
    const guest = view(
      { user: { id: 'u1', isGuest: true, email: null } },
      { initialConfirmSignOut: true },
    );
    expect(guest).toContain('Fortschritt für immer verloren gehen');
  });
});
