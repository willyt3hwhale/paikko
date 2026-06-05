/**
 * The review action bar - the accept/reject loop made of buttons.
 *
 *   Accept          -> PATCH status = "closed"
 *   Reject + comment -> POST the comment to the thread, then PATCH status =
 *                       "reproducing" (back into the fix loop)
 *   Reply            -> POST a thread message, no status change
 *
 * On any mutation it calls `onChanged()` so the parent can re-pull the head and
 * re-render the thread / status with fresh server state.
 */

"use client";

import { useState, useTransition } from "react";
import type { TicketHead } from "@/lib/contract";
import { setTicketStatus, postThreadMessage, ApiError } from "./api";
import { REVIEWER } from "./ui";

type Mode = "none" | "reject" | "reply";

export function ReviewActions({
  ticket,
  onChanged,
}: {
  ticket: TicketHead;
  onChanged: () => void | Promise<void>;
}) {
  const [mode, setMode] = useState<Mode>("none");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isClosed = ticket.status === "closed";

  function fail(err: unknown) {
    setError(
      err instanceof ApiError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Action failed.",
    );
  }

  function run(action: () => Promise<void>) {
    setError(null);
    startTransition(async () => {
      try {
        await action();
        setText("");
        setMode("none");
        await onChanged();
      } catch (err) {
        fail(err);
      }
    });
  }

  const accept = () =>
    run(async () => {
      await setTicketStatus(ticket.id, "closed");
    });

  const submitReject = () => {
    const comment = text.trim();
    if (!comment) {
      setError("A rejection needs a comment explaining what's still wrong.");
      return;
    }
    run(async () => {
      await postThreadMessage(ticket.id, { by: REVIEWER, text: comment });
      await setTicketStatus(ticket.id, "reproducing");
    });
  };

  const submitReply = () => {
    const reply = text.trim();
    if (!reply) {
      setError("Nothing to send.");
      return;
    }
    run(async () => {
      await postThreadMessage(ticket.id, { by: REVIEWER, text: reply });
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={accept}
          disabled={pending || isClosed}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Accept &amp; close
        </button>
        <button
          type="button"
          onClick={() => {
            setMode((m) => (m === "reject" ? "none" : "reject"));
            setError(null);
          }}
          disabled={pending || isClosed}
          className={`rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            mode === "reject"
              ? "bg-red-600 text-white hover:bg-red-700"
              : "border border-red-300 text-red-700 hover:bg-red-50"
          }`}
        >
          Reject
        </button>
        <button
          type="button"
          onClick={() => {
            setMode((m) => (m === "reply" ? "none" : "reply"));
            setError(null);
          }}
          disabled={pending}
          className={`rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            mode === "reply"
              ? "bg-neutral-800 text-white hover:bg-neutral-900"
              : "border border-neutral-300 text-neutral-700 hover:bg-neutral-50"
          }`}
        >
          Reply
        </button>
      </div>

      {isClosed && (
        <p className="text-sm text-neutral-400">
          This ticket is closed. Reopen it from the fix loop to act again.
        </p>
      )}

      {(mode === "reject" || mode === "reply") && (
        <div className="flex flex-col gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            autoFocus
            placeholder={
              mode === "reject"
                ? "What's still wrong? This goes back to the fix agent…"
                : "Add a note to the thread…"
            }
            className="w-full resize-y rounded-md border border-neutral-300 p-2 text-sm focus:border-neutral-500 focus:outline-none"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={mode === "reject" ? submitReject : submitReply}
              disabled={pending}
              className="rounded-md bg-neutral-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-900 disabled:opacity-50"
            >
              {mode === "reject"
                ? "Reject & send back to fix"
                : "Send reply"}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("none");
                setText("");
                setError(null);
              }}
              disabled={pending}
              className="rounded-md px-4 py-2 text-sm font-medium text-neutral-500 hover:text-neutral-800"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
