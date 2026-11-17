/**
 * Helpers of the end-to-end tests against the local Supabase stack: reading and preparing data
 * directly in the database (REST with the secret key, role service_role), and playing a whole
 * bot match through the UI. The keys come from the environment (see serverEnv.ts).
 */
import { expect, type Page } from '@playwright/test';
import { ADMIN_KEY, API_URL } from './serverEnv.ts';
import { lives, parseEloLine, stat } from './helpers.ts';

export interface ProfileDb {
  id: string;
  username: string | null;
  elo: number;
  gold: number;
  jokers: number;
  games_played: number;
  highest_arena: number;
}

export interface CardDb {
  card_id: string;
  level: number;
  copies: number;
  unlocked_upgrades: number;
}

export interface PackDb {
  id: string;
  kind: 'match' | 'welcome';
  opened: boolean;
  contents: unknown;
}

export interface MatchDb {
  id: string;
  result: string;
  bot_level: string;
}

async function rest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const key = ADMIN_KEY ?? '';
  const res = await fetch(`${API_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...init.headers,
    },
  });
  if (!res.ok)
    throw new Error(`REST ${init.method ?? 'GET'} ${path} -> ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

/** The profile row of a user name (waits until it exists: the name is set by the Edge Function). */
export async function profileByName(name: string): Promise<ProfileDb> {
  const cols = 'id,username,elo,gold,jokers,games_played,highest_arena';
  let found: ProfileDb | undefined;
  await expect
    .poll(
      async () => {
        const rows = await rest<ProfileDb[]>(`profiles?select=${cols}&username=eq.${name}`);
        found = rows[0];
        return found !== undefined;
      },
      { message: `profile "${name}" in the database` },
    )
    .toBe(true);
  if (!found) throw new Error('unreachable');
  return found;
}

export async function profileById(id: string): Promise<ProfileDb> {
  const cols = 'id,username,elo,gold,jokers,games_played,highest_arena';
  const row = (await rest<ProfileDb[]>(`profiles?select=${cols}&id=eq.${id}`))[0];
  if (!row) throw new Error(`no profile ${id}`);
  return row;
}

export function cardsOf(id: string): Promise<CardDb[]> {
  return rest<CardDb[]>(
    `player_cards?select=card_id,level,copies,unlocked_upgrades&user_id=eq.${id}&order=card_id`,
  );
}

export async function cardOf(id: string, card: string): Promise<CardDb> {
  const row = (await cardsOf(id)).find((c) => c.card_id === card);
  if (!row) throw new Error(`user ${id} has no card ${card}`);
  return row;
}

export function packsOf(id: string): Promise<PackDb[]> {
  return rest<PackDb[]>(`packs?select=id,kind,opened,contents&user_id=eq.${id}&order=created_at`);
}

export function matchesOf(id: string): Promise<MatchDb[]> {
  return rest<MatchDb[]>(`matches?select=id,result,bot_level&player_a=eq.${id}&order=created_at`);
}

/** Test preparation only: credits gold, jokers and copies of cards directly in the database. */
export async function grant(
  id: string,
  gift: { gold?: number; jokers?: number; copies?: Record<string, number> },
): Promise<void> {
  if (gift.gold !== undefined || gift.jokers !== undefined) {
    const body: Record<string, number> = {};
    if (gift.gold !== undefined) body['gold'] = gift.gold;
    if (gift.jokers !== undefined) body['jokers'] = gift.jokers;
    await rest(`profiles?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(body) });
  }
  for (const [card, copies] of Object.entries(gift.copies ?? {})) {
    const rows = await rest<CardDb[]>(`player_cards?user_id=eq.${id}&card_id=eq.${card}`, {
      method: 'PATCH',
      body: JSON.stringify({ copies }),
    });
    if (rows.length !== 1) throw new Error(`user ${id} does not own ${card}; cannot set copies`);
  }
}

/** Picks the first offered card whenever it is the human's turn, until the result shows. */
export async function playMatchToResult(page: Page): Promise<void> {
  const speed = page.getByTestId('speed-toggle');
  if ((await speed.getAttribute('data-speed')) !== '2') await speed.click();
  await expect(speed).toHaveAttribute('data-speed', '2');
  const result = page.getByTestId('result-title');
  const bar = page.getByTestId('draft-bar');
  while (!(await result.isVisible())) {
    const myTurn = await bar.evaluateAll((els) => els[0]?.getAttribute('data-my-turn') === 'true');
    if (myTurn) {
      const card = page.getByTestId('offer-card-0');
      if (await card.isVisible()) await card.click({ timeout: 2_000 }).catch(() => undefined);
    }
    await page.waitForTimeout(150);
  }
}

export interface MatchSummary {
  outcome: 'win' | 'loss' | 'draw';
  delta: number;
  elo: number;
}

/** Reads the result screen once the report to the server is done; checks outcome against lives. */
export async function readResult(page: Page): Promise<MatchSummary> {
  const result = page.getByTestId('result-title');
  const end = await lives(page);
  const outcome = (await result.getAttribute('data-outcome')) as MatchSummary['outcome'];
  if (end.me === 0 && end.opp === 0) expect(outcome).toBe('draw');
  else expect(outcome).toBe(end.me === 0 ? 'loss' : 'win');
  await expect(page.getByTestId('result-report-state')).toHaveAttribute('data-state', 'done', {
    timeout: 30_000,
  });
  const { delta, elo } = parseEloLine((await page.getByTestId('result-elo').textContent()) ?? '');
  return { outcome, delta, elo };
}

/** Menu stat bar against the database row. */
export async function expectStatBarMatchesDb(page: Page, id: string): Promise<ProfileDb> {
  const db = await profileById(id);
  expect(await stat(page, 'elo')).toBe(db.elo);
  expect(await stat(page, 'gold')).toBe(db.gold);
  expect(await stat(page, 'jokers')).toBe(db.jokers);
  return db;
}
