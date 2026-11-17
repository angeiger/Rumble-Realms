/**
 * HTTP details of the Edge Function `api`: CORS, JSON answers, the bearer token and a body
 * reader with a size limit. Pure functions on the web standard Request/Response, no Deno API,
 * so they are easy to test.
 */

/** Largest accepted request body in bytes (a report of 400 picks is about 1.3 kB). */
export const MAX_BODY_BYTES = 16 * 1024;

/**
 * The gateway of Supabase does not add CORS headers to function answers (CLI 3.1 and the
 * hosted platform), so the function sends them itself, on EVERY answer. `*` is fine: the
 * function only trusts the bearer token, never cookies.
 */
export const CORS_HEADERS: Readonly<Record<string, string>> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

/** A JSON answer with the CORS headers. */
export function jsonResponse(status: number, body: unknown, extra?: HeadersInit): Response {
  const headers = new Headers(extra);
  for (const [name, value] of Object.entries(CORS_HEADERS)) headers.set(name, value);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(body), { status, headers });
}

/** The answer to a CORS preflight (no token needed). */
export function preflightResponse(): Response {
  return new Response(null, { status: 204, headers: { ...CORS_HEADERS } });
}

/** The token of `Authorization: Bearer <token>`, or null. */
export function bearerToken(req: Request): string | null {
  const header = req.headers.get('Authorization');
  if (header === null) return null;
  const match = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(header);
  return match?.[1] ?? null;
}

export type BodyResult = { ok: true; value: unknown } | { ok: false };

/**
 * Reads the body as UTF-8 JSON, at most `limit` bytes. Too large, not UTF-8, empty or not
 * JSON: `{ ok: false }`. Stops reading as soon as the limit is passed.
 */
export async function readJsonBody(req: Request, limit = MAX_BODY_BYTES): Promise<BodyResult> {
  const declared = req.headers.get('Content-Length');
  if (declared !== null && !(Number(declared) <= limit)) return { ok: false };
  if (req.body === null) return { ok: false };

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      return { ok: false };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}
