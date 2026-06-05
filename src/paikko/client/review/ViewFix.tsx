/**
 * "View fix" slot - a link to the preview-per-ticket deploy where the agent's
 * proposed fix is running. The real URL comes from the agent runner once it
 * spins up a preview env; until that lands this stubs the convention so the
 * review UI has the slot wired and styled.
 */

"use client";

import type { TicketHead } from "@/lib/contract";

/**
 * Stub for the preview-per-ticket URL. The agent runner will publish the real
 * deploy URL (env or ticket metadata); for now we synthesise the convention so
 * the slot renders. Returns null when there's nothing meaningful to preview yet.
 */
export function previewUrlForTicket(ticket: TicketHead): string | null {
  // Convention placeholder: preview-<id>.paikko.preview. Swap for the real
  // deploy URL when the runner provides it.
  if (ticket.status === "open") return null;
  return `https://preview-${ticket.id}.paikko.preview${ticket.report.route}`;
}

export function ViewFix({ ticket }: { ticket: TicketHead }) {
  const url = previewUrlForTicket(ticket);

  return (
    <div className="rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-4">
      <h3 className="text-sm font-semibold text-neutral-700">Proposed fix</h3>
      {url ? (
        <>
          <p className="mt-1 text-xs text-neutral-500">
            Preview deploy for this ticket. Open it, reproduce the original
            steps, then Accept or Reject below.
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
            <span className="ml-1 not-italic text-amber-600">(stub)</span>
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
