import { describe, expect, it } from 'vitest';
import de from './de.json';
import en from './en.json';
import { t } from './index.ts';

describe('i18n catalogs', () => {
  it('de.json and en.json have exactly the same keys', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(de).sort());
  });

  it('has no empty values', () => {
    for (const catalog of [de, en]) {
      for (const [key, value] of Object.entries(catalog)) {
        expect(value.trim(), key).not.toBe('');
      }
    }
  });
});

describe('t()', () => {
  it('replaces placeholders', () => {
    expect(t('title.engineVersion', { version: 7 })).toBe('Engine v7');
  });

  it('returns the plain text without params', () => {
    expect(t('app.title')).toBe('Rumble Realms');
  });
});
