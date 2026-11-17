import { describe, expect, it } from 'vitest';
import { CARD_IDS } from '../../engine/src/index.ts';
import { MAX_REPORTED_PICKS } from './data/server.ts';
import type { ApiAction, ApiCall } from './protocol.ts';
import { API_ACTIONS } from './protocol.ts';
import { parseApiCall } from './validate.ts';

const UUID = '0f8fad5b-d9cb-469f-a165-70867728950e';

/** One valid body per action; the parsed call must equal it. */
const VALID: Record<ApiAction, ApiCall> = {
  set_username: { action: 'set_username', username: 'Andi_42' },
  set_deck: { action: 'set_deck', cards: ['archer', 'knight', 'skeleton', 'healer'] },
  level_up_card: { action: 'level_up_card', card: 'golem' },
  unlock_upgrade: { action: 'unlock_upgrade', card: 'bat', upgrade: 2 },
  spend_jokers: { action: 'spend_jokers', card: 'tnt', copies: 999 },
  create_match: { action: 'create_match', botLevel: 'hard', engineVersion: 4 },
  report_match: { action: 'report_match', matchId: UUID, picks: [0, 1, 2, 2, 1, 0] },
  open_pack: { action: 'open_pack', packId: UUID },
};

/** `base` with `key` replaced (or removed with `undefined`). */
function withField(base: ApiCall, key: string, value: unknown): unknown {
  const body: Record<string, unknown> = { ...base };
  if (value === undefined) delete body[key];
  else body[key] = value;
  return body;
}

