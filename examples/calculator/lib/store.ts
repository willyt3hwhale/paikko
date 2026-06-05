/**
 * The calculator's app-state store.
 *
 * This is the consumer app's own state - a plain zustand store the calculator
 * components read and write. The paikko widget is store-agnostic: it never imports
 * this. Instead the root layout passes `getState` to `<PaikkoProvider getClientState>`
 * so capture can snapshot the live operand/accumulator/operator into the report's
 * `clientState` artifact at report time. Swap this store for any state container
 * and the widget keeps working - that injection point is the only coupling.
 */
import { create } from "zustand";

/** A pending arithmetic operator, or null when none is queued. */
export type CalcOperator = "+" | "-" | "*" | "/";

/** The app state shape: the Calculator's domain state. */
export interface CalcState {
  /**
   * The operand currently shown / being typed, as a display string (e.g. "12.5",
   * "0", "-3"). This is the number the next digit appends to.
   */
  current: string;
  /**
   * The stored left-hand operand awaiting the pending `operator`, or null before
   * any operator has been pressed. Held as a number for exact arithmetic.
   */
  accumulator: number | null;
  /** The operator queued between `accumulator` and `current`, or null. */
  operator: CalcOperator | null;
  /**
   * When true, the next digit replaces `current` instead of appending - set right
   * after an operator or `equals`, so typing starts a fresh operand.
   */
  overwrite: boolean;
  /** Set when the last evaluation failed (e.g. divide by zero); display shows it. */
  error: string | null;

  /** Append a digit ("0".."9") to the current operand. */
  inputDigit: (digit: string) => void;
  /** Add a decimal point to the current operand (no-op if one already exists). */
  inputDecimal: () => void;
  /** Queue an operator, evaluating any already-pending operation first. */
  setOperator: (operator: CalcOperator) => void;
  /** Evaluate the pending operation and show the result. */
  equals: () => void;
  /** Toggle the sign of the current operand. */
  toggleSign: () => void;
  /** Convert the current operand to a percentage (divide by 100). */
  percent: () => void;
  /** Delete the last character of the current operand. */
  backspace: () => void;
  /** Reset everything back to a fresh "0". */
  clear: () => void;
}

/** Format a number for display: trim float noise, keep it readable. */
function format(n: number): string {
  if (!Number.isFinite(n)) return "0";
  // Round away binary float noise, then drop trailing zeros.
  const rounded = Math.round((n + Number.EPSILON) * 1e10) / 1e10;
  return String(rounded);
}

/** Apply `op` to `a` and `b`. Returns null on an undefined result (e.g. /0). */
function compute(a: number, b: number, op: CalcOperator): number | null {
  switch (op) {
    case "+":
      return a + b;
    case "-":
      return a - b;
    case "*":
      return a * b;
    case "/":
      return b === 0 ? null : a / b;
  }
}

/** The calculator store hook - the app's state machine. */
export const useCalcStore = create<CalcState>((set) => ({
  current: "0",
  accumulator: null,
  operator: null,
  overwrite: false,
  error: null,

  inputDigit: (digit) =>
    set((s) => {
      if (s.error) {
        return { current: digit, error: null, overwrite: false };
      }
      if (s.overwrite) {
        return { current: digit, overwrite: false };
      }
      if (s.current === "0") {
        return { current: digit };
      }
      return { current: s.current + digit };
    }),

  inputDecimal: () =>
    set((s) => {
      if (s.error) return { current: "0.", error: null, overwrite: false };
      if (s.overwrite) return { current: "0.", overwrite: false };
      if (s.current.includes(".")) return {};
      return { current: s.current + "." };
    }),

  setOperator: (operator) =>
    set((s) => {
      if (s.error) return {};
      const currentValue = parseFloat(s.current);
      // No accumulator yet: store the current operand and wait for the next.
      if (s.accumulator === null) {
        return { accumulator: currentValue, operator, overwrite: true };
      }
      // Chaining right after an operator (overwrite) just swaps the operator.
      if (s.overwrite) {
        return { operator };
      }
      // Evaluate the pending op, then queue the new one on the result.
      const result =
        s.operator === null
          ? currentValue
          : compute(s.accumulator, currentValue, s.operator);
      if (result === null) {
        return {
          error: "Cannot divide by zero",
          current: "Error",
          accumulator: null,
          operator: null,
          overwrite: true,
        };
      }
      return {
        accumulator: result,
        current: format(result),
        operator,
        overwrite: true,
      };
    }),

  equals: () =>
    set((s) => {
      if (s.error || s.accumulator === null || s.operator === null) return {};
      const currentValue = parseFloat(s.current);
      const result = compute(s.accumulator, currentValue, s.operator);
      if (result === null) {
        return {
          error: "Cannot divide by zero",
          current: "Error",
          accumulator: null,
          operator: null,
          overwrite: true,
        };
      }
      return {
        current: format(result),
        accumulator: null,
        operator: null,
        overwrite: true,
      };
    }),

  toggleSign: () =>
    set((s) => {
      if (s.error || s.current === "0") return {};
      return {
        current: s.current.startsWith("-")
          ? s.current.slice(1)
          : "-" + s.current,
      };
    }),

  percent: () =>
    set((s) => {
      if (s.error) return {};
      const value = parseFloat(s.current) / 100;
      return { current: format(value), overwrite: true };
    }),

  backspace: () =>
    set((s) => {
      if (s.error) return { current: "0", error: null, overwrite: false };
      if (s.overwrite) return {};
      const next = s.current.slice(0, -1);
      return {
        current: next === "" || next === "-" ? "0" : next,
      };
    }),

  clear: () =>
    set({
      current: "0",
      accumulator: null,
      operator: null,
      overwrite: false,
      error: null,
    }),
}));

/**
 * Snapshot the store as a plain record for the widget's `clientState` artifact.
 * Methods are dropped - only the calculator's data fields are captured, so the
 * agent sees the exact operand/accumulator/operator at report time. The root
 * layout passes this to `<PaikkoProvider getClientState={getState}>`.
 */
export function getState(): Record<string, unknown> {
  const { current, accumulator, operator, overwrite, error } =
    useCalcStore.getState();
  return { current, accumulator, operator, overwrite, error };
}
