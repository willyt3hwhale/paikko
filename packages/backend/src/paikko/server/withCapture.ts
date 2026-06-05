/**
 * `withCapture` - the mandated API route wrapper.
 *
 * Wrapping a Next App-Router route handler in `withCapture` is what makes backend
 * capture total instead of best-effort: every wrapped handler opens a trace
 * context (see {@link startTrace}), so every DB query the {@link withQueryCapture}
 * extension sees during the request is attributed to it, the handler's identity +
 * provenance are recorded, the resolved status is stamped, and any thrown error is
 * captured - then a contract-shaped {@link TraceRequest} is emitted into the
 * session buffer. The route author writes ordinary handler code and gets a full
 * backend trace for free.
 *
 * ## Usage
 *
 *   // app/api/cart/route.ts
 *   import { withCapture } from "@/paikko/server/withCapture";
 *
 *   export const GET = withCapture(
 *     async (req) => {
 *       const items = await prisma.cartItem.findMany();
 *       return Response.json(items);
 *     },
 *     { handler: "GET /api/cart", src: "app/api/cart/route.ts:5:1" },
 *   );
 *
 * `handler` and `src` are optional; if omitted, `handler` is derived from the
 * request method+path and `src` is null. The build-time provenance plugin (or a
 * codemod) can fill `src` precisely.
 *
 * ## The spine
 *
 * The wrapper reads `x-paikko-trace` (the frontend-generated traceId echoed per
 * request) and `x-paikko-session` from the inbound request. The traceId is what
 * stitches this {@link TraceRequest} to the frontend {@link NetworkEntry} that
 * fired it. Both headers are also echoed back on the response so the frontend can
 * confirm the round-trip was captured. If no traceId is present the request is
 * still served normally; we synthesize ids so capture never blocks a request.
 */

import { finish, setStatus, setThrew, startTrace } from "./sessionTrace";
import { appendToSessionDO, drainSessionDO } from "./sessionTraceClient";

/** Header carrying the frontend-generated spine id for this request. */
export const TRACE_HEADER = "x-paikko-trace";
/** Header carrying the capture session id (groups one reported interaction). */
export const SESSION_HEADER = "x-paikko-session";

/**
 * The minimal request surface we read. Next route handlers receive a `Request`
 * (App Router); this structural type keeps the wrapper testable without importing
 * Next types.
 */
export interface CapturableRequest {
  method: string;
  url: string;
  headers: { get(name: string): string | null };
}

/** A Next App-Router route handler: (request, context) => Response. */
export type RouteHandler<Req extends CapturableRequest, Ctx, Res> = (
  request: Req,
  context: Ctx,
) => Res | Promise<Res>;

/** Static identity to attach to the trace, when known at wrap time. */
export interface CaptureOptions {
  /** Stable handler identity, e.g. "POST /api/tickets". Derived if omitted. */
  handler?: string;
  /** Handler provenance "file:line:col". Null if unknown. */
  src?: string | null;
}

/**
 * Wrap a route handler so every invocation is captured as a {@link TraceRequest}.
 * The returned function has the same signature as the input, so it drops straight
 * into `export const GET = withCapture(...)`.
 */
export function withCapture<
  Req extends CapturableRequest,
  Ctx,
  Res extends ResponseLike,
>(
  handler: RouteHandler<Req, Ctx, Res>,
  options: CaptureOptions = {},
): RouteHandler<Req, Ctx, Res> {
  return async (request: Req, context: Ctx): Promise<Res> => {
    const traceId = request.headers.get(TRACE_HEADER) ?? synthId("trace");
    const sessionId = request.headers.get(SESSION_HEADER) ?? synthId("session");
    const url = request.url;
    const method = request.method;
    const handlerName = options.handler ?? deriveHandlerName(method, url);

    return startTrace(
      {
        traceId,
        sessionId,
        handler: handlerName,
        src: options.src ?? null,
        method,
        url,
      },
      async () => {
        try {
          const response = await handler(request, context);
          setStatus(readStatus(response));
          // finish() freezes the request; we then write it to the session's
          // Durable Object so the report drain (possibly a different isolate)
          // can find it. Append is best-effort and never throws.
          const finished = finish();
          if (finished) await appendToSessionDO(sessionId, finished);
          echoHeaders(response, traceId, sessionId);
          return response;
        } catch (err) {
          // Capture the throw, emit the (failed) trace to the session DO, then
          // re-throw so Next's error handling and the route's own semantics are
          // preserved.
          setThrew(err);
          setStatus(errorStatus(err));
          const finished = finish();
          if (finished) await appendToSessionDO(sessionId, finished);
          throw err;
        }
      },
    );
  };
}

/**
 * Assemble the `trace` artifact for a finished capture session by draining its
 * Durable Object buffer. The report bundle builder calls this when a user files a
 * report, to attach the backend side of the interaction. Returns null if nothing
 * was captured for the session. Async now: the buffer lives in the SessionTrace
 * DO (cross-isolate), so draining it is a DO fetch.
 */
export async function buildTraceArtifact(
  sessionId: string,
): Promise<import("@paikko/contract").TraceArtifact | null> {
  return drainSessionDO(sessionId);
}

/* ------------------------------------------------------------------ */
/* Response handling                                                  */
/* ------------------------------------------------------------------ */

/** Structural view of a Web `Response` - enough to read status + set headers. */
export interface ResponseLike {
  status?: number;
  headers?: { set(name: string, value: string): void };
}

/** Read the HTTP status off a response-like value; null if absent. */
function readStatus(response: ResponseLike): number | null {
  return typeof response.status === "number" ? response.status : null;
}

/** Echo the spine ids back so the frontend can confirm capture happened. */
function echoHeaders(response: ResponseLike, traceId: string, sessionId: string): void {
  if (response.headers && typeof response.headers.set === "function") {
    response.headers.set(TRACE_HEADER, traceId);
    response.headers.set(SESSION_HEADER, sessionId);
  }
}

/**
 * Map a thrown value to a status for the trace record. Next surfaces most thrown
 * errors as 500; an error carrying an explicit numeric `status`/`statusCode` is
 * honoured.
 */
function errorStatus(err: unknown): number {
  if (err && typeof err === "object") {
    const e = err as { status?: unknown; statusCode?: unknown };
    if (typeof e.status === "number") return e.status;
    if (typeof e.statusCode === "number") return e.statusCode;
  }
  return 500;
}

/* ------------------------------------------------------------------ */
/* Identity helpers                                                   */
/* ------------------------------------------------------------------ */

/** Derive a readable handler identity from method + pathname. */
function deriveHandlerName(method: string, url: string): string {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    // url may already be a path in some runtimes; use as-is.
  }
  return `${method} ${path}`;
}

/** Synthesize a fallback id when a header is missing, so capture never blocks. */
function synthId(prefix: string): string {
  const rand =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `${prefix}_${rand}`;
}
