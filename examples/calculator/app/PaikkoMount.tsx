"use client";

/**
 * Client island that mounts the paikko widget for the whole app.
 *
 * This lives in its own `"use client"` module (not the root layout, which is a
 * server component) for two reasons:
 *  1. The widget's <PaikkoProvider> is a client component.
 *  2. We pass `getClientState` - a function - which cannot cross the
 *     server->client boundary as a prop. Resolving the store getter here, inside
 *     a client module, keeps the function client-side.
 *
 * Configuration is the model a real consumer follows: point `endpoint` at the
 * backend's cross-origin reports intake, stamp a `projectKey` (SaaS seam), link
 * `ticketsUrl` to the backend review queue, and hand the widget this app's own
 * store reader so the report's `clientState` artifact reflects live calculator
 * state. Endpoint/tickets URLs are overridable via NEXT_PUBLIC_* env vars so the
 * same build can point at a deployed backend.
 */
import { PaikkoProvider } from "@paikko/widget";
import { getState } from "@/lib/store";

const ENDPOINT =
  process.env.NEXT_PUBLIC_PAIKKO_ENDPOINT ?? "http://localhost:8788/api/reports";
const TICKETS_URL =
  process.env.NEXT_PUBLIC_PAIKKO_TICKETS_URL ?? "http://localhost:8788/tickets";
const PROJECT_KEY = process.env.NEXT_PUBLIC_PAIKKO_PROJECT_KEY ?? "calculator-demo";

export function PaikkoMount() {
  return (
    <PaikkoProvider
      endpoint={ENDPOINT}
      projectKey={PROJECT_KEY}
      ticketsUrl={TICKETS_URL}
      getClientState={getState}
      reporter="calculator-demo"
    />
  );
}
