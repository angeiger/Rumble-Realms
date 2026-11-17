/** Test helpers: a fake backend, a player and ready-made props of the app view. */
import type { AuthMethods } from './WelcomeScreen.tsx';
import type { Backend, PlayerState } from '../backend/types.ts';
import type { AppViewProps } from '../App.tsx';

export function fakePlayer(over: Partial<PlayerState> = {}): PlayerState {
  return {
    userId: 'u1',
    username: 'Anna',
    usernameChanges: 0,
    elo: 1000,
    highestArena: 1,
    gold: 120,
    jokers: 7,
    gamesPlayed: 3,
    cards: {
      archer: { level: 1, copies: 0, unlockedUpgrades: 0 },
      knight: { level: 3, copies: 0, unlockedUpgrades: 0 },
      skeleton: { level: 1, copies: 0, unlockedUpgrades: 0 },
      musketeer: { level: 1, copies: 0, unlockedUpgrades: 0 },
    },
    deck: ['archer', 'knight', 'skeleton', 'musketeer'],
    packs: [],
    pendingMatch: null,
    ...over,
  };
}

export function fakeBackend(
  over: Partial<Backend> = {},
  methods: Partial<AuthMethods> = {},
): Backend {
  return {
    mode: 'supabase',
    authMethods: { guest: true, google: false, email: false, ...methods },
    getUser: async () => null,
    onAuthChange: () => () => undefined,
    signInAsGuest: async () => ({ id: 'u1', isGuest: true, email: null }),
    signInWithGoogle: async () => undefined,
    signInWithEmail: async () => undefined,
    linkGoogle: async () => undefined,
    linkEmail: async () => undefined,
    signOut: async () => undefined,
    loadPlayer: async () => fakePlayer(),
    isUsernameFree: async () => true,
    call: async () => ({ ok: false, error: { code: 'internal' } }),
    ...over,
  };
}

const noop = (): void => undefined;
const yes = async (): Promise<boolean> => true;

/** Props of `AppView` for a ready player in the menu on the battle tab; override what a test needs. */
export function viewProps(over: Partial<AppViewProps> = {}): AppViewProps {
  return {
    status: 'ready',
    screen: 'menu',
    tab: 'battle',
    onTab: noop,
    player: fakePlayer(),
    welcome: {
      methods: { guest: true, google: false, email: false },
      busy: false,
      error: null,
      onRetryInit: noop,
      onGuest: yes,
      onGoogle: yes,
      onEmail: yes,
    },
    username: { checkFree: async () => true, onSubmit: async () => null },
    title: {
      botLevel: 'easy',
      onBotLevel: noop,
      starting: false,
      startError: null,
      onPlay: noop,
      onResume: noop,
      onForfeit: noop,
    },
    profile: {
      user: { id: 'u1', isGuest: true, email: null },
      mode: 'supabase',
      methods: { guest: true, google: false, email: false },
      checkFree: async () => true,
      onRename: async () => null,
      onLinkGoogle: yes,
      onLinkEmail: yes,
      onSignOut: noop,
    },
    pack: {
      open: false,
      preferId: null,
      busy: false,
      onShow: noop,
      onOpen: async () => ({ ok: false, error: 'internal' }),
      onClose: noop,
    },
    ...over,
  };
}
