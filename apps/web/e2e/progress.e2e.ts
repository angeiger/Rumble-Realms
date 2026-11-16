/**
 * Accounts and progress (M4) in the local mode: onboarding, welcome pack, resuming an open
 * match, profile, collection. The flows live in `helpers.ts`, so the same tests can run against
 * a real server later with another configuration.
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

const LOCAL_KEY = 'rr.local.v1';
const MATCH_KEY = 'rr.match.v1';

/** Picks the human played so far (as saved for resuming). */
async function savedPicks(page: Page): Promise<number[]> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw === null ? [] : (JSON.parse(raw) as { picks: number[] }).picks;
  }, MATCH_KEY);
}

async function offerCards(page: Page): Promise<string[]> {
  return page
    .locator('[data-testid^="offer-card-"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-card') ?? ''));
}

/** Plays one card for the human and waits until it is the human's turn again (or the draft is over). */
async function playOne(page: Page): Promise<void> {
  await waitForMyTurn(page);
  await page.getByTestId('offer-card-0').click();
  await expect(page.getByTestId('pick-hint')).toBeVisible();
}

test('Onboarding: Namensprüfung, Willkommens-Pack mit Musketier, Neuladen behält alles', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await expect(page.getByTestId('welcome-screen')).toBeVisible();
  await page.getByTestId('welcome-play').click();
  await expect(page.getByTestId('username-screen')).toBeVisible();

  const input = page.getByTestId('username-input');
  const status = page.getByTestId('username-status');
  const submit = page.getByTestId('username-submit');
  await expect(status).toHaveAttribute('data-state', 'empty');
  await expect(submit).toBeDisabled();
  await input.fill('ab');
  await expect(status).toHaveAttribute('data-state', 'invalid');
  await expect(submit).toBeDisabled();
  await input.fill('hallo welt!');
  await expect(status).toHaveAttribute('data-state', 'invalid');
  await input.fill('admin');
  await expect(status).toHaveAttribute('data-state', 'blocked');
  await expect(submit).toBeDisabled();

  const name = uniqueName('onb');
  await input.fill(name);
  await expect(status).toHaveAttribute('data-state', 'free');
  await expect(submit).toBeEnabled();
  await submit.click();

  // The welcome pack opens by itself and holds the musketeer.
  const modal = page.getByTestId('pack-modal');
  await expect(modal).toBeVisible();
  await expect(modal).toHaveAttribute('data-kind', 'welcome');
  await expect(modal).toHaveAttribute('data-phase', 'closed');
  await page.getByTestId('pack-open').click();
  await expect(page.getByTestId('pack-reward')).toHaveAttribute('data-kind', 'cards');
  await expect(page.getByTestId('pack-reward').locator('[data-card]').first()).toHaveAttribute(
    'data-card',
    'musketeer',
  );
  await expect(page.getByTestId('pack-reward-new')).toBeVisible();
  await page.getByTestId('pack-next').click();
  await expect(modal).toBeHidden();

  // Menu: stat bar with name, start Elo, no gold and no jokers; the arena is shown; no pack waits.
  await expect(page.getByTestId('stat-bar')).toBeVisible();
  await expect(page.getByTestId('stat-name')).toHaveText(name);
  expect(await stat(page, 'elo')).toBe(1000);
  expect(await stat(page, 'gold')).toBe(0);
  expect(await stat(page, 'jokers')).toBe(0);
  await expect(page.getByTestId('arena-name')).toBeVisible();
  await expect(page.getByTestId('pack-button')).toHaveCount(0);

  await openTab(page, 'deck');
  await expect(page.getByTestId('deck-card-musketeer')).toHaveAttribute('data-status', 'owned');

  // Reload: still signed in, same name, card still owned, the pack does not come back.
  await reloadToMenu(page);
  await expect(page.getByTestId('pack-modal')).toHaveCount(0);
  await expect(page.getByTestId('stat-name')).toHaveText(name);
  expect(await stat(page, 'elo')).toBe(1000);
  await openTab(page, 'deck');
  await expect(page.getByTestId('deck-card-musketeer')).toHaveAttribute('data-status', 'owned');
  await expect(page.getByTestId('pack-button')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Willkommens-Pack: "Später" lässt ihn liegen, nach Neuladen öffnet er sich wieder', async ({
  page,
}) => {
  await enterGame(page, { pack: 'later' });
  await expect(page.getByTestId('pack-button')).toHaveAttribute('data-count', '1');
  await openTab(page, 'deck');
  await expect(page.getByTestId('deck-card-musketeer')).toHaveAttribute('data-status', 'missing');

  await page.reload();
  await expect(page.getByTestId('pack-modal')).toBeVisible();
  await page.getByTestId('pack-open').click();
  await expect(page.getByTestId('pack-reward')).toBeVisible();
  await page.getByTestId('pack-next').click();
  await expect(page.getByTestId('pack-modal')).toBeHidden();
  await expect(page.getByTestId('pack-button')).toHaveCount(0);
  await openTab(page, 'deck');
  await expect(page.getByTestId('deck-card-musketeer')).toHaveAttribute('data-status', 'owned');
});

