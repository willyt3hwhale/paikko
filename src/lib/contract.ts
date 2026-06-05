/**
 * paikko ticket bundle contract.
 *
 * This is THE shared interface. Every module imports from here: the
 * `<ReportButton>` that produces a bundle, the API that persists it, the ticket
 * UI that renders it, and the agent runner that consumes it. Change a shape here
 * and you change it for everyone, so it lives in one file with types and zod
 * schemas side by side.
 *
 * ## Two tiers
 *
 * A ticket is split so the agent's context stays cheap:
 *
 *   - TIER 1 - the HEAD ({@link TicketHead}). Small, always loaded into agent
 *     context. Carries the user's message, where it happened (route + clicked
 *     element provenance), the conversation thread, and an INDEX of artifacts.
 *     The index lists each artifact by name with a `ref` (how to fetch it) and a
 *     `summary` (one line) plus a few cheap stats, so the agent can decide from
 *     the head alone whether it even needs the heavy payload. Most tickets are
 *     solved from the head with zero fetches.
 *
 *   - TIER 2 - the ARTIFACT PAYLOADS. Heavy, immutable, captured once at report
 *     time (a photograph, not a live window). Fetched by ref only when a fix
 *     needs them: console, network, client state, storage, DOM snapshot, backend
 *     trace. Stored as JSONB rows keyed by ticket+name, served at
 *     `GET /tickets/:id/artifacts/:name`.
 *
 * ## The spine: traceId
 *
 * `traceId` stitches the two halves of a single request together. A frontend
 * {@link NetworkEntry} and the backend {@link TraceRequest} it triggered share
 * the same `traceId`. That is how the agent walks from "this fetch on the page"
 * to "this handler + these queries on the server" without guessing.
 *
 * ## Provenance: src
 *
 * `src` ("file:line:col") appears on every layer the user or agent can point at -
 * the clicked element, the API handler, each DB query - so provenance runs end to
 * end. It is injected at build time (see PROVENANCE.md).
 */

import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Shared primitives                                                  */
/* ------------------------------------------------------------------ */

/** Ticket lifecycle. Mirrors the `TicketStatus` enum in prisma/schema.prisma. */
export const TicketStatusSchema = z.enum([
  "open",
  "reproducing",
  "needs_info",
  "reviewing",
  "closed",
]);
export type TicketStatus = z.infer<typeof TicketStatusSchema>;

/**
 * The canonical names an artifact can have. The artifact index is keyed by these,
 * and `GET /tickets/:id/artifacts/:name` expects one of them.
 */
export const ArtifactNameSchema = z.enum([
  "console",
  "network",
  "clientState",
  "storage",
  "dom",
  "trace",
]);
export type ArtifactName = z.infer<typeof ArtifactNameSchema>;

/**
 * Source provenance, "file:line:col" (e.g. "src/components/Cart.tsx:42:7").
 * Injected at build time onto JSX, attached to handlers and queries.
 */
export const SrcSchema = z.string();
export type Src = z.infer<typeof SrcSchema>;

/** ISO-8601 timestamp string. Used everywhere a time is recorded. */
export const IsoTimeSchema = z.string().datetime();
export type IsoTime = z.infer<typeof IsoTimeSchema>;

/**
 * The id that stitches a frontend network entry to its backend request.
 * Generated client-side per request, echoed by the server.
 */
export const TraceIdSchema = z.string();
export type TraceId = z.infer<typeof TraceIdSchema>;

/* ------------------------------------------------------------------ */
/* TIER 1 - the head                                                  */
/* ------------------------------------------------------------------ */

/**
 * What the user pointed at when they hit report: the clicked DOM element resolved
 * to a CSS selector, its source location, and the owning component. All optional
 * because a report can be fired without a specific target (e.g. a global "this
 * page is wrong").
 */
export const ReportTargetSchema = z.object({
  /** CSS selector identifying the clicked element in the live DOM. */
  selector: z.string().nullable(),
  /** Build-time source provenance of the element ("file:line:col"). */
  src: SrcSchema.nullable(),
  /** Display name of the React component that owns the element. */
  component: z.string().nullable(),
});
export type ReportTarget = z.infer<typeof ReportTargetSchema>;

/** The user-authored core of a report: what's wrong and where. */
export const ReportSchema = z.object({
  /** Free-text description from the reporter. */
  message: z.string(),
  /** Report category (e.g. "bug", "visual", "crash"). Free-form in v0. */
  kind: z.string(),
  /** App route the report was fired from (e.g. "/cart"). */
  route: z.string(),
  /** The clicked element, resolved to selector + provenance + component. */
  target: ReportTargetSchema,
});
export type Report = z.infer<typeof ReportSchema>;

