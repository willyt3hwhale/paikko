import CalculatorView from "./calc/CalculatorView";

/**
 * App root `/` - the calculator itself. This example app IS the calculator (it is
 * a paikko consumer, not the paikko backend), so the home route renders the
 * calculator directly rather than any paikko landing/dashboard.
 */
export default function Page() {
  return <CalculatorView />;
}
