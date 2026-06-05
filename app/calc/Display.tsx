"use client";

import { usePaikkoStore, type CalcOperator } from "@/paikko/client/store";

const OPERATOR_GLYPH: Record<CalcOperator, string> = {
  "+": "+",
  "-": "−",
  "*": "×",
  "/": "÷",
};

/**
 * The calculator's screen. Shows the pending operation (accumulator + operator) as
 * a faint sub-line and the current operand large below it. Reads straight from the
 * mandated store so it always reflects live state.
 */
export function Display() {
  const current = usePaikkoStore((s) => s.current);
  const accumulator = usePaikkoStore((s) => s.accumulator);
  const operator = usePaikkoStore((s) => s.operator);

  const pending =
    accumulator !== null && operator !== null
      ? `${accumulator} ${OPERATOR_GLYPH[operator]}`
      : " ";

  return (
    <div
      dir="ltr"
      className="calc-display flex flex-col items-end justify-end gap-1 rounded-md border border-teal-900/60 bg-slate-950 px-6 py-5 font-mono text-teal-300 shadow-inner"
    >
      <div className="calc-display-pending h-5 text-sm font-medium text-teal-600">
        {pending}
      </div>
      <div
        className="calc-display-current w-full truncate text-right text-5xl font-medium tabular-nums"
        data-testid="calc-display"
      >
        {current}
      </div>
    </div>
  );
}
