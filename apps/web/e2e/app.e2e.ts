import { expect, test } from '@playwright/test';
import { battle, collectErrors, lives, startMatch, waitForMyTurn } from './helpers.ts';

test('Titel: lädt ohne Konsolenfehler', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Rumble Realms' })).toBeVisible();
  await expect(page.getByTestId('play-button')).toBeVisible();
  expect(errors).toEqual([]);
});

// Regression: starting right after page load used to freeze the game, because destroying the
// short-lived card image renderer emptied Pixi's global pools under the live battle renderer.
test('Sofortstart: erstes Ausspielen ohne Renderer-Fehler', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await page.getByTestId('play-button').click();
  await waitForMyTurn(page);
  await page.getByTestId('offer-card-0').click();
  await page.getByTestId('confirm-button').click();
  await expect(page.getByTestId('pick-hint')).toBeVisible();
  await page.waitForTimeout(3_000);
  expect(errors).toEqual([]);
  await expect(page.getByTestId('draft-bar')).toHaveAttribute('data-my-turn', 'true');
});

test('Draft: Auswahl, Ausspielen, Info', async ({ page }) => {
  await startMatch(page);
  await expect(battle(page)).toHaveAttribute('data-phase', 'draft');
  await expect(battle(page)).toHaveAttribute('data-round', '1');
  expect(await lives(page)).toEqual({ me: 4, opp: 4 });

  await waitForMyTurn(page);
  for (const i of [0, 1, 2]) await expect(page.getByTestId(`offer-card-${i}`)).toBeVisible();
  const confirm = page.getByTestId('confirm-button');
  await expect(confirm).toBeDisabled();

  // Tap selects; button becomes active
  await page.getByTestId('offer-card-1').click();
  await expect(page.getByTestId('offer-card-1')).toHaveAttribute('data-selected', 'true');
  await expect(confirm).toBeEnabled();

  // Info opens the detail view without selecting another card
  await page.getByTestId('offer-card-2').getByTestId('card-info').click();
  await expect(page.getByTestId('card-detail')).toBeVisible();
  await page.getByTestId('card-detail-close').click();
  await expect(page.getByTestId('card-detail')).toBeHidden();
  await expect(page.getByTestId('offer-card-2')).toHaveAttribute('data-selected', 'false');
  await expect(page.getByTestId('offer-card-1')).toHaveAttribute('data-selected', 'true');

  // Play via confirm button
  const statusBefore = await page.getByTestId('draft-status').textContent();
  await confirm.click();
  await expect(page.getByTestId('pick-hint')).toBeVisible();
  await expect(page.getByTestId('draft-status')).not.toHaveText(statusBefore ?? '');

  // Second tap on an already selected card also plays it
  await waitForMyTurn(page);
  const hint = await page.getByTestId('pick-hint').textContent();
  await page.getByTestId('offer-card-0').click();
  await expect(page.getByTestId('offer-card-0')).toHaveAttribute('data-selected', 'true');
  await page.getByTestId('offer-card-0').click();
  await expect(page.getByTestId('pick-hint')).not.toHaveText(hint ?? '');
});

