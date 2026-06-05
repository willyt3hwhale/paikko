/**
 * Stub-side client for the {@link SessionTrace} Durable Object.
 *
 * Route/handler code never talks to the DO directly - it goes through
 * {@link withCapture} (append on request finish) and the reports route (drain at
 * report time), which call the two helpers here. A DO can only be reached over
 * `fetch` against its stub, so these wrap that: resolve the per-session stub from
 * the request env (`SESSION_TRACE`, keyed `idFromName(sessionId)`), then POST JSON
 * to the DO's internal routes.
 *
 * Everything here is best-effort and non-throwing on the append path: capture must
 * never break the actual request. A failed append just means a (rare) missing
 * trace, which the report side already tolerates.
 */

import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { TraceArtifact, TraceRequest } from "@paikko/contract";

/**
 * Internal origin for DO fetches. DO `fetch` requires an absolute URL but the
 * host is meaningless (the request is routed to the stub, not the network), so we
 * use a fixed sentinel and only the pathname matters.
 */
const DO_ORIGIN = "https://session-trace.paikko.internal";

/** Resolve the SessionTrace DO stub for a capture session. */
function stubFor(sessionId: string) {
  const { env } = getCloudflareContext();
  const id = env.SESSION_TRACE.idFromName(sessionId);
  return env.SESSION_TRACE.get(id);
}

/**
 * Append a finished {@link TraceRequest} to its session's DO buffer. Best-effort:
 * swallows errors so a capture hiccup never fails the underlying request.
 */
export async function appendToSessionDO(
  sessionId: string,
  request: TraceRequest,
): Promise<void> {
  try {
    const stub = stubFor(sessionId);
    await stub.fetch(`${DO_ORIGIN}/append`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
  } catch {
    // Capture is non-blocking by contract: a lost trace request is acceptable,
    // a failed user request because of capture is not.
  }
}

/**
 * Drain a session's buffered requests from its DO and shape them as a
 * {@link TraceArtifact}. Returns null if the session captured nothing OR if the
 * DO is unavailable. The trace artifact is a best-effort enhancement: in any
 * environment where the SessionTrace Durable Object isn't reachable (local
 * `next dev`, which can't bind app-defined DOs, or a misconfigured deploy) the
 * call must degrade to "no trace" rather than throw - a missing trace must never
 * 500 the report intake that wraps it.
 */
export async function drainSessionDO(
  sessionId: string,
): Promise<TraceArtifact | null> {
  try {
    const stub = stubFor(sessionId);
    const res = await stub.fetch(`${DO_ORIGIN}/drain`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
    if (res.status === 204) return null;
    return (await res.json()) as TraceArtifact;
  } catch {
    // DO unreachable (e.g. no SessionTrace actor class in this runtime) - the
    // report still succeeds, just without the backend-trace artifact.
    return null;
  }
}
