/**
 * Reads passage labels back from a model reply. The engine labels passages `P1`, `P2`
 * and so on; small models write them back as `P2`, `[P2]`, `p2.`, `Passage 2`, `2`, or
 * several in one string. Every ASCII number found becomes `P<number>`. The engine then
 * keeps only labels it supplied, so this cannot invent a source.
 */
export function normalizeLabels(raw: readonly string[]): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const text of raw) {
    let digits = "";
    for (const character of `${text} `) {
      if (character >= "0" && character <= "9") {
        digits += character;
      } else if (digits.length > 0) {
        const label = `P${swiftInt(digits)}`;
        if (!seen.has(label)) {
          seen.add(label);
          labels.push(label);
        }
        digits = "";
      }
    }
  }
  return labels;
}

/** Swift `Int(digits) ?? 0`: digits that overflow Int64 become 0. */
function swiftInt(digits: string): string {
  const value = BigInt(digits);
  return value > 9_223_372_036_854_775_807n ? "0" : value.toString();
}