test('Ganzes Match bis zum Ergebnis', async ({ page }) => {
  test.setTimeout(6 * 60_000);
  await startMatch(page);
  await page.getByTestId('speed-toggle').click();
  await expect(page.getByTestId('speed-toggle')).toHaveAttribute('data-speed', '2');

  // Record phases, rounds and lives page-side so that short phases are not missed.
  await page.evaluate(() => {
    const w = window as unknown as { __log: { phases: string[]; rounds: string[] } };
    w.__log = { phases: [], rounds: [] };
    const read = (): void => {
      const el = document.querySelector('[data-testid="battle-screen"]');
      if (!el) return;
      const p = el.getAttribute('data-phase') ?? '';
      const r = el.getAttribute('data-round') ?? '';
      if (w.__log.phases.at(-1) !== p) w.__log.phases.push(p);
      if (w.__log.rounds.at(-1) !== r) w.__log.rounds.push(r);
    };
    new MutationObserver(read).observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ['data-phase', 'data-round'],
    });
    read();
  });

  const result = page.getByTestId('result-title');
  const bar = page.getByTestId('draft-bar');
  const lifeLog: { me: number; opp: number }[] = [];
  while (!(await result.isVisible())) {
    // One atomic read: the draft bar can disappear between two separate queries.
    const myTurn = await bar.evaluateAll((els) => els[0]?.getAttribute('data-my-turn') === 'true');
    if (myTurn) {
      const card = page.getByTestId('offer-card-0');
      if (await card.isVisible()) {
        await card.click({ timeout: 2_000 }).catch(() => undefined);
        await page
          .getByTestId('confirm-button')
          .click({ timeout: 2_000 })
          .catch(() => undefined);
      }
    }
    const l = await lives(page).catch(() => null);
    if (l) {
      const last = lifeLog.at(-1);
      if (!last || last.me !== l.me || last.opp !== l.opp) lifeLog.push(l);
    }
    await page.waitForTimeout(150);
  }

  const log = await page.evaluate(
    () => (window as unknown as { __log: { phases: string[]; rounds: string[] } }).__log,
  );
  for (const phase of ['draft', 'countdown', 'battle', 'roundEnd']) {
    expect(log.phases).toContain(phase);
  }
  expect(log.rounds.length).toBeGreaterThan(1);
  const nums = log.rounds.map(Number);
  expect(nums).toEqual([...nums].sort((a, b) => a - b));
  // Lives dropped at least once (first change happens after round 1)
  expect(lifeLog.length).toBeGreaterThan(1);

  const end = await lives(page);
  const dead = [end.me, end.opp].filter((n) => n === 0).length;
  expect(dead).toBeGreaterThanOrEqual(1);
  const outcome = await result.getAttribute('data-outcome');
  if (end.me === 0 && end.opp === 0) expect(outcome).toBe('draw');
  else expect(outcome).toBe(end.me === 0 ? 'loss' : 'win');

  // Both ways out of the result are offered; "Zum Start" shares its action with the leave
  // dialog, which has its own test.
  await expect(page.getByTestId('back-to-title')).toBeVisible();

  // Play again
  await page.getByTestId('play-again').click();
  await expect(result).toBeHidden();
  await expect(battle(page)).toHaveAttribute('data-round', '1');
  await expect(battle(page)).toHaveAttribute('data-phase', 'draft');
  expect(await lives(page)).toEqual({ me: 4, opp: 4 });
});

test('Verlassen: Abbrechen bleibt, Bestätigen führt zum Titel', async ({ page }) => {
  await startMatch(page);
  await page.getByTestId('leave-button').click();
  await expect(page.getByTestId('leave-dialog')).toBeVisible();
  await page.getByTestId('leave-cancel').click();
  await expect(page.getByTestId('leave-dialog')).toBeHidden();
  await expect(battle(page)).toBeVisible();

  await page.getByTestId('leave-button').click();
  await page.getByTestId('leave-confirm').click();
  await expect(page.getByTestId('title-screen')).toBeVisible();
  await expect(battle(page)).toHaveCount(0);
});

test('Canvas: genau eins, sinnvolle Größe, nicht einfarbig', async ({ page }) => {
  await startMatch(page);
  const canvas = page.locator('canvas');
  await expect(canvas).toHaveCount(1);
  const box = await canvas.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(200);
  expect(box?.height ?? 0).toBeGreaterThan(150);

  // Play a few picks so that units appear on the field.
  for (let i = 0; i < 2; i++) {
    await waitForMyTurn(page);
    await page.getByTestId('offer-card-0').click();
    await page.getByTestId('confirm-button').click();
    await expect(page.getByTestId('pick-hint')).toBeVisible();
  }

  const shot = await canvas.screenshot();
  const colors = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d');
    if (!ctx) return 0;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const seen = new Set<number>();
    for (let i = 0; i < d.length; i += 4 * 7) {
      seen.add(((d[i] ?? 0) >> 4) | (((d[i + 1] ?? 0) >> 4) << 4) | (((d[i + 2] ?? 0) >> 4) << 8));
    }
    return seen.size;
  }, shot.toString('base64'));
  expect(colors).toBeGreaterThan(5);
});

test('PWA: Manifest, Service Worker, Offline-Shell', async ({ page, context }) => {
  await page.goto('/');
  const href = await page.locator('link[rel=manifest]').getAttribute('href');
  expect(href).toBeTruthy();
  const res = await page.request.get(new URL(href ?? '', page.url()).toString());
  expect(res.ok()).toBe(true);
  const manifest = (await res.json()) as {
    name: string;
    display: string;
    icons: unknown[];
  };
  expect(manifest.name).toBe('Rumble Realms');
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons).toHaveLength(3);

  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // The worker must control the page for offline loads; autoUpdate may claim after a reload.
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('play-button')).toBeVisible();
  await context.setOffline(false);
});

test('Querformat: Dreh-Hinweis nur im Querformat sichtbar', async ({ page }) => {
  await page.goto('/');
  const hint = page.locator('.rotate-hint');
  await expect(hint).toBeHidden();
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(hint).toBeVisible();
  await page.setViewportSize({ width: 412, height: 915 });
  await expect(hint).toBeHidden();
});
