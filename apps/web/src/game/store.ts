/** App state outside React: current screen and the running game session. */
import { BOT_PROFILES } from '@rumble-realms/engine';
import { create } from 'zustand';
import { useBotStore } from './botStore.ts';
import { upgradesOf, useDeckStore } from './deckStore.ts';
import { createLocalSession } from './session.ts';
import type { BattleSpeed, GameSession, SessionSnapshot } from './types.ts';

export type Screen = 'title' | 'battle';
/** Tab of the menu screens (outside the battle). */
export type Tab = 'battle' | 'deck';

export interface GameStore {
  screen: Screen;
  tab: Tab;
  session: GameSession | null;
  snapshot: SessionSnapshot | null;
  startMatch: () => void;
  play: (slot: number) => void;
  setTab: (tab: Tab) => void;
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
  tab: 'battle',
  session: null,
  snapshot: null,

  startMatch() {
    detach();
    const level = useBotStore.getState().level;
    const bots = BOT_PROFILES.filter((p) => p.level === level);
    const bot = bots[randomIndex(bots.length)] ?? (bots[0] as (typeof bots)[number]);
    // The human's name stays empty: the UI shows its own i18n text for "you".
    const { deck, levels, upgrades } = useDeckStore.getState();
    const session = createLocalSession({
      seed: randomSeed(),
      bot,
      playerName: '',
      playerDeck: deck,
      playerLevels: levels,
      playerUpgrades: Object.fromEntries(deck.map((card) => [card, upgradesOf(upgrades, card)])),
    });
    unsubscribe = session.subscribe(() => {
      if (get().session === session) set({ snapshot: session.getSnapshot() });
    });
    set({ screen: 'battle', session, snapshot: session.getSnapshot() });
  },
  play: (slot) => get().session?.play(slot),
  setTab: (tab) => set({ tab }),
  setSpeed: (speed) => get().session?.setSpeed(speed),
  backToTitle() {
    detach();
    set({ screen: 'title', tab: 'battle', session: null, snapshot: null });
  },
}));

declare global {
  interface Window {
    /** Development only: the store for scripted browser checks (screenshots, E2E). */
    __rr?: typeof useGameStore;
  }
}

if (import.meta.env.DEV && typeof window !== 'undefined') window.__rr = useGameStore;
