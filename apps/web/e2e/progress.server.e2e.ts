/**
 * Accounts and progress against the LOCAL Supabase stack: real guest sign-in, real database,
 * real Edge Function `api` (SPEC 13). Start with `pnpm test:e2e:server` (see
 * docs/M4-BACKEND.md). Without the settings of the stack every test is skipped.
 *
 * The outcome of a bot match cannot be steered (the server draws the seed, and there is no test
 * switch in the server), so the match test plays up to three matches until one is won.
 * Preparing a saved state (gold, copies, jokers) is done directly in the database with the
 * secret key; the actions themselves then run through the UI and the real Edge Function.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  battle,
  collectErrors,
  enterGame,
  lives,
  openTab,
  reloadToMenu,
  stat,
  uniqueName,
  waitForMyTurn,
} from './helpers.ts';
import { missingMessage, missingSettings } from './serverEnv.ts';
import {
  cardOf,
  cardsOf,
  expectStatBarMatchesDb,
  grant,
  matchesOf,
  packsOf,
  playMatchToResult,
  profileById,
  profileByName,
  readResult,
} from './serverHelpers.ts';

const missing = missingSettings();
test.skip(missing.length > 0, missingMessage(missing));

/** Plays one card for the human and waits until the pick is shown. */
async function playOne(page: Page): Promise<void> {
  await waitForMyTurn(page);
  await page.getByTestId('offer-card-0').click();
  await expect(page.getByTestId('pick-hint')).toBeVisible();
}

async function startEasyMatch(page: Page): Promise<void> {
  await page.getByTestId('bot-level-easy').click();
  await page.getByTestId('play-button').click();
  await expect(battle(page)).toBeVisible();
}

test('Onboarding: Gast, Name (frei/vergeben gegen die Datenbank), Willkommens-Pack, Neuladen', async ({
  page,
  browser,
  baseURL,
}) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await expect(page.getByTestId('welcome-screen')).toBeVisible();
  await page.getByTestId('welcome-play').click();
  await expect(page.getByTestId('username-screen')).toBeVisible();
  const input = page.getByTestId('username-input');
  const status = page.getByTestId('username-status');
  await input.fill('admin');
  await expect(status).toHaveAttribute('data-state', 'blocked');

  const name = uniqueName('onb');
  await input.fill(name);
  await expect(status).toHaveAttribute('data-state', 'free');
  await page.getByTestId('username-submit').click();

  const modal = page.getByTestId('pack-modal');
  await expect(modal).toBeVisible();
  await expect(modal).toHaveAttribute('data-kind', 'welcome');
  await page.getByTestId('pack-open').click();
  await expect(page.getByTestId('pack-reward').locator('[data-card]').first()).toHaveAttribute(
    'data-card',
    'musketeer',
  );
  await page.getByTestId('pack-next').click();
  await expect(modal).toBeHidden();
  await expect(page.getByTestId('stat-name')).toHaveText(name);
  expect(await stat(page, 'elo')).toBe(1000);
  expect(await stat(page, 'gold')).toBe(0);

  // The database holds it: profile, the musketeer, the opened welcome pack.
  const profile = await profileByName(name);
  expect(profile.elo).toBe(1000);
  expect((await cardsOf(profile.id)).map((c) => c.card_id)).toContain('musketeer');
  const packs = await packsOf(profile.id);
  expect(packs).toHaveLength(1);
  expect(packs[0]).toMatchObject({ kind: 'welcome', opened: true });
  expect(packs[0]?.contents).not.toBeNull();

  // A second account in a second browser context: the same name is taken (checked in the database).
  const other = await browser.newContext({
    ...(baseURL === undefined ? {} : { baseURL }),
    viewport: { width: 412, height: 915 },
    hasTouch: true,
    isMobile: true,
  });
  try {
    const page2 = await other.newPage();
    await page2.goto('/');
    await page2.getByTestId('welcome-play').click();
    await expect(page2.getByTestId('username-screen')).toBeVisible();
    await page2.getByTestId('username-input').fill(name);
    await expect(page2.getByTestId('username-status')).toHaveAttribute('data-state', 'taken');
    await expect(page2.getByTestId('username-submit')).toBeDisabled();
    await page2.getByTestId('username-input').fill(name.toUpperCase());
    await expect(page2.getByTestId('username-status')).toHaveAttribute('data-state', 'taken');
  } finally {
    await other.close();
  }

  // Reload: same account, name and collection.
  await reloadToMenu(page);
  await expect(page.getByTestId('pack-modal')).toHaveCount(0);
  await expect(page.getByTestId('stat-name')).toHaveText(name);
  await openTab(page, 'deck');
  await expect(page.getByTestId('deck-card-musketeer')).toHaveAttribute('data-status', 'owned');
  await expectStatBarMatchesDb(page, profile.id);
  expect(errors).toEqual([]);
});

