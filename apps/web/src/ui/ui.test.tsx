import { CARD_IDS, CARDS, MAX_LEVEL, UPGRADES } from '@rumble-realms/engine';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SessionSnapshot } from '../game/types.ts';
import de from '../i18n/de.json';
import en from '../i18n/en.json';
import { ActiveUpgrades, UpgradeList } from './ActiveUpgrades.tsx';
import { BattleView, type BattleActions } from './BattleView.tsx';
import { CardDetail } from './CardDetail.tsx';
import { CardView } from './CardView.tsx';
import { DeckScreen } from './DeckScreen.tsx';
import { TAB_ORDER, TabBar } from './TabBar.tsx';
import { BotLevelPicker, TitleScreen } from './TitleScreen.tsx';
import { START_DECK } from '../game/config.ts';

const noop = () => undefined;
const actions: BattleActions = {
  play: noop,
  setSpeed: noop,
  leave: noop,
  playAgain: noop,
};

function snap(patch: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    phase: 'draft',
    round: 2,
    me: 0,
    players: [
      {
        name: '',
        isBot: false,
        deck: ['archer', 'knight', 'skeleton', 'healer'],
        levels: { knight: 3 },
        upgrades: {},
      },
      {
        name: 'Lady Knochenkralle',
        isBot: true,
        deck: ['skeleton', 'bat', 'archer', 'healer'],
        levels: {},
        upgrades: {},
      },
    ],
    lives: [4, 3],
    turn: 0,
    picksLeft: [2, 3],
    offer: [
      { kind: 'spawn', card: 'knight' },
      { kind: 'spawn', card: 'healer' },
      { kind: 'spawn', card: 'skeleton' },
    ],
    lastPick: null,
    roundResult: null,
    winner: null,
    speed: 1,
    activeUpgrades: [{}, {}],
    ...patch,
  };
}

function view(s: SessionSnapshot): string {
  return renderToString(<BattleView snapshot={s} actions={actions} field={<div />} />);
}

const roundResult = (
  winner: 0 | 1 | 'draw',
  reason: 'elimination' | 'timeout' = 'elimination',
) => ({
  round: 2,
  result: { winner, reason, ticks: 100, hp: [0, 0] as [number, number] },
  lives: [3, 3] as [number, number],
});

describe('TitleScreen', () => {
  it('shows play button and version', () => {
    const html = renderToString(
      <TitleScreen onPlay={noop} deck={START_DECK} levels={{}} botLevel="easy" onBotLevel={noop} />,
    );
    expect(html).toContain('data-testid="play-button"');
    expect(html).toContain('Engine v');
  });
});

describe('TabBar', () => {
  it('has the two tabs and marks the current one', () => {
    const html = renderToString(<TabBar tab="deck" onSelect={noop} />);
    expect(html).toContain('data-testid="tab-battle"');
    expect(html).toContain('data-testid="tab-deck"');
    expect(html).toContain('Kampf');
    expect(html).toMatch(
      /aria-current="page"[^>]*data-testid="tab-deck"|data-testid="tab-deck"[^>]*aria-current="page"/,
    );
    expect(html.match(/aria-current/g)).toHaveLength(1);
  });

  it('shows Deck left of Kampf', () => {
    const html = renderToString(<TabBar tab="battle" onSelect={noop} />);
    expect(html.indexOf('data-testid="tab-deck"')).toBeLessThan(
      html.indexOf('data-testid="tab-battle"'),
    );
    expect(TAB_ORDER).toEqual(['deck', 'battle']);
  });
});

describe('DeckScreen', () => {
  it('shows four places and every card of the game with the deck marked', () => {
    const html = renderToString(<DeckScreen />);
    expect(html).toContain('data-testid="deck-screen"');
    for (let i = 0; i < 4; i++) expect(html).toContain(`data-testid="deck-slot-${i}"`);
    expect(html).toContain('Alle Karten');
    for (const id of CARD_IDS) expect(html).toContain(`data-testid="deck-card-${id}"`);
    expect(html.match(/data-in-deck="true"/g)).toHaveLength(4);
    for (const id of START_DECK) {
      expect(html).toMatch(new RegExp(`data-testid="deck-slot-\\d"[^>]*data-card="${id}"`));
    }
    expect(html).not.toContain('data-testid="card-detail"');
  });
});

