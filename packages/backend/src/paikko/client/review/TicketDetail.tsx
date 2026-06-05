/**
 * Full single-ticket review view. Renders the tier-1 head (user message, clicked
 * target provenance, route), the conversation thread, the lazy artifact panels,
 * the "View fix" preview slot, and the review action bar. Owns the head as client
 * state so a mutation (accept / reject / reply) can re-pull and re-render without
 * a full navigation.
 *
 * Server-rendered initial head is passed in via `initial`; this component takes
 * over for interactivity.
 */

"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import type { TicketHead, ArtifactName } from "@paikko/contract";
import { ArtifactNameSchema } from "@paikko/contract";
import { getTicket } from "./api";
import { ArtifactPanel } from "./ArtifactPanel";
import { Thread } from "./Thread";
import { ReviewActions } from "./ReviewActions";
import { ViewFix } from "./ViewFix";
import { StatusBadge, Field, Code, timeAgo, absoluteTime } from "./ui";

/** Stable display order for artifact panels regardless of index key order. */
const ARTIFACT_ORDER = ArtifactNameSchema.options as readonly ArtifactName[];

export function TicketDetail({ initial }: { initial: TicketHead }) {
  const [ticket, setTicket] = useState<TicketHead>(initial);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setTicket(await getTicket(initial.id));
    } finally {
      setRefreshing(false);
    }
  }, [initial.id]);

  const { report } = ticket;
  const { target } = report;
  const indexedArtifacts = ARTIFACT_ORDER.filter(
    (name) => ticket.artifacts[name],
  );

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-8">
      <div>
        <Link
          href="/tickets"
          className="text-sm text-neutral-400 hover:text-neutral-700"
        >
          ← Queue
        </Link>
      </div>

      {/* Header: status + meta */}
      <header className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <StatusBadge status={ticket.status} />
          <span className="text-xs text-neutral-400">
            {report.kind} · filed by {ticket.reporter} ·{" "}
            <span title={absoluteTime(ticket.createdAt)}>
              {timeAgo(ticket.createdAt)}
            </span>
          </span>
          {refreshing && (
            <span className="text-xs text-neutral-300">refreshing…</span>
          )}
        </div>

        {/* The user message - the core of the report */}
        <p className="whitespace-pre-wrap text-lg leading-snug text-neutral-900">
          {report.message}
        </p>
      </header>

      {/* Where it happened */}
      <section className="grid grid-cols-2 gap-4 rounded-lg border border-neutral-200 bg-white p-4">
        <Field label="Route">
          <Code>{report.route}</Code>
        </Field>
        <Field label="Component">
          {target.component ? <Code>{target.component}</Code> : "—"}
        </Field>
        <Field label="Selector">
          {target.selector ? <Code>{target.selector}</Code> : "—"}
        </Field>
        <Field label="Source">
          {target.src ? <Code>{target.src}</Code> : "—"}
        </Field>
      </section>

      {/* Proposed fix preview */}
      <ViewFix ticket={ticket} />

      {/* Artifacts - lazy, fetched on expand */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
          Artifacts
        </h2>
        {indexedArtifacts.length === 0 ? (
          <p className="text-sm italic text-neutral-400">
            No artifacts captured for this ticket.
          </p>
        ) : (
          indexedArtifacts.map((name) => (
            <ArtifactPanel
              key={name}
              ticketId={ticket.id}
              name={name}
              entry={ticket.artifacts[name]!}
            />
          ))
        )}
      </section>

      {/* Thread */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
          Thread
        </h2>
        <Thread messages={ticket.thread} />
      </section>

      {/* Review actions */}
      <section className="flex flex-col gap-3 border-t border-neutral-200 pt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
          Review
        </h2>
        <ReviewActions ticket={ticket} onChanged={refresh} />
      </section>
    </main>
  );
}
