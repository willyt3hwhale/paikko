/**
 * CORS for the paikko backend API.
 *
 * The backend is now a standalone deployable; the consumer apps that mount the
 * report widget (e.g. examples/calculator) POST their reports here from a
 * DIFFERENT origin. The browser therefore preflights and enforces CORS on every
 * cross-origin call - both the report intake and the review/runner endpoints the
 * UI hits. This module centralises the (dev-permissive) CORS policy so every
 * route applies the same headers.
 *
 * Policy: allow the methods the API uses, allow the paikko capture headers the
 * widget sends (x-paikko-session, x-paikko-trace, x-paikko-project) plus
 * content-type, and decide the allowed Origin from `PAIKKO_ALLOWED_ORIGINS`:
 *
 *   - UNSET or "*"  -> permissive: reflect ANY request Origin (or "*" when there
 *                      is none). This is the zero-config dev default, so the
 *                      calculator on http://localhost:3000 keeps working without
 *                      touching the env.
 *   - comma list    -> allowlist: reflect the request Origin only when it is in
 *                      the list; otherwise emit no Allow-Origin header so the
 *                      browser blocks the cross-origin response. Lock prod down
 *                      here, e.g. `PAIKKO_ALLOWED_ORIGINS=https://app.example.com`.
 *
 * Origins are reflected (not a bare "*") so credentialed cross-origin calls work.
 */

import { NextResponse } from "next/server";
import type { CapturableRequest } from "./withCapture";

/** Methods the API surface exposes across the routes. */
const ALLOW_METHODS = "GET,POST,PATCH,OPTIONS";

/**
 * Request headers a cross-origin caller may send. Lower-cased; the browser
 * matches case-insensitively. Includes the paikko capture spine headers so the
 * widget's instrumented fetch is not blocked by preflight.
 */
const ALLOW_HEADERS = "content-type, x-paikko-session, x-paikko-trace, x-paikko-project";

/**
 * Env var holding the CORS allowlist: a comma-separated list of exact origins
 * (e.g. "https://app.example.com,https://admin.example.com"). UNSET or "*" means
 * permissive (reflect any origin) - the zero-config dev default. Documented in
 * `.env.example`.
 */
const ALLOWED_ORIGINS_ENV = "PAIKKO_ALLOWED_ORIGINS";

/**
 * Parse the configured allowlist. Returns:
 *   - `null` -> permissive mode (env unset/empty or contains a bare "*").
 *   - a Set of exact origins -> allowlist mode.
 *
 * Read from `process.env` on each call so a config change is picked up on the
 * next request (Workers/next dev re-evaluate env per invocation; no caching that
 * could pin a stale allowlist).
 */
function parseAllowlist(): Set<string> | null {
  const raw = process.env[ALLOWED_ORIGINS_ENV];
  if (!raw || raw.trim().length === 0) return null; // unset -> permissive
  const entries = raw
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  if (entries.length === 0 || entries.includes("*")) return null; // "*" -> permissive
  return new Set(entries);
}

/**
 * Resolve the `Access-Control-Allow-Origin` value for a request, or `null` when
 * the origin is not allowed (so the caller emits no Allow-Origin header and the
 * browser blocks the response).
 *
 *   - permissive (allowlist null): reflect the Origin, or "*" when absent.
 *   - allowlist: reflect the Origin only if it is listed; else `null`.
 */
function allowOrigin(origin: string | null): string | null {
  const allowlist = parseAllowlist();
  if (allowlist === null) {
    return origin && origin.length > 0 ? origin : "*";
  }
  return origin && allowlist.has(origin) ? origin : null;
}

/**
 * Apply the CORS response headers to a response, reflecting the request's Origin
 * when it is permitted by the `PAIKKO_ALLOWED_ORIGINS` policy. Returns the same
 * response for chaining. Call this on every response a cross-origin route returns
 * so the browser accepts it. A disallowed origin simply gets no Allow-Origin
 * header (the browser then blocks the cross-origin read).
 */
export function withCors<R extends Response>(response: R, origin: string | null): R {
  const allowed = allowOrigin(origin);
  if (allowed !== null) {
    response.headers.set("Access-Control-Allow-Origin", allowed);
  }
  response.headers.set("Access-Control-Allow-Methods", ALLOW_METHODS);
  response.headers.set("Access-Control-Allow-Headers", ALLOW_HEADERS);
  response.headers.set("Access-Control-Max-Age", "86400");
  // Caches must vary on Origin since the allowed value depends on it.
  response.headers.set("Vary", "Origin");
  return response;
}

/**
 * The bare CORS preflight handler: 204 + CORS headers reflecting the request
 * Origin. Exported as a plain handler (NOT pre-wrapped) so each route wraps it in
 * the mandated `withCapture(...)` seam directly - the seam-guard requires every
 * exported HTTP method handler's value to be a literal `withCapture(...)` call, so
 * a factory that hides the wrap would trip it. Usage in a route:
 *
 *   export const OPTIONS = withCapture(corsPreflight, {
 *     handler: "OPTIONS /api/reports",
 *   });
 */
export async function corsPreflight(
  req: CapturableRequest,
): Promise<NextResponse> {
  const res = new NextResponse(null, { status: 204 });
  return withCors(res, req.headers.get("origin"));
}