describe('CardView', () => {
  it('shows name, count and key values with a decimal comma', () => {
    const html = renderToString(<CardView card="knight" level={1} testId="offer-card-0" />);
    expect(html).toContain('Ritter');
    expect(html).toContain('×2');
    expect(html).toContain('600');
    expect(html).toContain('>60<');
    expect(html).toContain('card--common');
  });

  it('uses rarity frames, level scaling and healing for the healer', () => {
    const healer = renderToString(<CardView card="healer" level={1} />);
    expect(healer).toContain('card--rare');
    expect(healer).toContain('Heiler');
    const berserker = renderToString(<CardView card="berserker" level={1} />);
    expect(berserker).toContain('card--epic');
    expect(renderToString(<CardView card="knight" level={3} />)).toContain('720');
  });

  it('has no selection state any more (a tap plays the card)', () => {
    const html = renderToString(<CardView card="archer" level={1} />);
    expect(html).not.toContain('data-selected');
    expect(html).not.toContain('aria-pressed');
  });

  it('renders every base card', () => {
    for (const id of CARD_IDS) {
      const html = renderToString(<CardView card={id} level={1} />);
      expect(html).toContain(`×${CARDS[id].count}`);
    }
  });
});

describe('CardDetail', () => {
  it('shows role, rarity, values and the text', () => {
    const html = renderToString(<CardDetail card="berserker" level={1} onClose={noop} />);
    expect(html).toContain('data-testid="card-detail"');
    expect(html).toContain('Berserker');
    expect(html).toContain('Episch');
    expect(html).toContain('Tank');
    expect(html).toContain('900');
    expect(html).toContain('raubt Leben');
  });

  it('shows interval and speed (no longer on the offer card)', () => {
    const html = renderToString(<CardDetail card="knight" level={1} onClose={noop} />);
    expect(html).toContain('1,2 s');
    expect(html).toContain('0,8');
  });

  it('has no level control in the battle', () => {
    const html = renderToString(<CardDetail card="knight" level={2} onClose={noop} />);
    expect(html).not.toContain('level-picker');
    expect(html).toContain('Level 2');
  });

  it('shows the level picker with test mode hint when a handler is given', () => {
    const html = renderToString(
      <CardDetail card="tnt" level={3} onClose={noop} onLevelChange={noop} />,
    );
    expect(html).toContain('data-testid="level-minus"');
    expect(html).toContain('data-testid="level-plus"');
    expect(html).toMatch(/data-testid="level-value" data-level="3"[^>]*>Level 3</);
    expect(html).toContain('Testmodus: Level frei wählbar');
    expect(html).not.toMatch(/data-testid="level-minus"[^>]*disabled/);
    expect(html).not.toMatch(/data-testid="level-plus"[^>]*disabled/);
  });

  it('disables the buttons at the ends and updates with the level', () => {
    const low = renderToString(
      <CardDetail card="tnt" level={1} onClose={noop} onLevelChange={noop} />,
    );
    expect(low).toMatch(
      /data-testid="level-minus"[^>]*disabled|disabled[^>]*data-testid="level-minus"/,
    );
    const high = renderToString(
      <CardDetail card="tnt" level={MAX_LEVEL} onClose={noop} onLevelChange={noop} />,
    );
    expect(high).toMatch(
      /data-testid="level-plus"[^>]*disabled|disabled[^>]*data-testid="level-plus"/,
    );
    expect(high).toContain(`Level ${MAX_LEVEL}`);
    // The values follow the level (knight hp: 600 at level 1, 720 at level 3).
    const l1 = renderToString(
      <CardDetail card="knight" level={1} onClose={noop} onLevelChange={noop} />,
    );
    const l3 = renderToString(
      <CardDetail card="knight" level={3} onClose={noop} onLevelChange={noop} />,
    );
    expect(l1).toContain('600');
    expect(l3).toContain('720');
  });
});

