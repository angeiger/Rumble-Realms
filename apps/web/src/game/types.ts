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

/**
 * `intro`: short transition (smoke over the field, D-045) between the last pick and the battle;
 * `roundEnd`: result banner before the next draft.
 * Order: draft, intro, battle, roundEnd, then draft again or finished.
 */
export type SessionPhase = 'draft' | 'intro' | 'battle' | 'roundEnd' | 'finished';

export type BattleSpeed = 1 | 2;

export interface PlayerInfo {
  name: string;
  isBot: boolean;
  deck: CardId[];
  /** Card levels, same meaning as in the engine config. */
  levels: Partial<Record<CardId, number>>;
  /** Unlocked upgrades per card, bit mask 0..7 (bit i = upgrade i). Missing = none. */
  upgrades: Partial<Record<CardId, number>>;
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
  /** The most recent pick of this round (either player), for "X plays Y" hints. */
  lastPick: PickInfo | null;
  /** roundEnd and finished: the round that just ended. */
  roundResult: RoundOutcome | null;
  /** finished only. */
  winner: Winner | null;
  speed: BattleSpeed;
  /**
   * Upgrades activated so far in this match per player (bit masks per card, bit i = upgrade i),
   * for the symbols next to the lives (SPEC 4.5). Indexed by PlayerIndex.
   */
  activeUpgrades: [Partial<Record<CardId, number>>, Partial<Record<CardId, number>>];
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
   * Plays slot `slot` of the offer at once (D-044). Has no effect unless it is the local
   * player's turn and the slot exists.
   */
  play(slot: number): void;
  setSpeed(speed: BattleSpeed): void;

  /**
   * The only clock of the session: advances bot thinking time, the intro, battle ticks
   * and the round end pause by `dtMs` of real time. Called once per rendered frame.
   */
  advance(dtMs: number): FrameInfo;
}