test('Fortsetzen: Neuladen mitten im Match, Weiterspielen an derselben Stelle', async ({
  page,
}) => {
  test.setTimeout(2 * 60_000);
  const errors = collectErrors(page);
  await enterGame(page);
  await page.getByTestId('play-button').click();
  await expect(battle(page)).toBeVisible();

  // One pick; then stop at a moment when it is the human's turn, so that nothing changes meanwhile.
  await playOne(page);
  await waitForMyTurn(page);
  const round = await battle(page).getAttribute('data-round');
  const phase = await battle(page).getAttribute('data-phase');
  const liveNow = await lives(page);
  const offersBefore = await offerCards(page);
  const picksBefore = await savedPicks(page);
  expect(picksBefore.length).toBeGreaterThanOrEqual(2); // mine and the bot's
  await page.waitForTimeout(500);
  const shotBefore = (await page.locator('canvas').screenshot()).toString('base64');

  await page.reload();
  await expect(page.getByTestId('stat-bar')).toBeVisible();
  await expect(page.getByTestId('pending-match')).toBeVisible();
  await expect(page.getByTestId('play-button')).toHaveCount(0);
  await expect(page.getByTestId('pending-resume')).toBeVisible();
  await page.getByTestId('pending-resume').click();
  await expect(battle(page)).toBeVisible();
  await waitForMyTurn(page);
  await page.waitForTimeout(500);

  await expect(battle(page)).toHaveAttribute('data-round', round ?? '');
  await expect(battle(page)).toHaveAttribute('data-phase', phase ?? '');
  expect(await lives(page)).toEqual(liveNow);
  expect(await offerCards(page)).toEqual(offersBefore);
  expect(await savedPicks(page)).toEqual(picksBefore);

  // The field looks the same as before the reload: units stand where they stood.
  const shotAfter = (await page.locator('canvas').screenshot()).toString('base64');
  const changed = await page.evaluate(
    async ([a, b]) => {
      const load = async (b64: string): Promise<ImageData> => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext('2d');
        if (!ctx) throw new Error('no 2d context');
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, c.width, c.height);
      };
      const [x, y] = [await load(a as string), await load(b as string)];
      if (x.width !== y.width || x.height !== y.height) return 1;
      let diff = 0;
      for (let i = 0; i < x.data.length; i += 4) {
        const d =
          Math.abs((x.data[i] ?? 0) - (y.data[i] ?? 0)) +
          Math.abs((x.data[i + 1] ?? 0) - (y.data[i + 1] ?? 0)) +
          Math.abs((x.data[i + 2] ?? 0) - (y.data[i + 2] ?? 0));
        if (d > 90) diff++;
      }
      return diff / (x.width * x.height);
    },
    [shotBefore, shotAfter],
  );
  expect(changed).toBeLessThan(0.05);

  // The match goes on: one more pick is played and saved.
  await page.getByTestId('offer-card-0').click();
  await expect
    .poll(async () => (await savedPicks(page)).length)
    .toBeGreaterThan(picksBefore.length);
  expect(errors).toEqual([]);
});

test('Aufgeben: offenes Match zählt als Niederlage, neues Match beginnt', async ({ page }) => {
  await enterGame(page);
  const eloBefore = await stat(page, 'elo');
  await page.getByTestId('play-button').click();
  await playOne(page);
  await page.getByTestId('leave-button').click();
  await page.getByTestId('leave-confirm').click();
  await expect(page.getByTestId('pending-match')).toBeVisible();
  expect(await stat(page, 'elo')).toBe(eloBefore);

  await page.getByTestId('pending-forfeit').click();
  await expect(page.getByTestId('pending-forfeit-ask')).toBeVisible();
  // "Doch nicht": nothing happens
  await page.getByTestId('pending-forfeit-no').click();
  await expect(page.getByTestId('pending-forfeit-ask')).toHaveCount(0);
  expect(await stat(page, 'elo')).toBe(eloBefore);

  await page.getByTestId('pending-forfeit').click();
  await page.getByTestId('pending-forfeit-yes').click();
  await expect(battle(page)).toBeVisible();
  await expect(battle(page)).toHaveAttribute('data-round', '1');
  await expect(battle(page)).toHaveAttribute('data-phase', 'draft');
  expect(await lives(page)).toEqual({ me: 4, opp: 4 });
  // Only the opening pick of the bot can be there already: nothing of the old match is left.
  expect((await savedPicks(page)).length).toBeLessThanOrEqual(1);

  await page.getByTestId('leave-button').click();
  await page.getByTestId('leave-confirm').click();
  await expect(page.getByTestId('stat-bar')).toBeVisible();
  expect(await stat(page, 'elo')).toBeLessThan(eloBefore);
  expect(await stat(page, 'gold')).toBe(0); // a forfeit gives no comfort gold
  await expect(page.getByTestId('pending-match')).toBeVisible();
});

