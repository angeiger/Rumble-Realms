import { START_DECK } from '../game/config.ts';
import { describe, expect, it } from 'vitest';
import type { StateStorage } from 'zustand/middleware';
import { createLocalBackend, secureRandInt } from './local.ts';

function memoryStorage(): StateStorage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

describe('secureRandInt', () => {
  it('stays in range and covers all values', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 300; i++) {
      const x = secureRandInt(5);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(5);
      seen.add(x);
    }
    expect(seen.size).toBe(5);
    expect(secureRandInt(1)).toBe(0);
  });
});

describe('local backend', () => {
  it('has no user before sign-in and offers guest only', async () => {
    const b = createLocalBackend(memoryStorage());
    expect(b.mode).toBe('local');
    expect(b.authMethods).toEqual({ guest: true, google: false, email: false });
    expect(await b.getUser()).toBeNull();
  });

  it('a new guest has the start collection and start deck', async () => {
    const b = createLocalBackend(memoryStorage());
    const user = await b.signInAsGuest();
    expect(user.isGuest).toBe(true);
    const p = await b.loadPlayer();
    expect(p.username).toBeNull();
    expect(p.deck).toEqual(START_DECK);
    for (const card of START_DECK) expect(p.cards[card]?.level).toBe(1);
    expect(p.packs).toEqual([]);
  });

  it('username -> welcome pack -> opening it gives a musketeer', async () => {
    const b = createLocalBackend(memoryStorage());
    await b.signInAsGuest();
    const named = await b.call('set_username', { username: 'Anna_1' });
    expect(named.ok).toBe(true);
    const p = await b.loadPlayer();
    expect(p.username).toBe('Anna_1');
    expect(p.packs).toHaveLength(1);
    expect(p.packs[0]?.kind).toBe('welcome');
    const opened = await b.call('open_pack', { packId: p.packs[0]?.id ?? '' });
    expect(opened.ok).toBe(true);
    const after = await b.loadPlayer();
    expect(after.packs).toEqual([]);
    expect(after.cards.musketeer).toBeDefined();
  });

  it('survives a reload on the same storage; signOut keeps the progress', async () => {
    const storage = memoryStorage();
    const first = createLocalBackend(storage);
    const user = await first.signInAsGuest();
    await first.call('set_username', { username: 'Anna' });

    const second = createLocalBackend(storage);
    expect(await second.getUser()).toEqual(user);
    expect((await second.loadPlayer()).username).toBe('Anna');

    await second.signOut();
    expect(await second.getUser()).toBeNull();
    const third = createLocalBackend(storage);
    expect(await third.getUser()).toBeNull();
    expect(await third.signInAsGuest()).toEqual(user);
    expect((await third.loadPlayer()).username).toBe('Anna');
  });

  it('calls without a session are unauthorized; listeners hear sign-in and sign-out', async () => {
    const b = createLocalBackend(memoryStorage());
    expect(await b.call('open_pack', { packId: 'x' })).toEqual({
      ok: false,
      error: { code: 'unauthorized' },
    });
    const events: (string | null)[] = [];
    const off = b.onAuthChange((u) => events.push(u?.id ?? null));
    const user = await b.signInAsGuest();
    await b.signOut();
    off();
    await b.signInAsGuest();
    expect(events).toEqual([user.id, null]);
  });
});
