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
import { ReportBundleSchema } from "@paikko/contract";
import {
  withCapture,
  buildTraceArtifact,
  SESSION_HEADER,
} from "@/paikko/server/withCapture";
import { createTicketFromBundle } from "@/paikko/server/tickets/store";
import { errorToResponse } from "@/paikko/server/tickets/http";
import { withCors, corsPreflight } from "@/paikko/server/cors";
import { authReports } from "@/paikko/server/auth";

/** Header a cross-origin widget may use to carry the tenant/project key. */
const PROJECT_HEADER = "x-paikko-project";

/** Hard ceiling on the report bundle (~32MB). The per-field contract caps bound
 * individual artifacts, but clientState/storage/network bodies are app-shaped and
 * uncapped, so this is the backstop against a single oversized intake POST
 * bloating D1 / pressuring the worker. Intake is anonymous in the permissive
 * default, so the gate must not depend on auth. */
const MAX_BODY_BYTES = 32 << 20;

export const POST = withCapture(
  async (req: NextRequest) => {
    const origin = req.headers.get("origin");
    try {
      const declared = Number(req.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
        return withCors(
          NextResponse.json({ error: "payload too large" }, { status: 413 }),
          origin,
        );
      }
      const raw = await req.text();
      if (raw.length > MAX_BODY_BYTES) {
        return withCors(
          NextResponse.json({ error: "payload too large" }, { status: 413 }),
          origin,
        );
      }
      const body = JSON.parse(raw);
      const bundle = ReportBundleSchema.parse(body);

      // Drain the backend trace buffered for this capture session and attach it
      // as the `trace` artifact, so the agent gets the server side of the
      // interaction. The store validates it against ArtifactPayloadSchemas.trace
      // and splits it out like every other artifact.
      const sessionId = req.headers.get(SESSION_HEADER);
      if (sessionId) {
        const trace = await buildTraceArtifact(sessionId);
        if (trace) {
          bundle.artifacts = { ...bundle.artifacts, trace };
        }
      }

      // Auth (opt-in via PAIKKO_AUTH=required): validate the widget's publishable
      // key. When enforced, the resolved project's slug is authoritative - a key
      // can only file for its own tenant - so we stamp it onto the bundle,
      // overriding whatever projectKey the client claimed. Permissive (dev
      // default) -> `project` is null and the client's value stands.
      const project = await authReports(req);
      if (project) bundle.projectKey = project.slug;

      // projectKey (SaaS seam): bundle value (now the authed slug when enforced)
      // wins; else fall back to the x-paikko-project header. Persisted on the ticket.
      const headerProject = req.headers.get(PROJECT_HEADER);
      const { id } = await createTicketFromBundle(bundle, headerProject);
      return withCors(NextResponse.json({ id }, { status: 201 }), origin);
    } catch (err) {
      return withCors(errorToResponse(err), origin);
    }
  },
  { handler: "POST /api/reports", src: "app/api/reports/route.ts:16:1" },
);

export const OPTIONS = withCapture(corsPreflight, {
  handler: "OPTIONS /api/reports",
});
