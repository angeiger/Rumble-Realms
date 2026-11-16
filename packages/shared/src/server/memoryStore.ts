/**
 * The Store port (store.ts) in memory: for the handler tests and for the client's local mode
 * without a server. It follows the SQL functions `rr_*` of the database (supabase/migrations)
 * rule by rule: the same guards, the same error codes in the same order, and every write
 * method changes all of its rows or none (all checks run before the first change).
 *
 * The state can be saved as plain JSON (`snapshot`) and loaded again
 * (`createMemoryStore({ data })`); loading checks every row like the table constraints and
 * drops what does not fit, unusable data gives an empty store.
 *
 * No runtime dependencies besides the engine; runs in the browser, in Node and in Deno.
 */
import {
  ALL_UPGRADES_MASK,
  ARENAS,
  BOT_LEVELS,
  DECK_SIZE,
  ELO,
  MAX_LEVEL,
  STARTER_CARDS,
  STARTER_COPIES,
  STARTER_DECK,
  UPGRADES_PER_CARD,
} from '../../../engine/src/index.ts';
import type { BotLevelId, CardId, PlayerConfig } from '../../../engine/src/index.ts';
import type { DeckRow, PackReward, PackRow, PlayerCardRow, ProfileRow } from '../protocol.ts';
import { USERNAME_PATTERN } from '../username.ts';
import type {
  FinishMatchInput,
  FinishMatchOutput,
  MatchResult,
  MatchRow,
  Store,
  StoreErrorCode,
  StoreResult,
} from './store.ts';

// ---------------------------------------------------------------------------
// Limits of the database columns (supabase/migrations, section 1)
// ---------------------------------------------------------------------------

/** `player_cards.card_id` and every deck slot: format only, like the table constraint. */
const CARD_ID_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;
/** `matches.bot_profile`. */
const BOT_PROFILE_PATTERN = /^[a-z][a-z0-9-]{0,47}$/;
/** Largest value of a SQL `integer` column or parameter. */
const INT32_MAX = 2147483647;
const FIRST_ARENA = ARENAS[0]?.id ?? 1;
const LAST_ARENA = ARENAS[ARENAS.length - 1]?.id ?? FIRST_ARENA;
const MATCH_RESULTS: readonly MatchResult[] = ['pending', 'a_won', 'b_won', 'draw', 'abandoned'];
/** How often a new id is drawn when the generator returns one that is already in use. */
const ID_ATTEMPTS = 100;

/** Version of the JSON layout of `MemoryStoreData`. */
export const MEMORY_STORE_FORMAT = 1;

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

export interface MemoryCardRow extends PlayerCardRow {
  user_id: string;
}

export interface MemoryDeckRow extends DeckRow {
  user_id: string;
}

export interface MemoryMatchRow extends MatchRow {
  player_a: string;
  /** All picks of both players as booked; [] while pending. */
  picks: number[];
}

export interface MemoryPackRow extends PackRow {
  user_id: string;
}

/** The whole state as plain JSON (`snapshot`). Rows are in the order they were created. */
export interface MemoryStoreData {
  format: typeof MEMORY_STORE_FORMAT;
  /** Counter of the default id generator. */
  nextId: number;
  profiles: ProfileRow[];
  cards: MemoryCardRow[];
  decks: MemoryDeckRow[];
  matches: MemoryMatchRow[];
  packs: MemoryPackRow[];
}

export interface MemoryStoreOptions {
  /** A former `snapshot()`, e.g. from browser storage. Checked and cleaned (see file comment). */
  data?: unknown;
  /**
   * Generator of match and pack ids. It should return lower-case UUIDs, so that
   * `parseApiCall` accepts them (e.g. `() => crypto.randomUUID()`). Default:
   * `sequentialId` of a counter that is part of the snapshot (deterministic for tests).
   */
  newId?: () => string;
}