describe('BattleView', () => {
  it('draft, my turn: offer cards and status, no play button, no highlight', () => {
    const html = view(snap());
    expect(html).toContain('data-phase="draft"');
    expect(html).toContain('data-round="2"');
    expect(html).toContain('Lady Knochenkralle');
    expect(html).toContain('Du bist dran · noch 2 Karten');
    expect(html).toContain('data-testid="offer-card-0"');
    expect(html).toContain('data-testid="offer-card-2"');
    expect(html).not.toContain('confirm-button');
    expect(html).not.toContain('Ausspielen');
    expect(html).not.toContain('data-selected');
    expect(html).toContain('data-testid="lives-me"');
    expect(html).toMatch(/data-testid="lives-opponent" data-lives="3"/);
  });

  it('the field is always rendered (same place in every phase)', () => {
    for (const phase of ['draft', 'intro', 'battle', 'roundEnd'] as const) {
      const html = view(snap({ phase, turn: null, offer: null }));
      expect(html).toContain('battle__field');
      expect(html).not.toContain('data-testid="tab-bar"');
    }
  });

  it('draft, opponent turn: face-down cards and name', () => {
    const html = view(snap({ turn: 1, offer: null }));
    expect(html).toContain('Lady Knochenkralle wählt …');
    expect(html).not.toContain('data-testid="offer-card-0"');
    expect(html).toContain('data-my-turn="false"');
  });

  it('shows the last pick and forfeited units', () => {
    const own = view(
      snap({
        lastPick: {
          player: 0,
          slot: 0,
          kind: 'spawn',
          card: 'skeleton',
          spawned: [1, 2, 3, 4, 5],
          forfeited: 0,
        },
      }),
    );
    expect(own).toContain('Du spielst Skelette (5)');
    const opp = view(
      snap({
        lastPick: { player: 1, slot: 0, kind: 'spawn', card: 'knight', spawned: [1], forfeited: 1 },
      }),
    );
    expect(opp).toContain('Lady Knochenkralle spielt Ritter (2)');
    expect(opp).toContain('1 Einheit fand keinen Platz');
    const many = view(
      snap({
        lastPick: {
          player: 1,
          slot: 0,
          kind: 'spawn',
          card: 'skeleton',
          spawned: [1, 2],
          forfeited: 3,
        },
      }),
    );
    expect(many).toContain('3 Einheiten fanden keinen Platz');
  });

  it('intro, battle and round end show no cards and no countdown', () => {
    for (const phase of ['intro', 'battle', 'roundEnd'] as const) {
      const html = view(snap({ phase, turn: null, offer: null }));
      expect(html).toContain(`data-phase="${phase}"`);
      expect(html).not.toContain('data-testid="offer-card-0"');
      expect(html).not.toContain('data-testid="draft-bar"');
      expect(html).not.toContain('countdown');
      expect(html).not.toContain('Kampf!');
      expect(html).toContain('data-testid="lives-me"');
    }
  });

  it('round end banner: won, lost, draw, timeout', () => {
    const base = { phase: 'roundEnd' as const, turn: null, offer: null };
    const won = view(snap({ ...base, roundResult: roundResult(0) }));
    expect(won).toContain('Runde gewonnen!');
    expect(won).toContain('data-outcome="win"');
    expect(view(snap({ ...base, roundResult: roundResult(1) }))).toContain('Runde verloren');
    const draw = view(snap({ ...base, roundResult: roundResult('draw', 'timeout') }));
    expect(draw).toContain('Unentschieden');
    expect(draw).toContain('Zeit abgelaufen');
  });

  it('result: victory and defeat with final lives and buttons', () => {
    const base = { phase: 'finished' as const, turn: null, offer: null };
    const win = view(snap({ ...base, winner: 0, lives: [2, 0], roundResult: roundResult(0) }));
    expect(win).toContain('data-outcome="win"');
    expect(win).toContain('Sieg!');
    expect(win).toContain('data-testid="play-again"');
    expect(win).toContain('data-testid="back-to-title"');
    expect(win).toContain('Runden: 2');
    const loss = view(snap({ ...base, winner: 1, lives: [0, 1], roundResult: roundResult(1) }));
    expect(loss).toContain('data-outcome="loss"');
    expect(loss).toContain('Niederlage');
    expect(view(snap({ ...base, winner: 'draw', lives: [0, 0] }))).toContain('data-outcome="draw"');
  });
});

