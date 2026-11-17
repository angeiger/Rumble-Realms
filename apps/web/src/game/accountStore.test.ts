import type { ApiResponse } from '@rumble-realms/shared';
import { ENGINE_VERSION } from '@rumble-realms/engine';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setBackendForTests } from '../backend/index.ts';
import {
  BackendUnavailableError,
  type AuthUser,
  type Backend,
  type PlayerState,
} from '../backend/types.ts';
import {
  currentArena,
  deckLevels,
  deckUpgrades,
  ownedCard,
  resetAccountStoreForTests,
  useAccountStore,
} from './accountStore.ts';

const GUEST: AuthUser = { id: 'u1', isGuest: true, email: null };

function player(over: Partial<PlayerState> = {}): PlayerState {
  return {
    userId: 'u1',
    username: null,
    usernameChanges: 0,
    elo: 1000,
    highestArena: 1,
    gold: 0,
    jokers: 0,
    gamesPlayed: 0,
    cards: { musketeer: { level: 3, copies: 2, unlockedUpgrades: 5 } },
    deck: ['musketeer'],
    packs: [],
    pendingMatch: null,
    ...over,
  };
}

interface Fake extends Backend {
  state: { user: AuthUser | null; player: PlayerState; down: boolean };
  calls: unknown[];
  loads: number;
  emit(user: AuthUser | null): void;
  gate: Promise<void> | null;
  reply: ApiResponse<unknown>;
}

function fake(initialUser: AuthUser | null): Fake {
  let listener: ((u: AuthUser | null) => void) | null = null;
  const f: Fake = {
    mode: 'local',
    authMethods: { guest: true, google: false, email: false },
    state: { user: initialUser, player: player(), down: false },
    calls: [],
    loads: 0,
    gate: null,
    reply: { ok: true, data: {} },
    emit: (u) => listener?.(u),
    async getUser() {
      if (f.state.down) throw new BackendUnavailableError();
      return f.state.user;
    },
    onAuthChange(l) {
      listener = l;
      return () => {
        listener = null;
      };
    },
    async signInAsGuest() {
      f.state.user = GUEST;
      return GUEST;
    },
    async signInWithGoogle() {},
    async signInWithEmail() {},
    async linkGoogle() {},
    async linkEmail() {},
    async signOut() {
      f.state.user = null;
    },
    async loadPlayer() {
      f.loads++;
      if (f.state.down) throw new BackendUnavailableError();
      return f.state.player;
    },
    async isUsernameFree() {
      return true;
    },
    async call(action, request) {
      f.calls.push({ action, ...request });
      if (f.gate) await f.gate;
      if (f.state.down) throw new BackendUnavailableError();
      return f.reply as never;
    },
  };
  return f;
}

beforeEach(() => resetAccountStoreForTests());
afterEach(() => {
  setBackendForTests(null);
  resetAccountStoreForTests();
});

describe('status transitions', () => {
  it('loading -> signedOut without a session', async () => {
    setBackendForTests(fake(null));
    expect(useAccountStore.getState().status).toBe('loading');
    await useAccountStore.getState().init();
    expect(useAccountStore.getState().status).toBe('signedOut');
  });

  it('guest sign-in -> onboarding -> ready after the username', async () => {
    const f = fake(null);
    setBackendForTests(f);
    const s = useAccountStore.getState();
    await s.init();
    expect(await s.signInAsGuest()).toBe(true);
    expect(useAccountStore.getState().status).toBe('onboarding');
    expect(useAccountStore.getState().user).toEqual(GUEST);
    f.state.player = player({ username: 'Anna' });
    const r = await s.setUsername('Anna');
    expect(r.ok).toBe(true);
    expect(f.calls).toEqual([{ action: 'set_username', username: 'Anna' }]);
    expect(useAccountStore.getState().status).toBe('ready');
    expect(useAccountStore.getState().player?.username).toBe('Anna');
  });

  it('restores a session with a username straight to ready; init twice loads once', async () => {
    const f = fake(GUEST);
    f.state.player = player({ username: 'Anna' });
    setBackendForTests(f);
    await useAccountStore.getState().init();
    await useAccountStore.getState().init();
    expect(useAccountStore.getState().status).toBe('ready');
    expect(f.loads).toBe(1);
  });

  it('signOut and auth events lead to signedOut', async () => {
    const f = fake(GUEST);
    f.state.player = player({ username: 'Anna' });
    setBackendForTests(f);
    await useAccountStore.getState().init();
    await useAccountStore.getState().signOut();
    expect(useAccountStore.getState().status).toBe('signedOut');
    expect(useAccountStore.getState().player).toBeNull();
    f.emit(GUEST);
    await new Promise((r) => setTimeout(r, 0));
    expect(useAccountStore.getState().status).toBe('ready');
  });
});

