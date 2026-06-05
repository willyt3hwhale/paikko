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
import { type TicketHead } from "@/lib/contract";
import { TicketDetail } from "@/paikko/client/review";
import { getHead, TicketNotFoundError } from "@/paikko/server/tickets/store";

export const dynamic = "force-dynamic";

export default async function TicketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
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