describe('i18n of cards', () => {
  it('every card has a name and a text in both languages', () => {
    for (const id of CARD_IDS) {
      for (const catalog of [de, en] as Record<string, string>[]) {
        expect(catalog[`card.${id}.name`], id).toBeTruthy();
        expect(catalog[`card.${id}.text`], id).toBeTruthy();
      }
      expect(de[`rarity.${CARDS[id].rarity}` as keyof typeof de]).toBeTruthy();
      expect(de[`role.${CARDS[id].role}` as keyof typeof de]).toBeTruthy();
    }
  });
});

describe('bot level picker', () => {
  it('shows three buttons, marks the chosen one and the card level of it', () => {
    const html = renderToString(<BotLevelPicker value="medium" onChange={noop} />);
    for (const id of ['easy', 'medium', 'hard'])
      expect(html).toContain(`data-testid="bot-level-${id}"`);
    expect(html).toMatch(/aria-checked="true"[^>]*data-testid="bot-level-medium"/);
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(html).toContain('Leicht');
    expect(html).toContain('Schwer');
    expect(html).toContain('Kartenlevel 2 · 1 Upgrade');
    expect(renderToString(<BotLevelPicker value="easy" onChange={noop} />)).toContain(
      'Kartenlevel 1 · keine Upgrades',
    );
    expect(renderToString(<BotLevelPicker value="hard" onChange={noop} />)).toContain(
      'Kartenlevel 3 · 2 Upgrades',
    );
  });
});

describe('special offer cards', () => {
  it('double pack: ribbon, doubled count', () => {
    const html = renderToString(<CardView card="skeleton" level={1} kind="double" />);
    expect(html).toContain('data-kind="double"');
    expect(html).toContain('data-testid="card-double"');
    expect(html).toContain('Doppelpack');
    expect(html).toContain(`×${CARDS.skeleton.count * 2}`);
  });

  it('double pack counts the units that upgrades add', () => {
    // Rattle gang (+2 skeletons) is upgrade 2 -> mask 4.
    const html = renderToString(
      <CardView card="skeleton" level={1} kind="double" activeMask={4} />,
    );
    expect(html).toContain(`×${(CARDS.skeleton.count + 2) * 2}`);
  });

  it('upgrade card: unit, upgrade name and effect, no combat values', () => {
    const html = renderToString(<CardView card="knight" level={1} kind="upgrade" upgrade={0} />);
    expect(html).toContain('data-kind="upgrade"');
    expect(html).toContain('data-testid="card-upgrade"');
    expect(html).toContain('Aufrüstung');
    expect(html).toContain('Ritter');
    expect(html).toContain('Schild');
    expect(html).toContain('Absorbiert die ersten 250 Schaden.');
    expect(html).not.toContain('card__stats');
    expect(html).not.toContain('card__count');
  });

  it('a plain card is neither', () => {
    const html = renderToString(<CardView card="knight" level={1} />);
    expect(html).toContain('data-kind="spawn"');
    expect(html).not.toContain('card__ribbon');
  });

  it('the draft bar shows the kinds of the offer', () => {
    const html = view(
      snap({
        offer: [
          { kind: 'double', card: 'knight' },
          { kind: 'upgrade', card: 'healer', upgrade: 1 },
          { kind: 'spawn', card: 'skeleton' },
        ],
      }),
    );
    expect(html).toMatch(/data-testid="offer-card-0"[^>]*data-kind="double"/);
    expect(html).toMatch(/data-testid="offer-card-1"[^>]*data-kind="upgrade"[^>]*data-upgrade="1"/);
    expect(html).toMatch(/data-testid="offer-card-2"[^>]*data-kind="spawn"/);
    expect(html).toContain('Wiederbelebung');
  });

  it('hints for double pack and upgrade', () => {
    const pick = (player: 0 | 1, kind: 'double' | 'upgrade') =>
      view(
        snap({
          lastPick: {
            player,
            slot: 0,
            kind,
            card: 'knight',
            ...(kind === 'upgrade' ? { upgrade: 0 as const } : {}),
            spawned: kind === 'double' ? [1, 2, 3, 4] : [],
            forfeited: 0,
          },
        }),
      );
    expect(pick(0, 'double')).toContain('Du spielst Doppelpack Ritter (4)');
    expect(pick(1, 'double')).toContain('Lady Knochenkralle spielt Doppelpack Ritter (4)');
    expect(pick(0, 'upgrade')).toContain('Du rüstest auf: Ritter – Schild');
    expect(pick(1, 'upgrade')).toContain('Lady Knochenkralle rüstet auf: Ritter – Schild');
  });
});

