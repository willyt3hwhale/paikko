/**
 * HTTP helpers for the ticket routes.
 *
 * The mandated `withCapture` seam (`@/paikko/server/withCapture`) deliberately
 * re-throws handler errors so Next's error handling and the trace capture stay
 * intact - it does NOT turn thrown values into HTTP responses. So each route's
 * handler maps the store's typed errors (and zod validation failures) to the
 * right status itself, via {@link errorToResponse}. This keeps that mapping in
 * one place instead of repeating a try/catch ladder in every route file.
 */

import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  ArtifactNotFoundError,
  InvalidTransitionError,
  TicketNotFoundError,
} from "./store";

/** Map a thrown value to a JSON error response with a sensible HTTP status. */
export function errorToResponse(err: unknown): NextResponse {
  if (err instanceof TicketNotFoundError || err instanceof ArtifactNotFoundError) {
    return NextResponse.json({ error: err.message }, { status: 404 });
  }
  if (err instanceof InvalidTransitionError) {
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      { error: "validation failed", issues: err.issues },
      { status: 400 },
    );
  }
  if (err instanceof SyntaxError) {
    // Thrown by req.json() on a malformed body.
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  console.error("[tickets api] unhandled error:", err);
  return NextResponse.json({ error: "internal error" }, { status: 500 });
}
