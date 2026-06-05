/**
 * The ticket queue, grouped into three sections so the user sees what matters:
 *
 *   1. "Needs you"   - reviewing + needs_info. Pinned at top, accented. These
 *                      are the only tickets that want a human decision.
 *   2. "In progress" - open + reproducing. Neutral; the agent is working.
 *   3. "Done"        - closed (accepted) + rejected. Collapsed by default so
 *                      terminal tickets don't clutter the queue.
 *
 * Within every group rows are newest first. Empty groups are hidden (the "Done"
 * collapsible is only rendered when there is something done). Pure render - the
 * heads are fetched server-side and passed in.
 */

"use client";

import Link from "next/link";
import type { TicketHead } from "@paikko/contract";
import {
  StatusBadge,
  Code,
  timeAgo,
  absoluteTime,
  STATUS_GROUP,
  type TicketGroup,
} from "./ui";

function artifactNames(ticket: TicketHead): string[] {
  return Object.keys(ticket.artifacts);
}

/** Newest first, by createdAt. Stable for equal/invalid timestamps. */
function byNewest(a: TicketHead, b: TicketHead): number {
  return Date.parse(b.createdAt) - Date.parse(a.createdAt);
}

function TicketRow({ t }: { t: TicketHead }) {
  const names = artifactNames(t);
  // Terminal tickets read at a glance: accepted = green tint, rejected = muted
  // red with a struck message.
  const tone =
    t.status === "closed"
      ? "border-emerald-200 bg-emerald-50/40 hover:border-emerald-300 hover:bg-emerald-50"
      : t.status === "rejected"
        ? "border-red-200 bg-red-50/30 hover:border-red-300 hover:bg-red-50/60"
        : "border-neutral-200 bg-white hover:border-neutral-300 hover:bg-neutral-50";
  const messageTone =
    t.status === "rejected"
      ? "text-neutral-400 line-through"
      : "text-neutral-900";

  return (
    <li>
      <Link
        href={`/tickets/${encodeURIComponent(t.id)}`}
        className={`block rounded-lg border p-4 transition-colors ${tone}`}
      >
        <div className="flex items-center gap-3">
          <StatusBadge status={t.status} />
          <span className={`grow truncate font-medium ${messageTone}`}>
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
          {t.report.target.component && <span>{t.report.target.component}</span>}
          <span>by {t.reporter}</span>
          {names.length > 0 && (
            <span className="text-neutral-300">{names.join(" · ")}</span>
          )}
          {t.thread.length > 0 && (
            <span className="text-neutral-300">{t.thread.length} msg</span>
          )}
        </div>
      </Link>
    </li>
  );
}

/** A coloured count pill for section headers. */
function CountPill({ n, className }: { n: number; className: string }) {
  return (
    <span
      className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold ${className}`}
    >
      {n}
    </span>
  );
}

export function TicketList({ tickets }: { tickets: TicketHead[] }) {
  if (tickets.length === 0) {
    return (
      <p className="text-sm italic text-neutral-400">
        The queue is empty. Reports filed from the app land here.
      </p>
    );
  }

  const groups: Record<TicketGroup, TicketHead[]> = {
    needs: [],
    progress: [],
    done: [],
  };
  for (const t of tickets) groups[STATUS_GROUP[t.status]].push(t);
  for (const key of Object.keys(groups) as TicketGroup[]) {
    groups[key].sort(byNewest);
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Needs you - pinned, accented. The only section that wants action. */}
      {groups.needs.length > 0 && (
        <section className="rounded-xl border-l-4 border-amber-400 bg-amber-50/50 p-3">
          <div className="mb-2 flex items-center gap-2 px-1">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-700">
              Needs you
            </h2>
            <CountPill
              n={groups.needs.length}
              className="bg-amber-200 text-amber-900"
            />
          </div>
          <ul className="flex flex-col gap-2">
            {groups.needs.map((t) => (
              <TicketRow key={t.id} t={t} />
            ))}
          </ul>
        </section>
      )}

      {/* In progress - neutral, no action needed. */}
      {groups.progress.length > 0 && (
        <section>
          <div className="mb-2 flex items-center gap-2 px-1">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
              In progress
            </h2>
            <CountPill
              n={groups.progress.length}
              className="bg-neutral-200 text-neutral-700"
            />
          </div>
          <ul className="flex flex-col gap-2">
            {groups.progress.map((t) => (
              <TicketRow key={t.id} t={t} />
            ))}
          </ul>
        </section>
      )}

      {/* Done - terminal, collapsed by default. */}
      {groups.done.length > 0 && (
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-1 py-1 text-sm font-semibold uppercase tracking-wide text-neutral-400 hover:text-neutral-600">
            <svg
              className="size-3.5 shrink-0 transition-transform group-open:rotate-90"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.168 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02Z"
                clipRule="evenodd"
              />
            </svg>
            Done
            <CountPill
              n={groups.done.length}
              className="bg-neutral-100 text-neutral-500"
            />
          </summary>
          <ul className="mt-2 flex flex-col gap-2">
            {groups.done.map((t) => (
              <TicketRow key={t.id} t={t} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
