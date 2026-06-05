/**
 * Ticket API client for the in-app review UI.
 *
 * Thin typed wrapper over the ticket HTTP API owned by the API module. Every
 * shape crossing this boundary is a contract type, validated with the matching
 * zod schema from "@/lib/contract" so a drifting server is caught at the seam
 * instead of rendering garbage.
 *
 * Endpoints consumed (owned by the API module, served under the app):
 *   GET    /tickets                          -> TicketHead[]    (the queue)
 *   GET    /tickets/:id                       -> TicketHead      (one head)
 *   GET    /tickets/:id/artifacts/:name       -> ArtifactPayload (tier-2, lazy)
 *   PATCH  /tickets/:id                        -> TicketHead      (status change)
 *   POST   /tickets/:id/thread                 -> ThreadMessage   (append reply)
 */

import {
  TicketHeadSchema,
  ThreadMessageSchema,
  ArtifactPayloadSchemas,
  type TicketHead,
  type ThreadMessage,
  type ArtifactName,
  type ArtifactPayloadMap,
  type TicketStatus,
} from "@/lib/contract";
import { z } from "zod";

/** Base path for the ticket API. Relative so it works behind any host. */
const BASE = "/tickets";

const TicketHeadListSchema = z.array(TicketHeadSchema);

async function asJson(res: Response): Promise<unknown> {
  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      /* ignore */
    }
    throw new ApiError(
      `${res.status} ${res.statusText}${detail ? `: ${detail}` : ""}`,
      res.status,
    );
  }
  return res.json();
}

/** Error carrying the HTTP status so callers can branch on 404 etc. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** GET /tickets - the full queue of ticket heads. */
export async function listTickets(signal?: AbortSignal): Promise<TicketHead[]> {
  const body = await asJson(await fetch(BASE, { signal, cache: "no-store" }));
  return TicketHeadListSchema.parse(body);
}

/** GET /tickets/:id - a single ticket head. */
export async function getTicket(
  id: string,
  signal?: AbortSignal,
): Promise<TicketHead> {
  const body = await asJson(
    await fetch(`${BASE}/${encodeURIComponent(id)}`, {
      signal,
      cache: "no-store",
    }),
  );
  return TicketHeadSchema.parse(body);
}

/**
 * GET /tickets/:id/artifacts/:name - a tier-2 artifact payload, fetched lazily
 * only when the reviewer expands it. Validated against the schema for `name`,
 * so the returned value is correctly typed to the requested artifact.
 */
export async function getArtifact<N extends ArtifactName>(
  id: string,
  name: N,
  signal?: AbortSignal,
): Promise<ArtifactPayloadMap[N]> {
  const body = await asJson(
    await fetch(
      `${BASE}/${encodeURIComponent(id)}/artifacts/${encodeURIComponent(name)}`,
      { signal, cache: "no-store" },
    ),
  );
  // The schema map is keyed by ArtifactName; pick the schema for this name.
  // Narrow to a generic ZodType so `.parse` is callable across the union of
  // concrete schemas, then assert the validated result to the payload type.
  const schema: z.ZodType<unknown> = ArtifactPayloadSchemas[name];
  return schema.parse(body) as ArtifactPayloadMap[N];
}

/**
 * PATCH /tickets/:id - change ticket status. Used by the review actions:
 *   Accept  -> "closed"
 *   Reject  -> "reproducing" (back into the fix loop)
 * Returns the updated head.
 */
export async function setTicketStatus(
  id: string,
  status: TicketStatus,
  signal?: AbortSignal,
): Promise<TicketHead> {
  const body = await asJson(
    await fetch(`${BASE}/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
      signal,
    }),
  );
  return TicketHeadSchema.parse(body);
}

/**
 * POST /tickets/:id/thread - append a message to the ticket conversation.
 * Used by Reply and by Reject (the rejection comment). Returns the created
 * ThreadMessage.
 */
export async function postThreadMessage(
  id: string,
  msg: { by: string; text: string },
  signal?: AbortSignal,
): Promise<ThreadMessage> {
  const body = await asJson(
    await fetch(`${BASE}/${encodeURIComponent(id)}/thread`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(msg),
      signal,
    }),
  );
  return ThreadMessageSchema.parse(body);
}
