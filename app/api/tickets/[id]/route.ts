/**
 * GET   /api/tickets/:id  - one tier-1 head.
 * PATCH /api/tickets/:id  - drive the state machine and/or append a thread msg.
 *
 * GET returns the head (refs/summaries, not payloads). PATCH carries an optional
 * `status` (validated against the state machine in the store) and/or an optional
 * thread `message` ({ by, text }) - e.g. a reviewer rejecting with a comment
 * moves `reviewing -> reproducing` AND posts the reason in one atomic call.
 *
 * Both wrapped in the mandated `withCapture` seam (#2).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { TicketStatusSchema } from "@/lib/contract";
import { withCapture } from "@/paikko/server/withCapture";
import { getHead, patchTicket } from "@/paikko/server/tickets/store";
import { errorToResponse } from "@/paikko/server/tickets/http";

type Ctx = { params: Promise<{ id: string }> };

const PatchBodySchema = z
  .object({
    status: TicketStatusSchema.optional(),
    message: z
      .object({ by: z.string().min(1), text: z.string().min(1) })
      .optional(),
    // Branch-isolated review fields: the agent sets these when it parks a fix in
    // `reviewing` (the git branch + the isolated preview URL "View fix" links to).
    // Both nullable - explicit `null` clears, omitted leaves unchanged.
    branch: z.string().nullable().optional(),
    previewUrl: z.string().nullable().optional(),
  })
  .refine(
    (b) =>
      b.status !== undefined ||
      b.message !== undefined ||
      "branch" in b ||
      "previewUrl" in b,
    {
      message:
        "patch must set at least one of `status`, `message`, `branch`, or `previewUrl`",
    },
  );

export const GET = withCapture(
  async (_req: NextRequest, ctx: Ctx) => {
    try {
      const { id } = await ctx.params;
      const head = await getHead(id);
      return NextResponse.json(head);
    } catch (err) {
      return errorToResponse(err);
    }
  },
  { handler: "GET /api/tickets/:id", src: "app/api/tickets/[id]/route.ts:34:1" },
);

export const PATCH = withCapture(
  async (req: NextRequest, ctx: Ctx) => {
    try {
      const body = await req.json();
      const patch = PatchBodySchema.parse(body);
      const { id } = await ctx.params;
      const head = await patchTicket(id, patch);
      return NextResponse.json(head);
    } catch (err) {
      return errorToResponse(err);
    }
  },
  { handler: "PATCH /api/tickets/:id", src: "app/api/tickets/[id]/route.ts:45:1" },
);
