/**
 * The Store port (packages/shared/src/server/store.ts) on the Supabase database.
 *
 * - Reads: plain selects with the admin client. The admin client bypasses Row Level Security,
 *   so EVERY read filters on the account id itself (user_id / player_a / id).
 * - Writes: exactly one SQL function `rr_*` per method (PostgREST RPC, migration section 7).
 *   A guard failure of the function (SQLSTATE P0001, message `rr:<code>`) becomes
 *   `{ ok: false, code }` if `<code>` is one of STORE_ERROR_CODES. Everything else (network,
 *   unknown SQL errors, unexpected rows) is thrown; the function answers it with 500.
 *
 * The client type is the small part of supabase-js this file uses, so tests can fake it.
 */
import { STORE_ERROR_CODES } from '../_shared/packages/shared/src/index.ts';
import type { BotLevelId, PlayerConfig } from '../_shared/packages/engine/src/index.ts';
import type {
  FinishMatchInput,
  FinishMatchOutput,
  MatchResult,
  MatchRow,
  PackReward,
  PackRow,
  PlayerCardRow,
  ProfileRow,
  Store,
  StoreErrorCode,
  StoreResult,
} from '../_shared/packages/shared/src/index.ts';

// ---------------------------------------------------------------------------
// The client (subset of supabase-js)
// ---------------------------------------------------------------------------

export interface DbError {
  code?: string;
  message: string;
}

export interface DbResult {
  data: unknown;
  error: DbError | null;
}

export interface DbFilter extends PromiseLike<DbResult> {
  eq(column: string, value: string): DbFilter;
  maybeSingle(): PromiseLike<DbResult>;
}

export interface DbClient {
  from(table: string): { select(columns: string): DbFilter };
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<DbResult>;
}

// ---------------------------------------------------------------------------
// Columns and row mapping
// ---------------------------------------------------------------------------

const PROFILE_COLUMNS =
  'id, username, username_changes, elo, highest_arena, gold, jokers, games_played';
const CARD_COLUMNS = 'card_id, level, copies, unlocked_upgrades';
const MATCH_COLUMNS =
  'id, seed, engine_version, bot_level, bot_profile, setup, result, elo_delta_a';
const PACK_COLUMNS = 'id, kind, match_id, opened, contents';

const MATCH_RESULTS: readonly MatchResult[] = ['pending', 'a_won', 'b_won', 'draw', 'abandoned'];

type Row = Record<string, unknown>;

function unexpected(what: string): Error {
  return new Error(`SupabaseStore: unexpected ${what}`);
}

function isRow(value: unknown): value is Row {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function str(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') throw unexpected(`${key}`);
  return value;
}

function strOrNull(row: Row, key: string): string | null {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== 'string') throw unexpected(`${key}`);
  return value;
}

function int(row: Row, key: string): number {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw unexpected(`${key}`);
  return value;
}

function intOrNull(row: Row, key: string): number | null {
  return row[key] === null ? null : int(row, key);
}

function bool(row: Row, key: string): boolean {
  const value = row[key];
  if (typeof value !== 'boolean') throw unexpected(`${key}`);
  return value;
}

function profileOf(row: Row): ProfileRow {
  return {
    id: str(row, 'id'),
    username: strOrNull(row, 'username'),
    username_changes: int(row, 'username_changes'),
    elo: int(row, 'elo'),
    highest_arena: int(row, 'highest_arena'),
    gold: int(row, 'gold'),
    jokers: int(row, 'jokers'),
    games_played: int(row, 'games_played'),
  };
}

function cardOf(row: Row): PlayerCardRow {
  return {
    card_id: str(row, 'card_id'),
    level: int(row, 'level'),
    copies: int(row, 'copies'),
    unlocked_upgrades: int(row, 'unlocked_upgrades'),
  };
}

/**
 * `matches.setup` as an engine PlayerConfig. Only the shape is checked here; the engine checks
 * the content when the match is replayed (an unusable setup gives `bad_ticket`).
 */
function setupOf(value: unknown): PlayerConfig {
  if (!isRow(value) || !Array.isArray(value.deck) || !isRow(value.levels)) {
    throw unexpected('setup');
  }
  const setup = { deck: value.deck, levels: value.levels } as PlayerConfig;
  if (value.upgrades !== undefined && value.upgrades !== null) {
    if (!isRow(value.upgrades)) throw unexpected('setup.upgrades');
    setup.upgrades = value.upgrades as NonNullable<PlayerConfig['upgrades']>;
  }
  return setup;
}

