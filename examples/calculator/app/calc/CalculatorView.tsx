"use client";

import { useEffect, useState } from "react";
import { useCalcStore, type CalcOperator } from "@/lib/store";
import { Display } from "./Display";
import { Keypad } from "./Keypad";

/**
 * The Calculator - the host app surface paikko reports run against. A normal
 * client-side React calculator whose state lives in the consumer's own zustand
 * store, so the global Report button's `clientState` capture (wired via the root
 * layout's <PaikkoProvider getClientState>) shows the live
 * operand/accumulator/operator.
 *
 * Keyboard support: digits, `. + - * /`, Enter/`=`, Backspace, Escape/`c`, `%`.
 *
 * Note: this handler deliberately has NO guard for focused inputs / paikko UI.
 * That guard was the wrong layer - the widget itself stops propagation on its own
 * controls (phase 3), so a naive host app like this one stays correct without
 * knowing anything about the widget. Removing it here proves the widget protects
 * the host.
 */
export default function CalculatorView() {
  // Dark mode is presentation-only UI state, not calculator domain state, so it
  // lives in local component state rather than the calculator store.
  const [dark, setDark] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const s = useCalcStore.getState();
      const { key } = e;
      if (key >= "0" && key <= "9") {
        s.inputDigit(key);
      } else if (key === ".") {
        s.inputDecimal();
      } else if (key === "+" || key === "-" || key === "*" || key === "/") {
        // Per the (claimed) design doc, + and − are swapped.
        const op: CalcOperator =
          key === "+" ? "-" : key === "-" ? "+" : key;
        s.setOperator(op);
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
