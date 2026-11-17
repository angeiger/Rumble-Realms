/**
 * Account and progress state (M4): who is signed in and what the player owns. Not persisted
 * here; the backend keeps the session and the server keeps the data. All writes are API
 * actions; after a successful one the player state is reloaded from the backend.
 */
import {
  ENGINE_VERSION,
  type BotLevelId,
  type CardId,
  type UpgradeIndex,
} from '@rumble-realms/engine';
import {
  arenaForElo,
  type ApiAction,
  type ApiErrorCode,
  type ApiRequestOf,
  type ApiResponse,
  type ApiResponseOf,
  type OwnedCard,
} from '@rumble-realms/shared';
import { create } from 'zustand';
import { getBackend } from '../backend/index.ts';
import type { AuthUser, PlayerState } from '../backend/types.ts';

export type AccountStatus = 'loading' | 'signedOut' | 'onboarding' | 'ready';

export interface AccountError {
  code: ApiErrorCode | 'unavailable';
}

type Result<A extends ApiAction> = Promise<ApiResponse<ApiResponseOf<A>>>;

export interface AccountStore {
  status: AccountStatus;
  user: AuthUser | null;
  player: PlayerState | null;
  /** An action is running; further actions are refused until it ends (except `refresh`). */
  busy: boolean;
  /** The last failure, for display; cleared when the next action starts. */
  error: AccountError | null;

