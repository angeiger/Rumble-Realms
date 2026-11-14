/**
 * Local match against a bot (D-034 ff.). Implements `GameSession` on top of the engine.
 *
 * Everything that takes time runs through `advance(dtMs)` (D-035): no timers, no clock reads.
 * All randomness comes from the options (seeds), so a session is fully reproducible.
 */
import {
  applyPick,
  chooseBotPick,
  BOT_LEVELS,
  createMatch,
  currentPlayer,
  endRound,
  getOffer,
  picksRemaining,
  seedRng,
  STREAM_BOT,
  stepTick,
  type BattleEvent,
  type BattleState,
  type BotProfile,
  type CardId,
  type MatchState,
  type PlayerIndex,
  type RoundOutcome,
  type RngState,
} from '@rumble-realms/engine';
import {
  BOT_THINK_MS,
  COUNTDOWN_STEP_MS,
  MAX_FRAME_MS,
  ROUND_END_MS,
  START_DECK,
  TICK_MS,
} from './config.ts';
import type {
  BattleSpeed,
  FrameInfo,
  GameSession,
  PlayerInfo,
  SessionPhase,
  SessionSnapshot,
} from './types.ts';

export interface LocalSessionOptions {
  /** Match seed (non-negative safe integer). */
  seed: number;
  /** Seed of the bot's decisions; defaults to `seed`. */
  botSeed?: number;
  bot: BotProfile;
  /** Name of the human player. The UI shows its own i18n text if this is empty. */
  playerName: string;
  /** Defaults to `START_DECK`. All cards have level 1. */
  playerDeck?: CardId[];
}

/** The session plus access to the engine state, for tests (not part of the contract). */
export interface LocalSessionHandle {
  session: GameSession;
  match: MatchState;
}

/** At most this many ticks per `advance` call; the rest of the time is dropped. */
const MAX_TICKS_PER_FRAME = 10;
const HUMAN: PlayerIndex = 0;
const BOT: PlayerIndex = 1;

function levelsOf(deck: readonly CardId[], level: number): Partial<Record<CardId, number>> {
  const levels: Partial<Record<CardId, number>> = {};
  for (const card of deck) levels[card] = level;
  return levels;
}