test('Willkommens-Pack: "Später" lässt ihn in der Datenbank liegen, nach Neuladen wieder öffnen', async ({
  page,
}) => {
  const { name } = await enterGame(page, { pack: 'later' });
  const profile = await profileByName(name);
  expect((await packsOf(profile.id)).map((p) => p.opened)).toEqual([false]);
  expect((await cardsOf(profile.id)).map((c) => c.card_id)).not.toContain('musketeer');

  await page.reload();
  await expect(page.getByTestId('pack-modal')).toBeVisible();
  await page.getByTestId('pack-open').click();
  await expect(page.getByTestId('pack-reward')).toBeVisible();
  await page.getByTestId('pack-next').click();
  await expect(page.getByTestId('pack-modal')).toBeHidden();
  expect((await packsOf(profile.id)).map((p) => p.opened)).toEqual([true]);
  expect((await cardsOf(profile.id)).map((c) => c.card_id)).toContain('musketeer');
});

test('Ganzes Bot-Match (Leicht) bis zum Ergebnis, Meldung an den Server, bis zu 3 Matches bis zum Sieg', async ({
  page,
}) => {
  test.setTimeout(25 * 60_000);
  const errors = collectErrors(page);
  const { name } = await enterGame(page);
  const profile = await profileByName(name);
  await startEasyMatch(page);

  let won = false;
  for (let n = 1; n <= 3 && !won; n++) {
    const before = await profileById(profile.id);
    await playMatchToResult(page);
    const r = await readResult(page);
    const after = await profileById(profile.id);
    console.log(`match ${n}: ${r.outcome}, Elo ${before.elo} -> ${after.elo}`);

    // Result screen, database and (below) the menu all tell the same story.
    expect(after.elo).toBe(r.elo);
    expect(after.elo).toBe(before.elo + r.delta);
    expect(after.games_played).toBe(before.games_played + 1);
    expect((await matchesOf(profile.id)).filter((m) => m.result === 'pending')).toHaveLength(0);

    if (r.outcome === 'win') {
      won = true;
      expect(r.delta).toBeGreaterThan(0);
      await expect(page.getByTestId('result-pack')).toBeVisible();
      const unopened = (await packsOf(profile.id)).filter((p) => p.kind === 'match' && !p.opened);
      expect(unopened).toHaveLength(1);

      const goldBeforePack = after.gold;
      const jokersBeforePack = after.jokers;
      const cardsBeforePack = await cardsOf(profile.id);
      await page.getByTestId('result-open-pack').click();
      await expect(page.getByTestId('pack-modal')).toBeVisible();
      await page.getByTestId('pack-open').click();
      await expect(page.getByTestId('pack-reward')).toBeVisible();
      await page.getByTestId('pack-next').click();
      await expect(page.getByTestId('pack-modal')).toBeHidden();
      await expect(page.getByTestId('result-screen')).toBeVisible();

      const opened = (await packsOf(profile.id)).filter((p) => p.kind === 'match');
      expect(opened).toHaveLength(1);
      expect(opened[0]?.opened).toBe(true);
      expect(opened[0]?.contents).not.toBeNull();
      // The reward is booked: cards (copies), gold or jokers, depending on what the pack held.
      const reward = opened[0]?.contents as
        | { kind: 'cards'; card: string; copies: number }
        | { kind: 'gold'; gold: number }
        | { kind: 'jokers'; jokers: number };
      const afterPack = await profileById(profile.id);
      if (reward.kind === 'cards') {
        const was = cardsBeforePack.find((c) => c.card_id === reward.card)?.copies ?? 0;
        expect((await cardOf(profile.id, reward.card)).copies).toBe(was + reward.copies);
      } else if (reward.kind === 'gold') {
        expect(afterPack.gold).toBe(goldBeforePack + reward.gold);
      } else {
        expect(afterPack.jokers).toBe(jokersBeforePack + reward.jokers);
      }
    } else {
      expect(r.delta).toBeLessThanOrEqual(0);
      await expect(page.getByTestId('result-gold')).toContainText('+10');
      await expect(page.getByTestId('result-pack')).toHaveCount(0);
      expect(after.gold).toBe(before.gold + 10);
      expect((await packsOf(profile.id)).filter((p) => p.kind === 'match')).toHaveLength(0);
    }

    if (!won && n < 3) {
      await page.getByTestId('play-again').click();
      await expect(page.getByTestId('result-title')).toBeHidden();
      await expect(battle(page)).toHaveAttribute('data-round', '1');
    }
  }
  expect(won, 'no win against the easy bot in 3 matches').toBe(true);

  await page.getByTestId('back-to-title').click();
  await expect(page.getByTestId('stat-bar')).toBeVisible();
  await expectStatBarMatchesDb(page, profile.id);
  expect(errors).toEqual([]);
});

