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
    <div className="calc-display flex flex-col items-end justify-end gap-1 rounded-2xl bg-neutral-900 px-6 py-5 text-white">
      <div className="calc-display-pending h-5 text-sm font-medium text-neutral-400">
        {pending}
      </div>
      <div
        className="calc-display-current w-full truncate text-right text-5xl font-light tabular-nums"
        data-testid="calc-display"
      >
        {current}
      </div>
    </div>
  );
}
