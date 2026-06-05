"use client";

/**
 * paikko `<ReportButton>` - the entry point of the whole product.
 *
 * A floating button. Click it to enter "point mode": the page is overlaid, the
 * cursor becomes a crosshair, and the next click on any element is captured as
 * the report {@link ReportTarget} (its `data-src` provenance, owning component,
 * and a re-findable CSS selector). A small form then collects a free-text
 * message and a kind (bug / idea / visual).
 *
 * On submit it assembles a {@link ReportBundle} - the tier-1 report core plus
 * every captured artifact payload inline (console, network, client state,
 * storage, DOM) - validates it against the contract, and POSTs it to
 * `/api/reports`. The server splits the bundle into the persisted head + the
 * artifact rows.
 *
 * The {@link Capture} controller is installed for the component's lifetime so the
 * console/network ring buffers are already warm when the user reports.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type Report,
  type ReportTarget,
  type ReportBundle,
  ReportBundleSchema,
} from "@/lib/contract";
import {
  Capture,
  resolveTarget,
  snapshotArtifacts,
  type CaptureConfig,
} from "./capture";

/** Report kinds offered in the form. `kind` is free-form in the contract. */
const KINDS = ["bug", "idea", "visual"] as const;
type Kind = (typeof KINDS)[number];

type Phase = "idle" | "pointing" | "form" | "submitting" | "done" | "error";

export interface ReportButtonProps {
  /** Who is filing. Defaults to "anonymous" if not supplied by the host app. */
  reporter?: string;
  /** Where to POST the bundle. Defaults to the mandated `/api/reports`. */
  endpoint?: string;
  /**
   * Reader for the mandated client-state store. The store seam owns the store;
   * the host app passes its `getState` (or equivalent) here so capture can
   * snapshot it. Omitted -> client state is captured as `{}`.
   */
  getClientState?: () => Record<string, unknown>;
  /** Tuning for the capture buffers. Merged over capture defaults. */
  captureConfig?: Partial<CaptureConfig>;
  /** Called with the created ticket id (or raw response) after a successful POST. */
  onReported?: (result: unknown) => void;
}

