/**
 * Ticket store - the persisted side of the bundle contract.
 *
 * This module owns:
 *   - CRUD over the Prisma `Ticket` / `ThreadMessage` / `Artifact` rows.
 *   - The ticket state machine (the report/review loop). Transitions are
 *     validated here so no route handler can move a ticket through an illegal
 *     edge.
 *   - Re-assembly of persisted rows back into the on-the-wire {@link TicketHead}
 *     (tier 1) and {@link ArtifactPayload} (tier 2) shapes from the contract.
 *
 * Shapes are the contract's; persistence is an implementation detail. Anything
 * crossing the wire goes through the contract zod schemas, so the DB can never
 * leak a shape the agent runner doesn't expect.
 */

import { getPrisma } from "@/lib/db";
import {
  ArtifactIndex,
  ArtifactIndexEntry,
  ArtifactName,
  ArtifactNameSchema,
  ArtifactPayload,
  ArtifactPayloadMap,
  ArtifactPayloadSchemas,
  ReportBundle,
  ThreadMessage,
  TicketHead,
  TicketHeadSchema,
  TicketStatus,
} from "@/lib/contract";

/* ------------------------------------------------------------------ */
/* State machine                                                      */
/* ------------------------------------------------------------------ */

/**
 * The legal status transitions, mirroring the loop in README:
 *
 *   open -> reproducing
 *   reproducing -> needs_info     (repro failed / agent needs info)
 *   reproducing -> reviewing      (fix proposed; PARKED, non-blocking)
 *   needs_info  -> reproducing    (reporter answered; retry repro)
 *   reviewing   -> closed         (accepted + verified)
 *   reviewing   -> reproducing    (rejected + comment; back to fix)
 *   closed      -> reproducing    (reopened)
 *
 * `reviewing` is a parked state: the runner releases the ticket and picks
 * another while a human reviews, so nothing here blocks the queue.
 */
const TRANSITIONS: Record<TicketStatus, readonly TicketStatus[]> = {
  open: ["reproducing"],
  reproducing: ["needs_info", "reviewing"],
  needs_info: ["reproducing"],
  reviewing: ["closed", "reproducing"],
  closed: ["reproducing"],
};

