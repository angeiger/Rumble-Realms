import { CARD_IDS, MAX_LEVEL, type CardId } from '@rumble-realms/engine';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PlayerState } from '../backend/types.ts';
import de from '../i18n/de.json';
import en from '../i18n/en.json';
import { CardDetail, type CollectionDetail } from './CardDetail.tsx';
import { DeckView, type DeckViewProps } from './DeckScreen.tsx';
import {
  arenaOfCard,
  cardStatus,
  collectionErrorText,
  jokerOffer,
  levelProgress,
  levelUpInfo,
  placeInDeck,
  previewText,
  progressText,
  upgradeState,
} from './collection.ts';
import { fakePlayer } from './fakes.ts';

const noop = (): void => undefined;
const none = async (): Promise<null> => null;

/** Arena 1, gold 120, jokers 7; archer 3/5 copies, knight level 2 with 10 copies, healer 3/3. */
function player(over: Partial<PlayerState> = {}): PlayerState {
  return fakePlayer({
    gold: 120,
    jokers: 7,
    highestArena: 1,
    cards: {
      archer: { level: 1, copies: 3, unlockedUpgrades: 0 },
      knight: { level: 2, copies: 10, unlockedUpgrades: 1 },
      skeleton: { level: MAX_LEVEL, copies: 99, unlockedUpgrades: 7 },
      healer: { level: 1, copies: 3, unlockedUpgrades: 0 },
    },
    deck: ['archer', 'knight', 'skeleton', 'healer'],
    ...over,
  });
}

function deckHtml(p: PlayerState, over: Partial<DeckViewProps> = {}): string {
  return renderToString(
    <DeckView
      player={p}
      busy={false}
      onSetDeck={none}
      onLevelUp={none}
      onUnlockUpgrade={none}
      onSpendJokers={none}
      {...over}
    />,
  );
}

function detailHtml(card: CardId, p: PlayerState, over: Partial<CollectionDetail> = {}): string {
  return renderToString(
    <CardDetail
      card={card}
      level={p.cards[card]?.level ?? 1}
      onClose={noop}
      collection={{
        player: p,
        busy: false,
        error: null,
        onLevelUp: noop,
        onUnlockUpgrade: noop,
        onSpendJokers: noop,
        ...over,
      }}
    />,
  );
}

const disabled = (html: string, testId: string): boolean =>
  new RegExp(`<button[^>]*data-testid="${testId}"[^>]*disabled`).test(html) ||
  new RegExp(`<button[^>]*disabled[^>]*data-testid="${testId}"`).test(html);

