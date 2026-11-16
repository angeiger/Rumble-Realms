/**
 * The request handler of the Edge Function `api` (protocol.ts, D-082), independent of Deno and
 * of supabase-js: authentication, store and environment come in as dependencies.
 *
 *   OPTIONS              -> 204 with CORS headers (no token needed)
 *   not POST             -> 405 bad_request
 *   no or invalid token  -> 401 unauthorized
 *   body not JSON/16 kB  -> 200 bad_request
 *   otherwise            -> 200 with the answer of handleApiBody, except code `internal` -> 500
 *   any exception        -> 500 internal (logged without token, key or personal data)
 */
import { handleApiBody } from '../_shared/packages/shared/src/index.ts';
import type { ApiResponse, ServerEnv, Store } from '../_shared/packages/shared/src/index.ts';
import { bearerToken, jsonResponse, preflightResponse, readJsonBody } from './http.ts';

export interface ApiHandlerDeps {
  /**
   * The account id of a valid access token, or null if the token is invalid or expired.
   * Throws if the check itself failed (network, auth server down): that is answered with 500.
   */
  authenticate(token: string): Promise<string | null>;
  store: Store;
  env: ServerEnv;
  /** Error log (default console.error). Gets only the account id, the action and the error. */
  logError?: (message: string) => void;
}

function failure(code: 'unauthorized' | 'bad_request' | 'internal'): ApiResponse<never> {
  return { ok: false, error: { code } };
}

/** The action name of a body for the log, only if it is a short plain word. */
function actionOf(body: unknown): string {
  if (body !== null && typeof body === 'object' && !Array.isArray(body)) {
    const action = (body as Record<string, unknown>)['action'];
    if (typeof action === 'string' && /^[a-z_]{1,32}$/.test(action)) return action;
  }
  return '?';
}

function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return 'non-error exception';
}

export function createApiHandler(deps: ApiHandlerDeps): (req: Request) => Promise<Response> {
  const logError = deps.logError ?? ((message: string) => console.error(message));

  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return preflightResponse();
    if (req.method !== 'POST') {
      return jsonResponse(405, failure('bad_request'), { Allow: 'POST, OPTIONS' });
    }

    let user: string | null = null;
    let action = '?';
    try {
      const token = bearerToken(req);
      if (token !== null) user = await deps.authenticate(token);
      if (user === null) return jsonResponse(401, failure('unauthorized'));

      const body = await readJsonBody(req);
      if (!body.ok) return jsonResponse(200, failure('bad_request'));
      action = actionOf(body.value);

      const answer = await handleApiBody(deps.store, deps.env, user, body.value);
      if (!answer.ok && answer.error.code === 'internal') {
        // An unexpected store error the handlers caught themselves: same status as an exception.
        logError(
          `api: internal error (user ${user}, action ${action}): ${answer.error.detail ?? ''}`,
        );
        return jsonResponse(500, answer);
      }
      return jsonResponse(200, answer);
    } catch (error) {
      logError(`api: internal error (user ${user ?? '-'}, action ${action}): ${describe(error)}`);
      return jsonResponse(500, failure('internal'));
    }
  };
}