describe('actions', () => {
  it('reload the player after success, but not after a domain error', async () => {
    const f = fake(GUEST);
    f.state.player = player({ username: 'Anna' });
    setBackendForTests(f);
    await useAccountStore.getState().init();
    expect(f.loads).toBe(1);
    await useAccountStore.getState().levelUp('musketeer');
    expect(f.loads).toBe(2);
    f.reply = { ok: false, error: { code: 'not_enough_gold' } };
    const r = await useAccountStore.getState().levelUp('musketeer');
    expect(r).toEqual({ ok: false, error: { code: 'not_enough_gold' } });
    expect(f.loads).toBe(2);
    expect(useAccountStore.getState().error).toEqual({ code: 'not_enough_gold' });
  });

  it('createMatch sends the engine version and optional pending mode', async () => {
    const f = fake(GUEST);
    f.state.player = player({ username: 'Anna' });
    setBackendForTests(f);
    await useAccountStore.getState().init();
    await useAccountStore.getState().createMatch('easy');
    await useAccountStore.getState().createMatch('easy', 'forfeit');
    expect(f.calls).toEqual([
      { action: 'create_match', botLevel: 'easy', engineVersion: ENGINE_VERSION },
      {
        action: 'create_match',
        botLevel: 'easy',
        engineVersion: ENGINE_VERSION,
        pending: 'forfeit',
      },
    ]);
  });

  it('refuses a second action while busy, but refresh still works', async () => {
    const f = fake(GUEST);
    f.state.player = player({ username: 'Anna' });
    setBackendForTests(f);
    await useAccountStore.getState().init();
    let open!: () => void;
    f.gate = new Promise<void>((r) => (open = r));
    const first = useAccountStore.getState().openPack('p1');
    expect(useAccountStore.getState().busy).toBe(true);
    const second = await useAccountStore.getState().openPack('p2');
    expect(second).toEqual({ ok: false, error: { code: 'internal', detail: 'busy' } });
    const loads = f.loads;
    await useAccountStore.getState().refresh();
    expect(f.loads).toBe(loads + 1);
    open();
    await first;
    expect(useAccountStore.getState().busy).toBe(false);
    expect(f.calls).toHaveLength(1);
  });

  it('reports an unavailable backend without throwing', async () => {
    const f = fake(GUEST);
    f.state.player = player({ username: 'Anna' });
    setBackendForTests(f);
    await useAccountStore.getState().init();
    f.state.down = true;
    const r = await useAccountStore.getState().setDeck(['musketeer']);
    expect(r).toEqual({ ok: false, error: { code: 'internal', detail: 'unavailable' } });
    expect(useAccountStore.getState().error).toEqual({ code: 'unavailable' });
    expect(useAccountStore.getState().busy).toBe(false);
    expect(useAccountStore.getState().status).toBe('ready');
  });

  it('init with a dead backend ends signedOut with an error and can be retried', async () => {
    const f = fake(GUEST);
    f.state.down = true;
    setBackendForTests(f);
    await useAccountStore.getState().init();
    expect(useAccountStore.getState().status).toBe('signedOut');
    expect(useAccountStore.getState().error).toEqual({ code: 'unavailable' });
    f.state.down = false;
    await useAccountStore.getState().init();
    expect(useAccountStore.getState().status).toBe('onboarding');
  });

  it('an unauthorized answer signs the player out', async () => {
    const f = fake(GUEST);
    f.state.player = player({ username: 'Anna' });
    setBackendForTests(f);
    await useAccountStore.getState().init();
    f.reply = { ok: false, error: { code: 'unauthorized' } };
    await useAccountStore.getState().levelUp('musketeer');
    expect(useAccountStore.getState().status).toBe('signedOut');
  });
});

describe('selectors', () => {
  it('derive levels, upgrades, card and arena from the player', () => {
    const p = player({ deck: ['musketeer', 'archer'], elo: 1000 });
    expect(ownedCard(p, 'musketeer')?.copies).toBe(2);
    expect(ownedCard(p, 'archer')).toBeUndefined();
    expect(deckLevels(p)).toEqual({ musketeer: 3, archer: 1 });
    expect(deckUpgrades(p)).toEqual({ musketeer: 5, archer: 0 });
    expect(currentArena(p)).toBe(1);
  });
});
