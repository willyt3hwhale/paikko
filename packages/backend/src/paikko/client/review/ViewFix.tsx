/**
 * "View fix" slot - a link to the ticket's OWN isolated preview, a separate
 * OpenNext deployment (e.g. http://localhost:8788) where ONLY this ticket's fix
 * runs on its own branch/worktree. The live app on main stays pristine until the
 * reviewer Accepts. Open the ticket's route there, reproduce the steps, then
 * Accept/Reject from the review UI on the main app.
 */

"use client";

import type { TicketHead } from "@paikko/contract";

/**
 * URL where the proposed fix is live: the ticket's reported route on its
 * ISOLATED preview origin (`ticket.previewUrl` + the reported route). Returns
 * null when no isolated preview is up yet (the agent hasn't proposed a fix).
 */
export function previewUrlForTicket(ticket: TicketHead): string | null {
  if (!ticket.previewUrl) return null;
  return `${ticket.previewUrl}${ticket.report.route}`;
}

export function ViewFix({ ticket }: { ticket: TicketHead }) {
  const url = previewUrlForTicket(ticket);

  return (
    <div className="rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-4">
      <h3 className="text-sm font-semibold text-neutral-700">Proposed fix</h3>
      {url ? (
        <>
          <p className="mt-1 text-xs text-neutral-500">
            View the proposed fix in its isolated preview. The live app is
            unchanged until you Accept.
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
