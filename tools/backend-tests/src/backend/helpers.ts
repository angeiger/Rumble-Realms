/**
 * Helpers of the backend tests: guest accounts, calls of the Edge Function `api` over HTTP like
 * the app, honest local play of a bot match, and the admin client to prepare and check data.
 */
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  applyPick,
  chooseBotPick,
  createMatch,
  endRound,
  ENGINE_VERSION,
  getOffer,
  nextInt,
  OFFER_SIZE,
  seedRng,
  simulateToEnd,
  startBattle,
} from '@rumble-realms/engine';
import {
  API_FUNCTION,
  BOT,
  checkUsername,
  matchConfigOf,
  nextBotPick,
  outcomeOf,
} from '@rumble-realms/shared';
import type {
  ApiAction,
  ApiErrorCode,
  ApiRequestOf,
  ApiResponse,
  ApiResponseOf,
  MatchOutcome,
  MatchTicket,
  PackRow,
  PlayerCardRow,
  ProfileRow,
} from '@rumble-realms/shared';
import { expect } from 'vitest';
import { ADMIN_KEY, API_URL, CLIENT_KEY } from './env.ts';

const NO_SESSION = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
} as const;

export function functionUrl(): string {
  return `${API_URL}/functions/v1/${API_FUNCTION}`;
}

/** A client with only the public key (role anon). */
export function anonClient(): SupabaseClient {
  return createClient(API_URL as string, CLIENT_KEY as string, NO_SESSION);
}

