/**
 * Contract between the client and the server (SPEC 14.2, D-082 ff.).
 *
 * Reads: the client selects its own rows directly (Row Level Security: own rows only).
 * Writes: never directly. Every change goes through ONE Edge Function, `api`, as a POST with
 * a JSON body `{ action, ...parameters }` and the player's access token. The function answers
 * `{ ok: true, data }` or `{ ok: false, error }`, both with HTTP 200; only a missing or
 * invalid token (401) and unexpected failures (500) use other status codes, with the same body.
 *
 * This file has no runtime dependencies besides the engine and runs unchanged in the browser,
 * in Node and in Deno. Imports across packages are relative on purpose: Deno resolves them
 * without an import map (D-083).
 */
import type { BotLevelId, CardId, PlayerConfig, UpgradeIndex } from '../../engine/src/index.ts';

/** Name of the Edge Function behind all actions. */
export const API_FUNCTION = 'api';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const API_ERROR_CODES = [
  /** No or invalid access token. */
  'unauthorized',
  /** The body is not a valid request of the given action. */
  'bad_request',
  /** Unexpected server failure; nothing was changed. */
  'internal',

  /** Not 3-16 characters of a-z A-Z 0-9 _ (SPEC 9). */
  'username_invalid',
  /** Another player has this name (ignoring case). */
  'username_taken',
  /** Rejected by the word filter. */
  'username_blocked',
  /** The free change is used up (SPEC 9). */
  'username_locked',
  /** The action needs a username first (onboarding not finished). */
  'username_missing',

  /** The card is not in the player's collection. */
  'card_not_owned',
  /** The card belongs to an arena the player has not reached yet. */
  'card_not_in_pool',
  /** Not exactly four different owned cards. */
  'deck_invalid',

  /** The card is already at the highest level. */
  'max_level',
  'not_enough_copies',
  'not_enough_gold',
  'not_enough_jokers',
  /** The card level is too low for this upgrade (SPEC 7.3). */
  'level_too_low',
  'upgrade_already_unlocked',

  /** Client and server run different engine versions; the client must update first. */
  'engine_mismatch',
  /** No such match of this player. */
  'match_not_found',
  /** The reported picks do not form a complete, valid match, or the bot's picks are not the bot's. */
  'match_rejected',

  /** No such pack of this player. */
  'pack_not_found',
  'pack_already_opened',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export interface ApiError {
  code: ApiErrorCode;
  /** Technical detail for logs and tests (English). The UI shows its own text per code. */
  detail?: string;
}

export type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: ApiError };

// ---------------------------------------------------------------------------
// Shared value types
// ---------------------------------------------------------------------------

/**
 * Everything both sides need to run one bot match identically (D-084). Created by the
 * server; the human is always engine player 0, the bot player 1.
 */
export interface MatchTicket {
  matchId: string;
  /** Server-generated match seed, 0 .. 2^53 - 1. Also seeds the bot's decisions. */
  seed: number;
  engineVersion: number;
  botLevel: BotLevelId;
  /** Id of a profile in the engine's BOT_PROFILES. Deck, levels and upgrades follow from it. */
  botProfile: string;
  /** Snapshot of the player's deck with the levels and unlocked upgrades of its four cards. */
  player: PlayerConfig;
}

/** Content of an opened pack (SPEC 7.4); stored in `packs.contents`. */
export type PackReward =
  | { kind: 'cards'; card: CardId; copies: number }
  | { kind: 'gold'; gold: number }
  | { kind: 'jokers'; jokers: number };

