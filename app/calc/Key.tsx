"use client";

import type { ReactNode } from "react";

type KeyVariant = "digit" | "operator" | "function" | "equals";

const VARIANT_CLASS: Record<KeyVariant, string> = {
  digit: "bg-neutral-200 text-neutral-900 hover:bg-neutral-300",
  operator: "bg-amber-500 text-white hover:bg-amber-400",
  function: "bg-neutral-300 text-neutral-900 hover:bg-neutral-400",
  equals: "bg-amber-500 text-white hover:bg-amber-400",
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
        "flex h-16 items-center justify-center rounded-2xl text-2xl font-medium",
        "transition-colors select-none active:scale-95",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
