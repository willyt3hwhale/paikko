/**
 * Tier-2 artifact rendering. Each artifact name has a dedicated viewer that knows
 * its decoded payload shape; `ArtifactView` dispatches on the name. These are pure
 * - they receive an already-fetched, already-validated payload. The lazy fetch
 * lives in `ArtifactPanel`.
 */

"use client";

import type {
  ArtifactName,
  ArtifactPayloadMap,
  ConsoleArtifact,
  NetworkArtifact,
  ClientStateArtifact,
  StorageArtifact,
  DomArtifact,
  TraceArtifact,
} from "@/lib/contract";
import { Code, absoluteTime } from "./ui";

/* ---- console ---- */

const LEVEL_STYLE: Record<ConsoleArtifact[number]["level"], string> = {
  error: "text-red-600",
  warn: "text-amber-600",
  info: "text-blue-600",
  debug: "text-neutral-400",
  log: "text-neutral-700",
};

function ConsoleView({ payload }: { payload: ConsoleArtifact }) {
  if (payload.length === 0) return <Empty>No console output captured.</Empty>;
  return (
    <ul className="divide-y divide-neutral-100 font-mono text-xs">
      {payload.map((e, i) => (
        <li key={i} className="flex gap-2 py-1">
          <span
            className={`w-12 shrink-0 font-semibold uppercase ${LEVEL_STYLE[e.level]}`}
          >
            {e.level}
          </span>
          <span className="grow whitespace-pre-wrap break-all text-neutral-800">
            {e.message}
          </span>
          <span
            className="shrink-0 text-neutral-300"
            title={absoluteTime(e.at)}
          >
            {e.at.slice(11, 19)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ---- network ---- */

function statusColor(status: number | null): string {
  if (status === null) return "text-neutral-400";
  if (status >= 500) return "text-red-600";
  if (status >= 400) return "text-amber-600";
  return "text-green-600";
}

function NetworkView({ payload }: { payload: NetworkArtifact }) {
  if (payload.length === 0) return <Empty>No network calls captured.</Empty>;
  return (
    <ul className="divide-y divide-neutral-100 text-xs">
      {payload.map((n, i) => (
        <li key={i} className="flex flex-col gap-0.5 py-1.5">
          <div className="flex items-center gap-2 font-mono">
            <span className="w-12 shrink-0 font-semibold text-neutral-500">
              {n.method}
            </span>
            <span className={`w-8 shrink-0 font-semibold ${statusColor(n.status)}`}>
              {n.status ?? "—"}
            </span>
            <span className="grow break-all text-neutral-800">{n.url}</span>
            <span className="shrink-0 text-neutral-400">
              {n.durationMs != null ? `${Math.round(n.durationMs)}ms` : "—"}
            </span>
          </div>
          <div className="pl-14 text-[0.6875rem] text-neutral-400">
            traceId <Code>{n.traceId}</Code>
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ---- clientState ---- */

function ClientStateView({ payload }: { payload: ClientStateArtifact }) {
  const keys = Object.keys(payload);
  if (keys.length === 0) return <Empty>Empty client state.</Empty>;
  return <Json value={payload} />;
}

/* ---- storage ---- */

function StorageView({ payload }: { payload: StorageArtifact }) {
  return (
    <div className="flex flex-col gap-3">
      <StorageBucket title="localStorage" entries={payload.local} />
      <StorageBucket title="sessionStorage" entries={payload.session} />
      <StorageBucket title="cookies" entries={payload.cookies} />
    </div>
  );
}

function StorageBucket({
  title,
  entries,
}: {
  title: string;
  entries: Record<string, string>;
}) {
  const keys = Object.keys(entries);
  return (
    <div>
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">
        {title} ({keys.length})
      </h4>
      {keys.length === 0 ? (
        <p className="text-xs text-neutral-300">empty</p>
      ) : (
        <table className="w-full text-xs">
          <tbody className="divide-y divide-neutral-100">
            {keys.map((k) => (
              <tr key={k} className="align-top">
                <td className="w-1/3 py-1 pr-2 font-mono font-medium text-neutral-600">
                  {k}
                </td>
                <td className="py-1 break-all font-mono text-neutral-800">
                  {entries[k]}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ---- dom ---- */

function DomView({ payload }: { payload: DomArtifact }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-500">
        <span>
          viewport {payload.viewport.width}×{payload.viewport.height}
        </span>
        {payload.targetSelector && (
          <span>
            target <Code>{payload.targetSelector}</Code>
          </span>
        )}
      </div>
      <pre className="max-h-96 overflow-auto rounded bg-neutral-900 p-3 font-mono text-xs leading-relaxed text-neutral-100">
        {payload.html}
      </pre>
    </div>
  );
}

/* ---- trace ---- */

function TraceView({ payload }: { payload: TraceArtifact }) {
  if (payload.requests.length === 0)
    return <Empty>No backend requests in this trace.</Empty>;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-neutral-400">
        session <Code>{payload.sessionId}</Code>
      </p>
      {payload.requests.map((r, i) => (
        <div key={i} className="rounded border border-neutral-200 p-2">
          <div className="flex items-center gap-2 font-mono text-xs">
            <span className="font-semibold text-neutral-500">{r.method}</span>
            <span className={`font-semibold ${statusColor(r.status)}`}>
              {r.status ?? "—"}
            </span>
            <span className="grow break-all text-neutral-800">{r.url}</span>
            <span className="text-neutral-400">
              {r.durationMs != null ? `${Math.round(r.durationMs)}ms` : "—"}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 text-[0.6875rem] text-neutral-400">
            <span>handler {r.handler}</span>
            {r.src && (
              <span>
                src <Code>{r.src}</Code>
              </span>
            )}
            <span>traceId {r.traceId}</span>
          </div>
          {r.threw != null && (
            <pre className="mt-1 overflow-auto rounded bg-red-50 p-2 font-mono text-[0.6875rem] text-red-700">
              {safeStringify(r.threw)}
            </pre>
          )}
          {r.queries.length > 0 && (
            <ul className="mt-2 space-y-1 border-l-2 border-neutral-100 pl-2">
              {r.queries.map((q, qi) => (
                <li key={qi} className="text-[0.6875rem]">
                  <div className="flex gap-2 font-mono text-neutral-700">
                    <span className="grow break-all">{q.sql}</span>
                    <span className="shrink-0 text-neutral-400">
                      {q.durationMs != null
                        ? `${Math.round(q.durationMs)}ms`
                        : "—"}
                    </span>
                  </div>
                  {q.params && q.params.length > 0 && (
                    <div className="text-neutral-400">
                      params {safeStringify(q.params)}
                    </div>
                  )}
                  {q.src && (
                    <div className="text-neutral-300">{q.src}</div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

/* ---- helpers + dispatch ---- */

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs italic text-neutral-400">{children}</p>;
}

function safeStringify(value: unknown): string {
  try {
    return typeof value === "string" ? value : JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function Json({ value }: { value: unknown }) {
  return (
    <pre className="max-h-96 overflow-auto rounded bg-neutral-50 p-3 font-mono text-xs leading-relaxed text-neutral-800">
      {safeStringify(value)}
    </pre>
  );
}

/**
 * Dispatch on artifact name to the matching viewer. `payload` is the decoded,
 * validated tier-2 body for that name.
 */
export function ArtifactView<N extends ArtifactName>({
  name,
  payload,
}: {
  name: N;
  payload: ArtifactPayloadMap[N];
}) {
  switch (name) {
    case "console":
      return <ConsoleView payload={payload as ConsoleArtifact} />;
    case "network":
      return <NetworkView payload={payload as NetworkArtifact} />;
    case "clientState":
      return <ClientStateView payload={payload as ClientStateArtifact} />;
    case "storage":
      return <StorageView payload={payload as StorageArtifact} />;
    case "dom":
      return <DomView payload={payload as DomArtifact} />;
    case "trace":
      return <TraceView payload={payload as TraceArtifact} />;
    default:
      return <Json value={payload} />;
  }
}
