/**
 * /tickets - the review queue.
 *
 * Server component: fetches the tier-1 heads from the ticket API (owned by the
 * API module) and hands them to the client `<TicketList>` for rendering. The
 * head is small and always safe to load up front; tier-2 artifacts are fetched
 * lazily from inside the single-ticket view, never here.
 */

import { headers } from "next/headers";
import { TicketHeadSchema, type TicketHead } from "@/lib/contract";
import { TicketList } from "@/paikko/client/review";
import { z } from "zod";

// Always reflect the live queue; tickets change as the agent works them.
export const dynamic = "force-dynamic";

const TicketHeadListSchema = z.array(TicketHeadSchema);

/** Resolve the app origin from the inbound request so server fetch is absolute. */
async function originFromHeaders(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto =
    h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

async function loadTickets(): Promise<TicketHead[]> {
  const res = await fetch(`${await originFromHeaders()}/tickets`, {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Failed to load tickets: ${res.status} ${res.statusText}`);
  }
  return TicketHeadListSchema.parse(await res.json());
}

export default async function TicketsPage() {
  let tickets: TicketHead[] = [];
  let error: string | null = null;
  try {
    tickets = await loadTickets();
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
