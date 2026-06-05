/**
 * "View fix" slot - a link to the ticket's own route on the current origin,
 * where the agent's proposed fix is already running (the runner rebuilds the
 * fix into the same bundle). Open it, reproduce the steps, then Accept/Reject.
 */

"use client";

import type { TicketHead } from "@/lib/contract";

/**
 * URL where the proposed fix is live: the ticket's reported route on the
 * current origin. Returns null when there's nothing to preview yet (open) or
 * during SSR where there's no origin to resolve.
 */
export function previewUrlForTicket(ticket: TicketHead): string | null {
  if (ticket.status === "open") return null;
  if (typeof window === "undefined") return null;
  return `${window.location.origin}${ticket.report.route}`;
}

export function ViewFix({ ticket }: { ticket: TicketHead }) {
  const url = previewUrlForTicket(ticket);

  return (
    <div className="rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-4">
      <h3 className="text-sm font-semibold text-neutral-700">Proposed fix</h3>
      {url ? (
        <>
          <p className="mt-1 text-xs text-neutral-500">
            The fix is live on this app. Open the ticket&apos;s route, reproduce
            the original steps, then Accept or Reject below.
          </p>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-neutral-800 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-neutral-900"
          >
            View fix ↗
          </a>
          <p className="mt-2 break-all font-mono text-[0.6875rem] text-neutral-400">
            {url}
          </p>
        </>
      ) : (
        <p className="mt-1 text-xs text-neutral-500">
          No preview yet - the agent hasn&apos;t proposed a fix for this ticket.
        </p>
      )}
    </div>
  );
}