/** One message in the ticket's conversation (reporter, agent, or reviewer). */
export const ThreadMessageSchema = z.object({
  id: z.string(),
  /** Author handle: reporter id, "agent", reviewer id, etc. */
  by: z.string(),
  text: z.string(),
  at: IsoTimeSchema,
});
export type ThreadMessage = z.infer<typeof ThreadMessageSchema>;

/**
 * One entry in the artifact index. Lives in the head so the agent can read the
 * `summary` and stats and decide whether to fetch the heavy payload via `ref`.
 *
 * `count` and `size` are cheap, type-agnostic stats:
 *   - `count`: number of records in the payload (console lines, network calls,
 *     backend requests, ...). Null for single-object artifacts (clientState).
 *   - `size`: serialized payload size in bytes.
 */
export const ArtifactIndexEntrySchema = z.object({
  /** Fetch handle: `GET /tickets/:id/artifacts/:name`. */
  ref: z.string(),
  /** One-line human/agent summary so the head is decision-complete. */
  summary: z.string(),
  /** Record count for collection artifacts; null for singletons. */
  count: z.number().int().nullable(),
  /** Serialized payload size in bytes. */
  size: z.number().int(),
});
export type ArtifactIndexEntry = z.infer<typeof ArtifactIndexEntrySchema>;

/**
 * The artifacts index: a map from artifact name to its index entry. Partial -
 * a ticket only indexes the artifacts that were actually captured.
 */
export const ArtifactIndexSchema = z.record(
  ArtifactNameSchema,
  ArtifactIndexEntrySchema,
);
export type ArtifactIndex = Partial<Record<ArtifactName, ArtifactIndexEntry>>;

/**
 * TIER 1. The ticket head - always loaded into agent context. Small and
 * self-sufficient: message, where it happened, the thread, and the index of
 * heavy artifacts behind refs.
 */
export const TicketHeadSchema = z.object({
  id: z.string(),
  status: TicketStatusSchema,
  createdAt: IsoTimeSchema,
  /** Who filed it (user id / handle). */
  reporter: z.string(),
  report: ReportSchema,
  thread: z.array(ThreadMessageSchema),
  artifacts: ArtifactIndexSchema,
});
export type TicketHead = z.infer<typeof TicketHeadSchema>;

/* ------------------------------------------------------------------ */
/* TIER 2 - artifact payloads                                         */
/* ------------------------------------------------------------------ */

/* ---- console ---- */

/** One captured console line from the ring buffer. */
export const ConsoleEntrySchema = z.object({
  level: z.enum(["log", "info", "warn", "error", "debug"]),
  /** Already-formatted message text. */
  message: z.string(),
  /** Structured args as captured (best-effort serialized). */
  args: z.array(z.unknown()).optional(),
  at: IsoTimeSchema,
});
export type ConsoleEntry = z.infer<typeof ConsoleEntrySchema>;

/** Payload for the `console` artifact: the console ring buffer, oldest first. */
export const ConsoleArtifactSchema = z.array(ConsoleEntrySchema);
export type ConsoleArtifact = z.infer<typeof ConsoleArtifactSchema>;

/* ---- network ---- */

/**
 * One captured frontend network call. `traceId` is the spine: it matches the
 * `traceId` on the {@link TraceRequest} the call hit on the backend.
 */
export const NetworkEntrySchema = z.object({
  /** Spine id linking this call to its backend request. */
  traceId: TraceIdSchema,
  method: z.string(),
  url: z.string(),
  /** HTTP status; null if the request never completed. */
  status: z.number().int().nullable(),
  /** Request body as captured (serialized; null if none). */
  reqBody: z.unknown().nullable(),
  /** Response body as captured (serialized; null if none). */
  resBody: z.unknown().nullable(),
  startedAt: IsoTimeSchema,
  /** Round-trip duration in milliseconds; null if unknown. */
  durationMs: z.number().nullable(),
});
export type NetworkEntry = z.infer<typeof NetworkEntrySchema>;

/** Payload for the `network` artifact: last N network calls, oldest first. */
export const NetworkArtifactSchema = z.array(NetworkEntrySchema);
export type NetworkArtifact = z.infer<typeof NetworkArtifactSchema>;

/* ---- client state ---- */

/**
 * Payload for the `clientState` artifact: a snapshot of the mandated state store
 * at report time. Shape is app-defined, so it's an opaque record.
 */
export const ClientStateArtifactSchema = z.record(z.string(), z.unknown());
export type ClientStateArtifact = z.infer<typeof ClientStateArtifactSchema>;

/* ---- storage ---- */

/**
 * Payload for the `storage` artifact: localStorage / sessionStorage / cookies
 * captured at report time. Each is a flat string->string map.
 */
