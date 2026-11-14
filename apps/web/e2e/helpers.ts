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

/** Opens the title screen and starts a match. */
export async function startMatch(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('play-button')).toBeVisible();
  await page.getByTestId('play-button').click();
  await expect(page.getByTestId('battle-screen')).toBeVisible();
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
