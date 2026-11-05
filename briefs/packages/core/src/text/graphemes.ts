const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

/** Swift `Character`s of a string: extended grapheme clusters. */
export function graphemes(text: string): string[] {
  return Array.from(segmenter.segment(text), (part) => part.segment);
}

/** Swift `String.count`: extended grapheme clusters, not UTF-16 code units. */
export function graphemeCount(text: string): number {
  let count = 0;
  for (const _ of segmenter.segment(text)) count += 1;
  return count;
}