/** The body after a JSON round trip, as the server receives it. */
function json(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

describe('parseApiCall: general', () => {
  it('has a valid example for every action', () => {
    expect(Object.keys(VALID).sort()).toEqual([...API_ACTIONS].sort());
  });

  it.each(API_ACTIONS)('accepts a valid %s body', (action) => {
    expect(parseApiCall(json(VALID[action]))).toEqual(VALID[action]);
  });

  it('rejects bodies that are no object or have no known action', () => {
    for (const body of [null, undefined, 1, 'set_deck', [], [VALID.set_deck], true]) {
      expect(parseApiCall(body)).toBeNull();
    }
    for (const action of [undefined, null, 1, 'nope', 'toString', '__proto__', 'SET_DECK']) {
      expect(parseApiCall({ ...VALID.level_up_card, action })).toBeNull();
    }
  });

  it.each(API_ACTIONS)('ignores extra fields of %s and does not copy them', (action) => {
    const parsed = parseApiCall(
      json({ ...VALID[action], extra: 1, userId: 'someone else', gold: 1e9 }),
    );
    expect(parsed).toEqual(VALID[action]);
    expect(Object.keys(parsed ?? {}).sort()).toEqual(Object.keys(VALID[action]).sort());
  });

  it('returns fresh objects and arrays', () => {
    const body = json(VALID.report_match) as { picks: number[] };
    const parsed = parseApiCall(body) as { picks: number[] };
    expect(parsed).not.toBe(body);
    expect(parsed.picks).not.toBe(body.picks);
  });

  it.each(API_ACTIONS.filter((a) => Object.keys(VALID[a]).length > 1))(
    'rejects %s without one of its fields',
    (action) => {
      for (const key of Object.keys(VALID[action])) {
        if (key === 'action') continue;
        expect(parseApiCall(withField(VALID[action], key, undefined)), key).toBeNull();
      }
    },
  );

  it('does not read fields from the prototype chain', () => {
    const body = Object.create({ card: 'golem' }) as Record<string, unknown>;
    body['action'] = 'level_up_card';
    expect(parseApiCall(body)).toBeNull();
  });
});

describe('parseApiCall: per action', () => {
  it('set_username: any string (the content is checked by checkUsername)', () => {
    for (const username of ['', 'x', 'with space', 'ä'.repeat(50)]) {
      expect(parseApiCall({ action: 'set_username', username })).toEqual({
        action: 'set_username',
        username,
      });
    }
    for (const username of [null, 1, ['a'], { a: 1 }]) {
      expect(parseApiCall({ action: 'set_username', username })).toBeNull();
    }
  });

  it('set_deck: a list of known cards (count and duplicates are deck rules)', () => {
    for (const cards of [[], ['archer'], ['archer', 'archer'], [...CARD_IDS]]) {
      expect(parseApiCall({ action: 'set_deck', cards })).toEqual({ action: 'set_deck', cards });
    }
    for (const cards of [
      'archer',
      null,
      ['archer', 'dragon'],
      ['archer', 1],
      ['toString'],
      [...CARD_IDS, 'archer'],
      { 0: 'archer' },
    ]) {
      expect(parseApiCall({ action: 'set_deck', cards })).toBeNull();
    }
  });

  it('level_up_card: a known card', () => {
    for (const card of CARD_IDS) {
      expect(parseApiCall({ action: 'level_up_card', card })).toEqual({
        action: 'level_up_card',
        card,
      });
    }
    for (const card of ['dragon', '', 'Archer', 'constructor', 1, null, ['archer']]) {
      expect(parseApiCall({ action: 'level_up_card', card })).toBeNull();
    }
  });

  it('unlock_upgrade: a known card and upgrade 0..2', () => {
    for (const upgrade of [0, 1, 2]) {
      expect(parseApiCall({ action: 'unlock_upgrade', card: 'bat', upgrade })).toEqual({
        action: 'unlock_upgrade',
        card: 'bat',
        upgrade,
      });
    }
    for (const upgrade of [-1, 3, 1.5, '1', null, Number.NaN]) {
      expect(parseApiCall({ action: 'unlock_upgrade', card: 'bat', upgrade })).toBeNull();
    }
    expect(parseApiCall({ action: 'unlock_upgrade', card: 'dragon', upgrade: 0 })).toBeNull();
  });

  it('spend_jokers: a known card and 1..999 copies', () => {
    for (const copies of [1, 2, 999]) {
      expect(parseApiCall({ action: 'spend_jokers', card: 'tnt', copies })).toEqual({
        action: 'spend_jokers',
        card: 'tnt',
        copies,
      });
    }
    for (const copies of [0, -1, 1000, 1.5, '5', null, Number.POSITIVE_INFINITY]) {
      expect(parseApiCall({ action: 'spend_jokers', card: 'tnt', copies })).toBeNull();
    }
  });

  it('create_match: a bot level, an engine version >= 1 and an optional pending mode', () => {
    for (const botLevel of ['easy', 'medium', 'hard']) {
      expect(parseApiCall({ action: 'create_match', botLevel, engineVersion: 1 })).toEqual({
        action: 'create_match',
        botLevel,
        engineVersion: 1,
      });
    }
    for (const pending of ['resume', 'forfeit']) {
      expect(
        parseApiCall({ action: 'create_match', botLevel: 'easy', engineVersion: 4, pending }),
      ).toEqual({ action: 'create_match', botLevel: 'easy', engineVersion: 4, pending });
    }
    const base = { action: 'create_match', botLevel: 'easy', engineVersion: 4 };
    for (const botLevel of ['master', 'Easy', 'toString', '', 1, null]) {
      expect(parseApiCall({ ...base, botLevel })).toBeNull();
    }
    for (const engineVersion of [0, -1, 1.5, '4', null, 2 ** 53]) {
      expect(parseApiCall({ ...base, engineVersion })).toBeNull();
    }
    for (const pending of [null, '', 'cancel', 1, true]) {
      expect(parseApiCall({ ...base, pending })).toBeNull();
    }
    expect(parseApiCall({ ...base, pending: undefined })).toEqual(base);
  });

  it('report_match: a match uuid and up to MAX_REPORTED_PICKS picks 0..2', () => {
    const ok = (picks: unknown): unknown =>
      parseApiCall({ action: 'report_match', matchId: UUID, picks });
    expect(ok([])).toEqual({ action: 'report_match', matchId: UUID, picks: [] });
    const longest = Array.from({ length: MAX_REPORTED_PICKS }, (_, i) => i % 3);
    expect(ok(longest)).toEqual({ action: 'report_match', matchId: UUID, picks: longest });
    for (const picks of [
      [...longest, 0],
      [3],
      [-1],
      [0.5],
      ['1'],
      [null],
      null,
      '012',
      { length: 1, 0: 1 },
    ]) {
      expect(ok(picks)).toBeNull();
    }
  });

  it('report_match and open_pack: ids in uuid format, returned in lower case', () => {
    const upper = UUID.toUpperCase();
    expect(parseApiCall({ action: 'open_pack', packId: upper })).toEqual({
      action: 'open_pack',
      packId: UUID,
    });
    for (const id of [
      '',
      'not-a-uuid',
      UUID.slice(1),
      `${UUID}0`,
      ` ${UUID}`,
      UUID.replaceAll('-', ''),
      '0f8fad5b-d9cb-469f-a165-70867728950g',
      1,
      null,
    ]) {
      expect(parseApiCall({ action: 'open_pack', packId: id })).toBeNull();
      expect(parseApiCall({ action: 'report_match', matchId: id, picks: [] })).toBeNull();
    }
  });
});
