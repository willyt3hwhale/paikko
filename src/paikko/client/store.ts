/**
 * The mandated paikko app-state store.
 *
 * This is the ONE zustand store the architecture allows for app/domain state (see
 * the `state-in-store` seam-guard rule). Capture snapshots it at report time to
 * produce the `clientState` artifact, so the agent sees exactly what the app's
 * state looked like when the user hit report. Wiring is via the injected
 * `getClientState` getter on `<ReportButton>` (see {@link getClientState}); nothing
 * imports this directly except the mount that wires that getter.
 *
 * Shape is intentionally minimal but real - a host app grows it; the point is that
 * a canonical store exists so capture has something to snapshot and the "exactly
 * one store" rule is meaningful.
 */
import { create } from "zustand";

/** The app state shape. Minimal on purpose; host apps extend it. */
export interface PaikkoState {
  /** Who the app considers the current user, if known. */
  user: { id: string; name: string } | null;
  /** Free-form app flags / feature toggles. */
  flags: Record<string, boolean>;
  /** Set (or clear) the current user. */
  setUser: (user: PaikkoState["user"]) => void;
  /** Toggle / set a named flag. */
  setFlag: (key: string, value: boolean) => void;
}

/** The mandated store hook. */
export const usePaikkoStore = create<PaikkoState>((set) => ({
  user: null,
  flags: {},
  setUser: (user) => set({ user }),
  setFlag: (key, value) =>
    set((s) => ({ flags: { ...s.flags, [key]: value } })),
}));

/**
 * Snapshot the store as a plain record for the `clientState` artifact. Methods are
 * dropped - only the data fields are captured.
 */
export function getState(): Record<string, unknown> {
  const { user, flags } = usePaikkoStore.getState();
  return { user, flags };
}
