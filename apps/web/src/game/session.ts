/**
 * Local match against a bot (D-034 ff.). Implements `GameSession` on top of the engine.
 *
 * Everything that takes time runs through `advance(dtMs)` (D-035): no timers, no clock reads.
 * All randomness comes from the options (seeds), so a session is fully reproducible.
 */
import {
  applyPick,
  createMatch,
  currentPlayer,
  endRound,
  getOffer,
  picksRemaining,
  simulateToEnd,
  startBattle,
  stepTick,
  type BattleEvent,
  type BattleState,
  type MatchState,
  type PlayerConfig,
  type RoundOutcome,
} from '@rumble-realms/engine';
import {
  BOT,
  botProfileOf,
  HUMAN,
  matchConfigOf,
  nextBotPick,
  type MatchTicket,
} from '@rumble-realms/shared';
import { BOT_THINK_MS, INTRO_MS, MAX_FRAME_MS, ROUND_END_MS, TICK_MS } from './config.ts';
import type {
  BattleSpeed,
  FrameInfo,
  GameSession,
  PlayerInfo,
  SessionPhase,
  SessionSnapshot,
} from './types.ts';

export interface LocalSessionOptions {
  /** The server's ticket: seed, bot profile and the snapshot of the human's deck (D-084). */
  ticket: MatchTicket;
  /** Name of the human player. The UI shows its own i18n text if this is empty. */
  playerName: string;
  /**
   * Picks already made (resume): replayed at once, without waiting times and without display.
   * Invalid picks are ignored and the match starts from the beginning.
   */
  picks?: readonly number[];
  /** Called after every pick (human and bot) with all picks of the match so far. */
  onPick?: (picks: readonly number[]) => void;
}

/** The session plus access to the engine state, for tests (not part of the contract). */
export interface LocalSessionHandle {
  session: GameSession;
  match: MatchState;
}

/** At most this many ticks per `advance` call; the rest of the time is dropped. */
const MAX_TICKS_PER_FRAME = 10;

function infoOf(name: string, isBot: boolean, config: PlayerConfig): PlayerInfo {
  return {
    name,
    isBot,
    deck: [...config.deck],
    levels: { ...config.levels },
    upgrades: { ...(config.upgrades ?? {}) },
  };
}

/**
 * Plays `picks` into `match` without display. A battle that follows a pick is calculated to
 * the end, except after the last pick (it is then shown). Returns false if a pick is invalid.
 */
function replayPicks(match: MatchState, picks: readonly number[]): boolean {
  try {
    for (const [i, slot] of picks.entries()) {
      if ((match.phase as string) !== 'draft') return false;
      if (!Number.isInteger(slot) || slot < 0 || slot >= getOffer(match).slots.length) return false;
      applyPick(match, slot);
      if (i < picks.length - 1 && match.phase === 'battle') {
        simulateToEnd(startBattle(match));
        endRound(match);
      }
    }
    return true;
  } catch {
    return false;
  }
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
  const ticket = options.ticket;
  const config = matchConfigOf(ticket);
  if (config === null) {
    throw new Error(
      `createLocalSession: the ticket names an unknown bot profile (${String(ticket.botProfile)}, level ${String(ticket.botLevel)})`,
    );
  }
  const profile = botProfileOf(ticket.botProfile);
  const humanConfig = config.players[HUMAN];
  const botConfig = config.players[BOT];
  if (profile === null) throw new Error('createLocalSession: unknown bot profile');
  const players: [PlayerInfo, PlayerInfo] = [
    infoOf(options.playerName, false, humanConfig),
    infoOf(profile.name, true, botConfig),
  ];
  let match: MatchState = createMatch(config);
  const saved = options.picks ?? [];
  if (saved.length > 0 && !replayPicks(match, saved)) {
    // Unusable saved picks: start over instead of crashing.
    match = createMatch(config);
  }
  const events: BattleEvent[] = [];

  let phase: SessionPhase =
    match.phase === 'finished' ? 'finished' : match.phase === 'battle' ? 'intro' : 'draft';
  let speed: BattleSpeed = 1;
  let roundResult: RoundOutcome | null =
    match.phase === 'finished' ? (match.rounds[match.rounds.length - 1] ?? null) : null;
  /** Time spent in the current stage: bot thinking, intro or round end pause. */
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
      lastPick: last === null ? null : { ...last, spawned: [...last.spawned] },
      roundResult,
      winner: match.winner,
      speed,
      activeUpgrades: [{ ...match.activeUpgrades[0] }, { ...match.activeUpgrades[1] }],
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
    timerMs = 0;
    if (match.phase === 'battle') phase = 'intro';
    options.onPick?.([...match.picks]);
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
    get picks(): readonly number[] {
      return [...match.picks];
    },

    play(slot) {
      if (!humanTurn() || !validSlot(slot)) return;
      playSlot(slot);
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
            playSlot(nextBotPick(match, ticket));
            changed = true;
          }
          break;
        }
        case 'intro': {
          timerMs += dt;
          if (timerMs >= INTRO_MS) {
            phase = 'battle';
            timerMs = 0;
            tickAccMs = 0;
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
  return {
    session,
    get match() {
      return match;
    },
  };
}

export function createLocalSession(options: LocalSessionOptions): GameSession {
  return createLocalSessionHandle(options).session;
}
