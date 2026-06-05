/**
 * Prisma access for Cloudflare Workers (D1).
 *
 * On Workers there is no module-level connection string and no long-lived
 * process to hang a singleton on: isolates are ephemeral and the D1 binding
 * arrives on the per-request Cloudflare context, not from a file URL. So the old
 * `export const prisma = ...` file-singleton (which read `DATABASE_URL`) is gone.
 * Instead callers ask for a client at request time via {@link getPrisma}.
 *
 * The client is built from the request's D1 binding through the
 * `@prisma/adapter-d1` driver adapter, and is STILL wrapped in the paikko
 * query-capture extension (see {@link withQueryCapture}) so every query issued
 * inside an active `withCapture` request lands in that request's trace context.
 * Queries outside a request are silently ignored, so the extension is always safe
 * to apply - same guarantee as before, just per-request instead of process-wide.
 *
 * We do cache the built client on the Cloudflare context object for the lifetime
 * of one request, so multiple `getPrisma()` calls within a single handler reuse
 * one client (and therefore one adapter) rather than reconnecting per query.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaD1 } from "@prisma/adapter-d1";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  withQueryCapture,
  type CapturingPrismaClient,
} from "@/paikko/server/prismaMiddleware";

/**
 * The Cloudflare bindings this app expects. `CloudflareEnv` is the global
 * interface OpenNext exposes; we augment it with paikko's own bindings:
 *   - `DB`            - the D1 database (the ticket store).
 *   - `SESSION_TRACE` - the SessionTrace Durable Object namespace (trace buffer).
 * Names here MUST match the bindings declared in wrangler.jsonc.
 */
declare global {
  interface CloudflareEnv {
    DB: D1Database;
    SESSION_TRACE: DurableObjectNamespace;
  }
}

/** Per-request cache slot stashed on the Cloudflare context's `ctx`. */
const PRISMA_SLOT = Symbol.for("paikko.prisma");

interface PrismaCacheHost {
  [PRISMA_SLOT]?: CapturingPrismaClient;
}

/**
 * Get a capturing PrismaClient bound to the current request's D1 database.
 *
 * Must be called inside a request (where `getCloudflareContext()` can resolve the
 * bindings). Reuses a per-request client if one was already built this request.
 */
export function getPrisma(): CapturingPrismaClient {
  const { env, ctx } = getCloudflareContext();

  // Cache the client on the per-request execution context so repeated calls in
  // one handler share a client. `ctx` is request-scoped, so this never leaks
  // across requests/isolates.
  const host = ctx as unknown as PrismaCacheHost;
  const cached = host[PRISMA_SLOT];
  if (cached) return cached;

  const adapter = new PrismaD1(env.DB);
  const client = withQueryCapture(new PrismaClient({ adapter }));
  host[PRISMA_SLOT] = client;
  return client;
}
