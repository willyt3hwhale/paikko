/**
 * POST /api/tickets/:id/thread - append a message to a ticket's conversation.
 *
 * The review UI (Reply, and the rejection comment) posts here. The store appends
 * the message; we return the appended {@link ThreadMessage} (the last entry the
 * UI's postThreadMessage parses with ThreadMessageSchema).
 *
 * Wrapped in the mandated `withCapture` seam (#2 - no raw route handlers).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withCapture } from "@/paikko/server/withCapture";
import { appendThreadMessage, getHead } from "@/paikko/server/tickets/store";
import { errorToResponse } from "@/paikko/server/tickets/http";
import { withCors, corsPreflight } from "@/paikko/server/cors";
import { authTickets, assertProjectOwns } from "@/paikko/server/auth";

type Ctx = { params: Promise<{ id: string }> };

const ThreadBodySchema = z.object({
  by: z.string().min(1),
  text: z.string().min(1),
});

export const POST = withCapture(
  async (req: NextRequest, ctx: Ctx) => {
    const origin = req.headers.get("origin");
    try {
      const project = await authTickets(req);
      const body = await req.json();
      const { by, text } = ThreadBodySchema.parse(body);
      const { id } = await ctx.params;
      assertProjectOwns(project, await getHead(id)); // 404 if missing or other tenant
      const head = await appendThreadMessage(id, by, text);
      const appended = head.thread[head.thread.length - 1];
      return withCors(NextResponse.json(appended), origin);
    } catch (err) {
      return withCors(errorToResponse(err), origin);
    }
  },
  {
    handler: "POST /api/tickets/:id/thread",
    src: "app/api/tickets/[id]/thread/route.ts:25:1",
  },
);

export const OPTIONS = withCapture(corsPreflight, {
  handler: "OPTIONS /api/tickets/:id/thread",
});