test('Profil: Sprache umschalten, Name einmal ändern, danach gesperrt, Abmelden', async ({
  page,
}) => {
  const errors = collectErrors(page);
  const { name } = await enterGame(page);
  await openTab(page, 'profile');
  await expect(page.getByTestId('profile-screen')).toBeVisible();
  await expect(page.getByTestId('profile-username')).toHaveText(name);
  await expect(page.getByTestId('local-note')).toBeVisible();
  await expect(page.getByTestId('lang-de')).toHaveAttribute('aria-checked', 'true');

  // Language: texts change at once and stay after a reload
  await expect(page.getByTestId('tab-battle')).toContainText('Kampf');
  await page.getByTestId('lang-en').click();
  await expect(page.getByTestId('tab-battle')).toContainText('Battle');
  await expect(page.getByTestId('lang-en')).toHaveAttribute('aria-checked', 'true');
  await page.reload();
  await expect(page.getByTestId('tab-battle')).toContainText('Battle');
  await openTab(page, 'profile');
  await page.getByTestId('lang-de').click();
  await expect(page.getByTestId('tab-battle')).toContainText('Kampf');

  // One free rename
  await expect(page.getByTestId('rename-hint')).toContainText('einmal');
  await page.getByTestId('rename-button').click();
  const newName = uniqueName('neu');
  await page.getByTestId('username-input').fill(newName);
  await expect(page.getByTestId('username-status')).toHaveAttribute('data-state', 'free');
  await page.getByTestId('username-submit').click();
  await expect(page.getByTestId('profile-username')).toHaveText(newName);
  await expect(page.getByTestId('stat-name')).toHaveText(newName);
  await expect(page.getByTestId('rename-button')).toHaveCount(0);
  await expect(page.getByTestId('rename-hint')).toContainText('nicht mehr');

  await reloadToMenu(page);
  await openTab(page, 'profile');
  await expect(page.getByTestId('profile-username')).toHaveText(newName);
  await expect(page.getByTestId('rename-button')).toHaveCount(0);

  // Sign out (asks first) and back in as the same guest: name and progress are still there
  await page.getByTestId('sign-out').click();
  await expect(page.getByTestId('sign-out-ask')).toBeVisible();
  await page.getByTestId('sign-out-no').click();
  await expect(page.getByTestId('sign-out-ask')).toHaveCount(0);
  await page.getByTestId('sign-out').click();
  await page.getByTestId('sign-out-yes').click();
  await expect(page.getByTestId('welcome-screen')).toBeVisible();
  await page.getByTestId('welcome-play').click();
  await expect(page.getByTestId('stat-name')).toHaveText(newName);
  await expect(page.getByTestId('username-screen')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Deck-Tab: gesperrte und fehlende Karten grau, Detailansicht nennt Kosten und Grund', async ({
  page,
}) => {
  await enterGame(page, { pack: 'later' });
  await openTab(page, 'deck');
  const musketeer = page.getByTestId('deck-card-musketeer'); // arena 1, not found yet
  const assassin = page.getByTestId('deck-card-assassin'); // arena 2, not reached
  const archer = page.getByTestId('deck-card-archer');
  await expect(archer).toHaveAttribute('data-status', 'owned');
  await expect(musketeer).toHaveAttribute('data-status', 'missing');
  await expect(assassin).toHaveAttribute('data-status', 'locked');
  await expect(musketeer.getByTestId('tile-missing')).toBeVisible();
  await expect(assassin.getByTestId('tile-locked')).toContainText('2');
  await expect(archer).not.toHaveClass(/tile--gray/);
  await expect(musketeer).toHaveClass(/tile--gray/);
  await expect(assassin).toHaveClass(/tile--gray/);
  const filter = await assassin.locator('.tile__art').evaluate((el) => getComputedStyle(el).filter);
  expect(filter).toContain('grayscale');

  // Locked card: values of level 1 and the note, no level-up
  await assassin.click();
  const detail = page.getByTestId('card-detail');
  await expect(detail).toHaveAttribute('data-card', 'assassin');
  await expect(detail).toHaveAttribute('data-status', 'locked');
  await expect(page.getByTestId('detail-locked')).toBeVisible();
  await expect(page.getByTestId('detail-levelup')).toHaveCount(0);
  await page.getByTestId('card-detail-close').click();

  // Missing card
  await musketeer.click();
  await expect(detail).toHaveAttribute('data-status', 'missing');
  await expect(page.getByTestId('detail-missing')).toBeVisible();
  await page.getByTestId('card-detail-close').click();

  // Owned card at level 1: costs of the next level and why it does not work yet
  await archer.click();
  await expect(detail).toHaveAttribute('data-status', 'owned');
  const levelUp = page.getByTestId('detail-levelup');
  await expect(levelUp).toHaveAttribute('data-state', 'copies');
  await expect(levelUp).toContainText('1/5 Kopien');
  await expect(levelUp).toContainText('0/100 Gold');
  await expect(page.getByTestId('level-up-button')).toBeDisabled();
  await expect(page.getByTestId('level-up-reason')).toContainText('4 Kopien');
  // Upgrades are locked behind the card level
  await expect(page.getByTestId('upgrade-level-0')).toBeVisible();
  await expect(page.getByTestId('unlock-upgrade-0')).toHaveCount(0);
  // Jokers: none yet, the reason says so
  await expect(page.getByTestId('spend-jokers-button')).toBeDisabled();
  await expect(page.getByTestId('jokers-reason')).toBeVisible();
  await page.getByTestId('card-detail-close').click();
  await expect(archer.getByTestId('tile-can-level')).toHaveCount(0);
});

