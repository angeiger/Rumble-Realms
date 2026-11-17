import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PackInfo } from '../backend/types.ts';
import { AppView } from '../App.tsx';
import { usePackUi } from '../game/packUi.ts';
import { fakePlayer, viewProps } from './fakes.ts';
import { PackButton } from './PackButton.tsx';
import { PackModal, type PackModalProps } from './PackModal.tsx';
import { nextPack, pickPack, rewardLine, welcomeToOpen } from './packLogic.ts';

const noop = (): void => undefined;
const match = (id: string): PackInfo => ({ id, kind: 'match' });
const welcome = (id: string): PackInfo => ({ id, kind: 'welcome' });

function modal(over: Partial<PackModalProps> = {}): string {
  return renderToString(
    <PackModal
      packs={[match('a')]}
      preferId={null}
      busy={false}
      onOpen={async () => ({ ok: false, error: 'unavailable' })}
      onClose={noop}
      {...over}
    />,
  );
}

describe('pack logic', () => {
  it('picks the preferred pack if it is still unopened, else the oldest', () => {
    const packs = [match('a'), match('b')];
    expect(pickPack(packs, 'b')?.id).toBe('b');
    expect(pickPack(packs, 'gone')?.id).toBe('a');
    expect(pickPack(packs, null)?.id).toBe('a');
    expect(pickPack([], null)).toBeNull();
  });

  it('next pack skips the one just opened', () => {
    expect(nextPack([match('a'), match('b')], 'a')?.id).toBe('b');
    expect(nextPack([match('b')], 'a')?.id).toBe('b');
    expect(nextPack([match('a')], 'a')).toBeNull();
  });

  it('the welcome pack opens by itself once', () => {
    const packs = [match('a'), welcome('w')];
    expect(welcomeToOpen(packs, false)?.id).toBe('w');
    expect(welcomeToOpen(packs, true)).toBeNull();
    expect(welcomeToOpen([match('a')], false)).toBeNull();
  });

  it('reward lines for all three kinds', () => {
    expect(rewardLine({ kind: 'cards', card: 'bat', copies: 4 }, true)).toEqual({
      kind: 'cards',
      text: '+4 Kopien',
      isNew: true,
    });
    expect(rewardLine({ kind: 'cards', card: 'bat', copies: 1 }, false).text).toBe('+1 Kopie');
    expect(rewardLine({ kind: 'gold', gold: 80 }, false).text).toBe('+80 Gold');
    expect(rewardLine({ kind: 'jokers', jokers: 2 }, false).text).toBe('+2 Joker');
  });
});

describe('PackButton', () => {
  it('shows the count, and nothing without packs', () => {
    const html = renderToString(<PackButton count={3} onClick={noop} />);
    expect(html).toMatch(/data-testid="pack-button"[^>]*data-count="3"/);
    expect(html).toContain('Pack öffnen');
    expect(renderToString(<PackButton count={0} onClick={noop} />)).toBe('');
  });

  it('sits under the fight button of the battle tab only if packs wait', () => {
    const none = renderToString(<AppView {...viewProps()} />);
    expect(none).not.toContain('data-testid="pack-button"');
    const some = renderToString(
      <AppView {...viewProps({ player: fakePlayer({ packs: [match('a'), match('b')] }) })} />,
    );
    expect(some).toMatch(/data-testid="pack-button"[^>]*data-count="2"/);
    expect(some.indexOf('data-testid="play-button"')).toBeLessThan(
      some.indexOf('data-testid="pack-button"'),
    );
  });
});

describe('PackModal', () => {
  it('closed chest with an open button', () => {
    const html = modal();
    expect(html).toMatch(/data-testid="pack-modal" data-phase="closed" data-kind="match"/);
    expect(html).toContain('Belohnungspack');
    expect(html).toContain('data-testid="pack-open"');
    expect(html).not.toContain('data-testid="pack-reward"');
  });

  it('the welcome pack has its own heading', () => {
    const html = modal({ packs: [welcome('w')] });
    expect(html).toContain('data-kind="welcome"');
    expect(html).toContain('Willkommensgeschenk');
  });

  it('shows the preferred pack and how many others wait', () => {
    const html = modal({ packs: [welcome('w'), match('a')], preferId: 'a' });
    expect(html).toContain('data-kind="match"');
    expect(html).toMatch(/data-testid="pack-remaining" data-count="1"/);
  });

  it('renders nothing without packs', () => {
    expect(modal({ packs: [] })).toBe('');
  });

  it('reward: cards, with "new card" only when unlocked', () => {
    const fresh = modal({
      initialOpened: {
        reward: { kind: 'cards', card: 'musketeer', copies: 2 },
        cardUnlocked: true,
      },
    });
    expect(fresh).toMatch(/data-testid="pack-reward" data-kind="cards"/);
    expect(fresh).toContain('Musketier');
    expect(fresh).toContain('+2 Kopien');
    expect(fresh).toContain('Neue Karte!');
    expect(fresh).toContain('data-testid="pack-next"');
    expect(fresh).not.toContain('data-testid="pack-open"');
    const old = modal({
      initialOpened: { reward: { kind: 'cards', card: 'knight', copies: 3 }, cardUnlocked: false },
    });
    expect(old).not.toContain('Neue Karte!');
  });

  it('reward: gold and jokers', () => {
    const gold = modal({
      initialOpened: { reward: { kind: 'gold', gold: 120 }, cardUnlocked: false },
    });
    expect(gold).toMatch(/data-testid="pack-reward" data-kind="gold"/);
    expect(gold).toContain('+120 Gold');
    const jokers = modal({
      initialOpened: { reward: { kind: 'jokers', jokers: 3 }, cardUnlocked: false },
    });
    expect(jokers).toMatch(/data-testid="pack-reward" data-kind="jokers"/);
    expect(jokers).toContain('+3 Joker');
  });

  it('busy locks the open button', () => {
    expect(modal({ busy: true })).toMatch(/<button[^>]*data-testid="pack-open"[^>]*disabled/);
  });
});

describe('pack dialog in the app', () => {
  it('opens over the menu when the store says so, with the player packs', () => {
    const p = fakePlayer({ packs: [welcome('w')] });
    const closed = renderToString(<AppView {...viewProps({ player: p })} />);
    expect(closed).not.toContain('data-testid="pack-modal"');
    const open = renderToString(
      <AppView
        {...viewProps({
          player: p,
          pack: { ...viewProps().pack, open: true, preferId: 'w' },
        })}
      />,
    );
    expect(open).toContain('data-testid="pack-modal"');
    expect(open).toContain('Willkommensgeschenk');
  });

  it('the pack store opens for a given pack and closes again', () => {
    usePackUi.getState().show('p9');
    expect(usePackUi.getState()).toMatchObject({ open: true, preferId: 'p9' });
    usePackUi.getState().close();
    expect(usePackUi.getState()).toMatchObject({ open: false, preferId: null });
  });
});
