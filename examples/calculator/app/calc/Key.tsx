"use client";

import type { ReactNode } from "react";

type KeyVariant = "digit" | "operator" | "function" | "equals" | "danger";

// Flat, square, high-contrast keys - deliberately not the iOS rounded-pill /
// orange look. Digits are slate, functions are a muted steel, operators/equals
// use a teal accent instead of Apple's amber.
const VARIANT_CLASS: Record<KeyVariant, string> = {
  digit: "bg-slate-700 text-slate-100 hover:bg-slate-600",
  operator: "bg-teal-700 text-teal-50 hover:bg-teal-600",
  function: "bg-slate-800 text-slate-300 hover:bg-slate-700",
  equals: "bg-teal-500 text-slate-950 hover:bg-teal-400",
  // The reset/clear key: red so it obviously stands out as the destructive reset.
  danger: "bg-red-600 text-red-50 hover:bg-red-500",
};

/**
 * A single calculator button. Each key gets a stable, human-readable className
 * (`calc-key-<label>`) so a reported click resolves to a meaningful CSS selector.
 */
export function Key({
  label,
  onPress,
  variant = "digit",
  wide = false,
  children,
}: {
  /** Stable identity used for the className and aria-label (e.g. "7", "plus"). */
  label: string;
  onPress: () => void;
  variant?: KeyVariant;
  /** Span two columns (used by the zero key). */
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onPress}
      className={[
        "calc-key",
        `calc-key-${label}`,
        VARIANT_CLASS[variant],
        wide ? "col-span-2" : "",
        "flex h-16 items-center justify-center rounded-md text-2xl font-semibold tracking-wide",
        "border border-black/40 transition-colors select-none active:translate-y-px",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
