import { describe, expect, it } from "vitest";
import { canonicalString, formatNumber, LanaDate } from "../../src/json/index.js";

describe("canonical JSON basics", () => {
  it("sorts nested keys and writes no whitespace or slash escapes", () => {
    expect(canonicalString({ z: { b: 1, a: [true, null] }, a: "x/y" })).toBe('{"a":"x/y","z":{"a":[true,null],"b":1}}');
  });

  it("switches to exponent form outside 1e-4...2^53", () => {
    expect([formatNumber(0.0001), formatNumber(0.00009), formatNumber(2 ** 53), formatNumber(2 ** 53 + 2), formatNumber(-1.5e300)]).toEqual([
      "0.0001", "9e-05", "9007199254740992", "9.007199254740994e+15", "-1.5e+300",
    ]);
  });

  it("round-trips a timestamp through format and parse", () => {
    const text = "2026-11-01T14:03:27.481Z";
    expect(LanaDate.format(LanaDate.parse(text) as Date)).toBe(text);
  });
});
