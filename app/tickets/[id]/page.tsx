/**
 * /tickets/[id] - the single-ticket review view.
 *
 * Server component: fetches the tier-1 head from the ticket API and hands it to
 * the interactive client `<TicketDetail>`, which renders the message, the
 * clicked-target provenance, the thread, lazy artifact panels, the "View fix"
 * preview slot, and the Accept / Reject / Reply actions. Tier-2 artifact
 * payloads are fetched client-side on expand, never here.
 */

import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { TicketHeadSchema, type TicketHead } from "@/lib/contract";
import { TicketDetail } from "@/paikko/client/review";

export const dynamic = "force-dynamic";

async function originFromHeaders(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto =
    h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

async function loadTicket(id: string): Promise<TicketHead | null> {
  const res = await fetch(
    `${await originFromHeaders()}/tickets/${encodeURIComponent(id)}`,
    { cache: "no-store", headers: { accept: "application/json" } },
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Failed to load ticket: ${res.status} ${res.statusText}`);
  }
  return TicketHeadSchema.parse(await res.json());
}

export default async function TicketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  let ticket: TicketHead | null;
  let error: string | null = null;
  try {
    const { id } = await params;
    ticket = await loadTicket(id);
  } catch (err) {
    ticket = null;
    error = err instanceof Error ? err.message : "Failed to load ticket.";
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
