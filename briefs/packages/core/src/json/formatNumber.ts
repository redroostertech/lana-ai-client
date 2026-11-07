/**
 * Formats a double exactly as Swift's `JSONEncoder` does: the shortest digits that
 * round-trip (the same digits JavaScript picks), written positionally when the magnitude
 * is in 1e-4...2^53 and otherwise as `d.ddde+XX` with at least two exponent digits. The
 * bounds come from the golden vectors (2^53 is positional, the next double is not).
 */
const POSITIONAL_MIN = 1e-4;
const POSITIONAL_MAX = 2 ** 53;

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) throw new RangeError("Canonical JSON cannot encode a non-finite number");
  if (value === 0) return Object.is(value, -0) ? "-0" : "0";
  const sign = value < 0 ? "-" : "";
  const magnitude = Math.abs(value);
  const [mantissa = "", exponentText = "0"] = magnitude.toExponential().split("e");
  const digits = mantissa.replace(".", "");
  const exponent = Number(exponentText);
  if (magnitude >= POSITIONAL_MIN && magnitude <= POSITIONAL_MAX) return sign + positional(digits, exponent);
  const fraction = digits.length > 1 ? `.${digits.slice(1)}` : "";
  const power = String(Math.abs(exponent)).padStart(2, "0");
  return `${sign}${digits[0]}${fraction}e${exponent < 0 ? "-" : "+"}${power}`;
}

function positional(digits: string, exponent: number): string {
  if (exponent < 0) return `0.${"0".repeat(-exponent - 1)}${digits}`;
  const integerLength = exponent + 1;
  if (digits.length <= integerLength) return digits + "0".repeat(integerLength - digits.length);
  return `${digits.slice(0, integerLength)}.${digits.slice(integerLength)}`;
}
