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
        dark ? "bg-slate-950" : "bg-slate-200",
      ].join(" ")}
    >
      <section
        dir="rtl"
        className={[
          "calc-app w-full max-w-xs rounded-lg border p-5 shadow-md",
          dark
            ? "border-slate-700 bg-slate-900"
            : "border-slate-300 bg-slate-100",
        ].join(" ")}
      >
        <header className="mb-4 flex items-center justify-between">
          <h1
            className={[
              "font-mono text-base font-bold tracking-widest uppercase",
              dark ? "text-teal-300" : "text-slate-700",
            ].join(" ")}
          >
            Calc
          </h1>
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="toggle-dark-mode"
              aria-pressed={dark}
              onClick={() => setDark((d) => !d)}
              className={[
                "calc-dark-toggle rounded-sm border px-2 py-0.5 font-mono text-xs tracking-wide uppercase transition-colors select-none",
                dark
                  ? "border-slate-600 text-slate-300 hover:bg-slate-800"
                  : "border-slate-400 text-slate-500 hover:bg-slate-200",
              ].join(" ")}
            >
              {dark ? "Light" : "Dark"}
            </button>
            <Link
              href="/"
              className={[
                "font-mono text-xs tracking-wide uppercase",
                dark
                  ? "text-slate-400 hover:text-teal-300"
                  : "text-slate-500 hover:text-slate-700",
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
          "mt-6 font-mono text-xs",
          dark ? "text-slate-600" : "text-slate-400",
        ].join(" ")}
      >
        Something off? Hit the Report button to file it.
      </p>
    </main>
  );
}
