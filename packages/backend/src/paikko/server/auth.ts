/**
 * Project API-key auth (the SaaS hardening seam).
 *
 * Two key tiers, Stripe/Sentry-style:
 *
 *   - **publishable** (`pk_...`) - travels in the browser. The report widget sends
 *     it as `x-paikko-key` on the report POST. It may only CREATE reports for its
 *     project; it is NOT secret (anything in client JS is public), so the real
 *     defense for it is the CORS origin allowlist (`PAIKKO_ALLOWED_ORIGINS`).
 *   - **secret** (`sk_...`) - server-side only (the runner, the review API). Sent
 *     as `Authorization: Bearer sk_...`. Grants read/patch/delete scoped to the
 *     project's tickets. Stored ONLY as a SHA-256 hash; the plaintext is shown
 *     once at creation and never persisted.
 *
 * Auth is **opt-in**: enforced only when `PAIKKO_AUTH=required`. Unset (the
 * zero-config dev default) -> the auth functions are no-ops that return `null`,
 * so the single-tenant demo keeps working with no keys. When required, a missing
 * or bad key is a 401 ({@link UnauthorizedError}, mapped in `http.ts`).
 *
 * Crypto is Web Crypto (`crypto.subtle` / `crypto.getRandomValues`) so it runs
 * identically on Cloudflare Workers and under `next dev` - no Node `crypto`.
 */

import { getPrisma } from "@/lib/db";
import { TicketNotFoundError } from "@/paikko/server/tickets/store";

/** Thrown on a missing/invalid key when auth is enforced. Mapped to 401. */
export class UnauthorizedError extends Error {
  constructor(message = "unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/** A resolved tenant. The `slug` is what gets stamped on / filtered against tickets. */
export interface AuthedProject {
  id: string;
  slug: string;
  name: string;
}

/** True when key auth is enforced. Unset/anything-else -> permissive (dev default). */
export function authRequired(): boolean {
  return process.env.PAIKKO_AUTH === "required";
}

/* ------------------------------------------------------------------ */
/* key material                                                       */
/* ------------------------------------------------------------------ */

/** URL-safe base64 of random bytes (no padding). */
function randomToken(bytes = 24): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let bin = "";
  for (const b of buf) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** SHA-256 hex of a string (for hashing the secret key at rest). */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Mint a fresh key pair: a public `pk_...` and a secret `sk_...` (+ its hash). */
export async function generateKeyPair(): Promise<{
  publishableKey: string;
  secretKey: string;
  secretKeyHash: string;
}> {
  const publishableKey = `pk_${randomToken(18)}`;
  const secretKey = `sk_${randomToken(24)}`;
  const secretKeyHash = await sha256Hex(secretKey);
  return { publishableKey, secretKey, secretKeyHash };
}

/* ------------------------------------------------------------------ */
/* project CRUD                                                       */
/* ------------------------------------------------------------------ */

/**
 * Create a project and its keys. Returns the project plus the plaintext
 * `secretKey` - the ONLY time it exists outside a hash, so the caller must show
 * it to the operator and then forget it.
 */
export async function createProject(input: {
  slug: string;
  name?: string;
}): Promise<{ project: AuthedProject; publishableKey: string; secretKey: string }> {
  const prisma = getPrisma();
  const { publishableKey, secretKey, secretKeyHash } = await generateKeyPair();
  const row = await prisma.project.create({
    data: {
      slug: input.slug,
      name: input.name ?? input.slug,
      publishableKey,
      secretKeyHash,
    },
  });
  return {
    project: { id: row.id, slug: row.slug, name: row.name },
    publishableKey,
    secretKey,
  };
}

async function projectByPublishableKey(key: string): Promise<AuthedProject | null> {
  const prisma = getPrisma();
  const row = await prisma.project.findUnique({ where: { publishableKey: key } });
  return row ? { id: row.id, slug: row.slug, name: row.name } : null;
}

async function projectBySecretKey(key: string): Promise<AuthedProject | null> {
  const prisma = getPrisma();
  const hash = await sha256Hex(key);
  const row = await prisma.project.findUnique({ where: { secretKeyHash: hash } });
  return row ? { id: row.id, slug: row.slug, name: row.name } : null;
}

/* ------------------------------------------------------------------ */
/* request guards                                                     */
/* ------------------------------------------------------------------ */

/** Header the browser widget sends its publishable key on. */
export const PUBLISHABLE_HEADER = "x-paikko-key";

/**
 * Authorize a report-intake request. Permissive (returns `null`) unless
 * `PAIKKO_AUTH=required`, in which case the `x-paikko-key` publishable key must
 * resolve to a project (else 401). When it resolves, the caller stamps the
 * project's slug as the ticket's `projectKey`.
 */
export async function authReports(req: Request): Promise<AuthedProject | null> {
  if (!authRequired()) return null;
  const key = req.headers.get(PUBLISHABLE_HEADER);
  if (!key) throw new UnauthorizedError("missing publishable key (x-paikko-key)");
  const project = key.startsWith("pk_") ? await projectByPublishableKey(key) : null;
  if (!project) throw new UnauthorizedError("invalid publishable key");
  return project;
}

/**
 * Authorize a tickets/review API request with a secret key. Permissive (returns
 * `null`) unless `PAIKKO_AUTH=required`, in which case `Authorization: Bearer
 * sk_...` must resolve to a project (else 401). The caller scopes its reads/
 * writes to the returned project's slug.
 */
export async function authTickets(req: Request): Promise<AuthedProject | null> {
  if (!authRequired()) return null;
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const key = match?.[1];
  if (!key) throw new UnauthorizedError("missing bearer secret key");
  const project = key.startsWith("sk_") ? await projectBySecretKey(key) : null;
  if (!project) throw new UnauthorizedError("invalid secret key");
  return project;
}

/**
 * Cross-tenant access guard for per-ticket routes. When a project is authed, a
 * ticket it doesn't own is reported as not-found (404) rather than forbidden
 * (403), so a secret key can't probe which ticket ids exist in other tenants.
 * No-op when `project` is null (permissive mode).
 */
export function assertProjectOwns(
  project: AuthedProject | null,
  head: { id: string; projectKey: string | null },
): void {
  if (project && head.projectKey !== project.slug) {
    throw new TicketNotFoundError(head.id);
  }
}