describe('collection logic', () => {
  it('status: owned, found in a reached arena but missing, or locked by arena', () => {
    const p = player();
    expect(cardStatus(p, 'archer')).toBe('owned');
    expect(cardStatus(p, 'bat')).toBe('missing');
    expect(cardStatus(p, 'berserker')).toBe('locked');
    expect(cardStatus({ ...p, highestArena: 2 }, 'berserker')).toBe('missing');
    expect(arenaOfCard('berserker')).toEqual({ arena: 2, minElo: 1100 });
  });

  it('progress: copies towards the next level, MAX at the top, level-up needs gold too', () => {
    const p = player();
    const archer = levelProgress('archer', p.cards.archer!, p.gold);
    expect(archer).toMatchObject({ needed: 5, copies: 3, canLevel: false });
    expect(progressText(archer)).toBe('3/5');
    expect(archer.ratio).toBeCloseTo(0.6);
    const healer = levelProgress('healer', p.cards.healer!, 120);
    expect(healer.canLevel).toBe(true);
    expect(levelProgress('healer', p.cards.healer!, 99).canLevel).toBe(false);
    const max = levelProgress('skeleton', p.cards.skeleton!, 1e6);
    expect(progressText(max)).toBe('MAX');
    expect(max).toMatchObject({ needed: null, ratio: 1, canLevel: false });
  });

  it('level-up info names the first missing thing', () => {
    const p = player();
    expect(levelUpInfo('archer', p.cards.archer, 120)?.blocked).toBe('not_enough_copies');
    expect(levelUpInfo('healer', p.cards.healer, 50)?.blocked).toBe('not_enough_gold');
    expect(levelUpInfo('healer', p.cards.healer, 100)?.blocked).toBeNull();
    expect(levelUpInfo('skeleton', p.cards.skeleton, 1e6)).toBeNull();
    expect(levelUpInfo('bat', undefined, 1e6)).toBeNull();
  });

  it('upgrade states: unlocked, available, no gold, level too low', () => {
    const k = { level: 3, copies: 0, unlockedUpgrades: 1 };
    expect(upgradeState(k, 0, 0)).toEqual({ kind: 'unlocked' });
    expect(upgradeState(k, 1, 600)).toEqual({ kind: 'available', gold: 600 });
    expect(upgradeState(k, 1, 599)).toEqual({ kind: 'no_gold', gold: 600 });
    expect(upgradeState(k, 2, 9999)).toEqual({ kind: 'level', level: 5 });
  });

  it('joker offer: pool cards only, not at MAX, enough or not', () => {
    const p = player();
    expect(jokerOffer(p, 'bat')).toEqual({ cost: 1, have: 7, enough: true });
    expect(jokerOffer(p, 'healer')).toEqual({ cost: 2, have: 7, enough: true });
    expect(jokerOffer({ ...p, jokers: 1 }, 'healer')?.enough).toBe(false);
    expect(jokerOffer(p, 'berserker')).toBeNull();
    expect(jokerOffer(p, 'skeleton')).toBeNull();
    expect(jokerOffer({ ...p, highestArena: 2 }, 'berserker')?.cost).toBe(4);
  });

  it('deck change: replace, swap if the card is already in the deck, no change on the same card', () => {
    const deck: CardId[] = ['archer', 'knight', 'skeleton', 'healer'];
    expect(placeInDeck(deck, 0, 'bat')).toEqual(['bat', 'knight', 'skeleton', 'healer']);
    expect(placeInDeck(deck, 0, 'healer')).toEqual(['healer', 'knight', 'skeleton', 'archer']);
    expect(placeInDeck(deck, 1, 'knight')).toEqual(deck);
    expect(placeInDeck(deck, 9, 'bat')).toEqual(deck);
    expect(deck).toEqual(['archer', 'knight', 'skeleton', 'healer']);
  });

  it('preview text shows an arrow only if the value changes', () => {
    expect(previewText('560', '616')).toBe('560 → 616');
    expect(previewText('2', '2')).toBe('2');
    expect(previewText('2', null)).toBe('2');
  });

  it('error texts: own text per code, "no connection" for unavailable, generic fallback', () => {
    expect(collectionErrorText('unavailable')).toContain('Keine Verbindung');
    expect(collectionErrorText('not_enough_gold')).toBe('Dir fehlt Gold.');
    expect(collectionErrorText('internal')).toContain('nicht geklappt');
  });
});

