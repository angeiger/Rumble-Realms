/**
 * Strict check of the JSON body of an `api` call (protocol.ts). Hand-written on purpose: the
 * package stays free of runtime dependencies (browser, Node, Deno).
 *
 * Unknown actions, missing fields and wrong types give null. Fields that are not part of the
 * action are ignored and never copied into the result. What needs the player's data (owned
 * cards, deck rules, the content of a username) is checked later by the action itself.
 */
import {
  BOT_LEVELS,
  CARD_IDS,
  CARDS,
  OFFER_SIZE,
  UPGRADES_PER_CARD,
} from '../../engine/src/index.ts';
import type { BotLevelId, CardId, UpgradeIndex } from '../../engine/src/index.ts';
import { MAX_REPORTED_PICKS } from './data/server.ts';
import { MAX_JOKER_COPIES } from './progression.ts';
import { API_ACTIONS, type ApiAction, type ApiCall } from './protocol.ts';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Body = Record<string, unknown>;

function isPlainObject(value: unknown): value is Body {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Own property only: nothing from the prototype chain. */
function field(body: Body, key: string): unknown {
  return Object.hasOwn(body, key) ? body[key] : undefined;
}

function isCardId(value: unknown): value is CardId {
  return typeof value === 'string' && Object.hasOwn(CARDS, value);
}

function isIntIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}

/** A UUID in canonical form, returned in lower case (as the database prints it); else null. */
function uuidOf(value: unknown): string | null {
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value.toLowerCase() : null;
}

function isAction(value: unknown): value is ApiAction {
  return typeof value === 'string' && (API_ACTIONS as readonly string[]).includes(value);
}

/**
 * The checked call of a JSON body `{ action, ...parameters }`, or null if it is not a valid
 * request of a known action. The result is a fresh object with exactly the fields of the
 * action.
 */
export function parseApiCall(body: unknown): ApiCall | null {
  if (!isPlainObject(body)) return null;
  const action = field(body, 'action');
  if (!isAction(action)) return null;
  switch (action) {
    case 'set_username': {
      const username = field(body, 'username');
      return typeof username === 'string' ? { action, username } : null;
    }
    case 'set_deck': {
      // Count and duplicates are deck rules (`deck_invalid`), checked by the action.
      const cards = field(body, 'cards');
      if (!Array.isArray(cards) || cards.length > CARD_IDS.length) return null;
      const out: CardId[] = [];
      for (const card of cards as unknown[]) {
        if (!isCardId(card)) return null;
        out.push(card);
      }
      return { action, cards: out };
    }
    case 'level_up_card': {
      const card = field(body, 'card');
      return isCardId(card) ? { action, card } : null;
    }
    case 'unlock_upgrade': {
      const card = field(body, 'card');
      const upgrade = field(body, 'upgrade');
      if (!isCardId(card) || !isIntIn(upgrade, 0, UPGRADES_PER_CARD - 1)) return null;
      return { action, card, upgrade: upgrade as UpgradeIndex };
    }
    case 'spend_jokers': {
      const card = field(body, 'card');
      const copies = field(body, 'copies');
      if (!isCardId(card) || !isIntIn(copies, 1, MAX_JOKER_COPIES)) return null;
      return { action, card, copies };
    }
    case 'create_match': {
      const botLevel = field(body, 'botLevel');
      const engineVersion = field(body, 'engineVersion');
      const pending = field(body, 'pending');
      if (typeof botLevel !== 'string' || !Object.hasOwn(BOT_LEVELS, botLevel)) return null;
      if (!isIntIn(engineVersion, 1, Number.MAX_SAFE_INTEGER)) return null;
      const level = botLevel as BotLevelId;
      if (pending === undefined) return { action, botLevel: level, engineVersion };
      if (pending !== 'resume' && pending !== 'forfeit') return null;
      return { action, botLevel: level, engineVersion, pending };
    }
    case 'report_match': {
      const matchId = uuidOf(field(body, 'matchId'));
      const picks = field(body, 'picks');
      if (matchId === null || !Array.isArray(picks) || picks.length > MAX_REPORTED_PICKS) {
        return null;
      }
      const out: number[] = [];
      for (const pick of picks as unknown[]) {
        if (!isIntIn(pick, 0, OFFER_SIZE - 1)) return null;
        out.push(pick);
      }
      return { action, matchId, picks: out };
    }
    case 'open_pack': {
      const packId = uuidOf(field(body, 'packId'));
      return packId === null ? null : { action, packId };
    }
  }
}
