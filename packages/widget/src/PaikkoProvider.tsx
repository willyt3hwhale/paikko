"use client";

/**
 * Client boundary that mounts the paikko `<ReportButton>` (and optional
 * `<PaikkoNav>` pill) once for the whole host app.
 *
 * The host app's root layout is typically a server component, so the capture
 * entry point has to be mounted inside a `"use client"` island. This is that
 * island. The widget is backend-agnostic and store-agnostic:
 *
 *  - `endpoint` / `projectKey` configure where reports go and which tenant they
 *    belong to (forwarded to `<ReportButton>`); the bundle is POSTed there
 *    cross-origin.
 *  - `ticketsUrl` configures the review-queue link (forwarded to `<PaikkoNav>`);
 *    omit it to hide the nav pill.
 *  - `getClientState` is supplied BY THE HOST APP - the provider does not import
 *    any store. The host passes its own store's `getState` (or equivalent) so
 *    the `clientState` artifact is captured from the host's app state at report
 *    time. Omit it and client state is captured as `{}`.
 */
import React from "react";
import { ReportButton } from "./ReportButton";
import { PaikkoNav } from "./PaikkoNav";

export interface PaikkoProviderProps {
  /** Backend reports intake URL the bundle is POSTed to (may be cross-origin). */
  endpoint: string;
  /** Project/tenant key stamped onto every report (SaaS seam). */
  projectKey?: string | null;
  /** Absolute URL of the backend review queue; omit to hide the nav pill. */
  ticketsUrl?: string;
  /** Reader for the host app's client state, snapshotted at report time. */
  getClientState?: () => Record<string, unknown>;
  /** Who is filing. Defaults to "anonymous" inside `<ReportButton>`. */
  reporter?: string;
}

export function PaikkoProvider({
  endpoint,
  projectKey = null,
  ticketsUrl,
  getClientState,
  reporter,
}: PaikkoProviderProps): React.JSX.Element {
  return (
    <>
      <ReportButton
        endpoint={endpoint}
        projectKey={projectKey}
        getClientState={getClientState}
        reporter={reporter}
      />
      <PaikkoNav ticketsUrl={ticketsUrl} />
    </>
  );
}

export default PaikkoProvider;
