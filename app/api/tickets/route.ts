/**
 * GET /api/tickets - the queue the agent runner polls.
 *
 * Returns tier-1 heads only (refs + summaries for artifacts, never payloads -
 * that's the whole point of the two-tier wire format: the runner pulls the
 * cheap heads, then fetches a heavy artifact only when a fix needs it).
 *
 * Filter by status with `?status=open` (the common runner poll). An unknown
 * status value is a 400. Wrapped in the mandated `withCapture` seam (#2).
 */

import { NextRequest, NextResponse } from "next/server";
import { TicketStatusSchema } from "@/lib/contract";
import { withCapture } from "@/paikko/server/withCapture";
import { listHeads } from "@/paikko/server/tickets/store";
import { errorToResponse } from "@/paikko/server/tickets/http";

export const GET = withCapture(
  async (req: NextRequest) => {
    try {
      const statusParam = req.nextUrl.searchParams.get("status");
      const status = statusParam
        ? TicketStatusSchema.parse(statusParam)
        : undefined;
      const heads = await listHeads(status);
      return NextResponse.json({ tickets: heads });
    } catch (err) {
      return errorToResponse(err);
    }
  },
  { handler: "GET /api/tickets", src: "app/api/tickets/route.ts:18:1" },
);
