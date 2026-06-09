/**
 * GET /api/tickets/:id/artifacts/:name - one tier-2 artifact payload.
 *
 * The heavy half of the two-tier wire format. The agent reads an artifact's
 * `summary` from the head's index and only hits this endpoint (the index's
 * `ref`) when a fix actually needs the payload. The payload is re-validated
 * against its contract schema in the store before it leaves, so a fetch never
 * returns a drifted shape.
 *
 * `:name` must be one of the canonical artifact names; anything else is a 400.
 * Wrapped in the mandated `withCapture` seam (#2).
 */

import { NextRequest, NextResponse } from "next/server";
import { ArtifactNameSchema } from "@paikko/contract";
import { withCapture } from "@/paikko/server/withCapture";
import { getArtifactPayload, getHead } from "@/paikko/server/tickets/store";
import { errorToResponse } from "@/paikko/server/tickets/http";
import { withCors, corsPreflight } from "@/paikko/server/cors";
import { authTickets, assertProjectOwns } from "@/paikko/server/auth";

type Ctx = { params: Promise<{ id: string; name: string }> };

export const GET = withCapture(
  async (req: NextRequest, ctx: Ctx) => {
    const origin = req.headers.get("origin");
    try {
      const project = await authTickets(req);
      const { id, name } = await ctx.params;
      const artifactName = ArtifactNameSchema.parse(name);
      assertProjectOwns(project, await getHead(id)); // 404 if missing or other tenant
      const payload = await getArtifactPayload(id, artifactName);
      return withCors(NextResponse.json(payload), origin);
    } catch (err) {
      return withCors(errorToResponse(err), origin);
    }
  },
  {
    handler: "GET /api/tickets/:id/artifacts/:name",
    src: "app/api/tickets/[id]/artifacts/[name]/route.ts:22:1",
  },
);

export const OPTIONS = withCapture(corsPreflight, {
  handler: "OPTIONS /api/tickets/:id/artifacts/:name",
});
