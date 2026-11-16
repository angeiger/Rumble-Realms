/**
 * Backend without a server: the server logic of packages/shared runs unchanged in the browser
 * on an in-memory store, whose snapshot is kept in browser storage (development, tests and
 * preview deployments without Supabase). Only guest sign-in exists; there is one local player.
 */
import {
  createMemoryStore,
  handleApiCall,
  type ApiAction,
  type ApiCall,
  type ApiRequestOf,
  type ApiResponse,
  type ApiResponseOf,
  type ServerEnv,
} from '@rumble-realms/shared';
import type { StateStorage } from 'zustand/middleware';
import { safeStorage } from '../game/safeStorage.ts';
import { mapPlayer } from './supabase.ts';
import { BackendUnavailableError, type AuthUser, type Backend, type PlayerState } from './types.ts';

export const LOCAL_STORAGE_KEY = 'rr.local.v1';

interface Saved {
  userId: string;
  signedIn: boolean;
  /** Snapshot of the memory store. */
  data: unknown;
}

/** Uniform integer in 0..n-1 from crypto, rejecting values that would skew the modulo. */
export function secureRandInt(n: number): number {
  if (!Number.isInteger(n) || n < 1 || n > 2 ** 32) throw new RangeError('randInt: bad range');
  const limit = 2 ** 32 - (2 ** 32 % n);
  const buf = new Uint32Array(1);
  for (;;) {
    globalThis.crypto.getRandomValues(buf);
    const x = buf[0] ?? 0;
    if (x < limit) return x % n;
  }
}

const ENV: ServerEnv = { randInt: secureRandInt, now: () => performance.now() };

function readSaved(storage: StateStorage): Saved | null {
  try {
    const raw = storage.getItem(LOCAL_STORAGE_KEY);
    if (typeof raw !== 'string') return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const p = parsed as Record<string, unknown>;
    if (typeof p['userId'] !== 'string' || typeof p['signedIn'] !== 'boolean') return null;
    return { userId: p['userId'], signedIn: p['signedIn'], data: p['data'] };
  } catch {
    return null;
  }
}

export function createLocalBackend(storage: StateStorage = safeStorage): Backend {
  const saved = readSaved(storage);
  const store = createMemoryStore(saved?.data ? { data: saved.data } : {});
  let userId = saved?.userId ?? null;
  let signedIn = saved?.signedIn ?? false;
  const listeners = new Set<(user: AuthUser | null) => void>();

  function currentUser(): AuthUser | null {
    return signedIn && userId ? { id: userId, isGuest: true, email: null } : null;
  }

  function save(): void {
    if (!userId) return;
    const value: Saved = { userId, signedIn, data: store.snapshot() };
    storage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(value));
  }

  function notify(): void {
    const user = currentUser();
    for (const l of [...listeners]) l(user);
  }

  function unsupported(): never {
    throw new BackendUnavailableError('not available in local mode');
  }

  return {
    mode: 'local',
    authMethods: { guest: true, google: false, email: false },

    async getUser() {
      return currentUser();
    },

    onAuthChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    async signInAsGuest() {
      if (!userId) {
        userId = globalThis.crypto.randomUUID();
        await store.addUser(userId);
      }
      signedIn = true;
      save();
      notify();
      return { id: userId, isGuest: true, email: null };
    },

    signInWithGoogle: async () => unsupported(),
    signInWithEmail: async () => unsupported(),
    linkGoogle: async () => unsupported(),
    linkEmail: async () => unsupported(),

    async signOut() {
      // Only the session ends; the progress stays for the next guest sign-in.
      signedIn = false;
      save();
      notify();
    },

    async loadPlayer(): Promise<PlayerState> {
      if (!signedIn || !userId) throw new BackendUnavailableError('not signed in');
      const profile = await store.getProfile(userId);
      if (!profile) throw new BackendUnavailableError('profile not found');
      const [cards, deck, packs, pending] = await Promise.all([
        store.getCards(userId),
        store.getDeck(userId),
        store.listPacks(userId),
        store.getPendingMatch(userId),
      ]);
      return mapPlayer({
        profile,
        cards,
        deck,
        packs: packs.filter((p) => !p.opened),
        pending: pending
          ? {
              id: pending.id,
              seed: pending.seed,
              engine_version: pending.engine_version,
              bot_level: pending.bot_level,
              bot_profile: pending.bot_profile,
              setup: pending.setup,
            }
          : null,
      });
    },

    // One local player: every name is free.
    async isUsernameFree() {
      return true;
    },

    async call<A extends ApiAction>(
      action: A,
      request: ApiRequestOf<A>,
    ): Promise<ApiResponse<ApiResponseOf<A>>> {
      if (!signedIn || !userId) return { ok: false, error: { code: 'unauthorized' } };
      try {
        const res = await handleApiCall(store, ENV, userId, { action, ...request } as ApiCall);
        save();
        return res as ApiResponse<ApiResponseOf<A>>;
      } catch (cause) {
        throw new BackendUnavailableError('local call failed', { cause });
      }
    },
  };
}