test('Aufwerten, Upgrade und Joker mit vorbereitetem Spielstand', async ({ page }) => {
  // The saved state of the local mode is plain JSON; the test prepares it before the page loads
  // again (no switch in the app code). Server-side rules are tested against the real server.
  await enterGame(page);
  await page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    if (raw === null) throw new Error('no saved state');
    const saved = JSON.parse(raw) as {
      data: {
        profiles: { gold: number; jokers: number }[];
        cards: { card_id: string; copies: number }[];
      };
    };
    const profile = saved.data.profiles[0];
    const archer = saved.data.cards.find((c) => c.card_id === 'archer');
    if (!profile || !archer) throw new Error('unexpected state layout');
    profile.gold = 500;
    profile.jokers = 3;
    archer.copies = 5;
    localStorage.setItem(key, JSON.stringify(saved));
  }, LOCAL_KEY);
  await reloadToMenu(page);
  expect(await stat(page, 'gold')).toBe(500);
  expect(await stat(page, 'jokers')).toBe(3);

  await openTab(page, 'deck');
  const archer = page.getByTestId('deck-card-archer');
  await expect(archer).toHaveAttribute('data-can-level', 'true');
  await expect(archer.getByTestId('tile-can-level')).toBeVisible();
  await archer.click();
  const levelUp = page.getByTestId('detail-levelup');
  await expect(levelUp).toHaveAttribute('data-state', 'ready');
  await expect(page.getByTestId('level-up-reason')).toHaveCount(0);

  // Level 1 -> 2: 5 copies and 100 gold are spent
  await page.getByTestId('level-up-button').click();
  await expect(page.getByTestId('detail-level')).toHaveAttribute('data-level', '2');
  expect(await stat(page, 'gold')).toBe(400);
  await expect(levelUp).toHaveAttribute('data-state', 'copies');
  await expect(levelUp).toContainText('0/10 Kopien');

  // Upgrade 1 unlocks from level 2 for 200 gold
  await page.getByTestId('unlock-upgrade-0').click();
  await expect(page.getByTestId('upgrade-on-0')).toBeVisible();
  expect(await stat(page, 'gold')).toBe(200);

  // One copy for one joker
  await page.getByTestId('spend-jokers-button').click();
  await expect(levelUp).toContainText('1/10 Kopien');
  expect(await stat(page, 'jokers')).toBe(2);

  await page.getByTestId('card-detail-close').click();
  await expect(archer).toContainText('Level 2');
  await expect(archer.getByTestId('tile-upgrades')).toHaveAttribute('data-count', '1');

  // Everything is saved
  await reloadToMenu(page);
  await openTab(page, 'deck');
  await expect(page.getByTestId('deck-card-archer')).toContainText('Level 2');
  expect(await stat(page, 'gold')).toBe(200);
  expect(await stat(page, 'jokers')).toBe(2);
});