describe('deck tab as collection', () => {
  it('shows all 16 cards and four places taken from the player deck', () => {
    const html = deckHtml(player());
    for (const id of CARD_IDS) expect(html).toContain(`data-testid="deck-card-${id}"`);
    expect(html.match(/data-testid="deck-slot-\d"/g)).toHaveLength(4);
    expect(html.match(/data-in-deck="true"/g)).toHaveLength(4);
    expect(html).toMatch(/data-testid="deck-slot-3"[^>]*data-card="healer"/);
  });

  it('owned, missing and locked tiles look different', () => {
    const html = deckHtml(player());
    expect(html).toMatch(/data-testid="deck-card-archer"[^>]*data-status="owned"/);
    expect(html).toMatch(/data-testid="deck-card-bat"[^>]*data-status="missing"/);
    expect(html).toMatch(/data-testid="deck-card-berserker"[^>]*data-status="locked"/);
    expect(html.match(/data-testid="tile-missing"/g)).toHaveLength(3); // tnt, musketeer, bat
  });

  it('locked tiles name the arena, missing tiles say "Noch nicht gefunden"', () => {
    const html = deckHtml(player());
    expect(html).toContain('Arena 2');
    expect(html).toContain('Arena 5');
    expect(html).toContain('Noch nicht gefunden');
    expect(html.match(/data-testid="tile-locked"/g)).toHaveLength(
      CARD_IDS.filter((c) => cardStatus(player(), c) === 'locked').length,
    );
  });

  it('copies bar: 3/5, MAX at the top, level-up hint only if payable', () => {
    const html = deckHtml(player());
    expect(html).toContain('3/5');
    expect(html).toContain('MAX');
    expect(html).toMatch(/data-testid="deck-card-healer"[^>]*data-can-level="true"/);
    expect(html).toMatch(/data-testid="deck-card-archer"[^>]*data-can-level="false"/);
    expect(html).toMatch(/data-testid="deck-card-skeleton"[^>]*data-can-level="false"/);
    expect(html.match(/data-testid="tile-can-level"/g)).toHaveLength(1); // healer only (knight lacks gold)
  });

  it('level-up hint is gone without gold', () => {
    const html = deckHtml(player({ gold: 0 }));
    expect(html).not.toContain('data-testid="tile-can-level"');
  });

  it('upgrade symbols follow the unlocked mask', () => {
    const html = deckHtml(player());
    expect(html).toMatch(/data-testid="tile-upgrades" data-count="3"/);
    expect(html).toMatch(/data-testid="tile-upgrades" data-count="1"/);
  });

  it('shows a slot choice and an error note, locks nothing visible without busy', () => {
    const html = deckHtml(player(), { initialSlot: 1, initialError: 'unavailable' });
    expect(html).toContain('Platz 2 gewählt');
    expect(html).toMatch(/data-testid="deck-slot-1"[^>]*data-selected="true"/);
    expect(html).toMatch(/data-testid="deck-error" data-code="unavailable"/);
    expect(html).toContain('Keine Verbindung');
  });
});

