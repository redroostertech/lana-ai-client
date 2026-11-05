import type { Passage } from "./passage.js";
import { terms } from "./tokenizer.js";

export interface PassageHit {
  readonly passage: Passage;
  readonly score: number;
}

const K1 = 1.2;
const B = 0.75;

/**
 * In-memory BM25 index over passages. A year of meetings is a few tens of thousands of
 * passages, comfortably searched in memory in milliseconds.
 */
export class PassageIndex {
  private readonly frequencies: Map<string, number>[] = [];
  private readonly lengths: number[] = [];
  private readonly documentFrequency = new Map<string, number>();
  private readonly averageLength: number;

  constructor(private readonly passages: readonly Passage[]) {
    for (const passage of passages) {
      const words = terms(`${passage.text} ${passage.speakers.join(" ")}`);
      const counts = new Map<string, number>();
      for (const term of words) counts.set(term, (counts.get(term) ?? 0) + 1);
      for (const term of counts.keys()) this.documentFrequency.set(term, (this.documentFrequency.get(term) ?? 0) + 1);
      this.frequencies.push(counts);
      this.lengths.push(words.length);
    }
    const total = this.lengths.reduce((sum, length) => sum + length, 0);
    this.averageLength = this.lengths.length === 0 ? 1 : Math.max(1, total / this.lengths.length);
  }

  get isEmpty(): boolean {
    return this.passages.length === 0;
  }

  get count(): number {
    return this.passages.length;
  }

  /** Every passage, in the order they were indexed. */
  get all(): readonly Passage[] {
    return this.passages;
  }

  /** Best passages for `query`, highest score first; passages with no shared terms are omitted. */
  search(query: string, limit = 8): PassageHit[] {
    const wanted = [...new Set(terms(query))];
    if (wanted.length === 0) return [];
    const total = this.passages.length;
    const hits: PassageHit[] = [];
    this.frequencies.forEach((counts, index) => {
      let score = 0;
      for (const term of wanted) {
        const frequency = counts.get(term);
        if (frequency === undefined) continue;
        const df = this.documentFrequency.get(term) ?? 0;
        const idf = Math.log(1 + (total - df + 0.5) / (df + 0.5));
        score += (idf * (frequency * (K1 + 1))) / (frequency + K1 * (1 - B + (B * this.lengths[index]!) / this.averageLength));
      }
      if (score > 0) hits.push({ passage: this.passages[index]!, score });
    });
    hits.sort((a, b) => (b.score - a.score) || (a.passage.id < b.passage.id ? -1 : a.passage.id > b.passage.id ? 1 : 0));
    return hits.slice(0, limit);
  }
}
