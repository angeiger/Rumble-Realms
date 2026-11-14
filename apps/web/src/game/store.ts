/** App state outside React: current screen and the running game session. */
import { BOT_PROFILES } from '@rumble-realms/engine';
import { create } from 'zustand';
import { createLocalSession } from './session.ts';
import type { BattleSpeed, GameSession, SessionSnapshot } from './types.ts';

export type Screen = 'title' | 'battle';

export interface GameStore {
  screen: Screen;
  session: GameSession | null;
  snapshot: SessionSnapshot | null;
  startMatch: () => void;
  select: (slot: number) => void;
  confirm: () => void;
  setSpeed: (speed: BattleSpeed) => void;
  backToTitle: () => void;
}

const TWO_POW_21 = 2097152;
const TWO_POW_32 = 4294967296;

/** Random seed of 53 bits (a safe integer) from the browser's secure generator. */
function randomSeed(): number {
  const words = new Uint32Array(2);
  crypto.getRandomValues(words);
  return ((words[0] as number) % TWO_POW_21) * TWO_POW_32 + (words[1] as number);
}

/** Random index in [0, n) without modulo bias worth caring about for 3 profiles. */
function randomIndex(n: number): number {
  const word = new Uint32Array(1);
  crypto.getRandomValues(word);
  return Math.floor(((word[0] as number) / TWO_POW_32) * n);
}

let unsubscribe: (() => void) | null = null;

function detach(): void {
  if (unsubscribe !== null) unsubscribe();
  unsubscribe = null;
}

export const useGameStore = create<GameStore>()((set, get) => ({
  screen: 'title',
  session: null,
  snapshot: null,

  startMatch() {
    detach();
    const bots = BOT_PROFILES.filter((p) => p.level === 'easy');
    const bot = bots[randomIndex(bots.length)] ?? (bots[0] as (typeof bots)[number]);
    // The human's name stays empty: the UI shows its own i18n text for "you".
    const session = createLocalSession({ seed: randomSeed(), bot, playerName: '' });
    unsubscribe = session.subscribe(() => {
      if (get().session === session) set({ snapshot: session.getSnapshot() });
    });
    set({ screen: 'battle', session, snapshot: session.getSnapshot() });
  },
  select: (slot) => get().session?.select(slot),
  confirm: () => get().session?.confirm(),
  setSpeed: (speed) => get().session?.setSpeed(speed),
  backToTitle() {
    detach();
    set({ screen: 'title', session: null, snapshot: null });
  },
}));
