/** Backend on a real Supabase project: direct reads (RLS) and writes through the `api` function. */
import { CARD_IDS, type CardId } from '@rumble-realms/engine';
import {
  API_ERROR_CODES,
  API_FUNCTION,
  type ApiAction,
  type ApiErrorCode,
  type ApiRequestOf,
  type ApiResponse,
  type ApiResponseOf,
  type DeckRow,
  type OwnedCard,
  type PackRow,
  type PendingMatchRow,
  type PlayerCardRow,
  type ProfileRow,
} from '@rumble-realms/shared';
import {
  createClient,
  FunctionsHttpError,
  type SupabaseClient,
  type User,
} from '@supabase/supabase-js';
import { BackendUnavailableError, type AuthUser, type Backend, type PlayerState } from './types.ts';

export interface SupabaseBackendConfig {
  url: string;
  key: string;
  google: boolean;
  email: boolean;
}

const KNOWN_CARDS = new Set<string>(CARD_IDS);
const ERROR_CODES = new Set<string>(API_ERROR_CODES);

function isCard(value: unknown): value is CardId {
  return typeof value === 'string' && KNOWN_CARDS.has(value);
}

function toAuthUser(user: User | null | undefined): AuthUser | null {
  if (!user) return null;
  return { id: user.id, isGuest: user.is_anonymous === true, email: user.email || null };
}

function redirectTo(): string {
  return globalThis.location?.origin ?? '';
}