export interface MemoryStore extends Store {
  /**
   * Creates an account like the database trigger for new users: profile (Elo `ELO.start`,
   * no gold, no jokers, arena 1, no name), the start cards at level 1 with `STARTER_COPIES`
   * copies and the start deck. Throws if the id is empty or exists already.
   */
  addUser(id: string): void;
  hasUser(id: string): boolean;
  /** The player's deck, or null. */
  getDeck(user: string): Promise<DeckRow | null>;
  /** All packs of the player, opened or not, oldest first. */
  listPacks(user: string): Promise<PackRow[]>;
  /** The whole state as plain JSON (a fresh copy). */
  snapshot(): MemoryStoreData;
  /**
   * TEST HELPER (also for a local cheat menu, never for game logic): overwrites fields of the
   * profile. Throws on an unknown user or a value the database would reject.
   */
  patchProfile(user: string, patch: Partial<Omit<ProfileRow, 'id' | 'username'>>): void;
  /**
   * TEST HELPER: overwrites fields of a card of the player; a card the player does not own
   * yet is created first (level 1, no copies, no upgrades). Throws on an unknown user or a
   * value the database would reject.
   */
  patchCard(user: string, card: string, patch: Partial<Omit<PlayerCardRow, 'card_id'>>): void;
}

/** The default id for counter value `n`: a UUID (version 4 layout) holding `n` in hex. */
export function sequentialId(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

export function emptyMemoryStoreData(): MemoryStoreData {
  return {
    format: MEMORY_STORE_FORMAT,
    nextId: 0,
    profiles: [],
    cards: [],
    decks: [],
    matches: [],
    packs: [],
  };
}

// ---------------------------------------------------------------------------
// Checks (shared by the write methods, the test helpers and loading)
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;

function isPlainObject(value: unknown): value is Obj {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isInt(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}

function isCardIdFormat(value: unknown): value is string {
  return typeof value === 'string' && CARD_ID_PATTERN.test(value);
}

function isBotLevel(value: unknown): value is BotLevelId {
  return typeof value === 'string' && Object.hasOwn(BOT_LEVELS, value);
}

function isBotProfileFormat(value: unknown): value is string {
  return typeof value === 'string' && BOT_PROFILE_PATTERN.test(value);
}

function isSeed(value: unknown): value is number {
  return isInt(value, 0, Number.MAX_SAFE_INTEGER);
}

function isEngineVersion(value: unknown): value is number {
  return isInt(value, 1, INT32_MAX);
}

function isPicks(value: unknown): value is number[] {
  return Array.isArray(value) && (value as unknown[]).every((p) => isInt(p, 0, INT32_MAX));
}

function lowerName(name: string): string {
  return name.toLowerCase();
}

/** A profile row with exactly the known fields, or null (table `profiles`). */
function profileOf(v: unknown): ProfileRow | null {
  if (!isPlainObject(v)) return null;
  const { id, username } = v;
  if (typeof id !== 'string' || id.length === 0) return null;
  if (username !== null && (typeof username !== 'string' || !USERNAME_PATTERN.test(username))) {
    return null;
  }
  const row: ProfileRow = {
    id,
    username,
    username_changes: v.username_changes as number,
    elo: v.elo as number,
    highest_arena: v.highest_arena as number,
    gold: v.gold as number,
    jokers: v.jokers as number,
    games_played: v.games_played as number,
  };
  return profileNumbersValid(row) ? row : null;
}

function profileNumbersValid(p: ProfileRow): boolean {
  return (
    isInt(p.username_changes, 0, INT32_MAX) &&
    isInt(p.elo, 0, INT32_MAX) &&
    isInt(p.highest_arena, FIRST_ARENA, LAST_ARENA) &&
    isInt(p.gold, 0, INT32_MAX) &&
    isInt(p.jokers, 0, INT32_MAX) &&
    isInt(p.games_played, 0, INT32_MAX)
  );
}

function cardNumbersValid(c: PlayerCardRow): boolean {
  return (
    isInt(c.level, 1, MAX_LEVEL) &&
    isInt(c.copies, 0, INT32_MAX) &&
    isInt(c.unlocked_upgrades, 0, ALL_UPGRADES_MASK)
  );
}

/** A card row (table `player_cards`), or null. */
function cardOf(v: unknown): MemoryCardRow | null {
  if (!isPlainObject(v) || typeof v.user_id !== 'string' || !isCardIdFormat(v.card_id)) {
    return null;
  }
  const row: MemoryCardRow = {
    user_id: v.user_id,
    card_id: v.card_id,
    level: v.level as number,
    copies: v.copies as number,
    unlocked_upgrades: v.unlocked_upgrades as number,
  };
  return cardNumbersValid(row) ? row : null;
}

/** DECK_SIZE different card ids of valid format, or null (table `decks`). */
function deckCardsOf(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length !== DECK_SIZE) return null;
  const cards = v as unknown[];
  if (!cards.every(isCardIdFormat)) return null;
  return new Set(cards).size === DECK_SIZE ? [...(cards as string[])] : null;
}

/** A record of card id -> integer in [min, max], or null. */
function cardNumbersOf(
  v: unknown,
  min: number,
  max: number,
): Partial<Record<CardId, number>> | null {
  if (!isPlainObject(v)) return null;
  const out: Partial<Record<CardId, number>> = {};
  for (const [key, value] of Object.entries(v)) {
    if (!isCardIdFormat(key) || !isInt(value, min, max)) return null;
    // Only the format is known here, like in the database (`setup` is plain jsonb).
    out[key as CardId] = value;
  }
  return out;
}

/** The snapshot of a player config (`matches.setup`), or null. */
function setupOf(v: unknown): PlayerConfig | null {
  if (!isPlainObject(v)) return null;
  const deck = deckCardsOf(v.deck);
  const levels = cardNumbersOf(v.levels, 1, MAX_LEVEL);
  if (deck === null || levels === null) return null;
  const setup: PlayerConfig = { deck: deck as CardId[], levels };
  if (v.upgrades !== undefined) {
    const upgrades = cardNumbersOf(v.upgrades, 0, ALL_UPGRADES_MASK);
    if (upgrades === null) return null;
    setup.upgrades = upgrades;
  }
  return setup;
}

function copySetup(s: PlayerConfig): PlayerConfig {
  const copy: PlayerConfig = { deck: [...s.deck], levels: { ...s.levels } };
  if (s.upgrades !== undefined) copy.upgrades = { ...s.upgrades };
  return copy;
}

/** A match row (table `matches`), or null. */
function matchOf(v: unknown): MemoryMatchRow | null {
  if (!isPlainObject(v)) return null;
  const { id, player_a, seed, engine_version, bot_level, bot_profile, result, elo_delta_a } = v;
  const setup = setupOf(v.setup);
  if (
    typeof id !== 'string' ||
    id.length === 0 ||
    typeof player_a !== 'string' ||
    !isSeed(seed) ||
    !isEngineVersion(engine_version) ||
    !isBotLevel(bot_level) ||
    !isBotProfileFormat(bot_profile) ||
    setup === null ||
    !isPicks(v.picks) ||
    typeof result !== 'string' ||
    !(MATCH_RESULTS as readonly string[]).includes(result) ||
    (elo_delta_a !== null && !isInt(elo_delta_a, -INT32_MAX, INT32_MAX))
  ) {
    return null;
  }
  return {
    id,
    player_a,
    seed,
    engine_version,
    bot_level,
    bot_profile,
    setup,
    picks: [...v.picks],
    result: result as MatchResult,
    elo_delta_a,
  };
}

/**
 * The checked and normalized pack content, or null, by the rules of `rr_open_pack`: one of
 * the three shapes with exactly its keys and a whole amount 1..INT32_MAX. Like the database,
 * only the format of a card id is checked (by the caller, when the card is unlocked).
 */
function contentsOf(v: unknown): PackReward | null {
  if (!isPlainObject(v)) return null;
  const keys = Object.keys(v).sort().join(',');
  switch (v.kind) {
    case 'cards':
      return keys === 'card,copies,kind' &&
        typeof v.card === 'string' &&
        isInt(v.copies, 1, INT32_MAX)
        ? { kind: 'cards', card: v.card as CardId, copies: v.copies }
        : null;
    case 'gold':
      return keys === 'gold,kind' && isInt(v.gold, 1, INT32_MAX)
        ? { kind: 'gold', gold: v.gold }
        : null;
    case 'jokers':
      return keys === 'jokers,kind' && isInt(v.jokers, 1, INT32_MAX)
        ? { kind: 'jokers', jokers: v.jokers }
        : null;
    default:
      return null;
  }
}

/** A pack row (table `packs`), or null. */
function packOf(v: unknown): MemoryPackRow | null {
  if (!isPlainObject(v)) return null;
  const { id, user_id, kind, match_id, opened } = v;
  if (typeof id !== 'string' || id.length === 0 || typeof user_id !== 'string') return null;
  if (kind !== 'match' && kind !== 'welcome') return null;
  if (match_id !== null && (typeof match_id !== 'string' || kind === 'welcome')) return null;
  if (typeof opened !== 'boolean') return null;
  let contents: PackReward | null = null;
  if (v.contents !== null) {
    contents = contentsOf(v.contents);
    if (contents === null) return null;
  }
  if (opened && contents === null) return null;
  return { id, user_id, kind, match_id, opened, contents };
}

function copyContents(c: PackReward | null): PackReward | null {
  return c === null ? null : { ...c };
}

function copyPack(p: MemoryPackRow): PackRow {
  return {
    id: p.id,
    kind: p.kind,
    match_id: p.match_id,
    opened: p.opened,
    contents: copyContents(p.contents),
  };
}

function copyMatch(m: MemoryMatchRow): MatchRow {
  return {
    id: m.id,
    seed: m.seed,
    engine_version: m.engine_version,
    bot_level: m.bot_level,
    bot_profile: m.bot_profile,
    setup: copySetup(m.setup),
    result: m.result,
    elo_delta_a: m.elo_delta_a,
  };
}

function copyCard(c: PlayerCardRow): PlayerCardRow {
  return {
    card_id: c.card_id,
    level: c.level,
    copies: c.copies,
    unlocked_upgrades: c.unlocked_upgrades,
  };
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/**
 * Checks and cleans a former snapshot. Not an object of this format, or one of the row lists
 * missing: an empty store. Otherwise every row is checked like the table constraints and
 * dropped if it does not fit, or if its owner, its id or its "only one" rule is taken by an
 * earlier row; references follow the foreign keys (`packs.match_id` becomes null when the
 * match is gone). In detail:
 * - a second profile with the same name (ignoring case) loses its name,
 * - a deck that is invalid or uses cards the player does not own is replaced by the start
 *   deck if the player owns it, else the player has no deck,
 * - a second pending match of a player is closed as 'abandoned',
 * - a second welcome pack of a player and a second pack of the same match are dropped.
 */
export function loadMemoryStoreData(input: unknown): MemoryStoreData {
  const out = emptyMemoryStoreData();
  if (!isPlainObject(input) || input.format !== MEMORY_STORE_FORMAT) return out;
  const { profiles, cards, decks, matches, packs } = input;
  if (
    !Array.isArray(profiles) ||
    !Array.isArray(cards) ||
    !Array.isArray(decks) ||
    !Array.isArray(matches) ||
    !Array.isArray(packs)
  ) {
    return out;
  }
  out.nextId = isInt(input.nextId, 0, Number.MAX_SAFE_INTEGER) ? input.nextId : 0;

  const names = new Set<string>();
  const users = new Set<string>();
  for (const raw of profiles as unknown[]) {
    const p = profileOf(raw);
    if (p === null || users.has(p.id)) continue;
    if (p.username !== null) {
      if (names.has(lowerName(p.username))) p.username = null;
      else names.add(lowerName(p.username));
    }
    users.add(p.id);
    out.profiles.push(p);
  }

  const owned = new Map<string, Set<string>>();
  for (const raw of cards as unknown[]) {
    const c = cardOf(raw);
    if (c === null || !users.has(c.user_id)) continue;
    const set = owned.get(c.user_id) ?? new Set<string>();
    if (set.has(c.card_id)) continue;
    set.add(c.card_id);
    owned.set(c.user_id, set);
    out.cards.push(c);
  }

  const ownsAll = (user: string, list: readonly string[]) =>
    list.every((card) => owned.get(user)?.has(card) === true);
  const deckOf = new Map<string, string[]>();
  for (const raw of decks as unknown[]) {
    if (!isPlainObject(raw) || typeof raw.user_id !== 'string') continue;
    const list = deckCardsOf(raw.cards);
    if (list === null || !users.has(raw.user_id) || deckOf.has(raw.user_id)) continue;
    if (ownsAll(raw.user_id, list)) deckOf.set(raw.user_id, list);
  }
  for (const p of out.profiles) {
    const list = deckOf.get(p.id) ?? (ownsAll(p.id, STARTER_DECK) ? [...STARTER_DECK] : null);
    if (list !== null) out.decks.push({ user_id: p.id, cards: list });
  }

  const matchIds = new Set<string>();
  const pendingOf = new Set<string>();
  for (const raw of matches as unknown[]) {
    const m = matchOf(raw);
    if (m === null || !users.has(m.player_a) || matchIds.has(m.id)) continue;
    if (m.result === 'pending') {
      if (pendingOf.has(m.player_a)) {
        m.result = 'abandoned';
        m.elo_delta_a = 0;
      } else {
        pendingOf.add(m.player_a);
      }
    }
    matchIds.add(m.id);
    out.matches.push(m);
  }

  const packIds = new Set<string>();
  const packOfMatch = new Set<string>();
  const welcomeOf = new Set<string>();
  const matchOwner = new Map(out.matches.map((m) => [m.id, m.player_a]));
  for (const raw of packs as unknown[]) {
    const k = packOf(raw);
    if (k === null || !users.has(k.user_id) || packIds.has(k.id)) continue;
    if (k.match_id !== null && matchOwner.get(k.match_id) !== k.user_id) k.match_id = null;
    if (k.match_id !== null) {
      if (packOfMatch.has(k.match_id)) continue;
      packOfMatch.add(k.match_id);
    }
    if (k.kind === 'welcome') {
      if (welcomeOf.has(k.user_id)) continue;
      welcomeOf.add(k.user_id);
    }
    packIds.add(k.id);
    out.packs.push(k);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

interface UserState {
  profile: ProfileRow;
  /** By card id, in the order the cards were unlocked. */
  cards: Map<string, PlayerCardRow>;
  deck: string[] | null;
}

function fail<T>(code: StoreErrorCode): StoreResult<T> {
  return { ok: false, code };
}

function done<T>(value: T): StoreResult<T> {
  return { ok: true, value };
}

export function createMemoryStore(options: MemoryStoreOptions = {}): MemoryStore {
  const data = loadMemoryStoreData(options.data);
  const users = new Map<string, UserState>();
  const matches = new Map<string, MemoryMatchRow>();
  const packs = new Map<string, MemoryPackRow>();
  let nextId = data.nextId;

  for (const p of data.profiles) users.set(p.id, { profile: p, cards: new Map(), deck: null });
  for (const { user_id, ...card } of data.cards) users.get(user_id)?.cards.set(card.card_id, card);
  for (const d of data.decks) {
    const u = users.get(d.user_id);
    if (u !== undefined) u.deck = d.cards;
  }
  for (const m of data.matches) matches.set(m.id, m);
  for (const k of data.packs) packs.set(k.id, k);

  const generate = options.newId ?? (() => sequentialId(nextId++));

  /** A fresh id that no match and no pack uses yet. */
  function freshId(): string {
    for (let i = 0; i < ID_ATTEMPTS; i++) {
      const id = generate();
      if (typeof id === 'string' && id.length > 0 && !matches.has(id) && !packs.has(id)) return id;
    }
    throw new Error('MemoryStore: the id generator gives no unused id');
  }

  function nameTaken(user: string, name: string): boolean {
    const lower = lowerName(name);
    for (const [id, u] of users) {
      if (id !== user && u.profile.username !== null && lowerName(u.profile.username) === lower) {
        return true;
      }
    }
    return false;
  }

  function pendingOf(user: string): MemoryMatchRow | null {
    for (const m of matches.values()) if (m.player_a === user && m.result === 'pending') return m;
    return null;
  }

  function ownMatch(user: string, id: string): MemoryMatchRow | null {
    const m = matches.get(id);
    return m !== undefined && m.player_a === user ? m : null;
  }

  function ownPack(user: string, id: string): MemoryPackRow | null {
    const k = packs.get(id);
    return k !== undefined && k.user_id === user ? k : null;
  }

  function userOrThrow(id: string): UserState {
    const u = users.get(id);
    if (u === undefined) throw new Error(`MemoryStore: unknown user ${id}`);
    return u;
  }

  const store: MemoryStore = {
    // --- Reads ---

    async getProfile(user) {
      const u = users.get(user);
      return u === undefined ? null : { ...u.profile };
    },

    async getCards(user) {
      const u = users.get(user);
      return u === undefined ? [] : [...u.cards.values()].map(copyCard);
    },

    async getPendingMatch(user) {
      const m = pendingOf(user);
      return m === null ? null : copyMatch(m);
    },

    async getMatch(user, matchId) {
      const m = ownMatch(user, matchId);
      return m === null ? null : copyMatch(m);
    },

    async getPack(user, packId) {
      const k = ownPack(user, packId);
      return k === null ? null : copyPack(k);
    },

    async getPackOfMatch(user, matchId) {
      for (const k of packs.values()) {
        if (k.user_id === user && k.match_id === matchId) return copyPack(k);
      }
      return null;
    },

    // --- Writes (rr_* in supabase/migrations) ---

    async setUsername(user, username, freeRenames) {
      if (typeof username !== 'string') return fail('username_invalid');
      if (!isInt(freeRenames, 0, INT32_MAX)) return fail('bad_request');
      const u = users.get(user);
      if (u === undefined) return fail('not_found');
      const current = u.profile.username;
      if (current === username) return done({ username: current, welcomePackId: null });
      if (current !== null && u.profile.username_changes >= freeRenames) {
        return fail('username_locked');
      }
      // The table checks the format before the unique index.
      if (!USERNAME_PATTERN.test(username)) return fail('username_invalid');
      if (nameTaken(user, username)) return fail('username_taken');

      let welcomePackId: string | null = null;
      if (current === null) {
        const hasWelcome = [...packs.values()].some(
          (k) => k.user_id === user && k.kind === 'welcome',
        );
        if (!hasWelcome) {
          welcomePackId = freshId();
          packs.set(welcomePackId, {
            id: welcomePackId,
            user_id: user,
            kind: 'welcome',
            match_id: null,
            opened: false,
            contents: null,
          });
        }
      } else {
        u.profile.username_changes++;
      }
      u.profile.username = username;
      return done({ username, welcomePackId });
    },

    async setDeck(user, cards) {
      const u = users.get(user);
      if (u === undefined) return fail('not_found');
      const list = deckCardsOf(cards);
      if (list === null || !list.every((c) => u.cards.has(c))) return fail('deck_invalid');
      u.deck = list;
      return done({ cards: [...list] });
    },

    async levelUpCard(user, card, fromLevel, copies, gold) {
      if (
        typeof card !== 'string' ||
        !isInt(fromLevel, 1, MAX_LEVEL - 1) ||
        !isInt(copies, 0, INT32_MAX) ||
        !isInt(gold, 0, INT32_MAX)
      ) {
        return fail('bad_request');
      }
      const u = users.get(user);
      if (u === undefined) return fail('not_found');
      const c = u.cards.get(card);
      if (c === undefined) return fail('card_not_owned');
      if (c.level !== fromLevel) return fail('stale');
      if (c.copies < copies) return fail('not_enough_copies');
      if (u.profile.gold < gold) return fail('not_enough_gold');
      c.level++;
      c.copies -= copies;
      u.profile.gold -= gold;
      return done({ level: c.level, copies: c.copies, gold: u.profile.gold });
    },

    async unlockUpgrade(user, card, upgrade, minLevel, gold) {
      if (
        typeof card !== 'string' ||
        !isInt(upgrade, 0, UPGRADES_PER_CARD - 1) ||
        !isInt(minLevel, 1, MAX_LEVEL) ||
        !isInt(gold, 0, INT32_MAX)
      ) {
        return fail('bad_request');
      }
      const bit = 1 << upgrade;
      const u = users.get(user);
      if (u === undefined) return fail('not_found');
      const c = u.cards.get(card);
      if (c === undefined) return fail('card_not_owned');
      if ((c.unlocked_upgrades & bit) !== 0) return fail('upgrade_already_unlocked');
      if (c.level < minLevel) return fail('level_too_low');
      if (u.profile.gold < gold) return fail('not_enough_gold');
      c.unlocked_upgrades |= bit;
      u.profile.gold -= gold;
      return done({ unlockedUpgrades: c.unlocked_upgrades, gold: u.profile.gold });
    },

    async spendJokers(user, card, copies, jokers) {
      if (
        typeof card !== 'string' ||
        !isInt(copies, 1, INT32_MAX) ||
        !isInt(jokers, 1, INT32_MAX)
      ) {
        return fail('bad_request');
      }
      const u = users.get(user);
      if (u === undefined) return fail('not_found');
      if (u.profile.jokers < jokers) return fail('not_enough_jokers');
      const c = u.cards.get(card);
      if (c === undefined && !isCardIdFormat(card)) return fail('bad_request');
      if (c !== undefined && c.copies + copies > INT32_MAX) return fail('bad_request');

      let row: PlayerCardRow;
      if (c === undefined) {
        row = { card_id: card, level: 1, copies, unlocked_upgrades: 0 };
        u.cards.set(card, row);
      } else {
        c.copies += copies;
        row = c;
      }
      u.profile.jokers -= jokers;
      return done({ copies: row.copies, jokers: u.profile.jokers, cardUnlocked: c === undefined });
    },

    async createMatch(user, botLevel, botProfile, seed, engineVersion) {
      const u = users.get(user);
      if (u === undefined) return fail('not_found');
      if (u.profile.username === null) return fail('username_missing');
      if (pendingOf(user) !== null) return fail('match_pending');
      const deck = u.deck;
      if (deck === null || !deck.every((c) => u.cards.has(c))) return fail('deck_invalid');
      if (
        !isBotLevel(botLevel) ||
        !isBotProfileFormat(botProfile) ||
        !isSeed(seed) ||
        !isEngineVersion(engineVersion)
      ) {
        return fail('bad_request');
      }
      const levels: Partial<Record<CardId, number>> = {};
      const upgrades: Partial<Record<CardId, number>> = {};
      for (const id of deck) {
        const c = u.cards.get(id) as PlayerCardRow;
        levels[id as CardId] = c.level;
        upgrades[id as CardId] = c.unlocked_upgrades;
      }
      const row: MemoryMatchRow = {
        id: freshId(),
        player_a: user,
        seed,
        engine_version: engineVersion,
        bot_level: botLevel,
        bot_profile: botProfile,
        setup: { deck: [...deck] as CardId[], levels, upgrades },
        picks: [],
        result: 'pending',
        elo_delta_a: null,
      };
      matches.set(row.id, row);
      return done(copyMatch(row));
    },

    async finishMatch(user, matchId, input: FinishMatchInput) {
      const { result, picks, eloDelta, arena, gold, withPack } = input;
      if (
        typeof matchId !== 'string' ||
        !isPicks(picks) ||
        !isInt(eloDelta, -INT32_MAX, INT32_MAX) ||
        !isInt(arena, 0, INT32_MAX) ||
        !isInt(gold, 0, INT32_MAX) ||
        typeof withPack !== 'boolean' ||
        !(['a_won', 'b_won', 'draw', 'abandoned'] as const).includes(result) ||
        (result === 'abandoned' && (eloDelta !== 0 || arena !== 0 || gold !== 0 || withPack)) ||
        (result !== 'abandoned' &&
          (arena < FIRST_ARENA || arena > LAST_ARENA || (withPack && result !== 'a_won')))
      ) {
        return fail('bad_request');
      }
      const u = users.get(user);
      if (u === undefined) return fail('not_found');
      const m = ownMatch(user, matchId);
      if (m === null) return fail('match_not_found');
      if (m.result !== 'pending') return fail('match_not_pending');
      const p = u.profile;
      if (result !== 'abandoned' && p.gold + gold > INT32_MAX) return fail('bad_request');

      m.result = result;
      m.picks = [...picks];
      m.elo_delta_a = eloDelta;
      if (result === 'abandoned') {
        return done<FinishMatchOutput>({
          elo: p.elo,
          highestArena: p.highest_arena,
          arenaUnlocked: false,
          gold: p.gold,
          packId: null,
        });
      }
      const oldArena = p.highest_arena;
      p.elo = Math.max(0, p.elo + eloDelta);
      p.games_played++;
      p.highest_arena = Math.max(p.highest_arena, arena);
      p.gold += gold;
      let packId: string | null = null;
      if (withPack) {
        packId = freshId();
        packs.set(packId, {
          id: packId,
          user_id: user,
          kind: 'match',
          match_id: matchId,
          opened: false,
          contents: null,
        });
      }
      return done<FinishMatchOutput>({
        elo: p.elo,
        highestArena: p.highest_arena,
        arenaUnlocked: p.highest_arena > oldArena,
        gold: p.gold,
        packId,
      });
    },

    async openPack(user, packId, contents) {
      const reward = contentsOf(contents);
      if (reward === null) return fail('bad_request');
      const u = users.get(user);
      if (u === undefined) return fail('not_found');
      const k = ownPack(user, packId);
      if (k === null) return fail('pack_not_found');
      if (k.opened) return fail('pack_already_opened');

      const p = u.profile;
      const owned = reward.kind === 'cards' ? u.cards.get(reward.card) : undefined;
      if (reward.kind === 'cards') {
        if (owned === undefined && !isCardIdFormat(reward.card)) return fail('bad_request');
        if (owned !== undefined && owned.copies + reward.copies > INT32_MAX) {
          return fail('bad_request');
        }
      }
      if (reward.kind === 'gold' && p.gold + reward.gold > INT32_MAX) return fail('bad_request');
      if (reward.kind === 'jokers' && p.jokers + reward.jokers > INT32_MAX) {
        return fail('bad_request');
      }

      k.opened = true;
      k.contents = reward;
      let cardUnlocked = false;
      if (reward.kind === 'cards') {
        if (owned === undefined) {
          u.cards.set(reward.card, {
            card_id: reward.card,
            level: 1,
            copies: reward.copies,
            unlocked_upgrades: 0,
          });
          cardUnlocked = true;
        } else {
          owned.copies += reward.copies;
        }
      } else if (reward.kind === 'gold') {
        p.gold += reward.gold;
      } else {
        p.jokers += reward.jokers;
      }
      return done({ cardUnlocked });
    },

    // --- Helpers ---

    addUser(id) {
      if (typeof id !== 'string' || id.length === 0) throw new Error('MemoryStore: empty user id');
      if (users.has(id)) throw new Error(`MemoryStore: user ${id} exists already`);
      const cards = new Map<string, PlayerCardRow>();
      for (const card of STARTER_CARDS) {
        cards.set(card, { card_id: card, level: 1, copies: STARTER_COPIES, unlocked_upgrades: 0 });
      }
      users.set(id, {
        profile: {
          id,
          username: null,
          username_changes: 0,
          elo: ELO.start,
          highest_arena: FIRST_ARENA,
          gold: 0,
          jokers: 0,
          games_played: 0,
        },
        cards,
        deck: [...STARTER_DECK],
      });
    },

    hasUser(id) {
      return users.has(id);
    },

    async getDeck(user) {
      const deck = users.get(user)?.deck;
      return deck === undefined || deck === null ? null : { cards: [...deck] };
    },

    async listPacks(user) {
      return [...packs.values()].filter((k) => k.user_id === user).map(copyPack);
    },

    snapshot() {
      const out = emptyMemoryStoreData();
      out.nextId = nextId;
      for (const [id, u] of users) {
        out.profiles.push({ ...u.profile });
        for (const c of u.cards.values()) out.cards.push({ user_id: id, ...copyCard(c) });
        if (u.deck !== null) out.decks.push({ user_id: id, cards: [...u.deck] });
      }
      for (const m of matches.values()) {
        out.matches.push({ ...copyMatch(m), player_a: m.player_a, picks: [...m.picks] });
      }
      for (const k of packs.values()) out.packs.push({ ...copyPack(k), user_id: k.user_id });
      return out;
    },

    patchProfile(user, patch) {
      const u = userOrThrow(user);
      const next: ProfileRow = { ...u.profile, ...patch, id: u.profile.id };
      next.username = u.profile.username;
      if (!profileNumbersValid(next)) throw new Error('MemoryStore.patchProfile: invalid value');
      u.profile = next;
    },

    patchCard(user, card, patch) {
      const u = userOrThrow(user);
      if (!isCardIdFormat(card)) throw new Error(`MemoryStore.patchCard: bad card id ${card}`);
      const old = u.cards.get(card) ?? { card_id: card, level: 1, copies: 0, unlocked_upgrades: 0 };
      const next: PlayerCardRow = { ...old, ...patch, card_id: card };
      if (!cardNumbersValid(next)) throw new Error('MemoryStore.patchCard: invalid value');
      u.cards.set(card, next);
    },
  };
  return store;
}
