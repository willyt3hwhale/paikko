/**
 * GET    /api/tickets/:id  - one tier-1 head.
 * PATCH  /api/tickets/:id  - drive the state machine and/or append a thread msg.
 * DELETE /api/tickets/:id  - hard-delete the ticket + its thread/artifacts.
 *
 * GET returns the head (refs/summaries, not payloads). PATCH carries an optional
 * `status` (validated against the state machine in the store) and/or an optional
 * thread `message` ({ by, text }) - e.g. a reviewer rejecting with a comment
 * moves `reviewing -> reproducing` AND posts the reason in one atomic call.
 * DELETE removes the ticket and its children (TraceEntry rows are session-keyed,
 * not ticket-keyed, so they are left in place) and returns 204.
 *
 * Auth (opt-in via PAIKKO_AUTH=required): a secret key scopes every operation to
 * its project. A ticket owned by another tenant is treated as not-found (404) so
 * existence isn't leaked across tenants. Permissive (dev default) -> no scoping.
 *
 * All wrapped in the mandated `withCapture` seam (#2).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { TicketStatusSchema } from "@paikko/contract";
import { withCapture } from "@/paikko/server/withCapture";
import { deleteTicket, getHead, patchTicket } from "@/paikko/server/tickets/store";
import { errorToResponse } from "@/paikko/server/tickets/http";
import { withCors, corsPreflight } from "@/paikko/server/cors";
import { authTickets, assertProjectOwns } from "@/paikko/server/auth";

type Ctx = { params: Promise<{ id: string }> };

const PatchBodySchema = z
  .object({
    status: TicketStatusSchema.optional(),
    message: z
      .object({ by: z.string().min(1).max(256), text: z.string().min(1).max(16_384) })
      .optional(),
    // Branch-isolated review fields: the agent sets these when it parks a fix in
    // `reviewing` (the git branch + the isolated preview URL "View fix" links to).
    // Both nullable - explicit `null` clears, omitted leaves unchanged.
    branch: z.string().max(512).nullable().optional(),
    // Scheme-locked to http(s): the review UI renders this as an <a href>, and
    // React won't sanitize a `javascript:`/`data:` value, so reject anything that
    // isn't a real preview origin at the write boundary (the render path guards
    // too, for values that predate this).
    previewUrl: z
      .string()
      .url()
      .refine((u) => /^https?:$/.test(new URL(u).protocol), "previewUrl must be http(s)")
      .nullable()
      .optional(),
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
  async (req: NextRequest, ctx: Ctx) => {
    const origin = req.headers.get("origin");
    try {
      const project = await authTickets(req);
      const { id } = await ctx.params;
      const head = await getHead(id);
      assertProjectOwns(project, head);
      return withCors(NextResponse.json(head), origin);
    } catch (err) {
      return withCors(errorToResponse(err), origin);
    }
  },
  { handler: "GET /api/tickets/:id", src: "app/api/tickets/[id]/route.ts:34:1" },
);

export const PATCH = withCapture(
  async (req: NextRequest, ctx: Ctx) => {
    const origin = req.headers.get("origin");
    try {
      const project = await authTickets(req);
      const body = await req.json();
      const patch = PatchBodySchema.parse(body);
      const { id } = await ctx.params;
      assertProjectOwns(project, await getHead(id)); // 404 if missing or other tenant
      const head = await patchTicket(id, patch);
      return withCors(NextResponse.json(head), origin);
    } catch (err) {
      return withCors(errorToResponse(err), origin);
    }
  },
  { handler: "PATCH /api/tickets/:id", src: "app/api/tickets/[id]/route.ts:45:1" },
);

export const DELETE = withCapture(
  async (req: NextRequest, ctx: Ctx) => {
    const origin = req.headers.get("origin");
    try {
      const project = await authTickets(req);
      const { id } = await ctx.params;
      assertProjectOwns(project, await getHead(id)); // 404 if missing or other tenant
      await deleteTicket(id);
      return withCors(new NextResponse(null, { status: 204 }), origin);
    } catch (err) {
      return withCors(errorToResponse(err), origin);
    }
  },
  { handler: "DELETE /api/tickets/:id", src: "app/api/tickets/[id]/route.ts:DELETE" },
);

export const OPTIONS = withCapture(corsPreflight, {
  handler: "OPTIONS /api/tickets/:id",
});
