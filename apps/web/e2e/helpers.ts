import { expect, type Locator, type Page } from '@playwright/test';

/** Collects page errors and console errors (ignores the known software-renderer warning). */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (text.includes('GPU stall due to ReadPixels')) return;
    errors.push(`console.error: ${text}`);
  });
  return errors;
}

let nameCounter = 0;

/** A name that is valid (3 to 16 of a-z, 0-9, _) and different for every call, even across runs. */
export function uniqueName(prefix = 'tester'): string {
  nameCounter += 1;
  const stamp = Date.now().toString(36).slice(-5);
  const rand = Math.floor(Math.random() * 36 ** 2).toString(36);
  return `${prefix.slice(0, 5)}_${stamp}${rand}${nameCounter}`.slice(0, 16);
}

export interface EnteredGame {
  name: string;
  /** Card of the welcome pack, if it was opened. */
  welcomeCard: string | null;
}

/**
 * Welcome screen, guest sign-in, username, welcome pack, until the menu is ready.
 * The same steps work against the local mode and (later) a real server.
 * `pack: 'open'` opens the welcome pack and closes the reward; `'later'` leaves it unopened.
 */
export async function enterGame(
  page: Page,
  options: { name?: string; pack?: 'open' | 'later' } = {},
): Promise<EnteredGame> {
  const name = options.name ?? uniqueName();
  await page.goto('/');
  await signUp(page, name);
  return { name, welcomeCard: await handleWelcomePack(page, options.pack ?? 'open') };
}

/** From the welcome screen to the username step and on to the menu (the pack dialog comes next). */
export async function signUp(page: Page, name: string): Promise<void> {
  await page.getByTestId('welcome-play').click();
  await expect(page.getByTestId('username-screen')).toBeVisible();
  await page.getByTestId('username-input').fill(name);
  await expect(page.getByTestId('username-status')).toHaveAttribute('data-state', 'free');
  await page.getByTestId('username-submit').click();
}

export async function handleWelcomePack(
  page: Page,
  mode: 'open' | 'later',
): Promise<string | null> {
  const modal = page.getByTestId('pack-modal');
  await expect(modal).toBeVisible();
  let card: string | null = null;
  if (mode === 'open') {
    await page.getByTestId('pack-open').click();
    await expect(page.getByTestId('pack-reward')).toBeVisible();
    card = await page
      .getByTestId('pack-reward')
      .locator('[data-card]')
      .first()
      .getAttribute('data-card');
    await page.getByTestId('pack-next').click();
  } else {
    await page.getByTestId('pack-close').click();
  }
  await expect(modal).toBeHidden();
  await expect(page.getByTestId('play-button').or(page.getByTestId('pending-match'))).toBeVisible();
  return card;
}

const TAB_INDEX = { deck: 0, battle: 1, profile: 2 } as const;

/** Taps a tab and waits until the pager has come to rest on its page (the scroll animates). */
export async function openTab(page: Page, tab: keyof typeof TAB_INDEX): Promise<void> {
  await page.getByTestId(`tab-${tab}`).click();
  const pager = page.getByTestId('tab-pager');
  await expect(pager).toHaveAttribute('data-tab', tab);
  await expect
    .poll(() =>
      pager.evaluate((el, i) => Math.abs(el.scrollLeft - i * el.clientWidth), TAB_INDEX[tab]),
    )
    .toBeLessThan(2);
}

/** Reloads the page; the saved local state brings the player straight back to the menu. */
export async function reloadToMenu(page: Page): Promise<void> {
  await page.reload();
  await expect(page.getByTestId('stat-bar')).toBeVisible();
}

/** Reads "Elo: +12 (jetzt 1012)" from the result screen; "\u2212" is a minus sign. */
export function parseEloLine(text: string): { delta: number; elo: number } {
  const m = /Elo: (\S+) \(jetzt (\d+)\)/.exec(text);
  if (!m) throw new Error(`unexpected Elo line: ${text}`);
  const raw = (m[1] ?? '').replace('\u2212', '-').replace('\u00b1', '');
  return { delta: Number(raw === '' ? 0 : raw), elo: Number(m[2]) };
}

export async function stat(page: Page, id: 'elo' | 'gold' | 'jokers'): Promise<number> {
  const text = await page.getByTestId(`stat-${id}`).locator('.stat-bar__value').textContent();
  return Number(text);
}

/** Starts a match from the battle tab of the menu. */
export async function startMatch(page: Page): Promise<void> {
  await enterGame(page);
  await page.getByTestId('play-button').click();
  await expect(page.getByTestId('battle-screen')).toBeVisible();
}

/** Plays the first offered card whenever it is the human's turn, until the result shows. */
export async function playToResult(page: Page): Promise<void> {
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

export function battle(page: Page): Locator {
  return page.getByTestId('battle-screen');
}

export async function lives(page: Page): Promise<{ me: number; opp: number }> {
  const me = await page.getByTestId('lives-me').getAttribute('data-lives');
  const opp = await page.getByTestId('lives-opponent').getAttribute('data-lives');
  return { me: Number(me), opp: Number(opp) };
}

/** Waits until the human is on turn in the draft (offer cards shown). */
export async function waitForMyTurn(page: Page): Promise<void> {
  await expect(page.getByTestId('draft-bar')).toHaveAttribute('data-my-turn', 'true');
  await expect(page.getByTestId('offer-card-0')).toBeVisible();
}
