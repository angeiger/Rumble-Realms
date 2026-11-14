import { CARD_IDS, CARDS } from '@rumble-realms/engine';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SessionSnapshot } from '../game/types.ts';
import de from '../i18n/de.json';
import en from '../i18n/en.json';
import { BattleView, type BattleActions } from './BattleView.tsx';
import { CardDetail } from './CardDetail.tsx';
import { CardView } from './CardView.tsx';
import { TitleScreen } from './TitleScreen.tsx';

const noop = () => undefined;
const actions: BattleActions = {
  select: noop,
  confirm: noop,
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
      },
      {
        name: 'Lady Knochenkralle',
        isBot: true,
        deck: ['skeleton', 'bat', 'archer', 'healer'],
        levels: {},
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
    selectedSlot: null,
    lastPick: null,
    countdown: null,
    roundResult: null,
    winner: null,
    speed: 1,
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
    const html = renderToString(<TitleScreen onPlay={noop} />);
    expect(html).toContain('data-testid="play-button"');
    expect(html).toContain('Engine v');
  });
});

describe('CardView', () => {
  it('shows name, count and key values with a decimal comma', () => {
    const html = renderToString(<CardView card="knight" level={1} testId="offer-card-0" />);
    expect(html).toContain('Ritter');
    expect(html).toContain('×2');
    expect(html).toContain('600');
    expect(html).toContain('>60<');
    expect(html).toContain('1,2 s');
    expect(html).toContain('0,8');
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

  it('marks the selection', () => {
    expect(renderToString(<CardView card="archer" level={1} selected />)).toContain(
      'data-selected="true"',
    );
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
});

describe('BattleView', () => {
  it('draft, my turn: offer cards, status and disabled play button', () => {
    const html = view(snap());
    expect(html).toContain('data-phase="draft"');
    expect(html).toContain('data-round="2"');
    expect(html).toContain('Lady Knochenkralle');
    expect(html).toContain('Du bist dran · noch 2 Karten');
    expect(html).toContain('data-testid="offer-card-0"');
    expect(html).toContain('data-testid="offer-card-2"');
    expect(html).toMatch(/data-testid="confirm-button"[^>]*disabled/);
    expect(html).toContain('data-testid="lives-me"');
    expect(html).toMatch(/data-testid="lives-opponent" data-lives="3"/);
  });

  it('draft, selected card enables the play button', () => {
    const html = view(snap({ selectedSlot: 1 }));
    expect(html).not.toMatch(/data-testid="confirm-button"[^>]*disabled/);
    expect(html).toContain('data-selected="true"');
  });

  it('draft, opponent turn: face-down cards and name', () => {
    const html = view(snap({ turn: 1, offer: null }));
    expect(html).toContain('Lady Knochenkralle wählt …');
    expect(html).not.toContain('data-testid="offer-card-0"');
    expect(html).toContain('data-testid="card-back"');
  });

  it('shows the last pick and forfeited units', () => {
    const own = view(
      snap({
        lastPick: { player: 0, slot: 0, card: 'skeleton', spawned: [1, 2, 3, 4, 5], forfeited: 0 },
      }),
    );
    expect(own).toContain('Du spielst Skelette (5)');
    const opp = view(
      snap({ lastPick: { player: 1, slot: 0, card: 'knight', spawned: [1], forfeited: 1 } }),
    );
    expect(opp).toContain('Lady Knochenkralle spielt Ritter (2)');
    expect(opp).toContain('1 Einheit fand keinen Platz');
    const many = view(
      snap({ lastPick: { player: 1, slot: 0, card: 'skeleton', spawned: [1, 2], forfeited: 3 } }),
    );
    expect(many).toContain('3 Einheiten fanden keinen Platz');
  });

  it('countdown shows the number and no draft cards', () => {
    const html = view(snap({ phase: 'countdown', turn: null, offer: null, countdown: 2 }));
    expect(html).toContain('data-testid="countdown"');
    expect(html).toContain('>2<');
    expect(html).not.toContain('data-testid="offer-card-0"');
    expect(view(snap({ phase: 'countdown', turn: null, offer: null, countdown: 0 }))).toContain(
      'Kampf!',
    );
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
