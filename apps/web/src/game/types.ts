/**
 * Contract between the three parts of the client (DECISIONS D-034 ff.):
 *
 *   game/    GameSession: runs one local match against a bot on top of the engine
 *   render/  BattleCanvas: draws the field with PixiJS and drives the session clock
 *   ui/      React screens: read the snapshot, call the actions
 *
 * The engine state is mutable. React therefore never reads it directly but gets an
 * immutable SessionSnapshot that is replaced whenever something visible changes.
 * The renderer may read `session.battle` every frame, but must never modify it.
 */
import type {
  BattleEvent,
  BattleState,
  CardId,
  OfferSlot,
  PickInfo,
  PlayerIndex,
  RoundOutcome,
  Winner,
} from '@rumble-realms/engine';

/** `countdown`: "3 - 2 - 1 - Kampf!"; `roundEnd`: result banner before the next draft. */
export type SessionPhase = 'draft' | 'countdown' | 'battle' | 'roundEnd' | 'finished';

export type BattleSpeed = 1 | 2;

export interface PlayerInfo {
  name: string;
  isBot: boolean;
  deck: CardId[];
  /** Card levels, same meaning as in the engine config. */
  levels: Partial<Record<CardId, number>>;
}

export interface SessionSnapshot {
  phase: SessionPhase;
  /** 1-based. */
  round: number;
  /** The local player; shown at the bottom of the field. */
  me: PlayerIndex;
  players: [PlayerInfo, PlayerInfo];
  /** Indexed by PlayerIndex. */
  lives: [number, number];
  /** Draft only: whose pick is due; null otherwise. */
  turn: PlayerIndex | null;
  /** Draft only: picks each player still has in this round. */
  picksLeft: [number, number];
  /** The local player's offer while it is their turn; null otherwise. */
  offer: OfferSlot[] | null;
  /** Highlighted slot of `offer`; null if none. */
  selectedSlot: number | null;
  /** The most recent pick of this round (either player), for "X plays Y" hints. */
  lastPick: PickInfo | null;
  /** Countdown only: 3, 2, 1, then 0 for "Kampf!". */
  countdown: number | null;
  /** roundEnd and finished: the round that just ended. */
  roundResult: RoundOutcome | null;
  /** finished only. */
  winner: Winner | null;
  speed: BattleSpeed;
}

/** What happened during one `advance` call. */
export interface FrameInfo {
  /** Battle events of all ticks simulated in this call. Only valid until the next call. */
  events: readonly BattleEvent[];
  /** Ticks simulated in this call. */
  ticks: number;
  /** Fraction (0..1) of the next tick that has already passed, for interpolation. */
  alpha: number;
  /** True if the field was replaced by an empty one for a new round in this call. */
  fieldReset: boolean;
}

export interface GameSession {
  /** Current snapshot; the same object until something changes. */
  getSnapshot(): SessionSnapshot;
  /** Calls `listener` after every snapshot change. Returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;

  /** The field of the current round. A new object every round. Read-only for callers. */
  readonly battle: BattleState;

  /**
   * Highlights a slot of the offer. Selecting the highlighted slot again plays it
   * (SPEC 4.3). Ignored unless it is the local player's turn.
   */
  select(slot: number): void;
  /** Plays the highlighted slot. Ignored if nothing is highlighted. */
  confirm(): void;
  setSpeed(speed: BattleSpeed): void;

  /**
   * The only clock of the session: advances bot thinking time, countdown, battle ticks
   * and the round end pause by `dtMs` of real time. Called once per rendered frame.
   */
  advance(dtMs: number): FrameInfo;
}
