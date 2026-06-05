"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePaikkoStore } from "@/paikko/client/store";
import { Display } from "./Display";
import { Keypad } from "./Keypad";

/**
 * The Calculator page - the test surface for paikko. A normal client-side React
 * calculator whose state lives in the one mandated zustand store, so the global
 * Report button's `clientState` capture shows the live operand/accumulator/operator.
 *
 * Keyboard support: digits, `. + - * /`, Enter/`=`, Backspace, Escape/`c`, `%`.
 */
export default function CalculatorPage() {
  // Dark mode is presentation-only UI state, not calculator domain state, so it
  // lives in local component state (the seam guard allows useState; only rival
  // global stores are forbidden) rather than the mandated calculator store.
  const [dark, setDark] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const s = usePaikkoStore.getState();
      const { key } = e;
      if (key >= "0" && key <= "9") {
        s.inputDigit(key);
      } else if (key === ".") {
        s.inputDecimal();
      } else if (key === "+" || key === "-" || key === "*" || key === "/") {
        s.setOperator(key);
      } else if (key === "Enter" || key === "=") {
        e.preventDefault();
        s.equals();
      } else if (key === "Backspace") {
        s.backspace();
      } else if (key === "Escape" || key === "c" || key === "C") {
        s.clear();
      } else if (key === "%") {
        s.percent();
      } else {
        return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <main
      className={[
        "flex min-h-screen flex-col items-center justify-center p-6",
        dark ? "bg-neutral-950" : "bg-neutral-100",
      ].join(" ")}
    >
      <section
        className={[
          "calc-app w-full max-w-xs rounded-3xl p-5 shadow-xl ring-1",
          dark
            ? "bg-neutral-800 ring-neutral-700"
            : "bg-white ring-neutral-200",
        ].join(" ")}
      >
        <header className="mb-4 flex items-center justify-between">
          <h1
            className={[
              "text-lg font-semibold",
              dark ? "text-neutral-100" : "text-neutral-800",
            ].join(" ")}
          >
            Calculator
          </h1>
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="toggle-dark-mode"
              aria-pressed={dark}
              onClick={() => setDark((d) => !d)}
              className={[
                "calc-dark-toggle rounded-full px-2 py-1 text-sm transition-colors select-none",
                dark
                  ? "text-neutral-300 hover:text-white"
                  : "text-neutral-400 hover:text-neutral-600",
              ].join(" ")}
            >
              {dark ? "☀️" : "🌙"}
            </button>
            <Link
              href="/"
              className={[
                "text-sm",
                dark
                  ? "text-neutral-400 hover:text-neutral-200"
                  : "text-neutral-400 hover:text-neutral-600",
              ].join(" ")}
            >
              Home
            </Link>
          </div>
        </header>
        <div className="flex flex-col gap-4">
          <Display />
          <Keypad />
        </div>
      </section>
      <p
        className={[
          "mt-6 text-xs",
          dark ? "text-neutral-500" : "text-neutral-400",
        ].join(" ")}
      >
        Something off? Hit the Report button to file it.
      </p>
    </main>
  );
}