  /** Restores the session and loads the player. Harmless to call more than once. */
  init: () => Promise<void>;
  /** The sign-in and link actions resolve to true if the backend accepted them. */
  signInAsGuest: () => Promise<boolean>;
  signInWithGoogle: () => Promise<boolean>;
  signInWithEmail: (email: string) => Promise<boolean>;
  linkGoogle: () => Promise<boolean>;
  linkEmail: (email: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  /** Reloads the player; never blocked by `busy`. */
  refresh: () => Promise<void>;

  setUsername: (username: string) => Result<'set_username'>;
  setDeck: (cards: CardId[]) => Result<'set_deck'>;
  levelUp: (card: CardId) => Result<'level_up_card'>;
  unlockUpgrade: (card: CardId, upgrade: UpgradeIndex) => Result<'unlock_upgrade'>;
  spendJokers: (card: CardId, copies: number) => Result<'spend_jokers'>;
  openPack: (packId: string) => Result<'open_pack'>;
  createMatch: (botLevel: BotLevelId, pending?: 'resume' | 'forfeit') => Result<'create_match'>;
  reportMatch: (matchId: string, picks: number[]) => Result<'report_match'>;
}

const BUSY: ApiResponse<never> = { ok: false, error: { code: 'internal', detail: 'busy' } };
const UNAVAILABLE: ApiResponse<never> = {
  ok: false,
  error: { code: 'internal', detail: 'unavailable' },
};

function statusFor(player: PlayerState): AccountStatus {
  return player.username === null ? 'onboarding' : 'ready';
}

let started = false;
let unsubscribe: (() => void) | null = null;
/** Bumped by every load, so that a slow older load cannot overwrite a newer state. */
let epoch = 0;

export const useAccountStore = create<AccountStore>()((set, get) => {
  /** Loads the player of `user` into the store. Throws if the backend is unavailable. */
  async function load(user: AuthUser): Promise<void> {
    const mine = ++epoch;
    set({ user });
    const player = await getBackend().loadPlayer();
    if (mine !== epoch) return;
    set({ user, player, status: statusFor(player) });
  }

  function signedOut(): void {
    epoch++;
    set({ user: null, player: null, status: 'signedOut' });
  }

  function fail(): void {
    set({ error: { code: 'unavailable' } });
  }

  function onAuth(user: AuthUser | null): void {
    if (!user) {
      signedOut();
      return;
    }
    const s = get();
    if (s.user?.id === user.id && s.player) {
      // Token refresh or repeated event: keep the data, only update flags like isGuest/email.
      set({ user });
      return;
    }
    load(user).catch(fail);
  }

  /** Runs one exclusive action; BackendUnavailableError and any other throw become `unavailable`. */
  async function exclusive<T>(run: () => Promise<T>, onFail: T): Promise<T> {
    if (get().busy) return onFail;
    set({ busy: true, error: null });
    try {
      return await run();
    } catch {
      fail();
      return onFail;
    } finally {
      set({ busy: false });
    }
  }

  async function api<A extends ApiAction>(
    action: A,
    request: ApiRequestOf<A>,
  ): Promise<ApiResponse<ApiResponseOf<A>>> {
    if (get().busy) return BUSY;
    return exclusive<ApiResponse<ApiResponseOf<A>>>(async () => {
      const res = await getBackend().call(action, request);
      if (!res.ok) {
        set({ error: { code: res.error.code } });
        if (res.error.code === 'unauthorized') signedOut();
        return res;
      }
      const user = get().user;
      if (user) {
        try {
          await load(user);
        } catch {
          fail();
        }
      }
      return res;
    }, UNAVAILABLE);
  }

  /** Sign-in and link calls that do not return a user (redirects, e-mails). */
  function simple(run: () => Promise<void>): Promise<boolean> {
    return exclusive(async () => {
      await run();
      return true;
    }, false);
  }

  return {
    status: 'loading',
    user: null,
    player: null,
    busy: false,
    error: null,

    async init() {
      if (started) return;
      started = true;
      const backend = getBackend();
      try {
        unsubscribe = backend.onAuthChange(onAuth);
        const user = await backend.getUser();
        if (!user) {
          signedOut();
          return;
        }
        await load(user);
      } catch {
        // Allow a later init() to retry once the network is back.
        started = false;
        unsubscribe?.();
        unsubscribe = null;
        set({ status: 'signedOut', error: { code: 'unavailable' } });
      }
    },

    signInAsGuest() {
      return exclusive(async () => {
        const user = await getBackend().signInAsGuest();
        await load(user);
        return true;
      }, false);
    },
    signInWithGoogle: () => simple(() => getBackend().signInWithGoogle()),
    signInWithEmail: (email) => simple(() => getBackend().signInWithEmail(email)),
    linkGoogle: () => simple(() => getBackend().linkGoogle()),
    linkEmail: (email) => simple(() => getBackend().linkEmail(email)),

    async signOut() {
      await exclusive(async () => {
        await getBackend().signOut();
        signedOut();
      }, undefined);
    },

    async refresh() {
      const user = get().user;
      if (!user) return;
      try {
        await load(user);
      } catch {
        fail();
      }
    },

    setUsername: (username) => api('set_username', { username }),
    setDeck: (cards) => api('set_deck', { cards }),
    levelUp: (card) => api('level_up_card', { card }),
    unlockUpgrade: (card, upgrade) => api('unlock_upgrade', { card, upgrade }),
    spendJokers: (card, copies) => api('spend_jokers', { card, copies }),
    openPack: (packId) => api('open_pack', { packId }),
    createMatch: (botLevel, pending) =>
      api('create_match', {
        botLevel,
        engineVersion: ENGINE_VERSION,
        ...(pending ? { pending } : {}),
      }),
    reportMatch: (matchId, picks) => api('report_match', { matchId, picks }),
  };
});

/** Tests: forget the subscription and the init flag together with the state. */
export function resetAccountStoreForTests(): void {
  unsubscribe?.();
  unsubscribe = null;
  started = false;
  epoch++;
  useAccountStore.setState(
    { status: 'loading', user: null, player: null, busy: false, error: null },
    false,
  );
}

// ---------------------------------------------------------------------------
// Selectors (pure)
// ---------------------------------------------------------------------------

export function ownedCard(player: PlayerState, card: CardId): OwnedCard | undefined {
  return player.cards[card];
}

/** Levels of the four deck cards, in the form of `PlayerConfig.levels`. */
export function deckLevels(player: PlayerState): Partial<Record<CardId, number>> {
  const levels: Partial<Record<CardId, number>> = {};
  for (const card of player.deck) levels[card] = player.cards[card]?.level ?? 1;
  return levels;
}

/** Unlocked upgrade masks of the four deck cards, in the form of `PlayerConfig.upgrades`. */
export function deckUpgrades(player: PlayerState): Partial<Record<CardId, number>> {
  const upgrades: Partial<Record<CardId, number>> = {};
  for (const card of player.deck) upgrades[card] = player.cards[card]?.unlockedUpgrades ?? 0;
  return upgrades;
}

export function currentArena(player: PlayerState): number {
  return arenaForElo(player.elo);
}
