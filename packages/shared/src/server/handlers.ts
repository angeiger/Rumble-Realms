/**
 * The server logic of the `api` Edge Function (protocol.ts, SPEC 14.2, D-085): one function
 * per action. The handlers check the request against the game rules (progression.ts,
 * username.ts, match.ts), compute what is booked (costs, Elo, rewards, pack content) and let
 * the store book it atomically (store.ts). The same code runs on the server (SupabaseStore)
 * and in the client's local mode (MemoryStore).
 *
 * Errors the store reports are mapped to API codes: expected ones with the same name 1:1,
 * `not_found` (no profile) to `unauthorized`, anything else to `internal` with a detail.
 * Exceptions of the store are not caught: the Edge Function answers them with 500.
 *
 * No runtime dependencies besides the engine; runs in the browser, in Node and in Deno.
 */
import { BOT_LEVELS, ENGINE_VERSION, FREE_RENAMES, LOSS_GOLD } from '../../../engine/src/index.ts';
import type { BotLevelId, CardId } from '../../../engine/src/index.ts';
import { pickBotProfile, serverCheckPolicy, verifyBotMatch } from '../match.ts';
import {
  arenaForElo,
  checkDeck,
  checkLevelUp,
  checkSpendJokers,
  checkUnlockUpgrade,
  eloChange,
  jokerCost,
  levelUpCost,
  rollPack,
  upgradeUnlockCost,
  welcomeReward,
} from '../progression.ts';
import type { OwnedCard } from '../progression.ts';
import type {
  ApiAction,
  ApiCall,
  ApiError,
  ApiErrorCode,
  ApiRequestOf,
  ApiResponse,
  ApiResponseOf,
  MatchOutcome,
  MatchTicket,
  PlayerCardRow,
  ProfileRow,
} from '../protocol.ts';
import { checkUsername } from '../username.ts';
import { parseApiCall } from '../validate.ts';
import type { FinishMatchInput, MatchRow, ServerEnv, Store, StoreErrorCode } from './store.ts';

/** The answer of one action. */
export type ApiResultOf<A extends ApiAction> = ApiResponse<ApiResponseOf<A>>;

/** Signature of the handler of action `A`. `user` is the already authenticated account id. */
export type ActionHandler<A extends ApiAction> = (
  store: Store,
  env: ServerEnv,
  user: string,
  request: ApiRequestOf<A>,
) => Promise<ApiResultOf<A>>;

/**
 * Match seeds have 53 bits (MatchTicket.seed): 21 high bits times 2^32 plus 32 low bits, so
 * two draws of `randInt` cover 0 .. 2^53 - 1 uniformly.
 */
const SEED_HIGH = 2 ** 21;
const SEED_LOW = 2 ** 32;

/** How often level_up_card reads and checks again after the store reported `stale`. */
const STALE_RETRIES = 1;

/** Store codes that exist in the API with the same meaning. */
type SharedCode = Extract<StoreErrorCode, ApiErrorCode>;

const SCORE: Readonly<Record<MatchOutcome, 0 | 0.5 | 1>> = { win: 1, draw: 0.5, loss: 0 };
const RESULT_OF: Readonly<Record<MatchOutcome, 'a_won' | 'b_won' | 'draw'>> = {
  win: 'a_won',
  loss: 'b_won',
  draw: 'draw',
};

