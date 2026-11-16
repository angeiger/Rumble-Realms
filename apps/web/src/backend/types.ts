/** The one interface between the client and "the server" (real Supabase or local in-browser). */
import type { CardId } from '@rumble-realms/engine';
import type {
  ApiAction,
  ApiRequestOf,
  ApiResponse,
  ApiResponseOf,
  MatchTicket,
  OwnedCard,
} from '@rumble-realms/shared';

export interface AuthUser {
  id: string;
  isGuest: boolean;
  email: string | null;
}

export interface PackInfo {
  id: string;
  kind: 'match' | 'welcome';
}

export interface PlayerState {
  userId: string;
  /** null until chosen during onboarding. */
  username: string | null;
  usernameChanges: number;
  elo: number;
  highestArena: number;
  gold: number;
  jokers: number;
  gamesPlayed: number;
  cards: Partial<Record<CardId, OwnedCard>>;
  deck: CardId[];
  /** Unopened packs only, oldest first. */
  packs: PackInfo[];
  /** The unfinished match (result = 'pending'), else null. */
  pendingMatch: MatchTicket | null;
}

export interface Backend {
  readonly mode: 'supabase' | 'local';
  readonly authMethods: { guest: boolean; google: boolean; email: boolean };
  /** Current session (restored from browser storage) or null. */
  getUser(): Promise<AuthUser | null>;
  onAuthChange(listener: (user: AuthUser | null) => void): () => void;
  signInAsGuest(): Promise<AuthUser>;
  /** Redirects to Google. */
  signInWithGoogle(): Promise<void>;
  /** Sends a magic link. */
  signInWithEmail(email: string): Promise<void>;
  /** Links a guest account to Google (SPEC 9). */
  linkGoogle(): Promise<void>;
  linkEmail(email: string): Promise<void>;
  signOut(): Promise<void>;
  loadPlayer(): Promise<PlayerState>;
  isUsernameFree(name: string): Promise<boolean>;
  call<A extends ApiAction>(
    action: A,
    request: ApiRequestOf<A>,
  ): Promise<ApiResponse<ApiResponseOf<A>>>;
}

/** Network or server failure (no connection, HTTP 5xx, malformed answer). */
export class BackendUnavailableError extends Error {
  override name = 'BackendUnavailableError';
  constructor(message = 'backend unavailable', options?: { cause?: unknown }) {
    super(message, options);
  }
}
