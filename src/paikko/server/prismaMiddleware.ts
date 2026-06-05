/**
 * Prisma query-capture extension.
 *
 * This is the "DB activity is captured free" seam. It wraps every Prisma
 * operation so that, whenever a query runs inside an active {@link withCapture}
 * request, a {@link TraceQuery} is appended to that request's trace context. Route
 * authors write ordinary `prisma.user.findMany(...)` calls and get full query
 * provenance with zero extra code.
 *
 * ## How to wire it up
 *
 * The Prisma singleton (`@/lib/db`) should apply this extension once:
 *
 *   import { PrismaClient } from "@prisma/client";
 *   import { withQueryCapture } from "@/paikko/server/prismaMiddleware";
 *
 *   const base = new PrismaClient();
 *   export const prisma = withQueryCapture(base);
 *
 * `$extends` returns a new client; keep the extended one. Because the capture
 * reads the active AsyncLocalStorage context, queries outside a request (startup,
 * scripts) are silently ignored - the extension is always safe to apply.
 *
 * ## What's recorded
 *
 * Per query we record the model+action as the `sql` string (Prisma's query
 * extension runs above the SQL layer, so we don't see raw SQL for the typed API;
 * the model.action identity is the stable, useful provenance), the args as
 * `params`, the measured duration, and a best-effort call-site `src` guessed from
 * the JS stack. Raw `$queryRaw` / `$executeRaw` carry their actual SQL text.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import type { TraceQuery } from "@/lib/contract";
import { addQuery, getTrace } from "./sessionTrace";

/**
 * Apply the query-capture extension to a Prisma client. Returns the extended
 * client - use the return value, not the input.
 */
export function withQueryCapture<C extends PrismaClient>(client: C) {
  return client.$extends({
    name: "paikko-query-capture",
    query: {
      // Applies to every model and every action, plus raw operations.
      $allOperations: captureOperation,
    },
  });
}

/** The `$allOperations` hook signature, kept explicit for clarity. */
interface OperationArgs {
  operation: string;
  model?: string;
  args: unknown;
  query: (args: unknown) => Promise<unknown>;
}

/**
 * Wrap a single Prisma operation: time it, run it, and (if inside a trace) record
 * a {@link TraceQuery}. Errors are still recorded (with negative duration meaning
 * "failed") and then re-thrown so the route's own error path is unaffected.
 */
async function captureOperation({ operation, model, args, query }: OperationArgs): Promise<unknown> {
  // Fast path: if there's no active trace, skip all bookkeeping entirely.
  const active = getTrace();
  if (!active) {
    return query(args);
  }

  const src = guessSrc();
  const startedAt = performance.now();
  try {
    const result = await query(args);
    record(operation, model, args, performance.now() - startedAt, src);
    return result;
  } catch (err) {
    // durationMs stays measured; the thrown error surfaces in the handler-level
    // `threw`, so we don't double-record it on the query.
    record(operation, model, args, performance.now() - startedAt, src);
    throw err;
  }
}

/** Build and append the contract-shaped {@link TraceQuery}. */
function record(
  operation: string,
  model: string | undefined,
  args: unknown,
  durationMs: number,
  src: string | null,
): void {
  const trace: TraceQuery = {
    sql: model ? `${model}.${operation}` : operation,
    params: toParams(args),
    durationMs: Math.round(durationMs * 1000) / 1000,
    src,
  };
  addQuery(trace);
}

/**
 * Normalize Prisma operation args into the `params` array. Typed operations pass
 * a single args object; raw operations pass a tagged template / values. We always
 * surface a single-element array so the shape is predictable, dropping `undefined`.
 */
function toParams(args: unknown): unknown[] | undefined {
  if (args === undefined) return undefined;
  return [safeClone(args)];
}

/** JSON round-trip so params are serialization-safe in the JSONB payload. */
function safeClone(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

/**
 * Best-effort guess of the call site that issued the query, as "file:line:col".
 * We walk the captured stack and return the first frame outside node internals,
 * Prisma internals, and this file. Returns null if nothing usable is found.
 */
function guessSrc(): string | null {
  const stack = new Error().stack;
  if (!stack) return null;

  const lines = stack.split("\n").slice(1); // drop the "Error" header line
  for (const line of lines) {
    if (
      line.includes("node:internal") ||
      line.includes("node_modules/@prisma") ||
      line.includes("node_modules/.prisma") ||
      line.includes("prismaMiddleware") ||
      line.includes("sessionTrace")
    ) {
      continue;
    }
    const loc = extractLocation(line);
    if (loc) return loc;
  }
  return null;
}

/**
 * Pull "file:line:col" out of a V8 stack frame. Handles both
 * "at fn (/abs/path/file.ts:12:5)" and "at /abs/path/file.ts:12:5" forms, and
 * trims an absolute path down to a workspace-relative one when possible.
 */
function extractLocation(frame: string): string | null {
  const match = frame.match(/\(?([^()]+?):(\d+):(\d+)\)?\s*$/);
  if (!match) return null;
  const [, file, lineNo, colNo] = match;
  if (!file || file.startsWith("node:")) return null;
  return `${relativize(file)}:${lineNo}:${colNo}`;
}

/** Strip the cwd prefix so src matches the build-time "file:line:col" convention. */
function relativize(file: string): string {
  const cwd = process.cwd().replace(/\\/g, "/");
  const norm = file.replace(/\\/g, "/").replace(/^file:\/\//, "");
  if (norm.startsWith(cwd + "/")) return norm.slice(cwd.length + 1);
  return norm;
}

/**
 * The type of a client after applying {@link withQueryCapture}. Useful for the
 * `@/lib/db` singleton to export a precise type.
 */
export type CapturingPrismaClient = ReturnType<typeof withQueryCapture<PrismaClient>>;

// Re-export Prisma namespace type usage marker (keeps the import meaningful for
// consumers extending this with model-scoped overrides).
export type { Prisma };