function matchOf(row: Row, result?: MatchResult): MatchRow {
  const stored = result ?? str(row, 'result');
  if (!(MATCH_RESULTS as readonly string[]).includes(stored)) throw unexpected('result');
  return {
    id: str(row, 'id'),
    seed: int(row, 'seed'),
    engine_version: int(row, 'engine_version'),
    // Checked by the table constraint; a level the engine does not know is handled by the
    // handlers (the match is dropped).
    bot_level: str(row, 'bot_level') as BotLevelId,
    bot_profile: str(row, 'bot_profile'),
    setup: setupOf(row.setup),
    result: stored as MatchResult,
    elo_delta_a: result === undefined ? intOrNull(row, 'elo_delta_a') : null,
  };
}

function packOf(row: Row): PackRow {
  const kind = str(row, 'kind');
  if (kind !== 'match' && kind !== 'welcome') throw unexpected('pack kind');
  const contents = row.contents;
  if (contents !== null && !isRow(contents)) throw unexpected('pack contents');
  return {
    id: str(row, 'id'),
    kind,
    match_id: strOrNull(row, 'match_id'),
    opened: bool(row, 'opened'),
    // Written only by rr_open_pack, which stores exactly the PackReward shapes.
    contents: contents as PackReward | null,
  };
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

const RR_ERROR = /^rr:([a-z_]+)$/;

/** The store code of a guard failure of an `rr_*` function, or null for anything else. */
export function storeCodeOf(error: DbError): StoreErrorCode | null {
  if (error.code !== 'P0001') return null;
  const match = RR_ERROR.exec(error.message);
  const code = match?.[1];
  return code !== undefined && (STORE_ERROR_CODES as readonly string[]).includes(code)
    ? (code as StoreErrorCode)
    : null;
}

function dbFailure(what: string, error: DbError): Error {
  // Code and message only: `details` of a SQL error can contain row values.
  return new Error(`SupabaseStore: ${what} failed (${error.code ?? 'no code'}): ${error.message}`);
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

export class SupabaseStore implements Store {
  readonly #db: DbClient;

  constructor(db: DbClient) {
    this.#db = db;
  }

  // --- Reads ---

  async #one(table: string, columns: string, filters: [string, string][]): Promise<Row | null> {
    let query = this.#db.from(table).select(columns);
    for (const [column, value] of filters) query = query.eq(column, value);
    const { data, error } = await query.maybeSingle();
    if (error !== null) throw dbFailure(`select ${table}`, error);
    if (data === null) return null;
    if (!isRow(data)) throw unexpected(`${table} row`);
    return data;
  }

  async getProfile(user: string): Promise<ProfileRow | null> {
    const row = await this.#one('profiles', PROFILE_COLUMNS, [['id', user]]);
    return row === null ? null : profileOf(row);
  }

  async getCards(user: string): Promise<PlayerCardRow[]> {
    const { data, error } = await this.#db
      .from('player_cards')
      .select(CARD_COLUMNS)
      .eq('user_id', user);
    if (error !== null) throw dbFailure('select player_cards', error);
    if (!Array.isArray(data)) throw unexpected('player_cards rows');
    return data.map((row: unknown) => {
      if (!isRow(row)) throw unexpected('player_cards row');
      return cardOf(row);
    });
  }

  async getPendingMatch(user: string): Promise<MatchRow | null> {
    const row = await this.#one('matches', MATCH_COLUMNS, [
      ['player_a', user],
      ['result', 'pending'],
    ]);
    return row === null ? null : matchOf(row);
  }

  async getMatch(user: string, matchId: string): Promise<MatchRow | null> {
    const row = await this.#one('matches', MATCH_COLUMNS, [
      ['id', matchId],
      ['player_a', user],
    ]);
    return row === null ? null : matchOf(row);
  }

  async getPack(user: string, packId: string): Promise<PackRow | null> {
    const row = await this.#one('packs', PACK_COLUMNS, [
      ['id', packId],
      ['user_id', user],
    ]);
    return row === null ? null : packOf(row);
  }

  async getPackOfMatch(user: string, matchId: string): Promise<PackRow | null> {
    const row = await this.#one('packs', PACK_COLUMNS, [
      ['match_id', matchId],
      ['user_id', user],
    ]);
    return row === null ? null : packOf(row);
  }

  // --- Writes ---

  /** Calls `fn`; a guard failure gives its code, the result is passed to `map`. */
  async #call<T>(
    fn: string,
    args: Record<string, unknown>,
    map: (data: unknown) => T,
  ): Promise<StoreResult<T>> {
    const { data, error } = await this.#db.rpc(fn, args);
    if (error !== null) {
      const code = storeCodeOf(error);
      if (code === null) throw dbFailure(fn, error);
      return { ok: false, code };
    }
    return { ok: true, value: map(data) };
  }

  /** The single row of a `returns table (...)` function. */
  static #single(fn: string, data: unknown): Row {
    if (!Array.isArray(data) || data.length !== 1 || !isRow(data[0])) {
      throw unexpected(`result of ${fn}`);
    }
    return data[0];
  }

  setUsername(user: string, username: string, freeRenames: number) {
    const fn = 'rr_set_username';
    return this.#call(
      fn,
      { p_user: user, p_username: username, p_free_renames: freeRenames },
      (data) => {
        const row = SupabaseStore.#single(fn, data);
        return { username: str(row, 'username'), welcomePackId: strOrNull(row, 'welcome_pack_id') };
      },
    );
  }

  setDeck(user: string, cards: string[]) {
    const fn = 'rr_set_deck';
    return this.#call(fn, { p_user: user, p_cards: cards }, (data) => {
      if (!Array.isArray(data) || !data.every((c) => typeof c === 'string')) {
        throw unexpected(`result of ${fn}`);
      }
      return { cards: data as string[] };
    });
  }

  levelUpCard(user: string, card: string, fromLevel: number, copies: number, gold: number) {
    const fn = 'rr_level_up_card';
    return this.#call(
      fn,
      { p_user: user, p_card: card, p_from_level: fromLevel, p_copies: copies, p_gold: gold },
      (data) => {
        const row = SupabaseStore.#single(fn, data);
        return { level: int(row, 'level'), copies: int(row, 'copies'), gold: int(row, 'gold') };
      },
    );
  }

  unlockUpgrade(user: string, card: string, upgrade: number, minLevel: number, gold: number) {
    const fn = 'rr_unlock_upgrade';
    return this.#call(
      fn,
      { p_user: user, p_card: card, p_upgrade: upgrade, p_min_level: minLevel, p_gold: gold },
      (data) => {
        const row = SupabaseStore.#single(fn, data);
        return { unlockedUpgrades: int(row, 'unlocked_upgrades'), gold: int(row, 'gold') };
      },
    );
  }

  spendJokers(user: string, card: string, copies: number, jokers: number) {
    const fn = 'rr_spend_jokers';
    return this.#call(
      fn,
      { p_user: user, p_card: card, p_copies: copies, p_jokers: jokers },
      (data) => {
        const row = SupabaseStore.#single(fn, data);
        return {
          copies: int(row, 'copies'),
          jokers: int(row, 'jokers'),
          cardUnlocked: bool(row, 'card_unlocked'),
        };
      },
    );
  }

  createMatch(
    user: string,
    botLevel: BotLevelId,
    botProfile: string,
    seed: number,
    engineVersion: number,
  ) {
    const fn = 'rr_create_match';
    return this.#call(
      fn,
      {
        p_user: user,
        p_bot_level: botLevel,
        p_bot_profile: botProfile,
        p_seed: seed,
        p_engine_version: engineVersion,
      },
      // The function returns the new row without result and Elo: a new match is pending.
      (data) => matchOf(SupabaseStore.#single(fn, data), 'pending'),
    );
  }

  finishMatch(
    user: string,
    matchId: string,
    input: FinishMatchInput,
  ): Promise<StoreResult<FinishMatchOutput>> {
    const fn = 'rr_finish_match';
    return this.#call(
      fn,
      {
        p_user: user,
        p_match: matchId,
        p_result: input.result,
        p_picks: input.picks,
        p_elo_delta: input.eloDelta,
        p_arena: input.arena,
        p_gold: input.gold,
        p_with_pack: input.withPack,
      },
      (data) => {
        const row = SupabaseStore.#single(fn, data);
        return {
          elo: int(row, 'elo'),
          highestArena: int(row, 'highest_arena'),
          arenaUnlocked: bool(row, 'arena_unlocked'),
          gold: int(row, 'gold'),
          packId: strOrNull(row, 'pack_id'),
        };
      },
    );
  }

  openPack(user: string, packId: string, contents: PackReward) {
    const fn = 'rr_open_pack';
    return this.#call(fn, { p_user: user, p_pack: packId, p_contents: contents }, (data) => {
      const row = SupabaseStore.#single(fn, data);
      return { cardUnlocked: bool(row, 'card_unlocked') };
    });
  }
}