export const StorageArtifactSchema = z.object({
  local: z.record(z.string(), z.string()),
  session: z.record(z.string(), z.string()),
  cookies: z.record(z.string(), z.string()),
});
export type StorageArtifact = z.infer<typeof StorageArtifactSchema>;

/* ---- dom ---- */

/**
 * Payload for the `dom` artifact: a snapshot of the DOM at report time. `html` is
 * the serialized document/subtree; `targetSelector` points back at the clicked
 * element within it.
 */
export const DomArtifactSchema = z.object({
  /** Serialized DOM (full document or relevant subtree). */
  html: z.string(),
  /** Selector of the reported element within `html`. */
  targetSelector: z.string().nullable(),
  /** Viewport size at capture time. */
  viewport: z.object({
    width: z.number().int(),
    height: z.number().int(),
  }),
});
export type DomArtifact = z.infer<typeof DomArtifactSchema>;

/* ---- backend trace ---- */

/** One database query recorded inside a backend request. */
export const TraceQuerySchema = z.object({
  /** SQL or query string as executed. */
  sql: z.string(),
  /** Bound parameters, serialized. */
  params: z.array(z.unknown()).optional(),
  /** Execution time in milliseconds. */
  durationMs: z.number().nullable(),
  /** Provenance of the call site issuing the query ("file:line:col"). */
  src: SrcSchema.nullable(),
});
export type TraceQuery = z.infer<typeof TraceQuerySchema>;

/**
 * One backend request captured by the `withCapture()` handler wrapper. Joined to
 * a frontend {@link NetworkEntry} by `traceId`.
 */
export const TraceRequestSchema = z.object({
  /** Spine id - matches the frontend NetworkEntry that triggered this request. */
  traceId: TraceIdSchema,
  /** Name/identity of the handler that ran. */
  handler: z.string(),
  /** Provenance of the handler ("file:line:col"). */
  src: SrcSchema.nullable(),
  method: z.string(),
  url: z.string(),
  status: z.number().int().nullable(),
  /** Queries issued during this request, in order. */
  queries: z.array(TraceQuerySchema),
  /** Serialized error if the handler threw; null on success. */
  threw: z.unknown().nullable(),
  durationMs: z.number().nullable(),
});
export type TraceRequest = z.infer<typeof TraceRequestSchema>;

/**
 * Payload for the `trace` artifact: the backend side of the report. One capture
 * session containing every backend request that ran during the reported
 * interaction, each stitched to its frontend call by `traceId`.
 */
export const TraceArtifactSchema = z.object({
  /** Backend capture session id for the reported interaction. */
  sessionId: z.string(),
  requests: z.array(TraceRequestSchema),
});
export type TraceArtifact = z.infer<typeof TraceArtifactSchema>;

/* ------------------------------------------------------------------ */
/* Payload routing                                                    */
/* ------------------------------------------------------------------ */

/**
 * Maps each artifact name to the zod schema for its payload. Use this to validate
 * a payload before persisting it or after fetching it by ref:
 *
 *   ArtifactPayloadSchemas[name].parse(payload)
 */
export const ArtifactPayloadSchemas = {
  console: ConsoleArtifactSchema,
  network: NetworkArtifactSchema,
  clientState: ClientStateArtifactSchema,
  storage: StorageArtifactSchema,
  dom: DomArtifactSchema,
  trace: TraceArtifactSchema,
} as const;

/** Type-level map from artifact name to its decoded payload type. */
export interface ArtifactPayloadMap {
  console: ConsoleArtifact;
  network: NetworkArtifact;
  clientState: ClientStateArtifact;
  storage: StorageArtifact;
  dom: DomArtifact;
  trace: TraceArtifact;
}

/** Union of all artifact payloads (the body served behind any ref). */
export type ArtifactPayload = ArtifactPayloadMap[ArtifactName];

/* ------------------------------------------------------------------ */
/* Bundle assembly                                                    */
/* ------------------------------------------------------------------ */

/**
 * What the `<ReportButton>` produces and POSTs to create a ticket: the head's
 * report core plus every captured artifact payload inline. The server splits this
 * into the persisted head (with a built index) and the artifact rows.
 */
export const ReportBundleSchema = z.object({
  reporter: z.string(),
  report: ReportSchema,
  artifacts: z
    .object({
      console: ConsoleArtifactSchema.optional(),
      network: NetworkArtifactSchema.optional(),
      clientState: ClientStateArtifactSchema.optional(),
      storage: StorageArtifactSchema.optional(),
      dom: DomArtifactSchema.optional(),
      trace: TraceArtifactSchema.optional(),
    })
    .partial(),
});
export type ReportBundle = z.infer<typeof ReportBundleSchema>;
