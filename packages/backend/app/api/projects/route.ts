/**
 * POST /api/projects - mint a project + its API keys (admin only).
 *
 * Guarded by a bootstrap secret: the request must carry
 * `Authorization: Bearer <PAIKKO_ADMIN_TOKEN>`. When `PAIKKO_ADMIN_TOKEN` is
 * unset the endpoint is disabled entirely (404) - you can't create tenants on a
 * deployment that never configured an admin token.
 *
 * Body: `{ "slug": "my-app", "name": "My App" }` (slug is the tenant key stamped
 * on tickets). Returns the project plus BOTH keys ONCE:
 *   - publishableKey (pk_...) -> put in the widget (browser, not secret)
 *   - secretKey      (sk_...) -> give the runner / review API (server-side; the
 *     plaintext is never stored, only its hash, so this is the only time you see it)
 *
 * Wrapped in the mandated `withCapture` seam (#2).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withCapture } from "@/paikko/server/withCapture";
import { createProject, sha256Hex } from "@/paikko/server/auth";
import { errorToResponse } from "@/paikko/server/tickets/http";
import { withCors, corsPreflight } from "@/paikko/server/cors";

const BodySchema = z.object({
  // url-safe slug: the tenant key stamped on every ticket.
  slug: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]*$/, "slug must be lowercase alphanumeric / dashes"),
  name: z.string().min(1).max(120).optional(),
});

export const POST = withCapture(
  async (req: NextRequest) => {
    const origin = req.headers.get("origin");
    try {
      // Admin gate. Unset token -> feature disabled (404, not 401, so its
      // existence isn't advertised). Set -> require an exact bearer match.
      const adminToken = process.env.PAIKKO_ADMIN_TOKEN;
      if (!adminToken) {
        return withCors(
          NextResponse.json({ error: "not found" }, { status: 404 }),
          origin,
        );
      }
      const header = req.headers.get("authorization") ?? "";
      const presented = /^Bearer\s+(.+)$/i.exec(header.trim())?.[1] ?? "";
      // Compare SHA-256 hashes, not the raw tokens: this admin token mints tenant
      // keys, and a plain `!==` on the secret leaks length/prefix via timing. The
      // hashes are fixed-length and content-independent, mirroring how secret keys
      // are matched (sha256Hex + indexed lookup) elsewhere.
      const [ph, ah] = await Promise.all([sha256Hex(presented), sha256Hex(adminToken)]);
      if (ph !== ah) {
        return withCors(
          NextResponse.json({ error: "unauthorized" }, { status: 401 }),
          origin,
        );
      }

      const body = await req.json();
      const { slug, name } = BodySchema.parse(body);
      const result = await createProject({ slug, name });
      return withCors(
        NextResponse.json(
          {
            project: result.project,
            publishableKey: result.publishableKey,
            secretKey: result.secretKey,
            note: "Store the secretKey now - it is not retrievable later.",
          },
          { status: 201 },
        ),
        origin,
      );
    } catch (err) {
      return withCors(errorToResponse(err), origin);
    }
  },
  { handler: "POST /api/projects", src: "app/api/projects/route.ts:30:1" },
);

export const OPTIONS = withCapture(corsPreflight, {
  handler: "OPTIONS /api/projects",
});
