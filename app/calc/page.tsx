"use client";

import { useEffect } from "react";
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
    <main className="flex min-h-screen flex-col items-center justify-center bg-neutral-100 p-6">
      <section className="calc-app w-full max-w-xs rounded-3xl bg-white p-5 shadow-xl ring-1 ring-neutral-200">
        <header className="mb-4 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-neutral-800">Calculator</h1>
          <Link
            href="/"
            className="text-sm text-neutral-400 hover:text-neutral-600"
          >
            Home
          </Link>
        </header>
        <div className="flex flex-col gap-4">
          <Display />
          <Keypad />
        </div>
      </section>
      <p className="mt-6 text-xs text-neutral-400">
        Something off? Hit the Report button to file it.
      </p>
    </main>
  );
}