let adminClient: SupabaseClient | null = null;
/** The server client (service_role, bypasses RLS): only to prepare and check data. */
export function admin(): SupabaseClient {
  adminClient ??= createClient(API_URL as string, ADMIN_KEY as string, NO_SESSION);
  return adminClient;
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export interface Guest {
  id: string;
  /** Access token of the guest (JWT). */
  token: string;
  /** supabase-js client signed in as this guest (role authenticated). */
  db: SupabaseClient;
}

/** A new anonymous account, created like the app does ("Als Gast spielen"). */
export async function newGuest(): Promise<Guest> {
  const db = anonClient();
  const { data, error } = await db.auth.signInAnonymously();
  if (error !== null || data.session === null || data.user === null) {
    throw new Error(`signInAnonymously failed: ${error?.message ?? 'no session'}`);
  }
  return { id: data.user.id, token: data.session.access_token, db };
}

/** A fresh, allowed username of 14 characters. */
export function uniqueName(): string {
  for (;;) {
    const name = `t${crypto.randomUUID().replace(/-/g, '').slice(0, 13)}`;
    if (checkUsername(name) === null) return name;
  }
}

export interface NamedGuest extends Guest {
  username: string;
  welcomePackId: string;
}

/** A new guest with a username (onboarding done, welcome pack still closed). */
export async function namedGuest(): Promise<NamedGuest> {
  const guest = await newGuest();
  const username = uniqueName();
  const data = await ok(guest, 'set_username', { username });
  expect(data.welcomePackId).toMatch(/^[0-9a-f-]{36}$/);
  return { ...guest, username, welcomePackId: data.welcomePackId as string };
}

// ---------------------------------------------------------------------------
// Calls of the Edge Function
// ---------------------------------------------------------------------------

export interface RawAnswer {
  status: number;
  headers: Headers;
  /** Parsed JSON body, or the text if it is not JSON (null for an empty body). */
  body: unknown;
  ms: number;
}

/** One HTTP request to the function, exactly as given. */
export async function raw(init: {
  method?: string;
  token?: string | null;
  body?: string;
  headers?: Record<string, string>;
}): Promise<RawAnswer> {
  const headers: Record<string, string> = {
    apikey: CLIENT_KEY as string,
    'Content-Type': 'application/json',
    ...init.headers,
  };
  if (init.token !== undefined && init.token !== null) {
    headers.Authorization = `Bearer ${init.token}`;
  }
  const start = performance.now();
  const res = await fetch(functionUrl(), {
    method: init.method ?? 'POST',
    headers,
    ...(init.body === undefined ? {} : { body: init.body }),
  });
  const text = await res.text();
  const ms = performance.now() - start;
  let body: unknown = null;
  if (text !== '') {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: res.status, headers: res.headers, body, ms };
}

export interface Answer<A extends ApiAction> {
  status: number;
  body: ApiResponse<ApiResponseOf<A>>;
  ms: number;
}

/** Calls `action` like the app (POST, JSON, the guest's token). */
export async function call<A extends ApiAction>(
  who: Pick<Guest, 'token'>,
  action: A,
  request: ApiRequestOf<A>,
): Promise<Answer<A>> {
  const r = await raw({ token: who.token, body: JSON.stringify({ action, ...request }) });
  return { status: r.status, body: r.body as ApiResponse<ApiResponseOf<A>>, ms: r.ms };
}

/** Calls `action` and expects success (HTTP 200, ok: true). */
export async function ok<A extends ApiAction>(
  who: Pick<Guest, 'token'>,
  action: A,
  request: ApiRequestOf<A>,
): Promise<ApiResponseOf<A>> {
  const r = await call(who, action, request);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  if (!r.body.ok) throw new Error(`${action} failed: ${JSON.stringify(r.body.error)}`);
  return r.body.data;
}

/** Calls `action` and expects an error answer with HTTP 200; returns the code. */
export async function fails<A extends ApiAction>(
  who: Pick<Guest, 'token'>,
  action: A,
  request: ApiRequestOf<A>,
): Promise<ApiErrorCode> {
  const r = await call(who, action, request);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  if (r.body.ok) throw new Error(`${action} succeeded unexpectedly: ${JSON.stringify(r.body)}`);
  return r.body.error.code;
}

// ---------------------------------------------------------------------------
// Playing a match locally (like the app)
// ---------------------------------------------------------------------------

export interface Played {
  /** All picks of both players in order (MatchState.picks). */
  picks: number[];
  outcome: MatchOutcome;
  /** Indexes of the bot's picks in `picks`. */
  botIndexes: number[];
}

/** How the human picks: at random, or with the strategy of the medium bot (a decent player). */
export type HumanStyle = 'random' | 'medium';

/**
 * Plays the ticket's match to the end: the human picks from `humanSeed` in the given style,
 * the bot with `nextBotPick` (like the app). With `tamperBotPick = k` the bot's k-th decision
 * is replaced by another slot (a manipulated client); the rest is played on honestly.
 */
export function playMatch(
  ticket: MatchTicket,
  humanSeed: number,
  tamperBotPick = -1,
  style: HumanStyle = 'random',
): Played {
  const cfg = matchConfigOf(ticket);
  if (cfg === null) throw new Error('playMatch: bad ticket');
  const state = createMatch(cfg);
  const rng = seedRng(humanSeed, 0);
  const human = (): number =>
    style === 'medium' ? chooseBotPick(state, 'medium', rng) : nextInt(rng, OFFER_SIZE);
  const botIndexes: number[] = [];
  while (state.phase !== 'finished') {
    if (state.phase === 'draft') {
      if (getOffer(state).player === BOT) {
        let slot = nextBotPick(state, ticket);
        if (botIndexes.length === tamperBotPick) slot = (slot + 1) % OFFER_SIZE;
        botIndexes.push(state.picks.length);
        applyPick(state, slot);
      } else {
        applyPick(state, human());
      }
    } else {
      simulateToEnd(startBattle(state));
      endRound(state);
    }
  }
  if (state.winner === null) throw new Error('playMatch: finished without a winner');
  return { picks: [...state.picks], outcome: outcomeOf(state.winner), botIndexes };
}

/**
 * An honest play of the ticket with the wanted outcome if one of `tries` human seeds gives it
 * (the human may pick whatever he wants; a win is searched with the medium strategy, anything
 * else with random picks), else the last one played.
 */
export function playFor(ticket: MatchTicket, want: MatchOutcome, tries = 40): Played {
  const style: HumanStyle = want === 'win' ? 'medium' : 'random';
  let last: Played | null = null;
  for (let seed = 1; seed <= tries; seed++) {
    last = playMatch(ticket, seed, -1, style);
    if (last.outcome === want) return last;
  }
  return last as Played;
}

/**
 * A new easy match the human can win, and its winning picks. Some bot profiles almost always
 * beat the start deck (e.g. one easy profile wins about 98 % against random picks), and the
 * server chooses the profile. So a match without a winning line is dropped without any booking
 * and a new one is created. The drop goes through the admin client: every way through the API
 * books something (giving up and a rejected report count as a loss, D-084, D-086).
 */
export async function winnableMatch(
  who: Pick<Guest, 'token'>,
): Promise<{ ticket: MatchTicket; played: Played }> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const { ticket } = await ok(who, 'create_match', {
      botLevel: 'easy',
      engineVersion: ENGINE_VERSION,
    });
    const played = playFor(ticket, 'win');
    if (played.outcome === 'win') return { ticket, played };
    await dropMatch(ticket.matchId);
  }
  throw new Error('winnableMatch: no winnable match in 10 attempts');
}