test('Fortsetzen: Neuladen mitten im Match, Weiterspielen an derselben Stelle', async ({
  page,
}) => {
  test.setTimeout(3 * 60_000);
  const errors = collectErrors(page);
  const { name } = await enterGame(page);
  const profile = await profileByName(name);
  await startEasyMatch(page);
  await playOne(page);
  await waitForMyTurn(page);

  const pendingBefore = (await matchesOf(profile.id)).filter((m) => m.result === 'pending');
  expect(pendingBefore).toHaveLength(1);
  const round = await battle(page).getAttribute('data-round');
  const phase = await battle(page).getAttribute('data-phase');
  const liveNow = await lives(page);
  const offersBefore = await page
    .locator('[data-testid^="offer-card-"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-card') ?? ''));

  await page.reload();
  await expect(page.getByTestId('stat-bar')).toBeVisible();
  await expect(page.getByTestId('pending-match')).toBeVisible();
  await expect(page.getByTestId('play-button')).toHaveCount(0);
  await page.getByTestId('pending-resume').click();
  await expect(battle(page)).toBeVisible();
  await waitForMyTurn(page);
  await expect(battle(page)).toHaveAttribute('data-round', round ?? '');
  await expect(battle(page)).toHaveAttribute('data-phase', phase ?? '');
  expect(await lives(page)).toEqual(liveNow);
  expect(
    await page
      .locator('[data-testid^="offer-card-"]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-card') ?? '')),
  ).toEqual(offersBefore);

  // Still the same match on the server; playing on works.
  const pendingAfter = (await matchesOf(profile.id)).filter((m) => m.result === 'pending');
  expect(pendingAfter.map((m) => m.id)).toEqual(pendingBefore.map((m) => m.id));
  await page.getByTestId('offer-card-0').click();
  await expect(page.getByTestId('pick-hint')).toBeVisible();
  expect(errors).toEqual([]);
});

