/**
 * `SessionTrace` Durable Object - LEGACY backend-trace buffer.
 *
 * ## Status: no longer wired in
 *
 * This DO was the original cross-request trace buffer. It is kept as a reference
 * but is NOT the active buffer anymore: app-defined Durable Objects don't run
 * under local `next dev` ("no such actor class; SessionTrace"), so the trace
 * artifact was always absent in local development. The buffer now lives in a
 * D1-backed table (`sessionTraceD1.ts`), which works in every environment. The
 * capture seam (`sessionTraceClient.ts`) routes append/drain to D1, so nothing
 * imports this class for buffering anymore. The binding/export are still declared
 * for the Workers build; this file can be removed once the DO binding is dropped
 * from `wrangler.jsonc` + `worker.ts`.
 *
 * ## Why it originally existed
 *
 * paikko's backend capture buffers each request's {@link TraceRequest} keyed by
 * `sessionId`, then drains them at report time to build the `trace` artifact (the
 * server side of a reported interaction). On a single Node process that buffer was
 * a module-level `Map` (see the old `sessionTrace.ts`). On Cloudflare Workers that
 * does not work: isolates are ephemeral and independent, so the request that
 * captured the trace and the later `POST /api/reports` that drains it may run in
 * different isolates with different memory. An in-memory buffer would silently
 * lose the trace.
 *
 * A Durable Object fixes exactly this: it is a single, addressable, consistent
 * instance per id. We key one DO per capture session (`idFromName(sessionId)`),
 * so every request in a session - and the later report drain - all reach the SAME
 * instance regardless of which isolate served them. The buffer lives in the DO's
 * in-memory state for the (short) life of a reported interaction; a trace is a
 * photograph taken at report time, not durable state, so we deliberately do NOT
 * persist it to the DO's storage. If the DO evicts before the report, the trace is
 * simply absent - same failure mode as the old process buffer, no worse.
 *
 * ## Interface
 *
 * The DO speaks JSON over `fetch` (the only way to call a DO across the isolate
 * boundary). The stub-side helpers in {@link withCapture}/{@link sessionTrace}
 * wrap these calls so route code never sees the fetch:
 *
 *   - `POST /append`  body: TraceRequest        -> 204
 *   - `POST /drain`   body: { sessionId }        -> TraceArtifact | 204 (empty)
 */

import { DurableObject } from "cloudflare:workers";
import type { TraceArtifact, TraceRequest } from "@paikko/contract";
import { TraceRequestSchema } from "@paikko/contract";

export class SessionTrace extends DurableObject {
  /** Buffered finished requests for this session, in arrival order. */
  private requests: TraceRequest[] = [];

  /**
   * Append one finished request to this session's buffer. Validates against the
   * contract on the way in so a drifted shape can never enter the buffer.
   */
  append(request: TraceRequest): void {
    this.requests.push(TraceRequestSchema.parse(request));
  }

  /**
   * Pull and clear the buffered requests, shaped as a {@link TraceArtifact}.
   * Returns null if nothing was captured for this session (so the report builder
   * can skip attaching an empty `trace`). Draining clears the buffer - the trace
   * is consumed once, matching the old `drainSession` semantics.
   */
  drain(sessionId: string): TraceArtifact | null {
    if (this.requests.length === 0) return null;
    const requests = this.requests;
    this.requests = [];
    return { sessionId, requests };
  }

  /**
   * Cross-isolate entrypoint. DOs can only be invoked via `fetch`, so the stub
   * helpers POST JSON here and these handlers delegate to the typed methods above.
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/append" && request.method === "POST") {
      const body = (await request.json()) as TraceRequest;
      this.append(body);
      return new Response(null, { status: 204 });
    }

    if (url.pathname === "/drain" && request.method === "POST") {
      const { sessionId } = (await request.json()) as { sessionId: string };
      const artifact = this.drain(sessionId);
      if (!artifact) return new Response(null, { status: 204 });
      return Response.json(artifact);
    }

    return new Response("not found", { status: 404 });
  }
}
