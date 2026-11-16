/** The chosen bot level (D-073), saved in the browser. */
import type { BotLevelId } from '@rumble-realms/engine';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { safeStorage } from './safeStorage.ts';

export const BOT_STORAGE_KEY = 'rr.bot.v1';

/** Selectable levels in display order. */
export const BOT_LEVEL_IDS: readonly BotLevelId[] = ['easy', 'medium', 'hard'];
export const DEFAULT_BOT_LEVEL: BotLevelId = 'easy';

export function isBotLevel(value: unknown): value is BotLevelId {
  return typeof value === 'string' && (BOT_LEVEL_IDS as readonly string[]).includes(value);
}

export interface BotStore {
  level: BotLevelId;
  setLevel: (level: BotLevelId) => void;
}

export const useBotStore = create<BotStore>()(
  persist(
    (set) => ({
      level: DEFAULT_BOT_LEVEL,
      setLevel(level) {
        if (isBotLevel(level)) set({ level });
      },
    }),
    {
      name: BOT_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      partialize: (state) => ({ level: state.level }),
      merge: (persisted, current) => {
        const level = (persisted as { level?: unknown } | null)?.level;
        return { ...current, level: isBotLevel(level) ? level : DEFAULT_BOT_LEVEL };
      },
    },
  ),
);
