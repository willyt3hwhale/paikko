/**
 * @paikko/widget - the consumer-installable report widget. Public surface.
 *
 * The host app mounts {@link PaikkoProvider} once (typically in the root layout),
 * configured with the backend's reports `endpoint` (cross-origin OK), an optional
 * `projectKey` (SaaS seam), an optional `ticketsUrl` (review-queue link), and its
 * own `getClientState` reader. The widget then floats, captures, and POSTs
 * contract-valid {@link ReportBundle}s to that endpoint. `ReportButton`/`PaikkoNav`
 * are exported for hosts that want to compose the pieces themselves, and the
 * capture primitives are re-exported for apps that drive capture directly.
 */
export { PaikkoProvider, default } from "./PaikkoProvider";
export type { PaikkoProviderProps } from "./PaikkoProvider";

export { ReportButton } from "./ReportButton";
export type { ReportButtonProps } from "./ReportButton";

export { PaikkoNav } from "./PaikkoNav";
export type { PaikkoNavProps } from "./PaikkoNav";

export {
  Capture,
  resolveTarget,
  buildSelector,
  snapshotStorage,
  snapshotDom,
  snapshotScreenshot,
  snapshotArtifacts,
  getSessionId,
  TRACE_HEADER,
  SESSION_HEADER,
} from "./capture";
export type { CaptureConfig, CapturedArtifacts } from "./capture";
