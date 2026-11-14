import { beforeEach, describe, expect, it } from 'vitest';
import { useDeckStore } from './deckStore.ts';
import { START_DECK } from './config.ts';
import { useGameStore } from './store.ts';

describe('game store', () => {
  beforeEach(() => {
    useGameStore.getState().backToTitle();
  });

  it('starts on the title screen', () => {
    const s = useGameStore.getState();
    expect(s.screen).toBe('title');
    expect(s.session).toBeNull();
    expect(s.snapshot).toBeNull();
  });

  it('startMatch opens the battle and follows the session', () => {
    useGameStore.getState().startMatch();
    const s = useGameStore.getState();
    expect(s.screen).toBe('battle');
    expect(s.session).not.toBeNull();
    expect(s.snapshot).toBe(s.session?.getSnapshot());
    expect(s.snapshot?.players[0].name).toBe('');
    expect(s.snapshot?.players[1].isBot).toBe(true);

    for (let i = 0; i < 30; i++) {
      const snap = useGameStore.getState().snapshot;
      if (snap?.turn === 0) {
        useGameStore.getState().play(0);
        break;
      }
      s.session?.advance(250);
    }
    const now = useGameStore.getState();
    expect(now.snapshot).toBe(now.session?.getSnapshot());
    now.setSpeed(2);
    expect(useGameStore.getState().snapshot?.speed).toBe(2);
  });

  it('startMatch takes deck and levels from the deck store', () => {
    useDeckStore.setState({ deck: ['assassin', 'tnt', 'knight', 'archer'], levels: { tnt: 3 } });
    try {
      useGameStore.getState().startMatch();
      const me = useGameStore.getState().snapshot?.players[0];
      expect(me?.deck).toEqual(['assassin', 'tnt', 'knight', 'archer']);
      expect(me?.levels).toEqual({ assassin: 1, tnt: 3, knight: 1, archer: 1 });
    } finally {
      useDeckStore.setState({ deck: [...START_DECK], levels: {} });
    }
  });

  it('keeps the tab and goes back to the battle tab on backToTitle', () => {
    useGameStore.getState().setTab('deck');
    expect(useGameStore.getState().tab).toBe('deck');
    useGameStore.getState().backToTitle();
    expect(useGameStore.getState().tab).toBe('battle');
  });

  it('backToTitle detaches and clears', () => {
    useGameStore.getState().startMatch();
    const session = useGameStore.getState().session;
    useGameStore.getState().backToTitle();
    const s = useGameStore.getState();
    expect(s.screen).toBe('title');
    expect(s.session).toBeNull();
    expect(s.snapshot).toBeNull();
    session?.setSpeed(2);
    expect(useGameStore.getState().snapshot).toBeNull();
  });

  it('a new match replaces the old one and ignores the old session', () => {
    useGameStore.getState().startMatch();
    const first = useGameStore.getState().session;
    useGameStore.getState().startMatch();
    const second = useGameStore.getState().session;
    expect(second).not.toBe(first);
    first?.setSpeed(2);
    expect(useGameStore.getState().snapshot?.speed).toBe(1);
  });
});
