import { expect, test } from '@playwright/test';
import {
  battle,
  collectErrors,
  enterGame,
  lives,
  handleWelcomePack,
  parseEloLine,
  openTab,
  reloadToMenu,
  signUp,
  startMatch,
  stat,
  uniqueName,
  waitForMyTurn,
} from './helpers.ts';

test('Titel: lädt ohne Konsolenfehler', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await expect(page.getByTestId('welcome-screen')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Rumble Realms' })).toBeVisible();
  await enterGame(page);
  await expect(page.getByRole('heading', { name: 'Rumble Realms' })).toBeVisible();
  await expect(page.getByTestId('play-button')).toBeVisible();
  await expect(page.getByTestId('tab-bar')).toBeVisible();
  await expect(page.getByTestId('mini-deck')).toBeVisible();
  expect(errors).toEqual([]);
});

// Regression: starting right after page load used to freeze the game, because destroying the
// short-lived card image renderer emptied Pixi's global pools under the live battle renderer.
test('Sofortstart: erstes Ausspielen ohne Renderer-Fehler', async ({ page }) => {
  const errors = collectErrors(page);
  await enterGame(page);
  await page.getByTestId('play-button').click();
  await waitForMyTurn(page);
  await page.getByTestId('offer-card-0').click();
  await expect(page.getByTestId('pick-hint')).toBeVisible();
  await page.waitForTimeout(3_000);
  expect(errors).toEqual([]);
  await expect(page.getByTestId('draft-bar')).toHaveAttribute('data-my-turn', 'true');
});