describe('active upgrades next to the lives', () => {
  it('shows nothing without active upgrades', () => {
    const html = view(snap());
    expect(html).not.toContain('data-testid="upgrades-me"');
    expect(html).not.toContain('data-testid="upgrades-opponent"');
  });

  it('shows symbols for both players, one dot per upgrade', () => {
    const html = view(snap({ activeUpgrades: [{ knight: 5 }, { skeleton: 7, bat: 2 }] }));
    expect(html).toMatch(/data-testid="upgrades-me"[^>]*data-count="2"/);
    expect(html).toMatch(/data-testid="upgrades-opponent"[^>]*data-count="4"/);
    expect(html.match(/upg-chip__dot"/g)).toHaveLength(2 + 4);
    expect(html).toContain('2 aktive Upgrades');
  });

  it('keeps the header free of anything that could make it taller', () => {
    const html = renderToString(
      <ActiveUpgrades masks={{ knight: 1 }} name="Du" team="own" testId="x" />,
    );
    expect(html).toContain('upg-strip');
    expect(html).not.toContain('data-testid="upgrade-list"');
  });

  it('the list shows name and effect of every active upgrade', () => {
    const html = renderToString(
      <UpgradeList
        list={[
          { card: 'knight', index: 0 },
          { card: 'skeleton', index: 2 },
        ]}
        name="Du"
        team="own"
        onClose={noop}
      />,
    );
    expect(html).toContain('Aktive Upgrades: Du');
    expect(html).toContain('Ritter – Schild');
    expect(html).toContain('Absorbiert die ersten 250 Schaden.');
    expect(html).toContain('Skelette – Rasselbande');
    expect(html).toContain('+2 Skelette pro Karte.');
  });
});

describe('card detail upgrades', () => {
  it('lists the three upgrades with name and effect, highlighting one', () => {
    const html = renderToString(
      <CardDetail card="knight" level={1} onClose={noop} highlightUpgrade={1} />,
    );
    for (let i = 0; i < 3; i++) expect(html).toContain(`data-testid="detail-upgrade-${i}"`);
    expect(html).toContain('Schild');
    expect(html).toContain('Ansturm');
    expect(html).toContain('Spott');
    expect(html).toMatch(/data-testid="detail-upgrade-1"[^>]*data-highlight="true"/);
    expect(html).toMatch(/data-testid="detail-upgrade-0"[^>]*data-highlight="false"/);
    expect(html).not.toContain('role="switch"');
  });

  it('deck tab: a switch per upgrade, state from the mask, test mode note', () => {
    const html = renderToString(
      <CardDetail card="knight" level={1} onClose={noop} upgradeMask={5} onToggleUpgrade={noop} />,
    );
    expect(html.match(/role="switch"/g)).toHaveLength(3);
    expect(html).toMatch(/data-testid="upgrade-switch-0"[^>]*/);
    expect(html).toMatch(/aria-checked="true"[^>]*data-testid="upgrade-switch-0"/);
    expect(html).toMatch(/aria-checked="false"[^>]*data-testid="upgrade-switch-1"/);
    expect(html).toMatch(/aria-checked="true"[^>]*data-testid="upgrade-switch-2"/);
    expect(html).toContain('Testmodus: Upgrades frei schaltbar');
  });
});

describe('deck tab upgrades', () => {
  it('shows the unlocked upgrades of every card as symbols (all by default)', () => {
    const html = renderToString(<DeckScreen />);
    expect(html.match(/data-testid="tile-upgrades"/g)).toHaveLength(4 + CARD_IDS.length);
    expect(html).toContain('data-count="3"');
  });
});

describe('i18n of upgrades', () => {
  it('every upgrade id has a name and an effect text in both languages', () => {
    let n = 0;
    for (const defs of Object.values(UPGRADES)) {
      for (const def of defs) {
        n++;
        for (const catalog of [de, en] as Record<string, string>[]) {
          expect(catalog[`upgrade.${def.id}.name`], def.id).toBeTruthy();
          expect(catalog[`upgrade.${def.id}.text`], def.id).toBeTruthy();
        }
      }
    }
    expect(n).toBe(CARD_IDS.length * 3);
  });
});
