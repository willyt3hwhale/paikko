/**
 * One collapsible artifact in the ticket view. Reads its index entry from the
 * head (ref / summary / count / size) so it can render the row WITHOUT touching
 * the heavy payload. The tier-2 payload is fetched lazily, once, only when the
 * reviewer first expands the panel - mirroring how the agent decides from the
 * head alone whether a fetch is even needed.
 */

"use client";

import { useState, useCallback } from "react";
import type {
  ArtifactName,
  ArtifactIndexEntry,
  ArtifactPayloadMap,
} from "@/lib/contract";
import { getArtifact, ApiError } from "./api";
import { ArtifactView } from "./ArtifactView";
import { formatBytes } from "./ui";

const ARTIFACT_LABEL: Record<ArtifactName, string> = {
  console: "Console",
  network: "Network",
  clientState: "Client state",
  storage: "Storage",
  dom: "DOM snapshot",
  trace: "Backend trace",
};

type LoadState<N extends ArtifactName> =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "loaded"; payload: ArtifactPayloadMap[N] }
  | { phase: "error"; message: string };

export function ArtifactPanel<N extends ArtifactName>({
  ticketId,
  name,
  entry,
}: {
  ticketId: string;
  name: N;
  entry: ArtifactIndexEntry;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<LoadState<N>>({ phase: "idle" });

  const load = useCallback(async () => {
    setState({ phase: "loading" });
    try {
      const payload = await getArtifact(ticketId, name);
      setState({ phase: "loaded", payload });
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to load artifact.";
      setState({ phase: "error", message });
    }
  }, [ticketId, name]);

  const toggle = useCallback(() => {
    setOpen((wasOpen) => {
      const next = !wasOpen;
      // Lazy: fetch only the first time it's opened.
      if (next && state.phase === "idle") void load();
      return next;
    });
  }, [load, state.phase]);

  return (
    <div className="rounded-lg border border-neutral-200 bg-white">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-neutral-50"
      >
        <span
          className={`text-neutral-400 transition-transform ${open ? "rotate-90" : ""}`}
          aria-hidden
        >
          ▶
        </span>
        <span className="font-medium text-neutral-800">
          {ARTIFACT_LABEL[name]}
        </span>
        <span className="grow truncate text-sm text-neutral-500">
          {entry.summary}
        </span>
        <span className="shrink-0 text-xs tabular-nums text-neutral-400">
          {entry.count != null ? `${entry.count} · ` : ""}
          {formatBytes(entry.size)}
        </span>
      </button>

      {open && (
        <div className="border-t border-neutral-100 px-4 py-3">
          {state.phase === "loading" && (
            <p className="text-sm text-neutral-400">Loading {name}…</p>
          )}
          {state.phase === "error" && (
            <div className="flex items-center gap-3">
              <p className="text-sm text-red-600">{state.message}</p>
              <button
                type="button"
                onClick={() => void load()}
                className="text-sm font-medium text-blue-600 hover:underline"
              >
                Retry
              </button>
            </div>
          )}
          {state.phase === "loaded" && (
            <ArtifactView name={name} payload={state.payload} />
          )}
        </div>
      )}
    </div>
  );
}
