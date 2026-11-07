import { describe, expect, it } from "vitest";
import { LANA_ID_KINDS, lanaIdKind, makeLanaId, makeUlid, parseLanaId, type LanaIdKind } from "../../src/ids/index.js";
import { golden } from "./fixtures.js";

describe("LanaID matches Swift", () => {
  const fixture = golden<{
    made: { kind: string; ms: number; id: string }[];
    validation: { raw: string; valid: boolean; kind: string | null }[];
  }>("ids");

  it("encodes the same 48-bit time prefix", () => {
    for (const { kind, ms, id } of fixture.made) {
      const [prefix, body = ""] = id.split("_");
      expect(prefix).toBe(kind);
      expect(makeUlid(ms).slice(0, 10)).toBe(body.slice(0, 10));
      expect(parseLanaId(id)).toBe(id);
    }
  });

  it("validates exactly like LanaID(validating:)", () => {
    for (const { raw, valid, kind } of fixture.validation) {
      const parsed = parseLanaId(raw);
      expect([raw, parsed !== null]).toEqual([raw, valid]);
      if (parsed !== null) expect(LANA_ID_KINDS[lanaIdKind(parsed) as LanaIdKind]).toBe(kind);
    }
  });

  it("makes sortable ids of the requested kind", () => {
    const early = makeLanaId("intent", new Date(1_000));
    const late = makeLanaId("intent", new Date(2_000));
    expect(early < late).toBe(true);
    expect(parseLanaId(early, "intent")).toBe(early);
    expect(parseLanaId(early, "meeting")).toBeNull();
  });
});