// ---------------------------------------------------------------------------
// Data (admin client)
// ---------------------------------------------------------------------------

function check<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error !== null) throw new Error(`${what}: ${r.error.message}`);
  if (r.data === null) throw new Error(`${what}: no data`);
  return r.data;
}

export async function profileOf(id: string): Promise<ProfileRow> {
  return check(
    await admin()
      .from('profiles')
      .select('id, username, username_changes, elo, highest_arena, gold, jokers, games_played')
      .eq('id', id)
      .single(),
    'profile',
  ) as ProfileRow;
}

export async function cardsOf(id: string): Promise<Map<string, PlayerCardRow>> {
  const rows = check(
    await admin()
      .from('player_cards')
      .select('card_id, level, copies, unlocked_upgrades')
      .eq('user_id', id),
    'cards',
  ) as PlayerCardRow[];
  return new Map(rows.map((r) => [r.card_id, r]));
}

export async function deckOf(id: string): Promise<string[] | null> {
  const r = await admin().from('decks').select('cards').eq('user_id', id).maybeSingle();
  if (r.error !== null) throw new Error(`deck: ${r.error.message}`);
  return (r.data?.cards as string[] | undefined) ?? null;
}

export interface StoredMatch {
  id: string;
  player_a: string;
  result: string;
  picks: number[];
  elo_delta_a: number | null;
  engine_version: number;
  finished_at: string | null;
}

export async function matchOf(matchId: string): Promise<StoredMatch> {
  return check(
    await admin()
      .from('matches')
      .select('id, player_a, result, picks, elo_delta_a, engine_version, finished_at')
      .eq('id', matchId)
      .single(),
    'match',
  ) as StoredMatch;
}

export async function packOf(packId: string): Promise<PackRow & { user_id: string }> {
  return check(
    await admin()
      .from('packs')
      .select('id, user_id, kind, match_id, opened, contents')
      .eq('id', packId)
      .single(),
    'pack',
  ) as PackRow & { user_id: string };
}

/** Closes a pending match as `abandoned` without touching the profile (test setup only). */
export async function dropMatch(matchId: string): Promise<void> {
  const r = await admin()
    .from('matches')
    .update({ result: 'abandoned', finished_at: new Date().toISOString() })
    .eq('id', matchId)
    .eq('result', 'pending')
    .select('id');
  if (r.error !== null) throw new Error(`dropMatch: ${r.error.message}`);
  if (r.data?.length !== 1) throw new Error(`dropMatch: match ${matchId} is not pending`);
}

export async function patchProfile(
  id: string,
  patch: Partial<Omit<ProfileRow, 'id' | 'username'>>,
): Promise<void> {
  const r = await admin().from('profiles').update(patch).eq('id', id);
  if (r.error !== null) throw new Error(`patchProfile: ${r.error.message}`);
}

/** Sets fields of a card; a card the player does not own yet is created (level 1). */
export async function patchCard(
  id: string,
  card: string,
  patch: Partial<Omit<PlayerCardRow, 'card_id'>>,
): Promise<void> {
  const r = await admin()
    .from('player_cards')
    .upsert({ user_id: id, card_id: card, ...patch }, { onConflict: 'user_id,card_id' });
  if (r.error !== null) throw new Error(`patchCard: ${r.error.message}`);
}

/** The value of a pack reward in the player's data, for checking a booking. */
export function rewardDelta(
  reward:
    | { kind: 'cards'; card: string; copies: number }
    | { kind: 'gold'; gold: number }
    | {
        kind: 'jokers';
        jokers: number;
      },
): { card?: string; copies: number; gold: number; jokers: number } {
  switch (reward.kind) {
    case 'cards':
      return { card: reward.card, copies: reward.copies, gold: 0, jokers: 0 };
    case 'gold':
      return { copies: 0, gold: reward.gold, jokers: 0 };
    case 'jokers':
      return { copies: 0, gold: 0, jokers: reward.jokers };
  }
}
