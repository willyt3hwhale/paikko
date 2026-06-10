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
 * Auth is **on by default** and covers every surface. It is disabled only when
 * `PAIKKO_AUTH=disabled` (the local single-tenant dev escape hatch, e.g. the
 * bundled calculator demo) -> the auth functions become no-ops that return
 * `null`. Otherwise a missing or bad credential is a 401 ({@link
 * UnauthorizedError}, mapped in `http.ts`).
 *
 * Two caller shapes hit the ticket/review API, so it accepts two credentials:
 *   - the **runner / programmatic** client sends `Authorization: Bearer sk_...`
 *     and is scoped to its own tenant.
 *   - the in-app **review dashboard** runs in a browser and cannot hold a secret
 *     key, so the operator authenticates with HTTP Basic (gated at the
 *     middleware and re-checked here) and gets full, cross-tenant access.
 * {@link authTickets} returns a {@link Principal} discriminating the two.
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

/**
 * The authenticated caller of the ticket/review API:
 *   - `operator`: the platform operator (Basic-auth dashboard) - full access.
 *   - `tenant`: a secret-key client (the runner) - scoped to `project.slug`.
 */
export type Principal =
  | { kind: "operator" }
  | { kind: "tenant"; project: AuthedProject };

/** The tenant slug a principal is scoped to, or `undefined` for full access. */
export function principalSlug(principal: Principal | null): string | undefined {
  return principal?.kind === "tenant" ? principal.project.slug : undefined;
}

/** Env var holding the operator dashboard password (Basic auth). */
const OPERATOR_PASS_ENV = "PAIKKO_DASHBOARD_PASSWORD";
/** Env var holding the operator dashboard username (Basic auth); defaults to "admin". */
const OPERATOR_USER_ENV = "PAIKKO_DASHBOARD_USER";

/**
 * True when auth is enforced. ON by default; disabled ONLY by an explicit
 * `PAIKKO_AUTH=disabled` (the local dev escape hatch). Any other value -> enforced.
 */
export function authRequired(): boolean {
  return process.env.PAIKKO_AUTH !== "disabled";
}

/** The configured operator credentials, or null when the dashboard login is unset. */
function operatorCreds(): { user: string; pass: string } | null {
  const pass = process.env[OPERATOR_PASS_ENV];
  if (!pass) return null;
  return { user: process.env[OPERATOR_USER_ENV] || "admin", pass };
}

/**
 * Verify an HTTP Basic `Authorization` header against the configured operator
 * login. Compares SHA-256 of `user:pass` on both sides so the check doesn't leak
 * the credential length/prefix via timing. Returns false when no operator login
 * is configured (fail closed - the dashboard stays locked).
 */
export async function verifyOperatorBasic(authHeader: string | null): Promise<boolean> {
  const creds = operatorCreds();
  if (!creds) return false;
  const m = /^Basic\s+(.+)$/i.exec((authHeader ?? "").trim());
  if (!m) return false;
  let decoded: string;
  try {
    decoded = atob(m[1]);
  } catch {
    return false;
  }
  const idx = decoded.indexOf(":");
  if (idx === -1) return false;
  const presented = `${decoded.slice(0, idx)}:${decoded.slice(idx + 1)}`;
  const expected = `${creds.user}:${creds.pass}`;
  const [a, b] = await Promise.all([sha256Hex(presented), sha256Hex(expected)]);
  return a === b;
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
 * Authorize a tickets/review API request. No-op (returns `null`) only when auth
 * is disabled. Otherwise accepts either credential and returns the {@link
 * Principal}:
 *   - `Authorization: Basic ...` (the dashboard) -> `operator` (full access).
 *   - `Authorization: Bearer sk_...` (the runner) -> `tenant` (scoped to its slug).
 * Anything missing/invalid is a 401.
 */
export async function authTickets(req: Request): Promise<Principal | null> {
  if (!authRequired()) return null;
  const header = (req.headers.get("authorization") ?? "").trim();
  // operator (Basic) - the in-app review dashboard
  if (/^Basic\s+/i.test(header)) {
    if (await verifyOperatorBasic(header)) return { kind: "operator" };
    throw new UnauthorizedError("invalid operator credentials");
  }
  // tenant (Bearer sk_) - the runner / programmatic clients
  const match = /^Bearer\s+(.+)$/i.exec(header);
  const key = match?.[1];
  if (!key) throw new UnauthorizedError("missing credentials");
  const project = key.startsWith("sk_") ? await projectBySecretKey(key) : null;
  if (!project) throw new UnauthorizedError("invalid secret key");
  return { kind: "tenant", project };
}

/**
 * Cross-tenant access guard for per-ticket routes. An `operator` principal has
 * full access; a `tenant` principal hitting a ticket it doesn't own gets a
 * not-found (404) rather than forbidden (403), so a secret key can't probe which
 * ticket ids exist in other tenants. No-op when `principal` is null (auth off).
 */
export function assertProjectOwns(
  principal: Principal | null,
  head: { id: string; projectKey: string | null },
): void {
  if (
    principal?.kind === "tenant" &&
    head.projectKey !== principal.project.slug
  ) {
    throw new TicketNotFoundError(head.id);
  }
}
