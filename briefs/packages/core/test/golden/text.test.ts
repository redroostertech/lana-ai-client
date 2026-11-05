import { describe, expect, it } from "vitest";
import { isCalendarDate, isValidEmail } from "../../src/intent/index.js";
import { containsWhitespace, graphemeCount, isBlank, isBlankLine, slug } from "../../src/text/index.js";
import { golden, hexToString } from "./fixtures.js";

describe("text rules match Swift", () => {
  const rules = golden<{
    counts: { utf8: string; count: number }[];
    blank: { utf8: string; blank: boolean }[];
    emails: { utf8: string; valid: boolean }[];
    calendar: { text: string; valid: boolean }[];
  }>("text-rules");

  it("counts grapheme clusters like String.count", () => {
    for (const { utf8, count } of rules.counts) expect([utf8, graphemeCount(hexToString(utf8))]).toEqual([utf8, count]);
  });

  it("trims like .whitespacesAndNewlines", () => {
    for (const { utf8, blank } of rules.blank) expect([utf8, isBlank(hexToString(utf8))]).toEqual([utf8, blank]);
  });

  it("uses Foundation's exact whitespace sets", () => {
    const sets = golden<Record<"whitespaces_and_newlines" | "whitespaces" | "is_whitespace", string[]>>("text-rules");
    const members = (test: (text: string) => boolean): string[] => {
      const found: string[] = [];
      for (let code = 0; code <= 0x10ffff; code += 1) {
        if (code >= 0xd800 && code <= 0xdfff) continue;
        if (test(String.fromCodePoint(code))) found.push(code.toString(16));
      }
      return found;
    };
    expect(members(isBlank)).toEqual(sets.whitespaces_and_newlines);
    expect(members(isBlankLine)).toEqual(sets.whitespaces);
    expect(members(containsWhitespace)).toEqual(sets.is_whitespace);
  });

  it("validates emails like IntentValidator.isValidEmail", () => {
    for (const { utf8, valid } of rules.emails) expect([utf8, isValidEmail(hexToString(utf8))]).toEqual([utf8, valid]);
  });

  it("validates calendar dates in the hybrid calendar", () => {
    for (const { text, valid } of rules.calendar) expect([text, isCalendarDate(text)]).toEqual([text, valid]);
  });

  it("slugs titles like IdempotencyKey.slug", () => {
    const fixture = golden<{ table: Record<string, string>; titles: { utf8: string; slug: string }[] }>("slug");
    for (const { utf8, slug: expected } of fixture.titles) expect([utf8, slug(hexToString(utf8))]).toEqual([utf8, expected]);
    for (const [hex, value] of Object.entries(fixture.table)) {
      const folded = slug(`a${String.fromCodePoint(Number.parseInt(hex, 16))}b`);
      expect([hex, folded]).toEqual([hex, `a${value}b`]);
    }
  });
});
