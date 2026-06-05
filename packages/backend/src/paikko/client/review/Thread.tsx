/**
 * The ticket conversation. Renders the thread messages and distinguishes the
 * three kinds of author (reporter, agent, reviewer) by colour, so the review
 * back-and-forth is legible at a glance.
 */

"use client";

import type { ThreadMessage } from "@paikko/contract";
import { REVIEWER, timeAgo, absoluteTime } from "./ui";

function authorStyle(by: string): { ring: string; label: string } {
  if (by === "agent") return { ring: "border-l-violet-400", label: "agent" };
  if (by === REVIEWER || by === "reviewer")
    return { ring: "border-l-emerald-400", label: "reviewer" };
  return { ring: "border-l-blue-400", label: by };
}

export function Thread({ messages }: { messages: ThreadMessage[] }) {
  if (messages.length === 0) {
    return (
      <p className="text-sm italic text-neutral-400">No messages yet.</p>
    );
  }
  return (
    <ol className="flex flex-col gap-3">
      {messages.map((m) => {
        const { ring, label } = authorStyle(m.by);
        return (
          <li
            key={m.id}
            className={`rounded-r border-l-2 ${ring} bg-neutral-50 py-2 pl-3 pr-3`}
          >
            <div className="mb-0.5 flex items-baseline justify-between gap-2">
              <span className="text-xs font-semibold text-neutral-600">
                {label}
              </span>
              <time
                className="text-xs text-neutral-400"
                title={absoluteTime(m.at)}
                dateTime={m.at}
              >
                {timeAgo(m.at)}
              </time>
            </div>
            <p className="whitespace-pre-wrap break-words text-sm text-neutral-800">
              {m.text}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
