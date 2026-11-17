import { describe, expect, it } from 'vitest';
import { checkUsername } from './username.ts';

describe('checkUsername (SPEC 9.3)', () => {
  it('checks the format', () => {
    for (const bad of [
      'ab',
      'a'.repeat(17),
      'Hans Peter',
      'Jörg123',
      'a-b-c',
      '',
      5,
      null,
      undefined,
    ]) {
      expect(checkUsername(bad), String(bad)).toBe('username_invalid');
    }
    expect(checkUsername('abc')).toBeNull();
    expect(checkUsername('a'.repeat(16))).toBeNull();
    expect(checkUsername('___')).toBeNull();
  });
  it('allows harmless names', () => {
    for (const ok of [
      'Andreas',
      'Klassiker',
      'Assassine',
      'Ritter_99',
      'Grasshopper',
      'Marsch',
      'Hancock',
    ]) {
      expect(checkUsername(ok), ok).toBeNull();
    }
  });
  it('blocks insults, also with underscores, case and leetspeak', () => {
    for (const bad of [
      'Arschloch',
      'xx_FUCK_xx',
      'sch31sse',
      'n1gg3r',
      'Sh1t',
      'W_i_c_h_s_e_r',
      'Hitler88',
    ]) {
      expect(checkUsername(bad), bad).toBe('username_blocked');
    }
  });
  it('blocks role and operator names', () => {
    for (const bad of [
      'admin',
      'Admin_1',
      'Moderator',
      'SUPPORT',
      'RumbleRealms',
      'Rumble_Realms',
    ]) {
      expect(checkUsername(bad), bad).toBe('username_blocked');
    }
  });
});
