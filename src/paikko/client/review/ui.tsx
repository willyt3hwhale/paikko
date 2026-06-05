/**
 * Small presentational primitives shared across the review UI: status badges,
 * relative time, byte/count formatting. No data fetching here - pure render.
 */

"use client";

import type { TicketStatus } from "@/lib/contract";

/** Who the reviewer is in v0. Stamped onto thread messages the reviewer posts. */
export const REVIEWER = "reviewer";

/** Tailwind classes per ticket status, used by the badge. */
const STATUS_STYLE: Record<TicketStatus, string> = {
  open: "bg-blue-100 text-blue-800 ring-blue-600/20",
  reproducing: "bg-amber-100 text-amber-800 ring-amber-600/20",
  needs_info: "bg-purple-100 text-purple-800 ring-purple-600/20",
  reviewing: "bg-indigo-100 text-indigo-800 ring-indigo-600/20",
  closed: "bg-neutral-200 text-neutral-700 ring-neutral-500/20",
  rejected: "bg-red-100 text-red-800 ring-red-600/20",
};

const STATUS_LABEL: Record<TicketStatus, string> = {
  open: "open",
  reproducing: "reproducing",
  needs_info: "needs info",
  reviewing: "reviewing",
  closed: "closed",
  rejected: "rejected",
};

export function StatusBadge({ status }: { status: TicketStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium uppercase tracking-wide ring-1 ring-inset ${STATUS_STYLE[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Compact byte size, e.g. 1536 -> "1.5 KB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

/** Best-effort "x ago" from an ISO time; falls back to the raw string. */
export function timeAgo(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(then).toLocaleDateString();
}

/** Absolute, locale-formatted timestamp for hover titles. */
export function absoluteTime(iso: string): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? iso : new Date(t).toLocaleString();
}

/** A labelled key/value row used in the report header. */
export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium uppercase tracking-wide text-neutral-400">
        {label}
      </span>
      <span className="break-all text-sm text-neutral-800">{children}</span>
    </div>
  );
}

/** Monospace inline code chip, for selectors / src / handlers. */
export function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[0.8125rem] text-neutral-800">
      {children}
    </code>
  );
}
