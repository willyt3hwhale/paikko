"use client";

/**
 * Client boundary that mounts the paikko `<ReportButton>` once for the whole app
 * and wires it to the mandated state store.
 *
 * The root layout is a server component, so the capture entry point has to be
 * mounted inside a `"use client"` island. This is that island: it renders the
 * floating report button and hands it the store's {@link getState} as
 * `getClientState`, so the `clientState` artifact is captured from the one
 * mandated store at report time.
 */
import React from "react";
import { ReportButton } from "./ReportButton";
import { getState } from "./store";

export function PaikkoProvider(): React.JSX.Element {
  return <ReportButton getClientState={getState} />;
}

export default PaikkoProvider;
