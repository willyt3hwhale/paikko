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
import { ArtifactNameSchema } from "@/lib/contract";
import { withCapture } from "@/paikko/server/withCapture";
import { getArtifactPayload } from "@/paikko/server/tickets/store";
import { errorToResponse } from "@/paikko/server/tickets/http";

type Ctx = { params: Promise<{ id: string; name: string }> };

export const GET = withCapture(
  async (_req: NextRequest, ctx: Ctx) => {
    try {
      const { id, name } = await ctx.params;
      const artifactName = ArtifactNameSchema.parse(name);
      const payload = await getArtifactPayload(id, artifactName);
      return NextResponse.json(payload);
    } catch (err) {
      return errorToResponse(err);
    }
  },
  {
    handler: "GET /api/tickets/:id/artifacts/:name",
    src: "app/api/tickets/[id]/artifacts/[name]/route.ts:22:1",
  },
);
