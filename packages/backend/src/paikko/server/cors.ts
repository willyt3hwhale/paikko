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
 * Policy (dev): reflect the request's Origin (so credentials/headers work without
 * a wildcard), allow the methods the API uses, and allow the paikko capture
 * headers the widget sends (x-paikko-session, x-paikko-trace, x-paikko-project)
 * plus content-type. Tighten the allowed origin to a configured allowlist before
 * a real multi-tenant deployment.
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
 * Reflect the caller's Origin so credentialed/cross-origin requests work without a
 * bare `*` (which forbids credentials). Falls back to `*` when there is no Origin
 * header (e.g. same-origin or a non-browser client).
 */
function allowOrigin(origin: string | null): string {
  return origin && origin.length > 0 ? origin : "*";
}

/**
 * Apply the CORS response headers to a response, reflecting the request's Origin.
 * Returns the same response for chaining. Call this on every response a
 * cross-origin route returns so the browser accepts it.
 */
export function withCors<R extends Response>(response: R, origin: string | null): R {
  response.headers.set("Access-Control-Allow-Origin", allowOrigin(origin));
  response.headers.set("Access-Control-Allow-Methods", ALLOW_METHODS);
  response.headers.set("Access-Control-Allow-Headers", ALLOW_HEADERS);
  response.headers.set("Access-Control-Max-Age", "86400");
  // Caches must vary on Origin since we reflect it.
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