/** Closes a match without any booking (store.ts: everything 0 with 'abandoned'). */
function abandoned(picks: readonly number[]): FinishMatchInput {
  return {
    result: 'abandoned',
    picks: [...picks],
    eloDelta: 0,
    arena: 0,
    gold: 0,
    withPack: false,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ok<T>(data: T): ApiResponse<T> {
  return { ok: true, data };
}

type ApiFailure = { ok: false; error: ApiError };

function err(code: ApiErrorCode, detail?: string): ApiFailure {
  return detail === undefined
    ? { ok: false, error: { code } }
    : { ok: false, error: { code, detail } };
}

function noProfile(): ApiFailure {
  return err('unauthorized', 'no profile');
}

/** Maps an error of the store (see file comment). */
function storeFailure(
  action: ApiAction,
  code: StoreErrorCode,
  expected: readonly SharedCode[],
): ApiFailure {
  if (code === 'not_found') return noProfile();
  const hit = expected.find((c) => c === code);
  if (hit !== undefined) return err(hit);
  return err('internal', `${action}: unexpected store error ${code}`);
}

function ownedCard(rows: readonly PlayerCardRow[], card: CardId): OwnedCard | undefined {
  const row = rows.find((r) => r.card_id === card);
  return row === undefined
    ? undefined
    : { level: row.level, copies: row.copies, unlockedUpgrades: row.unlocked_upgrades };
}

/** The ticket of a stored match (also of a `PendingMatchRow` the client read itself). */
export function ticketOfMatch(
  row: Pick<MatchRow, 'id' | 'seed' | 'engine_version' | 'bot_level' | 'bot_profile' | 'setup'>,
): MatchTicket {
  return {
    matchId: row.id,
    seed: row.seed,
    engineVersion: row.engine_version,
    botLevel: row.bot_level,
    botProfile: row.bot_profile,
    player: row.setup,
  };
}

/**
 * Elo change and arena after a bot match (SPEC 7.5): K halved against bots, the arena of the
 * new Elo (the store keeps the highest arena ever reached).
 */
function eloBooking(
  profile: ProfileRow,
  botLevel: BotLevelId,
  outcome: MatchOutcome,
): { eloDelta: number; arena: number } {
  const eloDelta = eloChange({
    elo: profile.elo,
    opponentElo: BOT_LEVELS[botLevel].elo,
    score: SCORE[outcome],
    gamesPlayed: profile.games_played,
    vsBot: true,
  });
  return { eloDelta, arena: arenaForElo(profile.elo + eloDelta) };
}

function isKnownBotLevel(level: string): level is BotLevelId {
  return Object.hasOwn(BOT_LEVELS, level);
}

/**
 * Books a pending match. null when done, or when another request closed it in the meantime
 * (the caller goes on either way); else the error to answer.
 */
async function closeMatch(
  store: Store,
  action: ApiAction,
  user: string,
  matchId: string,
  input: FinishMatchInput,
): Promise<ApiFailure | null> {
  const r = await store.finishMatch(user, matchId, input);
  if (r.ok || r.code === 'match_not_pending' || r.code === 'match_not_found') return null;
  return storeFailure(action, r.code, []);
}

// ---------------------------------------------------------------------------
// Profile and collection
// ---------------------------------------------------------------------------

export const handleSetUsername: ActionHandler<'set_username'> = async (store, _env, user, req) => {
  const invalid = checkUsername(req.username);
  if (invalid !== null) return err(invalid);
  const r = await store.setUsername(user, req.username, FREE_RENAMES);
  if (!r.ok) {
    return storeFailure('set_username', r.code, [
      'username_taken',
      'username_locked',
      'username_invalid',
    ]);
  }
  return ok({ username: r.value.username, welcomePackId: r.value.welcomePackId });
};

export const handleSetDeck: ActionHandler<'set_deck'> = async (store, _env, user, req) => {
  const [profile, cards] = await Promise.all([store.getProfile(user), store.getCards(user)]);
  if (profile === null) return noProfile();
  const invalid = checkDeck(req.cards, new Set(cards.map((c) => c.card_id)));
  if (invalid !== null) return err(invalid);
  const r = await store.setDeck(user, req.cards);
  if (!r.ok) return storeFailure('set_deck', r.code, ['deck_invalid']);
  // The store saved exactly the checked list.
  return ok({ cards: [...req.cards] });
};

export const handleLevelUpCard: ActionHandler<'level_up_card'> = async (store, _env, user, req) => {
  for (let attempt = 0; ; attempt++) {
    const [profile, cards] = await Promise.all([store.getProfile(user), store.getCards(user)]);
    if (profile === null) return noProfile();
    const owned = ownedCard(cards, req.card);
    const invalid = checkLevelUp(req.card, owned, profile.gold);
    if (invalid !== null) return err(invalid);
    // checkLevelUp passed, so the card is owned and below the highest level.
    const level = (owned as OwnedCard).level;
    const cost = levelUpCost(req.card, level) as { copies: number; gold: number };
    const r = await store.levelUpCard(user, req.card, level, cost.copies, cost.gold);
    if (r.ok) return ok({ card: req.card, ...r.value });
    // A second request booked a level-up in between: check again with fresh data.
    if (r.code === 'stale' && attempt < STALE_RETRIES) continue;
    return storeFailure('level_up_card', r.code, [
      'card_not_owned',
      'not_enough_copies',
      'not_enough_gold',
    ]);
  }
};

export const handleUnlockUpgrade: ActionHandler<'unlock_upgrade'> = async (
  store,
  _env,
  user,
  req,
) => {
  const [profile, cards] = await Promise.all([store.getProfile(user), store.getCards(user)]);
  if (profile === null) return noProfile();
  const invalid = checkUnlockUpgrade(ownedCard(cards, req.card), req.upgrade, profile.gold);
  if (invalid !== null) return err(invalid);
  const cost = upgradeUnlockCost(req.upgrade);
  const r = await store.unlockUpgrade(user, req.card, req.upgrade, cost.level, cost.gold);
  if (!r.ok) {
    return storeFailure('unlock_upgrade', r.code, [
      'card_not_owned',
      'upgrade_already_unlocked',
      'level_too_low',
      'not_enough_gold',
    ]);
  }
  return ok({ card: req.card, unlockedUpgrades: r.value.unlockedUpgrades, gold: r.value.gold });
};

export const handleSpendJokers: ActionHandler<'spend_jokers'> = async (store, _env, user, req) => {
  const profile = await store.getProfile(user);
  if (profile === null) return noProfile();
  const invalid = checkSpendJokers(req.card, req.copies, profile.jokers, profile.highest_arena);
  if (invalid !== null) return err(invalid);
  const r = await store.spendJokers(user, req.card, req.copies, jokerCost(req.card, req.copies));
  if (!r.ok) return storeFailure('spend_jokers', r.code, ['not_enough_jokers']);
  return ok({ card: req.card, copies: r.value.copies, jokers: r.value.jokers });
};

// ---------------------------------------------------------------------------
// Matches
// ---------------------------------------------------------------------------

export const handleCreateMatch: ActionHandler<'create_match'> = async (store, env, user, req) => {
  if (req.engineVersion !== ENGINE_VERSION) {
    return err('engine_mismatch', `client ${req.engineVersion}, server ${ENGINE_VERSION}`);
  }
  const profile = await store.getProfile(user);
  if (profile === null) return noProfile();
  if (profile.username === null) return err('username_missing');

  const pending = await store.getPendingMatch(user);
  if (pending !== null) {
    let input: FinishMatchInput;
    if (pending.engine_version !== ENGINE_VERSION || !isKnownBotLevel(pending.bot_level)) {
      // A match of another engine version can no longer be replayed: drop it.
      input = abandoned([]);
    } else if (req.pending !== 'forfeit') {
      return ok({ ticket: ticketOfMatch(pending), resumed: true });
    } else {
      // Giving up counts as a loss, without the consolation gold.
      const { eloDelta, arena } = eloBooking(profile, pending.bot_level, 'loss');
      input = { result: 'b_won', picks: [], eloDelta, arena, gold: 0, withPack: false };
    }
    const failed = await closeMatch(store, 'create_match', user, pending.id, input);
    if (failed !== null) return failed;
  }

  const bot = pickBotProfile(req.botLevel, env.randInt);
  const seed = env.randInt(SEED_HIGH) * SEED_LOW + env.randInt(SEED_LOW);
  const r = await store.createMatch(user, req.botLevel, bot.id, seed, ENGINE_VERSION);
  if (r.ok) return ok({ ticket: ticketOfMatch(r.value), resumed: false });
  if (r.code === 'match_pending') {
    // A second request created a match in between: that one is the player's match now.
    const current = await store.getPendingMatch(user);
    if (current !== null) return ok({ ticket: ticketOfMatch(current), resumed: true });
    return err('internal', 'create_match: match_pending, but no pending match');
  }
  return storeFailure('create_match', r.code, ['username_missing', 'deck_invalid']);
};

/** The answer for a match that is booked already (`repeated: true`). */
async function bookedResult(
  store: Store,
  user: string,
  match: MatchRow,
  profile: ProfileRow,
): Promise<ApiResultOf<'report_match'>> {
  let outcome: MatchOutcome;
  switch (match.result) {
    case 'a_won':
      outcome = 'win';
      break;
    case 'b_won':
      outcome = 'loss';
      break;
    case 'draw':
      outcome = 'draw';
      break;
    case 'abandoned':
      return err('match_rejected', 'abandoned');
    case 'pending':
      return err('internal', 'report_match: the match is still pending');
  }
  const pack = await store.getPackOfMatch(user, match.id);
  return ok({
    outcome,
    eloDelta: match.elo_delta_a ?? 0,
    elo: profile.elo,
    highestArena: profile.highest_arena,
    arenaUnlocked: false,
    gold: outcome === 'win' ? 0 : LOSS_GOLD,
    packId: pack?.id ?? null,
    repeated: true,
  });
}

export const handleReportMatch: ActionHandler<'report_match'> = async (store, env, user, req) => {
  const [profile, match] = await Promise.all([
    store.getProfile(user),
    store.getMatch(user, req.matchId),
  ]);
  if (profile === null) return noProfile();
  if (match === null) return err('match_not_found');
  if (match.result !== 'pending') return bookedResult(store, user, match, profile);

  if (match.engine_version !== ENGINE_VERSION) {
    const failed = await closeMatch(store, 'report_match', user, match.id, abandoned([]));
    return (
      failed ??
      err('engine_mismatch', `match of engine ${match.engine_version}, server ${ENGINE_VERSION}`)
    );
  }

  const verdict = verifyBotMatch(
    ticketOfMatch(match),
    req.picks,
    serverCheckPolicy(match.bot_level, env.randInt, env.now),
  );
  if (!verdict.ok) {
    // Not finished yet: an honest client can play on and report again.
    if (verdict.reason === 'incomplete') return err('match_rejected', 'incomplete');
    // Everything else cannot become valid any more: close without Elo and reward.
    const failed = await closeMatch(store, 'report_match', user, match.id, abandoned(req.picks));
    if (failed !== null) return failed;
    if (verdict.reason === 'bad_ticket') {
      return err('internal', `report_match: bad_ticket: ${verdict.detail}`);
    }
    return err('match_rejected', verdict.reason);
  }

  // verifyBotMatch accepts only tickets with a profile of a known level.
  const outcome = verdict.outcome;
  const { eloDelta, arena } = eloBooking(profile, match.bot_level, outcome);
  const gold = outcome === 'win' ? 0 : LOSS_GOLD;
  const r = await store.finishMatch(user, match.id, {
    result: RESULT_OF[outcome],
    picks: [...req.picks],
    eloDelta,
    arena,
    gold,
    withPack: outcome === 'win',
  });
  if (r.ok) {
    return ok({
      outcome,
      eloDelta,
      elo: r.value.elo,
      highestArena: r.value.highestArena,
      arenaUnlocked: r.value.arenaUnlocked,
      gold,
      packId: r.value.packId,
      repeated: false,
    });
  }
  if (r.code === 'match_not_pending') {
    // A second report booked the match in between: answer with its booking.
    const [again, now] = await Promise.all([
      store.getMatch(user, match.id),
      store.getProfile(user),
    ]);
    if (again === null) return err('match_not_found');
    if (now === null) return noProfile();
    return bookedResult(store, user, again, now);
  }
  return storeFailure('report_match', r.code, ['match_not_found']);
};

// ---------------------------------------------------------------------------
// Packs
// ---------------------------------------------------------------------------

export const handleOpenPack: ActionHandler<'open_pack'> = async (store, env, user, req) => {
  const [profile, pack] = await Promise.all([
    store.getProfile(user),
    store.getPack(user, req.packId),
  ]);
  if (profile === null) return noProfile();
  if (pack === null) return err('pack_not_found');
  if (pack.opened) return err('pack_already_opened');
  const reward =
    pack.kind === 'welcome' ? welcomeReward() : rollPack(env.randInt, profile.highest_arena);
  const r = await store.openPack(user, pack.id, reward);
  if (!r.ok) return storeFailure('open_pack', r.code, ['pack_not_found', 'pack_already_opened']);
  return ok({ reward, cardUnlocked: r.value.cardUnlocked });
};

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/** Runs one checked call (see `parseApiCall`) for the authenticated account `user`. */
export function handleApiCall(
  store: Store,
  env: ServerEnv,
  user: string,
  call: ApiCall,
): Promise<ApiResponse<unknown>> {
  switch (call.action) {
    case 'set_username':
      return handleSetUsername(store, env, user, call);
    case 'set_deck':
      return handleSetDeck(store, env, user, call);
    case 'level_up_card':
      return handleLevelUpCard(store, env, user, call);
    case 'unlock_upgrade':
      return handleUnlockUpgrade(store, env, user, call);
    case 'spend_jokers':
      return handleSpendJokers(store, env, user, call);
    case 'create_match':
      return handleCreateMatch(store, env, user, call);
    case 'report_match':
      return handleReportMatch(store, env, user, call);
    case 'open_pack':
      return handleOpenPack(store, env, user, call);
  }
}

/** Checks a raw JSON body and runs it; a body that is not a valid call gives `bad_request`. */
export async function handleApiBody(
  store: Store,
  env: ServerEnv,
  user: string,
  body: unknown,
): Promise<ApiResponse<unknown>> {
  const call = parseApiCall(body);
  if (call === null) return err('bad_request');
  return handleApiCall(store, env, user, call);
}