/** Escapes the LIKE wildcards so that `ilike` compares the whole name literally. */
export function escapeLike(name: string): string {
  return name.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Selects return `{ data, error }`; an error means the server is not usable right now. */
function rows<T>(result: { data: T[] | null; error: unknown }, what: string): T[] {
  if (result.error || !result.data) {
    throw new BackendUnavailableError(`reading ${what} failed`, { cause: result.error });
  }
  return result.data;
}

export interface PlayerRows {
  profile: ProfileRow;
  cards: PlayerCardRow[];
  deck: DeckRow | null;
  packs: Pick<PackRow, 'id' | 'kind'>[];
  pending: PendingMatchRow | null;
}

/** Pure mapping of database rows to the client's player state. Unknown cards are skipped. */
export function mapPlayer(r: PlayerRows): PlayerState {
  const cards: Partial<Record<CardId, OwnedCard>> = {};
  for (const row of r.cards) {
    if (!isCard(row.card_id)) continue;
    cards[row.card_id] = {
      level: row.level,
      copies: row.copies,
      unlockedUpgrades: row.unlocked_upgrades,
    };
  }
  return {
    userId: r.profile.id,
    username: r.profile.username,
    usernameChanges: r.profile.username_changes,
    elo: r.profile.elo,
    highestArena: r.profile.highest_arena,
    gold: r.profile.gold,
    jokers: r.profile.jokers,
    gamesPlayed: r.profile.games_played,
    cards,
    deck: (r.deck?.cards ?? []).filter(isCard),
    packs: r.packs.map((p) => ({ id: p.id, kind: p.kind })),
    pendingMatch: r.pending
      ? {
          matchId: r.pending.id,
          seed: r.pending.seed,
          engineVersion: r.pending.engine_version,
          botLevel: r.pending.bot_level,
          botProfile: r.pending.bot_profile,
          player: r.pending.setup,
        }
      : null,
  };
}

/** Strictly checks the body of an answer of the `api` function. */
export function parseApiBody<T>(body: unknown): ApiResponse<T> {
  if (typeof body === 'object' && body !== null) {
    const b = body as Record<string, unknown>;
    if (b['ok'] === true && 'data' in b) return { ok: true, data: b['data'] as T };
    if (b['ok'] === false && typeof b['error'] === 'object' && b['error'] !== null) {
      const e = b['error'] as Record<string, unknown>;
      const code = e['code'];
      if (typeof code === 'string' && ERROR_CODES.has(code)) {
        return {
          ok: false,
          error:
            typeof e['detail'] === 'string'
              ? { code: code as ApiErrorCode, detail: e['detail'] }
              : { code: code as ApiErrorCode },
        };
      }
    }
  }
  throw new BackendUnavailableError('malformed answer of the api function');
}

export function createSupabaseBackend(
  config: SupabaseBackendConfig,
  client?: SupabaseClient,
): Backend {
  const supabase: SupabaseClient =
    client ??
    createClient(config.url, config.key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });

  async function requireUser(): Promise<AuthUser> {
    const user = await backend.getUser();
    if (!user) throw new BackendUnavailableError('not signed in');
    return user;
  }

  function check(error: unknown, what: string): void {
    if (error) throw new BackendUnavailableError(`${what} failed`, { cause: error });
  }

  const backend: Backend = {
    mode: 'supabase',
    authMethods: { guest: true, google: config.google, email: config.email },

    async getUser() {
      const { data, error } = await supabase.auth.getSession();
      check(error, 'restoring the session');
      return toAuthUser(data.session?.user);
    },

    onAuthChange(listener) {
      const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        // Deferred: awaiting supabase calls inside this callback would deadlock the auth lock.
        const user = toAuthUser(session?.user);
        setTimeout(() => listener(user), 0);
      });
      return () => data.subscription.unsubscribe();
    },

    async signInAsGuest() {
      const { data, error } = await supabase.auth.signInAnonymously();
      check(error, 'guest sign-in');
      const user = toAuthUser(data.user);
      if (!user) throw new BackendUnavailableError('guest sign-in returned no user');
      return user;
    },

    async signInWithGoogle() {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: redirectTo() },
      });
      check(error, 'Google sign-in');
    },

    async signInWithEmail(email) {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo() },
      });
      check(error, 'e-mail sign-in');
    },

    async linkGoogle() {
      const { error } = await supabase.auth.linkIdentity({
        provider: 'google',
        options: { redirectTo: redirectTo() },
      });
      check(error, 'linking Google');
    },

    async linkEmail(email) {
      const { error } = await supabase.auth.updateUser(
        { email },
        { emailRedirectTo: redirectTo() },
      );
      check(error, 'linking e-mail');
    },

    async signOut() {
      const { error } = await supabase.auth.signOut();
      check(error, 'sign-out');
    },

    async loadPlayer() {
      const user = await requireUser();
      const [profiles, cards, decks, packs, matches] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, username, username_changes, elo, highest_arena, gold, jokers, games_played')
          .eq('id', user.id),
        supabase
          .from('player_cards')
          .select('card_id, level, copies, unlocked_upgrades')
          .eq('user_id', user.id),
        supabase.from('decks').select('cards').eq('user_id', user.id),
        supabase
          .from('packs')
          .select('id, kind')
          .eq('user_id', user.id)
          .eq('opened', false)
          .order('created_at', { ascending: true }),
        supabase
          .from('matches')
          .select('id, seed, engine_version, bot_level, bot_profile, setup')
          .eq('player_a', user.id)
          .eq('result', 'pending'),
      ]);
      const profile = rows<ProfileRow>(profiles, 'profile')[0];
      if (!profile) throw new BackendUnavailableError('profile not found');
      return mapPlayer({
        profile,
        cards: rows<PlayerCardRow>(cards, 'cards'),
        deck: rows<DeckRow>(decks, 'deck')[0] ?? null,
        packs: rows<Pick<PackRow, 'id' | 'kind'>>(packs, 'packs'),
        pending: rows<PendingMatchRow>(matches, 'matches')[0] ?? null,
      });
    },

    async isUsernameFree(name) {
      const user = await requireUser();
      const { count, error } = await supabase
        .from('public_profiles')
        .select('id', { head: true, count: 'exact' })
        .ilike('username', escapeLike(name))
        .neq('id', user.id);
      check(error, 'username check');
      return (count ?? 0) === 0;
    },

    async call<A extends ApiAction>(
      action: A,
      request: ApiRequestOf<A>,
    ): Promise<ApiResponse<ApiResponseOf<A>>> {
      let result;
      try {
        result = await supabase.functions.invoke(API_FUNCTION, { body: { action, ...request } });
      } catch (cause) {
        throw new BackendUnavailableError('api call failed', { cause });
      }
      const { data, error } = result;
      if (!error) return parseApiBody<ApiResponseOf<A>>(data);
      if (error instanceof FunctionsHttpError) {
        const res = error.context as Response;
        if (res.status === 401) return { ok: false, error: { code: 'unauthorized' } };
        throw new BackendUnavailableError(`api answered HTTP ${res.status}`, { cause: error });
      }
      throw new BackendUnavailableError('api call failed', { cause: error });
    },
  };
  return backend;
}
