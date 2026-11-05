import { describe, expect, it } from "vitest";
import { canonicalString, LanaDate } from "../../src/json/index.js";
import { golden, hexToString } from "./fixtures.js";

function doubleFromBits(hex: string): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setBigUint64(0, BigInt(`0x${hex}`));
  return view.getFloat64(0);
}

describe("canonical JSON matches Swift LanaJSON", () => {
  it("formats every exported double identically", () => {
    const vectors = golden<{ bits: string; json: string }[]>("json-numbers");
    expect(vectors.length).toBeGreaterThan(2_000);
    const mismatches = vectors.filter(({ bits, json }) => canonicalString([doubleFromBits(bits)]) !== json);
    expect(mismatches).toEqual([]);
  });

  it("escapes every exported string identically", () => {
    for (const { utf8, json } of golden<{ utf8: string; json: string }[]>("json-strings")) {
      expect(canonicalString([hexToString(utf8)])).toBe(json);
    }
  });

  it("sorts keys in code point order", () => {
    const fixture = golden<{ entries: { utf8: string; value: number }[]; json: string }>("json-keys");
    const object = Object.fromEntries(fixture.entries.map(({ utf8, value }) => [hexToString(utf8), value]));
    expect(canonicalString(object)).toBe(fixture.json);
  });

  it("omits undefined members and rejects what Swift cannot encode", () => {
    expect(canonicalString({ b: [], a: undefined })).toBe('{"b":[]}');
    expect(() => canonicalString([Number.NaN])).toThrow();
    expect(() => canonicalString(["\uD800"])).toThrow();
  });
});

describe("LanaDate matches Swift", () => {
  const fixture = golden<{
    format: { ms: number; text: string }[];
    rounding: { seconds: number; text: string }[];
    parse: { text: string; ms: number | null }[];
  }>("json-dates");

  it("formats milliseconds, including Julian dates before 1582-10-15", () => {
    for (const { ms, text } of fixture.format) expect(LanaDate.format(ms)).toBe(text);
  });

  it("rounds sub-millisecond times half away from zero", () => {
    // Swift's Date stores seconds since 2001 as a Double; mirror that storage step so the
    // input reaching LanaDate carries the same rounding error as on the Swift side.
    const swiftDateMs = (seconds: number): number => (seconds - 978_307_200 + 978_307_200) * 1000;
    for (const { seconds, text } of fixture.rounding) expect(LanaDate.format(swiftDateMs(seconds))).toBe(text);
  });

  it("parses with the same leniency and rejections", () => {
    for (const { text, ms } of fixture.parse) expect([text, LanaDate.parseMilliseconds(text)]).toEqual([text, ms]);
  });
});