test('Draft: ein Tippen spielt, Info spielt nicht, Karten über dem Feld', async ({ page }) => {
  await startMatch(page);
  await expect(battle(page)).toHaveAttribute('data-phase', 'draft');
  await expect(battle(page)).toHaveAttribute('data-round', '1');
  expect(await lives(page)).toEqual({ me: 4, opp: 4 });
  // No tab bar in the battle, no confirm button any more
  await expect(page.getByTestId('tab-bar')).toHaveCount(0);

  await waitForMyTurn(page);
  for (const i of [0, 1, 2]) await expect(page.getByTestId(`offer-card-${i}`)).toBeVisible();
  await expect(page.getByTestId('confirm-button')).toHaveCount(0);

  // The cards lie over the field: the canvas reaches below the top edge of the cards.
  const canvasBox = await page.locator('canvas').boundingBox();
  const cardBox = await page.getByTestId('offer-card-0').boundingBox();
  expect(canvasBox).not.toBeNull();
  expect(cardBox).not.toBeNull();
  expect((canvasBox?.y ?? 0) + (canvasBox?.height ?? 0)).toBeGreaterThan(
    (cardBox?.y ?? 0) + (cardBox?.height ?? 0) - 1,
  );

  // Info opens the detail view without playing (and without a level control)
  const statusBefore = await page.getByTestId('draft-status').textContent();
  const picksBefore = await page.evaluate(
    () => document.querySelector('[data-testid="pick-hint"]')?.textContent ?? '',
  );
  await page.getByTestId('offer-card-2').getByTestId('card-info').click();
  await expect(page.getByTestId('card-detail')).toBeVisible();
  await expect(page.getByTestId('level-picker')).toHaveCount(0);
  await page.getByTestId('card-detail-close').click();
  await expect(page.getByTestId('card-detail')).toBeHidden();
  // Nothing was played: same status line, no new pick hint (an opening bot pick may still show)
  await expect(page.getByTestId('draft-status')).toHaveText(statusBefore ?? '');
  if (picksBefore === '') await expect(page.getByTestId('pick-hint')).toHaveCount(0);

  // One tap plays at once; the played card flies away as feedback
  const played = await page.evaluate(async () => {
    const card = document.querySelector<HTMLElement>('[data-testid="offer-card-1"]');
    card?.click();
    await new Promise((r) => setTimeout(r, 40));
    const ghost = document.querySelector('[data-testid="played-ghost"]') !== null;
    // While the opponent chooses (which can be short), no cards cover the field. Checked inside
    // the page at every frame, because the opponent's turn may be over before a test step runs.
    let opponentTurnSeen = false;
    let cardsDuringOpponentTurn = 0;
    const end = performance.now() + 3000;
    while (performance.now() < end && !opponentTurnSeen) {
      const bar = document.querySelector('[data-testid="draft-bar"]');
      if (bar?.getAttribute('data-my-turn') === 'false') {
        opponentTurnSeen = true;
        cardsDuringOpponentTurn = document.querySelectorAll('[data-testid^="offer-card-"]').length;
      } else {
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      }
    }
    return { ghost, opponentTurnSeen, cardsDuringOpponentTurn };
  });
  expect(played.ghost).toBe(true);
  expect(played.opponentTurnSeen).toBe(true);
  expect(played.cardsDuringOpponentTurn).toBe(0);
  await expect(page.getByTestId('pick-hint')).toBeVisible();

  // Second pick
  await waitForMyTurn(page);
  const hint = await page.getByTestId('pick-hint').textContent();
  // The hint sits in the middle third of the screen and does not overlap the offer cards or the screen edge
  await page.waitForTimeout(500); // past the fade-in slide
  const hintBox = await page
    .getByTestId('pick-hint')
    .locator('.pick-hint__text')
    .first()
    .boundingBox();
  const offerBox = await page.getByTestId('offer-card-0').boundingBox();
  const viewport = page.viewportSize() ?? { width: 412, height: 915 };
  expect(hintBox).not.toBeNull();
  expect(offerBox).not.toBeNull();
  const hintMid = (hintBox?.y ?? 0) + (hintBox?.height ?? 0) / 2;
  expect(hintMid).toBeGreaterThan(viewport.height / 3);
  expect(hintMid).toBeLessThan((viewport.height * 2) / 3);
  expect((hintBox?.y ?? 0) + (hintBox?.height ?? 0)).toBeLessThanOrEqual(offerBox?.y ?? 0);
  expect(hintBox?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((hintBox?.x ?? 0) + (hintBox?.width ?? 1e9)).toBeLessThanOrEqual(viewport.width);
  await page.getByTestId('offer-card-0').click();
  await expect(page.getByTestId('pick-hint')).not.toHaveText(hint ?? '');
});

test('Draft: drei große Karten vertikal mittig über der Mittellinie', async ({ page }) => {
  await startMatch(page);
  await waitForMyTurn(page);
  const vh = page.viewportSize()?.height ?? 915;
  const boxes = [];
  for (const i of [0, 1, 2]) {
    const box = await page.getByTestId(`offer-card-${i}`).boundingBox();
    expect(box).not.toBeNull();
    boxes.push(box as NonNullable<typeof box>);
  }
  for (const b of boxes) expect(b.width).toBeGreaterThanOrEqual(110);
  const top = Math.min(...boxes.map((b) => b.y));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  expect(Math.abs((top + bottom) / 2 - vh / 2)).toBeLessThan(vh * 0.08);
  // Side by side, not overlapping
  expect(boxes[1]?.x ?? 0).toBeGreaterThan((boxes[0]?.x ?? 0) + (boxes[0]?.width ?? 0) - 1);
  expect(boxes[2]?.x ?? 0).toBeGreaterThan((boxes[1]?.x ?? 0) + (boxes[1]?.width ?? 0) - 1);
  // The status line sits directly above the cards
  const status = await page.getByTestId('draft-status').boundingBox();
  expect((status?.y ?? 0) + (status?.height ?? 0)).toBeLessThanOrEqual(top + 1);
  expect(top - ((status?.y ?? 0) + (status?.height ?? 0))).toBeLessThan(40);
});

test('Feld bleibt zwischen Draft und Kampf gleich groß', async ({ page }) => {
  await startMatch(page);
  const canvas = page.locator('canvas');
  await expect(canvas).toHaveCount(1);
  const before = await canvas.boundingBox();
  const bar = page.getByTestId('draft-bar');
  while ((await battle(page).getAttribute('data-phase')) === 'draft') {
    const myTurn = await bar.evaluateAll((els) => els[0]?.getAttribute('data-my-turn') === 'true');
    if (myTurn) {
      await page
        .getByTestId('offer-card-0')
        .click({ timeout: 2_000 })
        .catch(() => undefined);
    }
    await page.waitForTimeout(150);
  }
  await expect(battle(page)).toHaveAttribute('data-phase', /intro|battle/);
  const after = await canvas.boundingBox();
  expect(after).toEqual(before);
  await expect(page.getByTestId('offer-card-0')).toHaveCount(0);
  await expect(page.getByTestId('countdown')).toHaveCount(0);
  await expect(battle(page)).toHaveAttribute('data-phase', 'battle');
  expect(await canvas.boundingBox()).toEqual(before);
});

test('Ganzes Match bis zum Ergebnis', async ({ page }) => {
  test.setTimeout(6 * 60_000);
  await enterGame(page);
  const eloBefore = await stat(page, 'elo');
  const goldBefore = await stat(page, 'gold');
  await page.getByTestId('play-button').click();
  await expect(battle(page)).toBeVisible();
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
  for (const phase of ['draft', 'intro', 'battle', 'roundEnd']) {
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

  // The result is saved: Elo follows the outcome, a win brings a pack, otherwise 10 gold of comfort.
  await expect(page.getByTestId('result-report-state')).toHaveAttribute('data-state', 'done');
  const { delta, elo: eloAfter } = parseEloLine(
    (await page.getByTestId('result-elo').textContent()) ?? '',
  );
  expect(eloAfter).toBe(eloBefore + delta);
  if (outcome === 'win') {
    expect(delta).toBeGreaterThan(0);
    await expect(page.getByTestId('result-pack')).toBeVisible();
  } else {
    expect(delta).toBeLessThanOrEqual(0);
    await expect(page.getByTestId('result-gold')).toContainText('+10');
    await expect(page.getByTestId('result-pack')).toHaveCount(0);
  }
  if (outcome === 'win') {
    await page.getByTestId('result-open-pack').click();
    await expect(page.getByTestId('pack-modal')).toBeVisible();
    await page.getByTestId('pack-open').click();
    await expect(page.getByTestId('pack-reward')).toBeVisible();
    await page.getByTestId('pack-next').click();
    await expect(page.getByTestId('pack-modal')).toBeHidden();
    await expect(page.getByTestId('result-screen')).toBeVisible();
  }

  // Both ways out of the result are offered
  await expect(page.getByTestId('back-to-title')).toBeVisible();

  // Play again
  await page.getByTestId('play-again').click();
  await expect(result).toBeHidden();
  await expect(battle(page)).toHaveAttribute('data-round', '1');
  await expect(battle(page)).toHaveAttribute('data-phase', 'draft');
  expect(await lives(page)).toEqual({ me: 4, opp: 4 });

  // Leaving the new match keeps it open; the menu shows the booked Elo and gold from before.
  await page.getByTestId('leave-button').click();
  await page.getByTestId('leave-confirm').click();
  await expect(page.getByTestId('stat-bar')).toBeVisible();
  expect(await stat(page, 'elo')).toBe(eloAfter);
  if (outcome === 'win') expect(await stat(page, 'gold')).toBeGreaterThanOrEqual(goldBefore);
  else expect(await stat(page, 'gold')).toBe(goldBefore + 10);
  await expect(page.getByTestId('pending-match')).toBeVisible();
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

test('Deck-Tab: Deck bleibt nach Neuladen, Match nutzt das Deck', async ({ page }) => {
  const errors = collectErrors(page);
  await enterGame(page);
  await openTab(page, 'deck');
  await expect(page.getByTestId('deck-screen')).toBeVisible();
  await expect(page.getByTestId('tab-bar')).toBeVisible();
  for (const [i, card] of ['archer', 'knight', 'skeleton', 'healer'].entries()) {
    await expect(page.getByTestId(`deck-slot-${i}`)).toHaveAttribute('data-card', card);
  }

  // Tap a card without a chosen place: detail view, nothing changes
  await page.getByTestId('deck-card-bat').click();
  await expect(page.getByTestId('card-detail')).toHaveAttribute('data-card', 'bat');
  await page.getByTestId('card-detail-close').click();
  await expect(page.getByTestId('deck-slot-0')).toHaveAttribute('data-card', 'archer');

  // A place is chosen, then a card the player does not own: detail view, the deck stays
  await page.getByTestId('deck-slot-0').click();
  await expect(page.getByTestId('deck-slot-0')).toHaveAttribute('data-selected', 'true');
  await page.getByTestId('deck-card-assassin').click();
  await expect(page.getByTestId('card-detail')).toHaveAttribute('data-card', 'assassin');
  await page.getByTestId('card-detail-close').click();
  await expect(page.getByTestId('deck-slot-0')).toHaveAttribute('data-card', 'archer');

  // Place 1 gets the bat (owned), place 2 gets TNT
  await page.getByTestId('deck-card-bat').click();
  await expect(page.getByTestId('deck-slot-0')).toHaveAttribute('data-card', 'bat');
  await expect(page.getByTestId('deck-slot-0')).toHaveAttribute('data-selected', 'false');
  await page.getByTestId('deck-slot-1').click();
  await page.getByTestId('deck-card-tnt').click();
  await expect(page.getByTestId('deck-slot-1')).toHaveAttribute('data-card', 'tnt');
  await expect(page.getByTestId('deck-card-tnt')).toHaveAttribute('data-in-deck', 'true');
  await expect(page.getByTestId('deck-card-archer')).toHaveAttribute('data-in-deck', 'false');
  await expect(page.getByTestId('deck-error')).toHaveCount(0);

  // Reload: the deck was saved
  await reloadToMenu(page);
  await openTab(page, 'deck');
  await expect(page.getByTestId('deck-slot-0')).toHaveAttribute('data-card', 'bat');
  await expect(page.getByTestId('deck-slot-1')).toHaveAttribute('data-card', 'tnt');
  await expect(page.getByTestId('deck-slot-2')).toHaveAttribute('data-card', 'skeleton');
  await expect(page.getByTestId('deck-slot-3')).toHaveAttribute('data-card', 'healer');

  // The battle tab shows the deck, and the match offers cards from it
  await openTab(page, 'battle');
  await expect(page.getByTestId('mini-deck')).toContainText('Lauf-TNT');
  await page.getByTestId('play-button').click();
  await expect(battle(page)).toBeVisible();
  const allowed = new Set(['bat', 'tnt', 'skeleton', 'healer']);
  for (let pick = 0; pick < 2; pick++) {
    await waitForMyTurn(page);
    const offers = await page.locator('[data-testid^="offer-card-"]').evaluateAll((els) =>
      els.map((el) => ({
        card: el.getAttribute('data-card') ?? '',
        kind: el.getAttribute('data-kind') ?? '',
        text: el.textContent ?? '',
      })),
    );
    expect(offers).toHaveLength(3);
    for (const o of offers) {
      expect(allowed.has(o.card)).toBe(true);
      // Upgrade cards show the upgrade instead of values and level.
      if (o.kind !== 'upgrade') expect(o.text).toContain('Level 1');
    }
    await page.getByTestId('offer-card-0').click();
    await expect(page.getByTestId('pick-hint')).toBeVisible();
  }
  expect(errors).toEqual([]);
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

  // The local mode needs no server: signed in, the menu comes up without a network too.
  await signUp(page, uniqueName('pwa'));
  await handleWelcomePack(page, 'open');
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

test('Tabs: Deck | Kampf | Profil, Wechsel per Tippen und per Wischen', async ({ page }) => {
  const errors = collectErrors(page);
  await enterGame(page);
  const pager = page.getByTestId('tab-pager');
  await expect(pager).toHaveAttribute('data-tab', 'battle');
  // Order in the tab bar: Deck | Kampf | Profil; the battle tab is active at start
  const deckTab = await page.getByTestId('tab-deck').boundingBox();
  const battleTab = await page.getByTestId('tab-battle').boundingBox();
  expect((deckTab?.x ?? 1e9) + (deckTab?.width ?? 0)).toBeLessThanOrEqual((battleTab?.x ?? 0) + 1);
  const profileTab = await page.getByTestId('tab-profile').boundingBox();
  expect((battleTab?.x ?? 1e9) + (battleTab?.width ?? 0)).toBeLessThanOrEqual(
    (profileTab?.x ?? 0) + 1,
  );
  await expect(page.getByTestId('tab-battle')).toHaveAttribute('aria-current', 'page');
  const scrollLeft = (): Promise<number> => pager.evaluate((el) => el.scrollLeft);
  const width = (): Promise<number> => pager.evaluate((el) => el.clientWidth);
  // The battle page is the middle one: it rests one page width from the left edge.
  const offBattle = async (): Promise<number> => Math.abs((await width()) - (await scrollLeft()));
  expect(await offBattle()).toBeLessThan(2);

  // Tap: scrolls over to the deck page
  await page.getByTestId('tab-deck').click();
  await expect(pager).toHaveAttribute('data-tab', 'deck');
  await expect.poll(scrollLeft).toBeLessThan(2);
  await expect(page.getByTestId('deck-screen')).toBeInViewport();
  await page.getByTestId('tab-profile').click();
  await expect(pager).toHaveAttribute('data-tab', 'profile');
  await expect
    .poll(async () => Math.abs((await width()) * 2 - (await scrollLeft())))
    .toBeLessThan(2);
  await expect(page.getByTestId('profile-screen')).toBeInViewport();
  await page.getByTestId('tab-battle').click();
  await expect(pager).toHaveAttribute('data-tab', 'battle');
  await expect.poll(offBattle).toBeLessThan(2);

  // Swipe with real touch events (Chromium DevTools protocol): drag right = to the deck
  const cdp = await page.context().newCDPSession(page);
  const touch = (
    type: 'touchStart' | 'touchMove' | 'touchEnd',
    x: number,
    y: number,
  ): Promise<unknown> =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x, y }],
    });
  const swipe = async (from: number, to: number, y: number): Promise<void> => {
    await touch('touchStart', from, y);
    const step = from < to ? 12 : -12;
    for (let x = from; step > 0 ? x <= to : x >= to; x += step) {
      await touch('touchMove', x, y);
      await page.waitForTimeout(16);
    }
    await touch('touchEnd', 0, 0);
  };
  await swipe(60, 380, 300);
  await expect(pager).toHaveAttribute('data-tab', 'deck');
  await expect(page.getByTestId('tab-deck')).toHaveAttribute('aria-current', 'page');
  // A vertical drag over the deck grid scrolls it and does not switch the tab
  await touch('touchStart', 200, 700);
  for (let y = 700; y >= 480; y -= 12) {
    await touch('touchMove', 206, y);
    await page.waitForTimeout(16);
  }
  await touch('touchEnd', 0, 0);
  await page.waitForTimeout(400);
  await expect(pager).toHaveAttribute('data-tab', 'deck');
  // Swipe left = back to the battle tab
  await swipe(380, 60, 300);
  await expect(pager).toHaveAttribute('data-tab', 'battle');
  await expect(page.getByTestId('play-button')).toBeInViewport();
  // Swipe left again = on to the profile page, swipe right = back
  await swipe(380, 60, 300);
  await expect(pager).toHaveAttribute('data-tab', 'profile');
  await swipe(60, 380, 300);
  await expect(pager).toHaveAttribute('data-tab', 'battle');
  await expect.poll(offBattle).toBeLessThan(2);

  // The tab follows the finger: the marker changes before the touch ends, and back again
  const drag = async (from: number, to: number, y: number): Promise<void> => {
    const step = from < to ? 12 : -12;
    for (let x = from; step > 0 ? x <= to : x >= to; x += step) {
      await touch('touchMove', x, y);
      await page.waitForTimeout(16);
    }
  };
  await touch('touchStart', 60, 300);
  await drag(60, 300, 300); // more than half a page to the right: deck
  await expect(pager).toHaveAttribute('data-tab', 'deck');
  await expect(page.getByTestId('tab-deck')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('tab-battle')).not.toHaveAttribute('aria-current', 'page');
  await drag(300, 150, 300); // back below half: battle again
  await expect(pager).toHaveAttribute('data-tab', 'battle');
  await expect(page.getByTestId('tab-battle')).toHaveAttribute('aria-current', 'page');
  await touch('touchEnd', 0, 0);
  await page.waitForTimeout(800);
  await expect(pager).toHaveAttribute('data-tab', 'battle');
  await expect.poll(offBattle).toBeLessThan(2);
  await touch('touchStart', 60, 300);
  await drag(60, 300, 300);
  await expect(pager).toHaveAttribute('data-tab', 'deck');
  await expect(page.getByTestId('tab-deck')).toHaveAttribute('aria-current', 'page');
  await touch('touchEnd', 0, 0);
  await expect.poll(scrollLeft).toBeLessThan(2);
  await expect(pager).toHaveAttribute('data-tab', 'deck');
  await expect(page.getByTestId('page-deck')).not.toHaveAttribute('inert', /.*/);
  await swipe(380, 60, 300);
  await expect(pager).toHaveAttribute('data-tab', 'battle');
  await expect.poll(offBattle).toBeLessThan(2);

  // Tap a tab and swipe back at once: afterwards `data-tab` matches the visible page, which is not inert
  await page.getByTestId('tab-deck').click();
  await page.waitForTimeout(80);
  await swipe(380, 60, 300);
  await page.waitForTimeout(1200);
  const restingTab = await pager.getAttribute('data-tab');
  expect(restingTab === 'deck' || restingTab === 'battle').toBe(true);
  const restingIndex = Math.round((await scrollLeft()) / (await width()));
  expect(restingIndex).toBe(restingTab === 'deck' ? 0 : 1);
  await expect(page.getByTestId(`page-${restingTab}`)).not.toHaveAttribute('inert', /.*/);
  if (restingTab === 'deck') {
    await page.getByTestId('tab-battle').click();
    await expect(pager).toHaveAttribute('data-tab', 'battle');
  }

  // With the detail dialog open nothing swipes
  await page.getByTestId('tab-deck').click();
  await expect(pager).toHaveAttribute('data-tab', 'deck');
  await page.getByTestId('deck-card-bat').click();
  await expect(page.getByTestId('card-detail')).toBeVisible();
  await swipe(380, 60, 300);
  await page.waitForTimeout(400);
  await expect(pager).toHaveAttribute('data-tab', 'deck');
  await page.getByTestId('card-detail-close').click();

  // The page itself never scrolls sideways
  expect(await page.evaluate(() => document.documentElement.scrollLeft)).toBe(0);
  expect(errors).toEqual([]);
});
