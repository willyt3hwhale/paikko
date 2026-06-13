/**
 * /tickets - the review queue.
 *
 * Server component: reads the tier-1 heads straight from the ticket store (it
 * has DB access; no HTTP round-trip to our own API - that self-fetch is fragile
 * on Workers and pointless from a server component) and hands them to the client
 * `<TicketList>`. The head is small and always safe to load up front; tier-2
 * artifacts are fetched lazily from inside the single-ticket view, never here.
 */

import { headers } from "next/headers";
import { type TicketHead } from "@paikko/contract";
import { TicketList } from "@/paikko/client/review";
import { listHeads } from "@/paikko/server/tickets/store";
import { authRequired, verifyOperatorBasic } from "@/paikko/server/auth";
import { UnauthorizedPage } from "@/paikko/client/review/Unauthorized";

// Always reflect the live queue; tickets change as the agent works them.
export const dynamic = "force-dynamic";

/**
 * Optionally narrow the queue to one tenant with `?projectKey=<key>`. Omitting
 * it (the default) shows ALL tickets - the single-tenant dev behaviour, so
 * nothing regresses. Next 15 hands `searchParams` to a server component as a
 * Promise, hence the await.
 */
export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ projectKey?: string | string[] }>;
}) {
  // Defense in depth: middleware gates this route, but never read the DB on an
  // unauthenticated request even if the edge gate is bypassed/misconfigured.
  if (authRequired() && !(await verifyOperatorBasic((await headers()).get("authorization")))) {
    return <UnauthorizedPage />;
  }

  const { projectKey } = await searchParams;
  const tenant = Array.isArray(projectKey) ? projectKey[0] : projectKey;

  let tickets: TicketHead[] = [];
  let error: string | null = null;
  try {
    // `tenant` undefined -> show all tickets (default); set -> filter to tenant.
    tickets = await listHeads(undefined, tenant);
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