describe('card detail as collection', () => {
  it('level-up possible: values with preview, enabled button', () => {
    const p = player();
    const html = detailHtml('healer', p);
    expect(html).toMatch(/data-testid="detail-levelup" data-state="ready"/);
    expect(disabled(html, 'level-up-button')).toBe(false);
    expect(html).toContain('3/3 Kopien');
    expect(html).toContain('120/100 Gold');
    expect(html).toContain('→');
    expect(html).toContain('Aufwerten auf Level 2');
  });

  it('copies missing: button locked with the reason', () => {
    const html = detailHtml('archer', player());
    expect(html).toMatch(/data-testid="detail-levelup" data-state="copies"/);
    expect(disabled(html, 'level-up-button')).toBe(true);
    expect(html).toContain('Dir fehlen noch 2 Kopien.');
  });

  it('gold missing: button locked with the reason', () => {
    const html = detailHtml('healer', player({ gold: 40 }));
    expect(html).toMatch(/data-testid="detail-levelup" data-state="gold"/);
    expect(disabled(html, 'level-up-button')).toBe(true);
    expect(html).toContain('Dir fehlen noch 60 Gold.');
  });

  it('MAX: no level-up button, no preview, no joker offer', () => {
    const html = detailHtml('skeleton', player());
    expect(html).toMatch(/data-testid="detail-levelup" data-state="max"/);
    expect(html).not.toContain('level-up-button');
    expect(html).not.toContain('→');
    expect(html).not.toContain('detail-jokers');
  });

  it('busy locks every button', () => {
    const html = detailHtml('healer', player(), { busy: true });
    expect(disabled(html, 'level-up-button')).toBe(true);
    expect(disabled(html, 'spend-jokers-button')).toBe(true);
    const k = detailHtml(
      'knight',
      player({ gold: 5000, cards: { knight: { level: 3, copies: 0, unlockedUpgrades: 1 } } }),
      { busy: true },
    );
    expect(disabled(k, 'unlock-upgrade-1')).toBe(true);
  });

  it('upgrades: unlocked, unlockable for gold, level too low', () => {
    const p = player({
      gold: 700,
      cards: { knight: { level: 3, copies: 0, unlockedUpgrades: 1 } },
      deck: ['knight', 'knight', 'knight', 'knight'],
    });
    const html = detailHtml('knight', p);
    expect(html).toMatch(/data-testid="detail-upgrade-0"[^>]*data-state="unlocked"/);
    expect(html).toContain('data-testid="upgrade-on-0"');
    expect(html).toMatch(/data-testid="detail-upgrade-1"[^>]*data-state="available"/);
    expect(disabled(html, 'unlock-upgrade-1')).toBe(false);
    expect(html).toContain('600 Gold');
    expect(html).toMatch(/data-testid="detail-upgrade-2"[^>]*data-state="level"/);
    expect(html).toContain('Ab Kartenlevel 5');
    expect(html).not.toContain('unlock-upgrade-2');
  });

  it('upgrade without enough gold: button shown but locked', () => {
    const p = player({
      gold: 100,
      cards: { knight: { level: 3, copies: 0, unlockedUpgrades: 1 } },
      deck: ['knight', 'knight', 'knight', 'knight'],
    });
    const html = detailHtml('knight', p);
    expect(html).toMatch(/data-testid="detail-upgrade-1"[^>]*data-state="no_gold"/);
    expect(disabled(html, 'unlock-upgrade-1')).toBe(true);
  });

  it('jokers: possible and too few', () => {
    const ok = detailHtml('healer', player());
    expect(ok).toContain('1 Kopie für 2 Joker');
    expect(disabled(ok, 'spend-jokers-button')).toBe(false);
    expect(ok).not.toContain('jokers-reason');
    const few = detailHtml('healer', player({ jokers: 1 }));
    expect(disabled(few, 'spend-jokers-button')).toBe(true);
    expect(few).toContain('Dir fehlen noch 1 Joker.');
  });

  it('card not found yet: level 1 values and only the joker section', () => {
    const html = detailHtml('bat', player());
    expect(html).toMatch(/data-testid="card-detail"[^>]*data-status="missing"/);
    expect(html).toContain('data-testid="detail-missing"');
    expect(html).toContain('data-testid="spend-jokers-button"');
    expect(html).not.toContain('detail-levelup');
    expect(html).not.toContain('detail-upgrades');
    expect(html).not.toContain('→');
  });

  it('card of a later arena: values and "Ab Arena N (Elo ...)" only', () => {
    const html = detailHtml('berserker', player());
    expect(html).toMatch(/data-testid="card-detail"[^>]*data-status="locked"/);
    expect(html).toContain('Ab Arena 2 (Elo 1100)');
    expect(html).toContain('900');
    expect(html).not.toContain('detail-jokers');
    expect(html).not.toContain('detail-levelup');
    expect(html).not.toContain('detail-upgrades');
  });

  it('shows a server error as a short note', () => {
    const html = detailHtml('healer', player(), { error: 'unavailable' });
    expect(html).toMatch(/data-testid="detail-error" data-code="unavailable"/);
    expect(html).toContain('Keine Verbindung');
  });

  it('no test mode switches any more', () => {
    const html = detailHtml('knight', player());
    expect(html).not.toContain('role="switch"');
    expect(html).not.toContain('level-picker');
    expect(html).not.toContain('Testmodus');
  });
});

describe('i18n of the collection', () => {
  it('both languages have the same keys', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(de).sort());
  });
});