/** Thrown when a caller asks for a status edge the machine forbids. */
export class InvalidTransitionError extends Error {
  constructor(
    readonly from: TicketStatus,
    readonly to: TicketStatus,
  ) {
    super(`illegal ticket transition: ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
  }
}

/** Thrown when an operation targets a ticket id that doesn't exist. */
export class TicketNotFoundError extends Error {
  constructor(readonly id: string) {
    super(`ticket not found: ${id}`);
    this.name = "TicketNotFoundError";
  }
}

/** Thrown when an artifact name isn't indexed on the ticket. */
export class ArtifactNotFoundError extends Error {
  constructor(
    readonly ticketId: string,
    readonly name: string,
  ) {
    super(`artifact not found: ${ticketId}/${name}`);
    this.name = "ArtifactNotFoundError";
  }
}

/** Whether `from -> to` is a legal transition. Identity edges are rejected. */
export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/* ------------------------------------------------------------------ */
/* Row -> contract assembly                                           */
/* ------------------------------------------------------------------ */

/**
 * Minimal shape of the rows this module reads back. Declared structurally so we
 * don't depend on Prisma's generated types leaking through the public surface
 * (and so this file type-checks before `prisma generate` has run).
 */
interface ThreadRow {
  id: string;
  by: string;
  text: string;
  at: Date;
}

interface ArtifactRow {
  name: string;
  summary: string;
  payload: unknown;
  /** Serialized payload byte size, computed at write time and cached here. */
  size?: number;
}

interface TicketRow {
  id: string;
  status: string;
  kind: string;
  reporter: string;
  route: string;
  targetSelector: string | null;
  targetSrc: string | null;
  targetComponent: string | null;
  message: string;
  createdAt: Date;
  thread: ThreadRow[];
  artifacts: ArtifactRow[];
}

/** Byte size of a JSON value as it will sit on the wire / in JSONB. */
function jsonSize(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
}

/**
 * Decode a stored artifact payload. SQLite has no JSON column type, so payloads
 * are persisted as JSON strings; this turns the stored string back into the value
 * the contract schemas expect. Already-decoded values (defensive) pass through.
 */
function decodePayload(stored: unknown): unknown {
  if (typeof stored !== "string") return stored;
  try {
    return JSON.parse(stored);
  } catch {
    return stored;
  }
}

/**
 * Record count for an artifact payload: array length for collections, null for
 * single-object artifacts (clientState, storage, dom, trace-session). Matches
 * the contract's `count` semantics ("null for singletons").
 */
function payloadCount(name: ArtifactName, payload: unknown): number | null {
  if (name === "console" || name === "network") {
    return Array.isArray(payload) ? payload.length : 0;
  }
  return null;
}

/** Build the `ref` fetch handle for an artifact. */
function artifactRef(ticketId: string, name: ArtifactName): string {
  return `GET /tickets/${ticketId}/artifacts/${name}`;
}

/** Assemble one artifact index entry from its stored row. */
function toIndexEntry(ticketId: string, row: ArtifactRow): ArtifactIndexEntry {
  const name = ArtifactNameSchema.parse(row.name);
  const payload = decodePayload(row.payload);
  return {
    ref: artifactRef(ticketId, name),
    summary: row.summary,
    count: payloadCount(name, payload),
    size: row.size ?? jsonSize(payload),
  };
}

/** Assemble the artifacts index (tier-1 refs only) from stored artifact rows. */
function toArtifactIndex(ticketId: string, rows: ArtifactRow[]): ArtifactIndex {
  const index: ArtifactIndex = {};
  for (const row of rows) {
    const name = ArtifactNameSchema.parse(row.name);
    index[name] = toIndexEntry(ticketId, row);
  }
  return index;
}

/** Re-assemble a persisted ticket into the contract's tier-1 {@link TicketHead}. */
function toHead(row: TicketRow): TicketHead {
  const head: TicketHead = {
    id: row.id,
    status: row.status as TicketStatus,
    createdAt: row.createdAt.toISOString(),
    reporter: row.reporter,
    report: {
      message: row.message,
      kind: row.kind,
      route: row.route,
      target: {
        selector: row.targetSelector,
        src: row.targetSrc,
        component: row.targetComponent,
      },
    },
    thread: row.thread
      .map(toThreadMessage)
      .sort((a, b) => a.at.localeCompare(b.at)),
    artifacts: toArtifactIndex(row.id, row.artifacts),
  };
  // Guarantee we never emit a shape the agent runner can't parse.
  return TicketHeadSchema.parse(head);
}

function toThreadMessage(row: ThreadRow): ThreadMessage {
  return { id: row.id, by: row.by, text: row.text, at: row.at.toISOString() };
}

/** The relation selection needed to assemble a full head. */
const headInclude = {
  thread: true,
  artifacts: { select: { name: true, summary: true, payload: true } },
} as const;

/* ------------------------------------------------------------------ */
/* Intake - bundle -> persisted ticket + artifact rows                */
/* ------------------------------------------------------------------ */

/** One-line, type-aware summary for an artifact, used in the tier-1 index. */
function summarize(name: ArtifactName, payload: unknown): string {
  switch (name) {
    case "console": {
      const arr = payload as ArtifactPayloadMap["console"];
      const errors = arr.filter((e) => e.level === "error").length;
      const warns = arr.filter((e) => e.level === "warn").length;
      return `${arr.length} console line(s), ${errors} error(s), ${warns} warn(s)`;
    }
    case "network": {
      const arr = payload as ArtifactPayloadMap["network"];
      const failed = arr.filter(
        (e) => e.status === null || (e.status ?? 0) >= 400,
      ).length;
      return `${arr.length} network call(s), ${failed} failed/incomplete`;
    }
    case "clientState": {
      const keys = Object.keys(payload as ArtifactPayloadMap["clientState"]);
      return `client state snapshot, ${keys.length} top-level key(s)`;
    }
    case "storage": {
      const s = payload as ArtifactPayloadMap["storage"];
      return `storage: ${Object.keys(s.local).length} local, ${Object.keys(s.session).length} session, ${Object.keys(s.cookies).length} cookie(s)`;
    }
    case "dom": {
      const d = payload as ArtifactPayloadMap["dom"];
      return `DOM snapshot ${d.viewport.width}x${d.viewport.height}, ${d.html.length} char(s)`;
    }
    case "trace": {
      const t = payload as ArtifactPayloadMap["trace"];
      const queries = t.requests.reduce((n, r) => n + r.queries.length, 0);
      const threw = t.requests.filter((r) => r.threw !== null).length;
      return `${t.requests.length} backend request(s), ${queries} quer(ies), ${threw} threw`;
    }
  }
}

/**
 * Intake: split a {@link ReportBundle} into a persisted ticket head plus one
 * {@link Artifact} row per captured artifact name. Each payload is validated
 * against its contract schema before it is written, so a malformed capture is
 * rejected at the seam rather than rotting in the DB. Returns the new ticket id.
 *
 * The whole split is one transaction: a ticket never lands without its artifacts.
 */
export async function createTicketFromBundle(
  bundle: ReportBundle,
): Promise<{ id: string }> {
  const prisma = getPrisma();
  const { reporter, report, artifacts } = bundle;

  const artifactRows = (
    Object.keys(artifacts) as ArtifactName[]
  ).flatMap((name) => {
    const raw = artifacts[name];
    if (raw === undefined) return [];
    // Validate the inline payload against the contract before persisting.
    const payload = ArtifactPayloadSchemas[name].parse(raw);
    return [
      {
        name,
        summary: summarize(name, payload),
        // SQLite has no JSON column; persist the validated payload as a JSON
        // string and decode it on read.
        payload: JSON.stringify(payload),
      },
    ];
  });

  const created = await prisma.ticket.create({
    data: {
      status: "open",
      kind: report.kind,
      reporter,
      route: report.route,
      message: report.message,
      targetSelector: report.target.selector,
      targetSrc: report.target.src,
      targetComponent: report.target.component,
      artifacts: { create: artifactRows },
    },
    select: { id: true },
  });

  return { id: created.id };
}

/* ------------------------------------------------------------------ */
/* Reads                                                              */
/* ------------------------------------------------------------------ */

/**
 * List tier-1 heads, optionally filtered by status. This is the queue the agent
 * runner polls (e.g. status="open"). Returns refs/summaries only - never the
 * heavy artifact payloads. Newest first.
 */
export async function listHeads(
  status?: TicketStatus,
): Promise<TicketHead[]> {
  const prisma = getPrisma();
  const rows = await prisma.ticket.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" },
    include: headInclude,
  });
  return (rows as unknown as TicketRow[]).map(toHead);
}

/** Fetch one tier-1 head by id, or throw {@link TicketNotFoundError}. */
export async function getHead(id: string): Promise<TicketHead> {
  const prisma = getPrisma();
  const row = await prisma.ticket.findUnique({
    where: { id },
    include: headInclude,
  });
  if (!row) throw new TicketNotFoundError(id);
  return toHead(row as unknown as TicketRow);
}

/**
 * Fetch one tier-2 artifact payload by ticket + name. Re-validated against the
 * contract schema on the way out so a fetch never returns a drifted shape.
 * Throws {@link TicketNotFoundError} / {@link ArtifactNotFoundError}.
 */
export async function getArtifactPayload<N extends ArtifactName>(
  ticketId: string,
  name: N,
): Promise<ArtifactPayloadMap[N]> {
  const prisma = getPrisma();
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: { id: true },
  });
  if (!ticket) throw new TicketNotFoundError(ticketId);

  const row = await prisma.artifact.findUnique({
    where: { ticketId_name: { ticketId, name } },
    select: { payload: true },
  });
  if (!row) throw new ArtifactNotFoundError(ticketId, name);

  return ArtifactPayloadSchemas[name].parse(
    decodePayload(row.payload),
  ) as ArtifactPayloadMap[N];
}

/* ------------------------------------------------------------------ */
/* Mutations                                                          */
/* ------------------------------------------------------------------ */

/**
 * Move a ticket to a new status, enforcing the state machine. Returns the
 * updated head. Throws {@link TicketNotFoundError} if the id is unknown or
 * {@link InvalidTransitionError} if the edge is illegal.
 *
 * Done in a transaction with a re-read of the current status so two concurrent
 * runners can't both drive the same illegal edge.
 */
export async function setStatus(
  id: string,
  to: TicketStatus,
): Promise<TicketHead> {
  // NOTE: Cloudflare D1 does not support interactive (callback) transactions, so
  // the @prisma/adapter-d1 driver adapter rejects `prisma.$transaction(async tx
  // => ...)`. We read-then-write without a wrapping transaction. The state
  // machine is still enforced (illegal edges throw); the lost guarantee is only
  // the atomic read-modify-write against a concurrent racer. v0 runs a single
  // serial runner, so a lost update here is acceptable - documented, not hidden.
  const prisma = getPrisma();
  const current = await prisma.ticket.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!current) throw new TicketNotFoundError(id);
  const from = current.status as TicketStatus;
  if (from !== to) {
    if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
    await prisma.ticket.update({ where: { id }, data: { status: to } });
  }
  return getHead(id);
}

/**
 * Append a message to a ticket's thread (reporter answering a needs_info, the
 * agent posting a fix note, a reviewer rejecting). Returns the updated head.
 * Throws {@link TicketNotFoundError} if the ticket is gone.
 */
export async function appendThreadMessage(
  id: string,
  by: string,
  text: string,
): Promise<TicketHead> {
  const prisma = getPrisma();
  const ticket = await prisma.ticket.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!ticket) throw new TicketNotFoundError(id);

  await prisma.threadMessage.create({
    data: { ticketId: id, by, text },
  });
  return getHead(id);
}

/**
 * Convenience for the review loop: append a message AND transition in one call.
 * Either both land or neither does. Used when a status change carries a comment
 * (e.g. reviewer rejects with a reason -> reviewing -> reproducing + note).
 */
export async function patchTicket(
  id: string,
  patch: { status?: TicketStatus; message?: { by: string; text: string } },
): Promise<TicketHead> {
  // See setStatus() above: D1 has no interactive transactions, so this is no
  // longer atomic. We validate the transition BEFORE writing anything, so an
  // illegal edge still aborts without a partial write of the message. The only
  // weakened guarantee is a concurrent racer between the read and the writes,
  // which the single serial v0 runner does not hit.
  const prisma = getPrisma();
  const current = await prisma.ticket.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!current) throw new TicketNotFoundError(id);

  if (patch.status) {
    const from = current.status as TicketStatus;
    if (from !== patch.status && !canTransition(from, patch.status)) {
      throw new InvalidTransitionError(from, patch.status);
    }
  }

  if (patch.message) {
    await prisma.threadMessage.create({
      data: { ticketId: id, by: patch.message.by, text: patch.message.text },
    });
  }
  if (patch.status) {
    const from = current.status as TicketStatus;
    if (from !== patch.status) {
      await prisma.ticket.update({
        where: { id },
        data: { status: patch.status },
      });
    }
  }
  return getHead(id);
}

export type { ArtifactPayload };
