import { beforeEach, describe, expect, it } from 'vitest';
import { BOT_PROFILES } from '@rumble-realms/engine';
import { BOT_STORAGE_KEY, DEFAULT_BOT_LEVEL, isBotLevel, useBotStore } from './botStore.ts';

describe('bot store', () => {
  beforeEach(() => useBotStore.setState({ level: DEFAULT_BOT_LEVEL }));

  it('defaults to easy and accepts the three levels only', () => {
    expect(DEFAULT_BOT_LEVEL).toBe('easy');
    useBotStore.getState().setLevel('hard');
    expect(useBotStore.getState().level).toBe('hard');
    useBotStore.getState().setLevel('master' as never);
    expect(useBotStore.getState().level).toBe('hard');
    expect(isBotLevel('medium')).toBe(true);
    expect(isBotLevel('x')).toBe(false);
    expect(BOT_STORAGE_KEY).toContain('rr.');
  });

  it('every selectable level has bot profiles', () => {
    for (const level of ['easy', 'medium', 'hard']) {
      expect(BOT_PROFILES.some((p) => p.level === level)).toBe(true);
    }
  });
});
