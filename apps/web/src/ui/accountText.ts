import type { ApiErrorCode, ApiResponse } from '@rumble-realms/shared';
import { t, type MessageKey } from '../i18n/index.ts';

export type UiErrorCode = ApiErrorCode | 'unavailable';

const ERROR_KEYS: Partial<Record<UiErrorCode, MessageKey>> = {
  username_taken: 'error.username_taken',
  username_blocked: 'error.username_blocked',
  username_invalid: 'error.username_invalid',
  username_locked: 'error.username_locked',
  unavailable: 'error.unavailable',
};

/** Plain-language text for an error code; unknown codes get the generic text. */
export function errorText(code: UiErrorCode): string {
  return t(ERROR_KEYS[code] ?? 'error.generic');
}

/**
 * The error of an account-store API result as shown to the player, or null on success.
 * The store reports "no connection" as `internal` with the detail `unavailable`.
 */
export function uiErrorOf(res: ApiResponse<unknown>): UiErrorCode | null {
  if (res.ok) return null;
  return res.error.detail === 'unavailable' ? 'unavailable' : res.error.code;
}
