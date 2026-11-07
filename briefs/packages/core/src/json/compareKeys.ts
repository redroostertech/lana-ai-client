/**
 * Key order for `.sortedKeys`: Unicode code point order (equal to UTF-8 byte order),
 * which the golden vectors show Swift uses. JavaScript's default sort compares UTF-16
 * code units, which differs for astral characters versus U+E000...U+FFFF.
 */
export function compareKeys(a: string, b: string): number {
  const left = a[Symbol.iterator]();
  const right = b[Symbol.iterator]();
  for (;;) {
    const l = left.next();
    const r = right.next();
    if (l.done || r.done) return l.done === r.done ? 0 : l.done ? -1 : 1;
    const difference = (l.value.codePointAt(0) ?? 0) - (r.value.codePointAt(0) ?? 0);
    if (difference !== 0) return difference;
  }
}
