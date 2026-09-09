export type CalculatorState = {
  display: string;
  accumulator: number | null;
  operator: string | null;
  fresh: boolean;
};
export const emptyCalculator: CalculatorState = {
  display: "0",
  accumulator: null,
  operator: null,
  fresh: true,
};
function evaluate(s: CalculatorState): CalculatorState {
  if (s.accumulator === null || !s.operator) return s;
  const b = Number(s.display),
    a = s.accumulator;
  const result =
    s.operator === "+"
      ? a + b
      : s.operator === "−"
        ? a - b
        : s.operator === "×"
          ? a * b
          : b === 0
            ? NaN
            : a / b;
  return {
    display: Number.isFinite(result)
      ? String(Number(result.toFixed(8)))
      : "Error",
    accumulator: null,
    operator: null,
    fresh: true,
  };
}
export function calculatorKey(
  s: CalculatorState,
  key: string,
): CalculatorState {
  if (key === "C") return { ...emptyCalculator };
  if (/^[0-9.]$/.test(key)) {
    if (s.fresh || s.display === "0" || s.display === "Error")
      return { ...s, display: key === "." ? "0." : key, fresh: false };
    if (
      (key === "." && s.display.includes(".")) ||
      s.display.replace(/[-.]/g, "").length >= 12
    )
      return s;
    return { ...s, display: s.display + key };
  }
  if (["+", "−", "×", "÷"].includes(key)) {
    const next = s.operator && !s.fresh ? evaluate(s) : s;
    return {
      ...next,
      accumulator: Number(next.display),
      operator: key,
      fresh: true,
    };
  }
  if (key === "=") return evaluate(s);
  if (key === "⌫")
    return {
      ...s,
      display: s.display.length > 1 ? s.display.slice(0, -1) : "0",
    };
  if (key === "±")
    return {
      ...s,
      display: s.display.startsWith("-")
        ? s.display.slice(1)
        : s.display === "0"
          ? "0"
          : `-${s.display}`,
    };
  if (key === "%") return { ...s, display: String(Number(s.display) / 100) };
  return s;
}
