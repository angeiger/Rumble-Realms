/** App state outside React: current screen, the running game session and its report. */
import type { ApiErrorCode, ApiResponseOf } from '@rumble-realms/shared';
import { create } from 'zustand';
import { useAccountStore } from './accountStore.ts';
import { useBotStore } from './botStore.ts';
import { clearPendingMatch, loadPendingMatch, savePendingMatch } from './pendingMatch.ts';
import { createLocalSession } from './session.ts';
import type { BattleSpeed, GameSession, SessionSnapshot } from './types.ts';

export type Screen = 'menu' | 'battle';
/** Tab of the menu screens (outside the battle). */
export type Tab = 'deck' | 'battle' | 'profile';

export type StartError = ApiErrorCode | 'unavailable';

export interface MatchReport {
  state: 'idle' | 'sending' | 'done' | 'failed';
  /** state 'done': the server's booking. */
  result: ApiResponseOf<'report_match'> | null;
  /** state 'failed'. */
  error: StartError | null;
  /** state 'failed': the server's detail, e.g. the reason of `match_rejected`. */
  detail?: string;
}

export interface GameStore {
  screen: Screen;
  tab: Tab;
  session: GameSession | null;
  snapshot: SessionSnapshot | null;
  /** `create_match` is running. */
  starting: boolean;
  /** The last failure to start a match; cleared by the next start. */
  startError: StartError | null;
  report: MatchReport;
  /**
   * Asks the server for a ticket and opens the battle. `pending` says what to do with an
   * unfinished match: 'resume' (default) or 'forfeit' (counts as a loss).
   */
  startMatch: (pending?: 'resume' | 'forfeit') => Promise<void>;
  /** Reports the finished match again after it failed (no network). */
  retryReport: () => Promise<void>;
  play: (slot: number) => void;
  setTab: (tab: Tab) => void;
  setSpeed: (speed: BattleSpeed) => void;
  /** Leaves the battle. An unfinished match stays open (on the server and in the browser). */
  backToMenu: () => void;
}

/**
 * The server will never accept this report: the match is over. It may have been booked anyway
 * (`match_rejected` for a broken report counts as a loss, D-084), so the profile is read again.
 */
const FINAL_REJECTIONS: readonly (ApiErrorCode | 'unavailable')[] = [
  'match_rejected',
  'engine_mismatch',
  'match_not_found',
];

const IDLE_REPORT: MatchReport = { state: 'idle', result: null, error: null };

let unsubscribe: (() => void) | null = null;

function detach(): void {
  if (unsubscribe !== null) unsubscribe();
  unsubscribe = null;
}

/** Maps a failed API response to what the UI distinguishes ("no network" vs. a code). */
function errorOf(error: { code: ApiErrorCode; detail?: string }): StartError {
  return error.detail === 'unavailable' ? 'unavailable' : error.code;
}

export const useGameStore = create<GameStore>()((set, get) => {
  /** Matches whose report is running right now; prevents double reports. */
  const reporting = new Set<string>();
  /** The match of the current session. */
  let currentMatchId: string | null = null;

  async function sendReport(session: GameSession, matchId: string): Promise<void> {
    if (reporting.has(matchId)) return;
    reporting.add(matchId);
    set({ report: { state: 'sending', result: null, error: null } });
    try {
      const res = await useAccountStore.getState().reportMatch(matchId, [...session.picks]);
      if (res.ok) {
        clearPendingMatch();
        if (get().session === session) {
          set({ report: { state: 'done', result: res.data, error: null } });
        }
        return;
      }
      const error = errorOf(res.error);
      if (FINAL_REJECTIONS.includes(error)) {
        clearPendingMatch();
        // Elo, games and the open match changed on the server; a failed call does not reload.
        await useAccountStore.getState().refresh();
      }
      if (get().session === session) {
        const detail = error === 'unavailable' ? undefined : res.error.detail;
        set({
          report: {
            state: 'failed',
            result: null,
            error,
            ...(detail === undefined ? {} : { detail }),
          },
        });
      }
    } finally {
      reporting.delete(matchId);
    }
  }

  /** Watches the session: copies the snapshot and reports the match when it is finished. */
  function follow(session: GameSession, matchId: string): void {
    let reported = false;
    unsubscribe = session.subscribe(() => {
      if (get().session !== session) return;
      const snapshot = session.getSnapshot();
      set({ snapshot });
      if (snapshot.phase === 'finished' && !reported) {
        reported = true;
        void sendReport(session, matchId);
      }
    });
  }

  return {
    screen: 'menu',
    tab: 'battle',
    session: null,
    snapshot: null,
    starting: false,
    startError: null,
    report: IDLE_REPORT,

    async startMatch(pending) {
      if (get().starting || get().report.state === 'sending') return;
      set({ starting: true, startError: null });
      let res: Awaited<ReturnType<ReturnType<typeof useAccountStore.getState>['createMatch']>>;
      try {
        res = await useAccountStore.getState().createMatch(useBotStore.getState().level, pending);
      } catch {
        set({ starting: false, startError: 'unavailable' });
        return;
      }
      if (!res.ok) {
        set({ starting: false, startError: errorOf(res.error) });
        return;
      }
      const { ticket, resumed } = res.data;
      const picks = resumed ? (loadPendingMatch(ticket.matchId) ?? []) : [];
      savePendingMatch(ticket, picks);
      let session: GameSession;
      try {
        session = createLocalSession({
          ticket,
          playerName: useAccountStore.getState().player?.username ?? '',
          picks,
          onPick: (all) => savePendingMatch(ticket, all),
        });
      } catch {
        set({ starting: false, startError: 'internal' });
        return;
      }
      detach();
      currentMatchId = ticket.matchId;
      follow(session, ticket.matchId);
      const snapshot = session.getSnapshot();
      set({
        screen: 'battle',
        session,
        snapshot,
        starting: false,
        report: IDLE_REPORT,
      });
      if (snapshot.phase === 'finished') {
        // Resumed into a match that was already over (nothing left to play).
        void sendReport(session, ticket.matchId);
      }
    },

    async retryReport() {
      const { session, report } = get();
      if (session === null || currentMatchId === null || report.state !== 'failed') return;
      if (session.getSnapshot().phase !== 'finished') return;
      await sendReport(session, currentMatchId);
    },

    play: (slot) => get().session?.play(slot),
    setTab: (tab) => set({ tab }),
    setSpeed: (speed) => get().session?.setSpeed(speed),
    backToMenu() {
      detach();
      set({
        screen: 'menu',
        tab: 'battle',
        session: null,
        snapshot: null,
        startError: null,
        report: IDLE_REPORT,
      });
    },
  };
});

declare global {
  interface Window {
    /** Development only: the store for scripted browser checks (screenshots, E2E). */
    __rr?: typeof useGameStore;
  }
}

if (import.meta.env.DEV && typeof window !== 'undefined') window.__rr = useGameStore;
