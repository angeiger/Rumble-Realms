/**
 * The port between the server logic (handlers.ts) and the data store (D-085).
 *
 * The handlers decide WHAT is booked (costs, Elo, pack content, match result) from the game
 * data. The store books it atomically and guards what only the data can know: ownership,
 * enough gold/copies/jokers, the state of a match or pack. Every write method is one atomic
 * step; if it reports an error, nothing was changed.
 *
 * Implementations:
 * - SupabaseStore (supabase/functions/api): one SQL function `rr_*` per write (PostgREST RPC
 *   with the service role), plain selects for the reads.
 * - MemoryStore (memoryStore.ts): the same rules in memory, for tests and for the client's
 *   local mode without a server.
 * Both must behave identically; the handler tests run against the MemoryStore, the
 * integration tests against the real database.
 */
import type { BotLevelId, PlayerConfig } from '../../../engine/src/index.ts';
import type { PackReward, PackRow, PlayerCardRow, ProfileRow } from '../protocol.ts';

/** Guard failures of the write methods; the names follow the SQL errors `rr:<code>`. */
export const STORE_ERROR_CODES = [
  /** The player has no profile. */
  'not_found',
  'bad_request',
  'username_taken',
  'username_locked',
  'username_invalid',
  'username_missing',
  'deck_invalid',
  'card_not_owned',
  /** The card is no longer at the level the caller computed the cost for. */
  'stale',
  'not_enough_copies',
  'not_enough_gold',
  'not_enough_jokers',
  'upgrade_already_unlocked',
  'level_too_low',
  /** The player already has an unfinished match. */
  'match_pending',
  'match_not_found',
  'match_not_pending',
  'pack_not_found',
  'pack_already_opened',
] as const;

export type StoreErrorCode = (typeof STORE_ERROR_CODES)[number];

export type StoreResult<T> = { ok: true; value: T } | { ok: false; code: StoreErrorCode };

export type MatchResult = 'pending' | 'a_won' | 'b_won' | 'draw' | 'abandoned';

/** A row of `matches` as the server logic needs it. The human is always player A. */
export interface MatchRow {
  id: string;
  seed: number;
  engine_version: number;
  bot_level: BotLevelId;
  bot_profile: string;
  /** Snapshot of the player's deck, levels and unlocked upgrades when the match was created. */
  setup: PlayerConfig;
  result: MatchResult;
  /** null until booked. */
  elo_delta_a: number | null;
}

export interface FinishMatchInput {
  /** Never 'pending'. */
  result: Exclude<MatchResult, 'pending'>;
  /** All picks of both players in order. */
  picks: number[];
  eloDelta: number;
  /** Arena the new Elo reaches; the store keeps the highest one ever reached. */
  arena: number;
  /** Gold to add (consolation after a loss or draw). */
  gold: number;
  /** Create an unopened reward pack (only with result 'a_won'). */
  withPack: boolean;
}

/** State of the player after the match was booked. */
export interface FinishMatchOutput {
  elo: number;
  highestArena: number;
  arenaUnlocked: boolean;
  /** Gold balance after booking. */
  gold: number;
  packId: string | null;
}

export interface Store {
  // --- Reads (never fail for a missing row: they return null or an empty list) ---
  getProfile(user: string): Promise<ProfileRow | null>;
  getCards(user: string): Promise<PlayerCardRow[]>;
  /** The player's unfinished match, if any. */
  getPendingMatch(user: string): Promise<MatchRow | null>;
  /** A match of this player (as player A), whatever its state. */
  getMatch(user: string, matchId: string): Promise<MatchRow | null>;
  /** A pack of this player. */
  getPack(user: string, packId: string): Promise<PackRow | null>;
  /** The reward pack of a match of this player, if one was granted. */
  getPackOfMatch(user: string, matchId: string): Promise<PackRow | null>;

  // --- Writes (each one atomic) ---

  /**
   * First call sets the name and creates the unopened welcome pack. Later calls rename while
   * fewer than `freeRenames` renames were used; the same name again changes nothing.
   * Errors: not_found, username_taken, username_locked, username_invalid.
   */
  setUsername(
    user: string,
    username: string,
    freeRenames: number,
  ): Promise<StoreResult<{ username: string; welcomePackId: string | null }>>;

  /** Errors: deck_invalid (not four different owned cards). */
  setDeck(user: string, cards: string[]): Promise<StoreResult<{ cards: string[] }>>;

  /**
   * Raises `card` from `fromLevel` by one level and takes `copies` copies and `gold` gold.
   * Errors: card_not_owned, stale, not_enough_copies, not_enough_gold, bad_request.
   */
  levelUpCard(
    user: string,
    card: string,
    fromLevel: number,
    copies: number,
    gold: number,
  ): Promise<StoreResult<{ level: number; copies: number; gold: number }>>;

  /**
   * Unlocks upgrade `upgrade` (0..2) of `card` for `gold` gold if the card has `minLevel`.
   * Errors: card_not_owned, upgrade_already_unlocked, level_too_low, not_enough_gold, bad_request.
   */
  unlockUpgrade(
    user: string,
    card: string,
    upgrade: number,
    minLevel: number,
    gold: number,
  ): Promise<StoreResult<{ unlockedUpgrades: number; gold: number }>>;

  /**
   * Takes `jokers` jokers and adds `copies` copies of `card`; a card the player does not own
   * yet is created at level 1.
   * Errors: not_enough_jokers, bad_request.
   */
  spendJokers(
    user: string,
    card: string,
    copies: number,
    jokers: number,
  ): Promise<StoreResult<{ copies: number; jokers: number; cardUnlocked: boolean }>>;

  /**
   * Creates a pending bot match; the store takes the snapshot (`setup`) of the player's deck
   * itself. Errors: username_missing, match_pending, not_found, deck_invalid (the stored deck
   * is broken), bad_request.
   */
  createMatch(
    user: string,
    botLevel: BotLevelId,
    botProfile: string,
    seed: number,
    engineVersion: number,
  ): Promise<StoreResult<MatchRow>>;

  /**
   * Books a pending match exactly once. With result 'abandoned' nothing but the match row
   * changes (eloDelta, arena and gold must be 0, withPack false).
   * Errors: match_not_found, match_not_pending, bad_request.
   */
  finishMatch(
    user: string,
    matchId: string,
    input: FinishMatchInput,
  ): Promise<StoreResult<FinishMatchOutput>>;

  /**
   * Opens an unopened pack exactly once: stores `contents` and books it (copies, gold or jokers).
   * Errors: pack_not_found, pack_already_opened, bad_request.
   */
  openPack(
    user: string,
    packId: string,
    contents: PackReward,
  ): Promise<StoreResult<{ cardUnlocked: boolean }>>;
}

/** Everything the handlers need from the outside besides the store. */
export interface ServerEnv {
  /**
   * Uniform random integer in 0..n-1 from a secure source (seeds, bot profile, packs).
   * Must support n up to 2^32 (the match seed is built from two such numbers).
   */
  randInt(n: number): number;
  /** Milliseconds, monotonic; only used to limit the time spent on checking bot picks. */
  now(): number;
}