export function ReportButton({
  reporter = "anonymous",
  endpoint = "/api/reports",
  getClientState,
  captureConfig,
  onReported,
}: ReportButtonProps): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>("idle");
  const [target, setTarget] = useState<ReportTarget | null>(null);
  const [message, setMessage] = useState("");
  const [kind, setKind] = useState<Kind>("bug");
  const [errorText, setErrorText] = useState<string | null>(null);

  // One capture controller for the component's lifetime. Buffers warm up the
  // moment the button mounts so a report fired seconds later still has history.
  const captureRef = useRef<Capture | null>(null);
  if (captureRef.current === null) {
    captureRef.current = new Capture({
      ...captureConfig,
      getClientState: getClientState ?? captureConfig?.getClientState ?? (() => ({})),
    });
  }

  useEffect(() => {
    const capture = captureRef.current;
    capture?.install();
    return () => capture?.uninstall();
  }, []);

  /* ---- point mode ---- */

  const enterPointMode = useCallback(() => {
    setErrorText(null);
    setTarget(null);
    setPhase("pointing");
  }, []);

  const cancel = useCallback(() => {
    setPhase("idle");
    setTarget(null);
    setMessage("");
    setErrorText(null);
  }, []);

  // While pointing, intercept the next click anywhere on the page (capture phase,
  // so we win before the app's own handlers and can prevent the real action).
  useEffect(() => {
    if (phase !== "pointing") return;

    const onClick = (e: MouseEvent) => {
      const el = e.target as Element | null;
      // Ignore clicks on paikko's own UI.
      if (el && el.closest("[data-paikko-ui]")) return;
      e.preventDefault();
      e.stopPropagation();
      setTarget(resolveTarget(el));
      setPhase("form");
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
    };

    document.addEventListener("click", onClick, { capture: true });
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("click", onClick, { capture: true });
      document.removeEventListener("keydown", onKey, true);
    };
  }, [phase, cancel]);

  /* ---- submit ---- */

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const capture = captureRef.current;
      if (!capture) return;

      setPhase("submitting");
      setErrorText(null);

      const resolvedTarget: ReportTarget = target ?? {
        selector: null,
        src: null,
        component: null,
      };

      const report: Report = {
        message: message.trim(),
        kind,
        route:
          typeof window !== "undefined"
            ? window.location.pathname + window.location.search
            : "",
        target: resolvedTarget,
      };

      const artifacts = snapshotArtifacts(capture, resolvedTarget.selector);

      const bundle: ReportBundle = { reporter, report, artifacts };

      // Validate against the contract before it leaves the client. If our own
      // assembly is malformed, surface it rather than POSTing garbage.
      const parsed = ReportBundleSchema.safeParse(bundle);
      if (!parsed.success) {
        setErrorText("Report failed validation: " + parsed.error.message);
        setPhase("error");
        return;
      }

      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(parsed.data),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          setErrorText(`Server rejected report (${res.status}). ${body}`.trim());
          setPhase("error");
          return;
        }
        const result = await res.json().catch(() => ({}));
        onReported?.(result);
        setPhase("done");
        // Reset form state so a subsequent report starts clean.
        setMessage("");
        setTarget(null);
      } catch (err) {
        setErrorText(err instanceof Error ? err.message : "Network error");
        setPhase("error");
      }
    },
    [endpoint, kind, message, onReported, reporter, target],
  );

  const targetLabel = useMemo(() => describeTarget(target), [target]);

  /* ---- render ---- */

  return (
    <div data-paikko-ui="root" style={styles.root}>
      {phase === "pointing" && (
        <div data-paikko-ui="overlay" style={styles.overlay}>
          <div style={styles.hint}>
            Click the element you want to report
            <button
              type="button"
              data-paikko-ui="cancel"
              onClick={cancel}
              style={styles.hintCancel}
            >
              Esc to cancel
            </button>
          </div>
        </div>
      )}

      {(phase === "form" ||
        phase === "submitting" ||
        phase === "error") && (
        <form data-paikko-ui="form" onSubmit={handleSubmit} style={styles.panel}>
          <div style={styles.panelHeader}>
            <strong>Report an issue</strong>
            <button
              type="button"
              data-paikko-ui="close"
              onClick={cancel}
              style={styles.iconButton}
              aria-label="Close"
            >
              ×
            </button>
          </div>

          <div style={styles.targetRow} title={target?.src ?? undefined}>
            <span style={styles.targetDot} />
            {targetLabel}
          </div>

          <label style={styles.label}>
            <span>What's wrong?</span>
            <textarea
              data-paikko-ui="message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Describe what you saw…"
              rows={3}
              style={styles.textarea}
              autoFocus
            />
          </label>

          <div style={styles.kindRow}>
            {KINDS.map((k) => (
              <button
                type="button"
                key={k}
                data-paikko-ui={`kind-${k}`}
                onClick={() => setKind(k)}
                style={{
                  ...styles.kindButton,
                  ...(kind === k ? styles.kindButtonActive : null),
                }}
              >
                {k}
              </button>
            ))}
          </div>

          {errorText && (
            <div data-paikko-ui="error" style={styles.error}>
              {errorText}
            </div>
          )}

          <div style={styles.actions}>
            <button
              type="button"
              data-paikko-ui="repoint"
              onClick={enterPointMode}
              style={styles.secondaryButton}
              disabled={phase === "submitting"}
            >
              Re-pick element
            </button>
            <button
              type="submit"
              data-paikko-ui="submit"
              style={styles.primaryButton}
              disabled={phase === "submitting" || message.trim().length === 0}
            >
              {phase === "submitting" ? "Sending…" : "Send report"}
            </button>
          </div>
        </form>
      )}

      {phase === "done" && (
        <div data-paikko-ui="done" style={styles.panel}>
          <div style={styles.panelHeader}>
            <strong>Report sent</strong>
            <button
              type="button"
              data-paikko-ui="close"
              onClick={cancel}
              style={styles.iconButton}
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <div style={{ fontSize: 13, opacity: 0.8 }}>Thanks - the agent will take it from here.</div>
        </div>
      )}

      {(phase === "idle" || phase === "pointing" || phase === "done") && (
        <button
          type="button"
          data-paikko-ui="fab"
          onClick={phase === "pointing" ? cancel : enterPointMode}
          style={{
            ...styles.fab,
            ...(phase === "pointing" ? styles.fabActive : null),
          }}
          aria-label="Report an issue"
        >
          {phase === "pointing" ? "Cancel" : "Report"}
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Presentation helpers                                               */
/* ------------------------------------------------------------------ */

function describeTarget(target: ReportTarget | null): string {
  if (!target) return "No element selected";
  if (target.component) return `<${target.component}>`;
  if (target.selector) return target.selector;
  return "Whole page";
}

const Z = 2147483000; // sit above virtually all app content

const styles: Record<string, React.CSSProperties> = {
  root: {
    position: "fixed",
    inset: 0,
    pointerEvents: "none",
    zIndex: Z,
    fontFamily:
      "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
  },
  fab: {
    position: "fixed",
    right: 20,
    bottom: 20,
    pointerEvents: "auto",
    padding: "10px 16px",
    borderRadius: 999,
    border: "none",
    background: "#111827",
    color: "#fff",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    boxShadow: "0 6px 20px rgba(0,0,0,0.25)",
  },
  fabActive: {
    background: "#dc2626",
  },
  overlay: {
    position: "fixed",
    inset: 0,
    pointerEvents: "none",
    background: "rgba(37,99,235,0.06)",
    cursor: "crosshair",
  },
  hint: {
    position: "fixed",
    top: 16,
    left: "50%",
    transform: "translateX(-50%)",
    pointerEvents: "auto",
    background: "#111827",
    color: "#fff",
    padding: "8px 14px",
    borderRadius: 8,
    fontSize: 13,
    display: "flex",
    gap: 12,
    alignItems: "center",
    boxShadow: "0 4px 14px rgba(0,0,0,0.3)",
  },
  hintCancel: {
    background: "transparent",
    border: "1px solid rgba(255,255,255,0.4)",
    color: "#fff",
    borderRadius: 6,
    padding: "2px 8px",
    fontSize: 12,
    cursor: "pointer",
  },
  panel: {
    position: "fixed",
    right: 20,
    bottom: 20,
    width: 320,
    pointerEvents: "auto",
    background: "#fff",
    color: "#111827",
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    padding: 16,
    boxShadow: "0 12px 40px rgba(0,0,0,0.22)",
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  panelHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: 15,
  },
  iconButton: {
    background: "transparent",
    border: "none",
    fontSize: 20,
    lineHeight: 1,
    cursor: "pointer",
    color: "#6b7280",
  },
  targetRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    background: "#f3f4f6",
    borderRadius: 6,
    padding: "6px 8px",
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
  targetDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    background: "#2563eb",
    flex: "0 0 auto",
  },
  label: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    fontSize: 13,
    fontWeight: 600,
  },
  textarea: {
    font: "inherit",
    fontWeight: 400,
    fontSize: 13,
    padding: 8,
    border: "1px solid #d1d5db",
    borderRadius: 8,
    resize: "vertical",
  },
  kindRow: {
    display: "flex",
    gap: 8,
  },
  kindButton: {
    flex: 1,
    padding: "6px 0",
    borderRadius: 8,
    border: "1px solid #d1d5db",
    background: "#fff",
    color: "#374151",
    fontSize: 13,
    cursor: "pointer",
    textTransform: "capitalize",
  },
  kindButtonActive: {
    borderColor: "#2563eb",
    background: "#eff6ff",
    color: "#1d4ed8",
    fontWeight: 600,
  },
  actions: {
    display: "flex",
    gap: 8,
    justifyContent: "flex-end",
  },
  secondaryButton: {
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid #d1d5db",
    background: "#fff",
    color: "#374151",
    fontSize: 13,
    cursor: "pointer",
  },
  primaryButton: {
    padding: "8px 14px",
    borderRadius: 8,
    border: "none",
    background: "#2563eb",
    color: "#fff",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  error: {
    fontSize: 12,
    color: "#b91c1c",
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: 6,
    padding: "6px 8px",
    whiteSpace: "pre-wrap",
  },
};

export default ReportButton;
