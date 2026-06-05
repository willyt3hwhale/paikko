/**
 * Backend capture trace context.
 *
 * This is the server-side spine of paikko's "total capture" guarantee. Every API
 * route wrapped in {@link withCapture} opens a trace context here; every DB query
 * issued during that request lands in it via the Prisma middleware. When the
 * handler finishes we have a fully-formed {@link TraceRequest} - handler identity,
 * provenance, status, ordered queries, and any thrown error - with zero work from
 * the route author.
 *
 * The context is an {@link AsyncLocalStorage} store so it follows the request
 * across `await` boundaries without being threaded through call signatures. That
 * is what lets the Prisma middleware reach back up and attach a query to "the
 * request currently running" without a handle being passed down.
 *
 * ## Shape
 *
 * A single context maps 1:1 to a {@link TraceRequest}. We carry the spine ids
 * (`traceId` from the inbound `x-paikko-trace` header, `sessionId` for the capture
 * session) plus the mutable accumulators (`queries`, `threw`, `status`). On
 * {@link finish} we freeze it into a contract-shaped {@link TraceRequest} and hand
 * it to the registered sink.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { TraceQuery, TraceRequest } from "@/lib/contract";
import { TraceRequestSchema } from "@/lib/contract";

/**
 * The mutable per-request capture context. Lives in AsyncLocalStorage for the
 * lifetime of one handler invocation.
 */
export interface TraceContext {
  /** Spine id from `x-paikko-trace`; stitches to the frontend NetworkEntry. */
  traceId: string;
  /** Backend capture session id (groups requests of one reported interaction). */
  sessionId: string;
  /** Handler identity (route id / function name). */
  handler: string;
  /** Handler provenance "file:line:col"; null if unknown. */
  src: string | null;
  method: string;
  url: string;
  /** HTTP status once known; null until the handler resolves. */
  status: number | null;
  /** Queries seen so far, in execution order. */
  queries: TraceQuery[];
  /** Serialized error if the handler threw; null otherwise. */
  threw: unknown | null;
  /** Wall-clock start (ms epoch) for duration math. */
  startedAtMs: number;
}

/** A sink receives each finished request. Default sink buffers per session. */
export type TraceSink = (request: TraceRequest) => void;

const storage = new AsyncLocalStorage<TraceContext>();

/**
 * In-memory buffer of finished requests, keyed by sessionId. The frontend's
 * report bundle assembly reads this (via {@link drainSession}) to build the
 * `trace` artifact. This is deliberately process-local and ephemeral: a trace is a
 * photograph taken at report time, not durable state.
 */
const sessionBuffers = new Map<string, TraceRequest[]>();

// The session buffer is fed directly by finish() via defaultSink (which knows the
// sessionId). This pluggable sink is an additional fan-out hook, no-op by default.
let sink: TraceSink = () => {};

/** Default sink: append the request to its session buffer. */
function defaultSink(sessionId: string, request: TraceRequest): void {
  let buf = sessionBuffers.get(sessionId);
  if (!buf) {
    buf = [];
    sessionBuffers.set(sessionId, buf);
  }
  buf.push(request);
}

/** Override the sink (e.g. to forward finished requests elsewhere). */
export function setTraceSink(next: TraceSink): void {
  sink = next;
}

/** Fields needed to open a context. */
export interface StartTraceInput {
  traceId: string;
  sessionId: string;
  handler: string;
  src: string | null;
  method: string;
  url: string;
}

/**
 * Run `fn` inside a fresh trace context. Everything `fn` awaits - including the
 * Prisma middleware - sees this context via {@link getTrace}. Returns whatever
 * `fn` returns; the context is discarded when `fn` settles (callers should call
 * {@link finish} from inside `fn` to emit the record).
 */
export function startTrace<T>(input: StartTraceInput, fn: () => Promise<T>): Promise<T> {
  const ctx: TraceContext = {
    traceId: input.traceId,
    sessionId: input.sessionId,
    handler: input.handler,
    src: input.src,
    method: input.method,
    url: input.url,
    status: null,
    queries: [],
    threw: null,
    startedAtMs: Date.now(),
  };
  return storage.run(ctx, fn);
}

/** The active context, or undefined if not inside a wrapped handler. */
export function getTrace(): TraceContext | undefined {
  return storage.getStore();
}

/**
 * Record one query against the active context. Called by the Prisma middleware.
 * No-op outside a trace (e.g. queries during boot), so DB code stays unconditional.
 */
export function addQuery(query: TraceQuery): void {
  const ctx = storage.getStore();
  if (!ctx) return;
  ctx.queries.push(query);
}

/** Stamp the resolved HTTP status onto the active context. */
export function setStatus(status: number | null): void {
  const ctx = storage.getStore();
  if (ctx) ctx.status = status;
}

/** Stamp a thrown error onto the active context. */
export function setThrew(threw: unknown): void {
  const ctx = storage.getStore();
  if (ctx) ctx.threw = threw;
}

/**
 * Freeze the active context into a contract-shaped {@link TraceRequest}, validate
 * it, hand it to the sink, and return it. Called by {@link withCapture} once the
 * handler settles. No-op-safe: returns null outside a trace.
 */
export function finish(): TraceRequest | null {
  const ctx = storage.getStore();
  if (!ctx) return null;

  const request: TraceRequest = TraceRequestSchema.parse({
    traceId: ctx.traceId,
    handler: ctx.handler,
    src: ctx.src,
    method: ctx.method,
    url: ctx.url,
    status: ctx.status,
    queries: ctx.queries,
    threw: serializeError(ctx.threw),
    durationMs: Date.now() - ctx.startedAtMs,
  });

  defaultSink(ctx.sessionId, request);
  sink(request);
  return request;
}

/**
 * Pull and clear the buffered requests for a session, shaped as the body of a
 * `trace` artifact's `requests` array. The report bundle assembly wraps these in
 * `{ sessionId, requests }` to form a {@link TraceArtifact}.
 */
export function drainSession(sessionId: string): TraceRequest[] {
  const buf = sessionBuffers.get(sessionId) ?? [];
  sessionBuffers.delete(sessionId);
  return buf;
}

/** Peek at a session's buffered requests without clearing. */
export function peekSession(sessionId: string): TraceRequest[] {
  return sessionBuffers.get(sessionId) ?? [];
}

/**
 * Best-effort serialize a thrown value into something JSON-safe for `threw`.
 * Errors lose their prototype across JSON, so we flatten name/message/stack.
 */
export function serializeError(threw: unknown): unknown {
  if (threw == null) return null;
  if (threw instanceof Error) {
    return {
      name: threw.name,
      message: threw.message,
      stack: threw.stack ?? null,
    };
  }
  try {
    // Round-trip to guarantee JSON-safety; non-serializable bits become strings.
    return JSON.parse(JSON.stringify(threw));
  } catch {
    return String(threw);
  }
}