test('Aufgeben: offenes Match zählt als Niederlage, neues Match beginnt', async ({ page }) => {
  test.setTimeout(3 * 60_000);
  const errors = collectErrors(page);
  const { name } = await enterGame(page);
  const profile = await profileByName(name);
  const eloBefore = await stat(page, 'elo');
  await startEasyMatch(page);
  await playOne(page);
  await page.getByTestId('leave-button').click();
  await page.getByTestId('leave-confirm').click();
  await expect(page.getByTestId('pending-match')).toBeVisible();
  expect(await stat(page, 'elo')).toBe(eloBefore);
  expect((await matchesOf(profile.id)).filter((m) => m.result === 'pending')).toHaveLength(1);

  await page.getByTestId('pending-forfeit').click();
  await page.getByTestId('pending-forfeit-yes').click();
  await expect(battle(page)).toBeVisible();
  await expect(battle(page)).toHaveAttribute('data-round', '1');
  await expect(battle(page)).toHaveAttribute('data-phase', 'draft');

  // The old match is booked as a loss; the new one is the only open one.
  const rows = await matchesOf(profile.id);
  expect(rows).toHaveLength(2);
  expect(rows.filter((m) => m.result === 'pending')).toHaveLength(1);
  const db = await profileById(profile.id);
  expect(db.elo).toBeLessThan(eloBefore);
  expect(db.gold).toBe(0); // a forfeit gives no comfort gold
  expect(db.games_played).toBe(1);

  await page.getByTestId('leave-button').click();
  await page.getByTestId('leave-confirm').click();
  await expect(page.getByTestId('stat-bar')).toBeVisible();
  await expectStatBarMatchesDb(page, profile.id);
  expect(errors).toEqual([]);
});

test('Aufwerten, Upgrade und Joker mit in der Datenbank vorbereitetem Spielstand', async ({
  page,
}) => {
  const errors = collectErrors(page);
  const { name } = await enterGame(page);
  const profile = await profileByName(name);
  await grant(profile.id, { gold: 500, jokers: 3, copies: { archer: 5 } });
  await reloadToMenu(page);
  expect(await stat(page, 'gold')).toBe(500);
  expect(await stat(page, 'jokers')).toBe(3);

  await openTab(page, 'deck');
  const archer = page.getByTestId('deck-card-archer');
  await expect(archer).toHaveAttribute('data-can-level', 'true');
  await archer.click();
  const levelUp = page.getByTestId('detail-levelup');
  await expect(levelUp).toHaveAttribute('data-state', 'ready');

  // Level 1 -> 2: 5 copies and 100 gold
  await page.getByTestId('level-up-button').click();
  await expect(page.getByTestId('detail-level')).toHaveAttribute('data-level', '2');
  expect(await stat(page, 'gold')).toBe(400);
  await expect(levelUp).toContainText('0/10 Kopien');
  expect(await cardOf(profile.id, 'archer')).toMatchObject({ level: 2, copies: 0 });
  expect((await profileById(profile.id)).gold).toBe(400);

  // Upgrade 1 from level 2 for 200 gold
  await page.getByTestId('unlock-upgrade-0').click();
  await expect(page.getByTestId('upgrade-on-0')).toBeVisible();
  expect(await stat(page, 'gold')).toBe(200);
  expect((await cardOf(profile.id, 'archer')).unlocked_upgrades & 1).toBe(1);

  // One copy for one joker
  await page.getByTestId('spend-jokers-button').click();
  await expect(levelUp).toContainText('1/10 Kopien');
  expect(await stat(page, 'jokers')).toBe(2);
  expect(await cardOf(profile.id, 'archer')).toMatchObject({ level: 2, copies: 1 });
  expect(await profileById(profile.id)).toMatchObject({ gold: 200, jokers: 2 });

  await page.getByTestId('card-detail-close').click();
  await expect(archer).toContainText('Level 2');
  await reloadToMenu(page);
  await openTab(page, 'deck');
  await expect(page.getByTestId('deck-card-archer')).toContainText('Level 2');
  await expectStatBarMatchesDb(page, profile.id);
  expect(errors).toEqual([]);
});

test('Abmelden im Profil führt zum Willkommensbildschirm', async ({ page }) => {
  const errors = collectErrors(page);
  const { name } = await enterGame(page);
  await openTab(page, 'profile');
  await expect(page.getByTestId('profile-username')).toHaveText(name);
  await expect(page.getByTestId('local-note')).toHaveCount(0);
  await page.getByTestId('sign-out').click();
  await page.getByTestId('sign-out-yes').click();
  await expect(page.getByTestId('welcome-screen')).toBeVisible();

  // The session is gone for good: after a reload the welcome screen is still shown.
  await page.reload();
  await expect(page.getByTestId('welcome-screen')).toBeVisible();
  expect(errors).toEqual([]);
});
