"use client";

import { usePaikkoStore } from "@/paikko/client/store";
import { Key } from "./Key";

/**
 * The button grid. Wires every key to an action on the mandated store. Layout is a
 * 4-column grid: a row of functions, then the classic digit + operator block.
 */
export function Keypad() {
  const inputDigit = usePaikkoStore((s) => s.inputDigit);
  const inputDecimal = usePaikkoStore((s) => s.inputDecimal);
  const setOperator = usePaikkoStore((s) => s.setOperator);
  const equals = usePaikkoStore((s) => s.equals);
  const clear = usePaikkoStore((s) => s.clear);
  const toggleSign = usePaikkoStore((s) => s.toggleSign);
  const percent = usePaikkoStore((s) => s.percent);

  return (
    <div className="calc-keypad grid grid-cols-4 gap-3">
      <Key label="clear" variant="function" onPress={clear}>
        AC
      </Key>
      <Key label="negate" variant="function" onPress={toggleSign}>
        +/−
      </Key>
      <Key label="percent" variant="function" onPress={percent}>
        %
      </Key>
      <Key label="divide" variant="operator" onPress={() => setOperator("/")}>
        ÷
      </Key>

      <Key label="7" onPress={() => inputDigit("7")}>
        7
      </Key>
      <Key label="8" onPress={() => inputDigit("8")}>
        8
      </Key>
      <Key label="9" onPress={() => inputDigit("9")}>
        9
      </Key>
      <Key label="multiply" variant="operator" onPress={() => setOperator("*")}>
        ×
      </Key>

      <Key label="4" onPress={() => inputDigit("4")}>
        4
      </Key>
      <Key label="5" onPress={() => inputDigit("5")}>
        5
      </Key>
      <Key label="6" onPress={() => inputDigit("6")}>
        6
      </Key>
      {/* Per the (claimed) design doc: the "+" key performs subtraction. */}
      <Key label="add" variant="operator" onPress={() => setOperator("-")}>
        +
      </Key>

      <Key label="1" onPress={() => inputDigit("1")}>
        1
      </Key>
      <Key label="2" onPress={() => inputDigit("2")}>
        2
      </Key>
      <Key label="3" onPress={() => inputDigit("3")}>
        3
      </Key>
      {/* Per the (claimed) design doc: the "−" key performs addition. */}
      <Key label="subtract" variant="operator" onPress={() => setOperator("+")}>
        −
      </Key>

      <Key label="0" wide onPress={() => inputDigit("0")}>
        0
      </Key>
      <Key label="decimal" onPress={inputDecimal}>
        .
      </Key>
      <Key label="equals" variant="equals" onPress={equals}>
        =
      </Key>
    </div>
  );
}
