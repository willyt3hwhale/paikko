/**
 * POST /api/reports - ticket intake.
 *
 * Accepts the `<ReportButton>` payload ({@link ReportBundle}): a report core
 * plus inline artifact payloads. Validates it against the contract, then hands
 * it to the store which splits it into a persisted ticket head (building the
 * tier-1 index) + one Artifact row per captured artifact. Returns the new id.
 *
 * Wrapped in the mandated `withCapture` seam (#2 - no raw route handlers). Errors
 * are mapped to HTTP statuses inside the handler (the seam re-throws by design),
 * so the captured trace still records the real resolved status.
 */

import { NextRequest, NextResponse } from "next/server";
import { ReportBundleSchema } from "@/lib/contract";
import {
  withCapture,
  buildTraceArtifact,
  SESSION_HEADER,
} from "@/paikko/server/withCapture";
import { createTicketFromBundle } from "@/paikko/server/tickets/store";
import { errorToResponse } from "@/paikko/server/tickets/http";

export const POST = withCapture(
  async (req: NextRequest) => {
    try {
      const body = await req.json();
      const bundle = ReportBundleSchema.parse(body);

      // Drain the backend trace buffered for this capture session and attach it
      // as the `trace` artifact, so the agent gets the server side of the
      // interaction. The store validates it against ArtifactPayloadSchemas.trace
      // and splits it out like every other artifact.
      const sessionId = req.headers.get(SESSION_HEADER);
      if (sessionId) {
        const trace = buildTraceArtifact(sessionId);
        if (trace) {
          bundle.artifacts = { ...bundle.artifacts, trace };
        }
      }

      const { id } = await createTicketFromBundle(bundle);
      return NextResponse.json({ id }, { status: 201 });
    } catch (err) {
      return errorToResponse(err);
    }
  },
  { handler: "POST /api/reports", src: "app/api/reports/route.ts:16:1" },
);
