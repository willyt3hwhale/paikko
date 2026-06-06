/**
 * D1-backed backend-trace buffer - the DEFAULT cross-request trace store.
 *
 * ## Why this exists
 *
 * paikko's capture seam buffers each request's {@link TraceRequest} keyed by
 * `sessionId`, then drains them at report time to build the `trace` artifact. The
 * original buffer was the `SessionTrace` Durable Object (see `sessionTraceDO.ts`),
 * which solved the cross-isolate problem on Cloudflare Workers. But app-defined
 * Durable Objects do NOT run under local `next dev` ("no such actor class;
 * SessionTrace"), so the trace artifact was always absent in local development.
 *
 * D1 is available in every environment - local `next dev` (via the local D1
 * sqlite file) and Workers prod alike - so backing the buffer with a D1 table
 * makes trace populate everywhere. Each finished request is one `TraceEntry` row
 * (payload = JSON-serialized TraceRequest); draining reads all rows for a session
 * in arrival order, deletes them (the trace is consumed once), and shapes them as
 * a {@link TraceArtifact}.
 *
 * Everything here is best-effort and non-throwing: capture must never break the
 * underlying request, and a missing trace must never 500 the report intake. Both
 * entry points swallow errors and degrade to "no trace".
 */

import type { TraceArtifact, TraceRequest } from "@paikko/contract";
import { getPrisma } from "@/lib/db";

/**
 * Append a finished {@link TraceRequest} to its session's D1 buffer. Best-effort:
 * swallows errors so a capture hiccup never fails the underlying request.
 */
export async function appendTraceEntry(
  sessionId: string,
  request: TraceRequest,
): Promise<void> {
  try {
    const prisma = getPrisma();
    await prisma.traceEntry.create({
      data: { sessionId, payload: JSON.stringify(request) },
    });
  } catch {
    // Capture is non-blocking by contract: a lost trace request is acceptable,
    // a failed user request because of capture is not.
  }
}

/**
 * Drain a session's buffered requests from D1 and shape them as a
 * {@link TraceArtifact}. Reads all rows for the session oldest-first, DELETEs them
 * (drain semantics - the trace is consumed once), parses the payloads back into
 * {@link TraceRequest}s, and returns `{ sessionId, requests }`. Returns null if the
 * session captured nothing OR if the store is unavailable - a missing trace must
 * never 500 the report intake that wraps it.
 */
export async function drainTraceEntries(
  sessionId: string,
): Promise<TraceArtifact | null> {
  try {
    const prisma = getPrisma();

    const rows = await prisma.traceEntry.findMany({
      where: { sessionId },
      orderBy: { createdAt: "asc" },
    });
    if (rows.length === 0) return null;

    // Drain semantics: consume the buffer for this session. Deleting after the
    // read keeps it simple; a duplicate report for the same session would just
    // find an empty buffer (same as the DO's drain-clears behaviour).
    await prisma.traceEntry.deleteMany({ where: { sessionId } });

    const requests: TraceRequest[] = [];
    for (const row of rows) {
      try {
        requests.push(JSON.parse(row.payload) as TraceRequest);
      } catch {
        // A single corrupt payload should not lose the whole trace; skip it.
      }
    }
    if (requests.length === 0) return null;

    return { sessionId, requests };
  } catch {
    // Store unreachable (e.g. no D1 binding in this runtime) - the report still
    // succeeds, just without the backend-trace artifact.
    return null;
  }
}
