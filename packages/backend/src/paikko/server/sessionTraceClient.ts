/**
 * Trace-buffer client used by the capture seam.
 *
 * Route/handler code never talks to the buffer directly - it goes through
 * {@link withCapture} (append on request finish) and the reports route (drain at
 * report time), which call the two helpers here. The function names are kept
 * (`appendToSessionDO`/`drainSessionDO`) so the callers don't change, but the
 * implementation now routes to the D1-backed store (`sessionTraceD1.ts`).
 *
 * ## Why D1 instead of the Durable Object
 *
 * The buffer used to live in the `SessionTrace` Durable Object
 * (`sessionTraceDO.ts`), which solved the cross-isolate problem on Cloudflare
 * Workers. But app-defined Durable Objects do NOT run under local `next dev` ("no
 * such actor class; SessionTrace"), so the `trace` artifact was always absent in
 * local development. D1 is available in EVERY environment - local `next dev` and
 * Workers prod alike - so backing the buffer with a D1 table makes trace populate
 * everywhere with no env-specific branching.
 *
 * The DO implementation is left in the repo (`sessionTraceDO.ts`) as a legacy
 * reference but is no longer wired in; nothing imports it for buffering anymore.
 *
 * Everything here is best-effort and non-throwing on the append path: capture must
 * never break the actual request. A failed append just means a (rare) missing
 * trace, which the report side already tolerates (it degrades to "no trace").
 */

import type { TraceArtifact, TraceRequest } from "@paikko/contract";
import { appendTraceEntry, drainTraceEntries } from "./sessionTraceD1";

/**
 * Append a finished {@link TraceRequest} to its session's buffer. Best-effort:
 * the underlying D1 store swallows errors so a capture hiccup never fails the
 * underlying request.
 */
export async function appendToSessionDO(
  sessionId: string,
  request: TraceRequest,
): Promise<void> {
  await appendTraceEntry(sessionId, request);
}

/**
 * Drain a session's buffered requests and shape them as a {@link TraceArtifact}.
 * Returns null if the session captured nothing OR if the store is unavailable -
 * a missing trace must never 500 the report intake.
 */
export async function drainSessionDO(
  sessionId: string,
): Promise<TraceArtifact | null> {
  return drainTraceEntries(sessionId);
}