/** Lives after the finished battle, computed like `endRound` does (shown during `roundEnd`). */
function outcomeOf(match: MatchState): RoundOutcome {
  const result = match.battle.result;
  if (result === null) throw new Error('outcomeOf: the battle has no result yet');
  const lives: [number, number] = [match.lives[0], match.lives[1]];
  if (result.winner === 'draw') {
    lives[0]--;
    lives[1]--;
  } else {
    lives[result.winner === 0 ? 1 : 0]--;
  }
  lives[0] = Math.max(0, lives[0]);
  lives[1] = Math.max(0, lives[1]);
  return {
    round: match.round,
    result: { ...result, hp: [result.hp[0], result.hp[1]] },
    lives,
  };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/** Like `createLocalSession`, but also returns the engine state (for tests). */
export function createLocalSessionHandle(options: LocalSessionOptions): LocalSessionHandle {
  const playerDeck = [...(options.playerDeck ?? START_DECK)];
  const botDeck = [...options.bot.deck];
  const botLevel = BOT_LEVELS[options.bot.level];
  const players: [PlayerInfo, PlayerInfo] = [
    {
      name: options.playerName,
      isBot: false,
      deck: playerDeck,
      levels: levelsOf(playerDeck, 1),
    },
    {
      name: options.bot.name,
      isBot: true,
      deck: botDeck,
      levels: levelsOf(botDeck, botLevel.cardLevel),
    },
  ];
  const match = createMatch({
    seed: options.seed,
    players: [
      { deck: playerDeck, levels: { ...players[0].levels } },
      { deck: botDeck, levels: { ...players[1].levels } },
    ],
  });
  const botRng: RngState = seedRng(options.botSeed ?? options.seed, STREAM_BOT);
  const events: BattleEvent[] = [];

  let phase: SessionPhase = 'draft';
  let speed: BattleSpeed = 1;
  let selectedSlot: number | null = null;
  let countdown: number | null = null;
  let roundResult: RoundOutcome | null = null;
  /** Time spent in the current stage: bot thinking, countdown step or round end pause. */
  let timerMs = 0;
  /** Real time (times speed) not yet turned into ticks. */
  let tickAccMs = 0;

  let snapshot: SessionSnapshot;
  const listeners = new Set<() => void>();

  function buildSnapshot(): SessionSnapshot {
    const inDraft = phase === 'draft';
    const turn = inDraft ? currentPlayer(match) : null;
    const offer =
      inDraft && turn === HUMAN ? getOffer(match).slots.map((slot) => ({ ...slot })) : null;
    const last = match.lastPick;
    const lives: [number, number] =
      phase === 'roundEnd' && roundResult !== null
        ? [roundResult.lives[0], roundResult.lives[1]]
        : [match.lives[0], match.lives[1]];
    const snap: SessionSnapshot = {
      phase,
      round: match.round,
      me: HUMAN,
      players,
      lives,
      turn,
      picksLeft: inDraft ? [picksRemaining(match, 0), picksRemaining(match, 1)] : [0, 0],
      offer,
      selectedSlot: offer === null ? null : selectedSlot,
      lastPick: last === null ? null : { ...last, spawned: [...last.spawned] },
      countdown,
      roundResult,
      winner: match.winner,
      speed,
    };
    return deepFreeze(snap);
  }

  /** Replaces the snapshot and notifies the listeners. */
  function publish(): void {
    snapshot = buildSnapshot();
    for (const listener of [...listeners]) listener();
  }

  function playSlot(slot: number): void {
    applyPick(match, slot);
    selectedSlot = null;
    timerMs = 0;
    if (match.phase === 'battle') {
      phase = 'countdown';
      countdown = 3;
    }
  }

  function humanTurn(): boolean {
    return phase === 'draft' && currentPlayer(match) === HUMAN;
  }

  function validSlot(slot: number): boolean {
    return Number.isInteger(slot) && slot >= 0 && slot < getOffer(match).slots.length;
  }

  const session: GameSession = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get battle(): BattleState {
      return match.battle;
    },

    select(slot) {
      if (!humanTurn() || !validSlot(slot)) return;
      if (selectedSlot === slot) {
        playSlot(slot);
      } else {
        selectedSlot = slot;
      }
      publish();
    },
    confirm() {
      if (!humanTurn() || selectedSlot === null) return;
      playSlot(selectedSlot);
      publish();
    },
    setSpeed(next) {
      if ((next !== 1 && next !== 2) || next === speed) return;
      speed = next;
      publish();
    },

    advance(rawDt) {
      const dt = Number.isFinite(rawDt) && rawDt > 0 ? Math.min(rawDt, MAX_FRAME_MS) : 0;
      events.length = 0;
      const frame: FrameInfo = { events, ticks: 0, alpha: 0, fieldReset: false };
      let changed = false;

      switch (phase) {
        case 'draft': {
          if (currentPlayer(match) !== BOT) break;
          timerMs += dt;
          if (timerMs >= BOT_THINK_MS) {
            playSlot(chooseBotPick(match, options.bot.level, botRng));
            changed = true;
          }
          break;
        }
        case 'countdown': {
          timerMs += dt;
          if (timerMs >= COUNTDOWN_STEP_MS) {
            timerMs -= COUNTDOWN_STEP_MS;
            if (countdown === 0 || countdown === null) {
              phase = 'battle';
              countdown = null;
              timerMs = 0;
              tickAccMs = 0;
            } else {
              countdown--;
            }
            changed = true;
          }
          break;
        }
        case 'battle': {
          tickAccMs += dt * speed;
          const due = Math.floor(tickAccMs / TICK_MS);
          const ticks = Math.min(due, MAX_TICKS_PER_FRAME);
          // Whole ticks are consumed; beyond the cap they are dropped (no catching up).
          tickAccMs -= due * TICK_MS;
          const battle = match.battle;
          for (let i = 0; i < ticks && battle.result === null; i++) {
            stepTick(battle, events);
            frame.ticks++;
          }
          if (battle.result !== null) {
            roundResult = outcomeOf(match);
            phase = 'roundEnd';
            timerMs = 0;
            tickAccMs = 0;
            changed = true;
          } else {
            frame.alpha = tickAccMs / TICK_MS;
          }
          break;
        }
        case 'roundEnd': {
          timerMs += dt;
          if (timerMs >= ROUND_END_MS) {
            endRound(match);
            timerMs = 0;
            if (match.phase === 'finished') {
              phase = 'finished';
            } else {
              phase = 'draft';
              roundResult = null;
              selectedSlot = null;
              frame.fieldReset = true;
            }
            changed = true;
          }
          break;
        }
        case 'finished':
          break;
      }

      if (changed) publish();
      return frame;
    },
  };

  snapshot = buildSnapshot();
  return { session, match };
}

export function createLocalSession(options: LocalSessionOptions): GameSession {
  return createLocalSessionHandle(options).session;
}
