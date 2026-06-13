/**
 * /tickets/[id] - the single-ticket review view.
 *
 * Server component: reads the tier-1 head straight from the ticket store (direct
 * DB access; no fragile HTTP self-fetch) and hands it to the interactive client
 * `<TicketDetail>`, which renders the message, the clicked-target provenance, the
 * thread, lazy artifact panels, the "View fix" preview slot, and the Accept /
 * Reject / Reply actions. Tier-2 artifact payloads are fetched client-side on
 * expand, never here.
 */

import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { type TicketHead } from "@paikko/contract";
import { TicketDetail } from "@/paikko/client/review";
import { getHead, TicketNotFoundError } from "@/paikko/server/tickets/store";
import { authRequired, verifyOperatorBasic } from "@/paikko/server/auth";
import { UnauthorizedPage } from "@/paikko/client/review/Unauthorized";

export const dynamic = "force-dynamic";

export default async function TicketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Defense in depth: middleware gates this route, but never read the DB on an
  // unauthenticated request even if the edge gate is bypassed/misconfigured.
  if (authRequired() && !(await verifyOperatorBasic((await headers()).get("authorization")))) {
    return <UnauthorizedPage />;
  }

  let ticket: TicketHead | null = null;
  let error: string | null = null;
  try {
    const { id } = await params;
    ticket = await getHead(id);
  } catch (err) {
    if (err instanceof TicketNotFoundError) {
      ticket = null;
    } else {
      error = err instanceof Error ? err.message : "Failed to load ticket.";
    }
  }

  if (!ticket && !error) notFound();

  if (error) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-8">
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      </main>
    );
  }

  return <TicketDetail initial={ticket!} />;
}
