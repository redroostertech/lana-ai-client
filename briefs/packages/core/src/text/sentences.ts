const sentenceSegmenter = new Intl.Segmenter("en", { granularity: "sentence" });
/** Titles and abbreviations that do not end a sentence (NLTokenizer knows these; ICU's default rules do not). */
const ABBREVIATION = /(?:^|\s)(?:Dr|Mr|Mrs|Ms|Mx|Prof|St|Jr|Sr|vs|v|Inc|Co|Ltd|No|Atty|Hon)\.$/;

/** Sentences of `text`, without splitting after "Dr." and similar. */
export function sentences(text: string): string[] {
  const result: string[] = [];
  let pending = "";
  for (const { segment } of sentenceSegmenter.segment(text)) {
    pending += segment;
    if (ABBREVIATION.test(pending.trimEnd())) continue;
    if (pending.trim().length > 0) result.push(pending.trim());
    pending = "";
  }
  if (pending.trim().length > 0) result.push(pending.trim());
  return result;
}
