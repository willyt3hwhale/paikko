/**
 * paikko client capture layer - public surface.
 *
 * The host app mounts {@link ReportButton} once (typically in the root layout)
 * and is done: it floats, captures, and POSTs contract-valid {@link ReportBundle}s
 * to `/api/reports`. The capture primitives are re-exported for apps that want to
 * drive capture themselves.
 */
export { ReportButton, default } from "./ReportButton";
export type { ReportButtonProps } from "./ReportButton";

export {
  Capture,
  resolveTarget,
  buildSelector,
  snapshotStorage,
  snapshotDom,
  snapshotArtifacts,
  getSessionId,
  TRACE_HEADER,
  SESSION_HEADER,
} from "./capture";
export type { CaptureConfig, CapturedArtifacts } from "./capture";