/** Result of a match from the point of view of the reporting player. */
export type MatchOutcome = 'win' | 'loss' | 'draw';

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export interface ApiActions {
  /**
   * First call: sets the name and grants the welcome pack (SPEC 9). Later calls rename;
   * one rename is free, after that the name is locked.
   */
  set_username: {
    request: { username: string };
    response: { username: string; welcomePackId: string | null };
  };
  /** Exactly four different owned cards (SPEC 7.1). */
  set_deck: {
    request: { cards: CardId[] };
    response: { cards: CardId[] };
  };
  /** Spends copies and gold to raise the card by one level (SPEC 7.2). */
  level_up_card: {
    request: { card: CardId };
    response: { card: CardId; level: number; copies: number; gold: number };
  };
  /** Spends gold to unlock one upgrade of an owned card (SPEC 7.3). */
  unlock_upgrade: {
    request: { card: CardId; upgrade: UpgradeIndex };
    response: { card: CardId; unlockedUpgrades: number; gold: number };
  };
  /**
   * Turns jokers into `copies` copies of a card from the unlocked arenas; unlocks the card
   * if the player does not own it yet (SPEC 7.4).
   */
  spend_jokers: {
    request: { card: CardId; copies: number };
    response: { card: CardId; copies: number; jokers: number };
  };
  /**
   * Starts a bot match. If the player still has an unfinished match:
   * - `pending: 'resume'` (default) returns that match again (`resumed: true`), unless it was
   *   created by another engine version; then it is dropped without Elo change and a new
   *   match is created.
   * - `pending: 'forfeit'` books it as a loss and creates a new match.
   */
  create_match: {
    request: { botLevel: BotLevelId; engineVersion: number; pending?: 'resume' | 'forfeit' };
    response: { ticket: MatchTicket; resumed: boolean };
  };
  /**
   * Reports a finished match: all picks of both players in order (like the engine's
   * `MatchState.picks`). The server replays the match, checks the bot's picks and books Elo
   * and reward. Reporting a match again returns the booked result (`repeated: true`).
   */
  report_match: {
    request: { matchId: string; picks: number[] };
    response: {
      outcome: MatchOutcome;
      eloDelta: number;
      /** Elo after booking. */
      elo: number;
      /** Highest arena after booking, and whether this match unlocked it. */
      highestArena: number;
      arenaUnlocked: boolean;
      /** Consolation gold granted (0 after a win). */
      gold: number;
      /** The unopened reward pack after a win, else null. */
      packId: string | null;
      repeated: boolean;
    };
  };
  /** Rolls and books the content of an unopened pack (SPEC 7.4). */
  open_pack: {
    request: { packId: string };
    response: { reward: PackReward; cardUnlocked: boolean };
  };
}

export type ApiAction = keyof ApiActions;
export type ApiRequestOf<A extends ApiAction> = ApiActions[A]['request'];
export type ApiResponseOf<A extends ApiAction> = ApiActions[A]['response'];

/** The JSON body of a call. */
export type ApiCall = { [A in ApiAction]: { action: A } & ApiRequestOf<A> }[ApiAction];

export const API_ACTIONS: readonly ApiAction[] = [
  'set_username',
  'set_deck',
  'level_up_card',
  'unlock_upgrade',
  'spend_jokers',
  'create_match',
  'report_match',
  'open_pack',
];

// ---------------------------------------------------------------------------
// Rows the client reads directly (snake_case like the database columns)
// ---------------------------------------------------------------------------

export interface ProfileRow {
  id: string;
  /** null until chosen during onboarding. */
  username: string | null;
  username_changes: number;
  elo: number;
  highest_arena: number;
  gold: number;
  jokers: number;
  games_played: number;
}

export interface PlayerCardRow {
  card_id: string;
  level: number;
  copies: number;
  /** Bit mask 0..7, bit i = upgrade i. */
  unlocked_upgrades: number;
}

export interface DeckRow {
  cards: string[];
}

export interface PackRow {
  id: string;
  /** 'match' = reward for a win, 'welcome' = the onboarding pack. */
  kind: 'match' | 'welcome';
  match_id: string | null;
  opened: boolean;
  contents: PackReward | null;
}

/** The columns of `matches` a client needs to resume its unfinished match. */
export interface PendingMatchRow {
  id: string;
  seed: number;
  engine_version: number;
  bot_level: BotLevelId;
  bot_profile: string;
  setup: PlayerConfig;
}
