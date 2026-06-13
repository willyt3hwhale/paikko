/**
 * Operator (dashboard) HTTP Basic auth - edge-safe.
 *
 * This lives in its OWN module with zero Prisma/Node imports so the edge
 * `middleware.ts` can use the exact same constant-time credential check as the
 * route/server-component layer without dragging the Prisma client (and the rest
 * of `auth.ts`) into the edge runtime. Pure Web Crypto + `process.env`.
 *
 * `auth.ts` re-exports `sha256Hex` and `verifyOperatorBasic` from here so the
 * rest of the codebase keeps importing them from one place.
 */

/** Env var holding the operator dashboard password (Basic auth). */
const OPERATOR_PASS_ENV = "PAIKKO_DASHBOARD_PASSWORD";
/** Env var holding the operator dashboard username (Basic auth); defaults to "admin". */
const OPERATOR_USER_ENV = "PAIKKO_DASHBOARD_USER";

/** SHA-256 hex of a string. Used for hashing keys/credentials before compare. */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** The configured operator credentials, or null when the dashboard login is unset. */
export function operatorCreds(): { user: string; pass: string } | null {
  const pass = process.env[OPERATOR_PASS_ENV];
  if (!pass) return null;
  return { user: process.env[OPERATOR_USER_ENV] || "admin", pass };
}

/**
 * Verify an HTTP Basic `Authorization` header against the configured operator
 * login. Compares SHA-256 of `user:pass` on both sides: the hashes are
 * fixed-length and content-independent, so the equality check leaks neither the
 * password length nor a matching prefix via timing (unlike a raw `===` on the
 * secrets). Returns false when no operator login is configured (fail closed -
 * the dashboard stays locked).
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
