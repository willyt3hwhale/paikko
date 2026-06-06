/**
 * GET /api/tickets - the queue the agent runner polls.
 *
 * Returns tier-1 heads only (refs + summaries for artifacts, never payloads -
 * that's the whole point of the two-tier wire format: the runner pulls the
 * cheap heads, then fetches a heavy artifact only when a fix needs it).
 *
 * Filter by status with `?status=open` (the common runner poll). An unknown
 * status value is a 400. Wrapped in the mandated `withCapture` seam (#2).
 *
 * Filter by tenant with `?projectKey=<key>` (the multi-tenant SaaS seam): only
 * tickets stamped with that projectKey are returned. Omitting the param returns
 * ALL tenants' tickets (the single-tenant default - back-compatible).
 */

import { NextRequest, NextResponse } from "next/server";
import { TicketStatusSchema } from "@paikko/contract";
import { withCapture } from "@/paikko/server/withCapture";
import { listHeads } from "@/paikko/server/tickets/store";
import { errorToResponse } from "@/paikko/server/tickets/http";
import { withCors, corsPreflight } from "@/paikko/server/cors";

export const GET = withCapture(
  async (req: NextRequest) => {
    const origin = req.headers.get("origin");
    try {
      const statusParam = req.nextUrl.searchParams.get("status");
      const status = statusParam
        ? TicketStatusSchema.parse(statusParam)
        : undefined;
      // Optional multi-tenant filter; absent -> all tenants (single-tenant default).
      const projectKey = req.nextUrl.searchParams.get("projectKey") ?? undefined;
      const heads = await listHeads(status, projectKey);
      return withCors(NextResponse.json(heads), origin);
    } catch (err) {
      return withCors(errorToResponse(err), origin);
    }
  },
  { handler: "GET /api/tickets", src: "app/api/tickets/route.ts:18:1" },
);

export const OPTIONS = withCapture(corsPreflight, {
  handler: "OPTIONS /api/tickets",
});
