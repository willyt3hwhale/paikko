/**
 * /tickets - the review queue.
 *
 * Server component: reads the tier-1 heads straight from the ticket store (it
 * has DB access; no HTTP round-trip to our own API - that self-fetch is fragile
 * on Workers and pointless from a server component) and hands them to the client
 * `<TicketList>`. The head is small and always safe to load up front; tier-2
 * artifacts are fetched lazily from inside the single-ticket view, never here.
 */

import { type TicketHead } from "@paikko/contract";
import { TicketList } from "@/paikko/client/review";
import { listHeads } from "@/paikko/server/tickets/store";

// Always reflect the live queue; tickets change as the agent works them.
export const dynamic = "force-dynamic";

export default async function TicketsPage() {
  let tickets: TicketHead[] = [];
  let error: string | null = null;
  try {
    tickets = await listHeads();
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load tickets.";
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-8">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold text-neutral-900">Tickets</h1>
        <span className="text-sm text-neutral-400">
          {tickets.length} in queue
        </span>
      </header>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      ) : (
        <TicketList tickets={tickets} />
      )}
    </main>
  );
}
