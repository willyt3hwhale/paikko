/**
 * The ticket queue. Renders a list of tier-1 heads with status badge, the user
 * message, where it happened, and cheap signals (artifact names captured, thread
 * length). Click-through goes to the single-ticket review view. Pure render -
 * the heads are fetched server-side and passed in.
 */

"use client";

import Link from "next/link";
import type { TicketHead } from "@/lib/contract";
import { StatusBadge, Code, timeAgo, absoluteTime } from "./ui";

function artifactNames(ticket: TicketHead): string[] {
  return Object.keys(ticket.artifacts);
}

export function TicketList({ tickets }: { tickets: TicketHead[] }) {
  if (tickets.length === 0) {
    return (
      <p className="text-sm italic text-neutral-400">
        The queue is empty. Reports filed from the app land here.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {tickets.map((t) => {
        const names = artifactNames(t);
        return (
          <li key={t.id}>
            <Link
              href={`/tickets/${encodeURIComponent(t.id)}`}
              className="block rounded-lg border border-neutral-200 bg-white p-4 transition-colors hover:border-neutral-300 hover:bg-neutral-50"
            >
              <div className="flex items-center gap-3">
                <StatusBadge status={t.status} />
                <span className="grow truncate font-medium text-neutral-900">
                  {t.report.message || "(no message)"}
                </span>
                <span
                  className="shrink-0 text-xs text-neutral-400"
                  title={absoluteTime(t.createdAt)}
                >
                  {timeAgo(t.createdAt)}
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-400">
                <span>
                  <Code>{t.report.route}</Code>
                </span>
                {t.report.target.component && (
                  <span>{t.report.target.component}</span>
                )}
                <span>by {t.reporter}</span>
                {names.length > 0 && (
                  <span className="text-neutral-300">
                    {names.join(" · ")}
                  </span>
                )}
                {t.thread.length > 0 && (
                  <span className="text-neutral-300">
                    {t.thread.length} msg
                  </span>
                )}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
