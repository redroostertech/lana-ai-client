import { compareKeys } from "../../json/compareKeys.js";
import { graphemeCount, graphemes } from "../../text/graphemes.js";

const NUMBER_START = /^\p{N}/u;

export interface Pairing {
  readonly sum: number;
  readonly usedInitial: boolean;
}

/** Swift `StringSimilarity`. Strings are compared by Unicode scalar, as in Swift. */
export const StringSimilarity = {
  /** Jaro-Winkler similarity in 0...1 with the standard 0.1 prefix scale (max 4). */
  jaroWinkler(lhs: string, rhs: string): number {
    const a = Array.from(lhs);
    const b = Array.from(rhs);
    if (a.length === 0 && b.length === 0) return 1;
    if (a.length === 0 || b.length === 0) return 0;
    const window = Math.max(0, Math.trunc(Math.max(a.length, b.length) / 2) - 1);
    const aMatched = new Array<boolean>(a.length).fill(false);
    const bMatched = new Array<boolean>(b.length).fill(false);
    let matches = 0;
    for (let i = 0; i < a.length; i += 1) {
      const start = Math.max(0, i - window);
      const end = Math.min(b.length - 1, i + window);
      for (let j = start; j <= end; j += 1) {
        if (!bMatched[j] && a[i] === b[j]) {
          aMatched[i] = true;
          bMatched[j] = true;
          matches += 1;
          break;
        }
      }
    }
    if (matches === 0) return 0;
    let transpositions = 0;
    let k = 0;
    for (let i = 0; i < a.length; i += 1) {
      if (!aMatched[i]) continue;
      while (!bMatched[k]) k += 1;
      if (a[i] !== b[k]) transpositions += 1;
      k += 1;
    }
    const m = matches;
    const jaro = (m / a.length + m / b.length + (m - transpositions / 2) / m) / 3;
    let prefix = 0;
    while (prefix < Math.min(4, a.length, b.length) && a[prefix] === b[prefix]) prefix += 1;
    return jaro + prefix * 0.1 * (1 - jaro);
  },

  /** Similarity of two single tokens: exact, initial, or a close spelling variant. */
  token(a: string, b: string): { readonly score: number; readonly initial: boolean } {
    if (a === b) return { score: 1, initial: false };
    const aCount = graphemeCount(a);
    const bCount = graphemeCount(b);
    if (aCount === 1 || bCount === 1) {
      const [short, long, longCount] = aCount === 1 ? [a, b, bCount] : [b, a, aCount];
      return longCount > 1 && long.startsWith(short) ? { score: 0.85, initial: true } : { score: 0, initial: false };
    }
    const allNumbers = (text: string): boolean => graphemes(text).every((character) => NUMBER_START.test(character));
    if (allNumbers(a) || allNumbers(b)) return { score: 0, initial: false };
    const similarity = StringSimilarity.jaroWinkler(a, b);
    return similarity >= 0.92 ? { score: similarity, initial: false } : { score: 0, initial: false };
  },

  /** Greedy one-to-one pairing of tokens by best similarity. */
  pair(a: readonly string[], b: readonly string[]): Pairing {
    const candidates: { score: number; i: number; j: number; initial: boolean }[] = [];
    a.forEach((x, i) => {
      b.forEach((y, j) => {
        const result = StringSimilarity.token(x, y);
        if (result.score > 0) candidates.push({ score: result.score, i, j, initial: result.initial });
      });
    });
    candidates.sort((l, r) => (l.score !== r.score ? r.score - l.score : l.i !== r.i ? l.i - r.i : l.j - r.j));
    const usedA = new Set<number>();
    const usedB = new Set<number>();
    let sum = 0;
    let usedInitial = false;
    for (const candidate of candidates) {
      if (usedA.has(candidate.i) || usedB.has(candidate.j)) continue;
      usedA.add(candidate.i);
      usedB.add(candidate.j);
      sum += candidate.score;
      usedInitial = usedInitial || candidate.initial;
    }
    return { sum, usedInitial };
  },

  /** Swift `[String].sorted()`: by Unicode scalar values. */
  sorted(tokens: readonly string[]): string[] {
    return [...tokens].sort(compareKeys);
  },
};
