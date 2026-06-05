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
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();
  const pending = busy;

  const isClosed = ticket.status === "closed";
  // Accept (-> closed) and Reject (-> reproducing) are only legal edges out of
  // `reviewing` in the state machine (see store.ts TRANSITIONS). For the other
  // non-closed states the agent still owns the ticket, so the reviewer can only
  // Reply to the thread.
  const canReview = ticket.status === "reviewing";

  // A short status line for the non-reviewing, non-closed states, telling the
  // reviewer what the ticket is waiting on instead of offering Accept/Reject.
  const waitingFor: string | null =
    ticket.status === "needs_info"
      ? "The agent needs more info - reply below."
      : ticket.status === "open" || ticket.status === "reproducing"
        ? "Waiting for the agent to propose a fix…"
        : null;

  function fail(err: unknown) {
    setError(
      err instanceof ApiError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Action failed.",
    );
  }

  async function run(action: () => Promise<void>) {
    // `busy` keeps every action button disabled for the whole in-flight window;
    // we don't lean on startTransition's pending flag because passing an async
    // function to startTransition (React 18) only tracks its synchronous prefix.
    setError(null);
    setBusy(true);
    try {
      await action();
      await onChanged();
      // Only the synchronous post-mutation state flushes go through the
      // transition, so the re-render off fresh server state stays low priority.
      startTransition(() => {
        setText("");
        setMode("none");
      });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
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
        {canReview && (
          <button
            type="button"
            onClick={accept}
            disabled={pending}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Accept &amp; close
          </button>
        )}
        {canReview && (
          <button
            type="button"
            onClick={() => {
              setMode((m) => (m === "reject" ? "none" : "reject"));
              setError(null);
            }}
            disabled={pending}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              mode === "reject"
                ? "bg-red-600 text-white hover:bg-red-700"
                : "border border-red-300 text-red-700 hover:bg-red-50"
            }`}
          >
            Reject
          </button>
        )}
        {!isClosed && (
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
        )}
      </div>

      {waitingFor && (
        <p className="text-sm text-neutral-400">{waitingFor}</p>
      )}

      {isClosed && (
        <p className="text-sm text-neutral-400">
          This ticket is closed. Reopen it from the fix loop to act again.
        </p>
      )}

      {((mode === "reject" && canReview) || mode === "reply") && (
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
