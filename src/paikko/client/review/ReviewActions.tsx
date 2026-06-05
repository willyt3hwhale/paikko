/**
 * The review action bar - the branch-isolated accept/reject/reply loop.
 *
 *   Accept & merge   -> PATCH status = "closed"   (runner merges the ticket's
 *                       branch to main + redeploys the live app)
 *   Reject & discard -> PATCH status = "rejected"  (runner discards the branch +
 *                       worktree; the live app is untouched)
 *   Reply            -> POST a thread message, no status change. ANY reply on a
 *                       `reviewing` ticket re-engages the agent: it revisits and
 *                       revises the fix on the same branch. No separate Reject is
 *                       needed to request changes.
 *
 * On any mutation it calls `onChanged()` so the parent can re-pull the head and
 * re-render the thread / status with fresh server state.
 */

"use client";

import { useState, useTransition } from "react";
import type { TicketHead } from "@/lib/contract";
import { setTicketStatus, postThreadMessage, ApiError } from "./api";
import { REVIEWER } from "./ui";

type Mode = "none" | "reply";

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

  // `closed` (accepted+merged) and `rejected` (discarded) are the terminal
  // states - no further action is possible from the review UI.
  const isTerminal =
    ticket.status === "closed" || ticket.status === "rejected";
  // Accept (-> closed) and Reject (-> rejected) are only legal out of
  // `reviewing` in the state machine (see store.ts TRANSITIONS). For the other
  // non-terminal states the agent still owns the ticket, so the reviewer can
  // only Reply to the thread (which re-engages the agent).
  const canReview = ticket.status === "reviewing";

  // A short status line for the non-reviewing, non-terminal states, telling the
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

  const reject = () =>
    run(async () => {
      await setTicketStatus(ticket.id, "rejected");
    });

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
            Accept &amp; merge
          </button>
        )}
        {canReview && (
          <button
            type="button"
            onClick={reject}
            disabled={pending}
            className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Reject &amp; discard
          </button>
        )}
        {!isTerminal && (
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

      {canReview && (
        <p className="text-xs text-neutral-400">
          Replying asks the agent to revise the fix.
        </p>
      )}

      {waitingFor && <p className="text-sm text-neutral-400">{waitingFor}</p>}

      {ticket.status === "closed" && (
        <p className="text-sm text-neutral-400">
          This ticket was accepted - the fix was merged to main and the live app
          redeployed. Reopen it from the fix loop to act again.
        </p>
      )}

      {ticket.status === "rejected" && (
        <p className="text-sm text-neutral-400">
          This ticket was rejected - the fix was discarded and the live app left
          untouched.
        </p>
      )}

      {mode === "reply" && !isTerminal && (
        <div className="flex flex-col gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            autoFocus
            placeholder="Ask the agent to revise the fix, or add a note to the thread…"
            className="w-full resize-y rounded-md border border-neutral-300 p-2 text-sm focus:border-neutral-500 focus:outline-none"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={submitReply}
              disabled={pending}
              className="rounded-md bg-neutral-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-900 disabled:opacity-50"
            >
              Send reply
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
