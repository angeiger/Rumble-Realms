/** Timing and setup of a local match (presentation only; game rules live in the engine). */
import type { CardId } from '@rumble-realms/engine';

/** One engine tick in real time at speed 1 (20 ticks per second). */
export const TICK_MS = 50;
/** Longest real time one `advance` call may cover, e.g. after the tab was in the background. */
export const MAX_FRAME_MS = 250;
/** Bots pick after about a second, for the feel of a real opponent (SPEC 4.3). */
export const BOT_THINK_MS = 1000;
/** Transition (smoke over the field) between the last pick and the battle (D-045). */
export const INTRO_MS = 900;
/** How long the round result stays on screen before the next draft starts. */
export const ROUND_END_MS = 2500;

/** Start deck of every new player (SPEC 7.1). */
export const START_DECK: CardId[] = ['archer', 'knight', 'skeleton', 'healer'];
