import { describe, expect, it } from 'vitest';
import { setLocale } from '../i18n/index.ts';
import {
  formatNumber,
  getCardStats,
  intervalSeconds,
  scaleStat,
  speedFieldsPerSecond,
} from './cardStats.ts';

describe('card stats', () => {
  it('converts ticks and move speed', () => {
    expect(intervalSeconds(24)).toBe(1.2);
    expect(intervalSeconds(50)).toBe(2.5);
    expect(speedFieldsPerSecond(40)).toBe(0.8);
    expect(speedFieldsPerSecond(90)).toBe(1.8);
  });

  it('scales by level like SPEC 6.3 (+10 % per level)', () => {
    expect(scaleStat(600, 1)).toBe(600);
    expect(scaleStat(600, 5)).toBe(840);
    expect(scaleStat(30, 3)).toBe(36);
  });

  it('reads the level 1 table of SPEC 5.2', () => {
    const knight = getCardStats('knight', 1);
    expect(knight).toMatchObject({ hp: 600, effect: 60, interval: 1.2, rangeKind: 'melee' });
    const archer = getCardStats('archer', 1);
    expect(archer).toMatchObject({ count: 3, range: 5, rangeKind: 'ranged', target: 'groundAir' });
    expect(getCardStats('healer', 1)).toMatchObject({ effectKind: 'heal', effect: 40 });
    expect(getCardStats('tnt', 1)).toMatchObject({ interval: null, rangeKind: 'contact' });
  });

  it('applies the level', () => {
    expect(getCardStats('knight', 3).hp).toBe(720);
  });

  it('formats numbers with a decimal comma in German', () => {
    setLocale('de');
    expect(formatNumber(1.2)).toBe('1,2');
    expect(formatNumber(0.8)).toBe('0,8');
    expect(formatNumber(2)).toBe('2');
    setLocale('en');
    expect(formatNumber(1.2)).toBe('1.2');
    setLocale('de');
  });
});
