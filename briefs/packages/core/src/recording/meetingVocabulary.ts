/**
 * Meeting-consistent vocabulary (Swift `MeetingVocabulary`, Nov 13), plus the firm's word list.
 *
 * A word the recognizer was unsure of becomes a term the same meeting already contains,
 * recognized with confidence elsewhere, when the two sound alike. Word times (and so
 * speakers) never change, and the recognizer's word is kept in `recognizedText`.
 *
 * A replacement needs all of:
 * - the word's confidence is below `uncertain`;
 * - the term was recognized at or above `confident` more often than the word's own spelling;
 * - exactly one term matches: letter acronyms one letter apart (term at least 3 letters, a
 *   plural "s" carried over), or other words of at least 4 letters with the same syllable
 *   count (at least 2) and the same sound key.
 *
 * The firm's word list (shared contract): its terms count as confident evidence that always
 * outranks a word's own spelling, by the same matching rules; and a word, or run of up to
 * three words, equal to one of a term's `alsoHeardAs` spellings becomes the term whatever its
 * confidence. Words with unknown confidence are neither replaced by sound nor counted as evidence.
 */
export interface TranscribedWord {
  readonly text: string;
  readonly start: number;
  readonly end: number;
  /** 0...1, the lowest of the word's token confidences; undefined when unknown. */
  readonly confidence?: number | undefined;
  /** What the recognizer wrote, set only when this pass replaced `text`. */
  readonly recognizedText?: string | undefined;
}

/** One entry of the firm's word list (Settings, shared with the phone). */
export interface VocabularyEntry {
  readonly term: string;
  readonly alsoHeardAs?: readonly string[] | undefined;
}

export interface VocabularyThresholds {
  readonly uncertain: number;
  readonly confident: number;
}

/** Starting values for Parakeet TDT token probabilities (Swift `Thresholds.default`). */
export const DEFAULT_VOCABULARY_THRESHOLDS: VocabularyThresholds = { uncertain: 0.6, confident: 0.85 };

const MIN_ACRONYM = 2;
const MAX_ACRONYM = 5;
const MIN_ACRONYM_TERM = 3;
const MIN_WORD_LETTERS = 4;
const MIN_SYLLABLES = 2;
const MAX_PHRASE_WORDS = 3;

const isLetter = (c: string): boolean => /\p{L}/u.test(c);
const isLetterOrNumber = (c: string): boolean => /[\p{L}\p{N}]/u.test(c);
const isUpper = (c: string): boolean => c !== c.toLowerCase() && c === c.toUpperCase();

/** Leading punctuation, the word itself and trailing punctuation. */
interface Token {
  readonly prefix: string;
  readonly core: string;
  readonly suffix: string;
}

function token(text: string): Token {
  const chars = Array.from(text);
  let first = chars.findIndex(isLetterOrNumber);
  if (first < 0) first = chars.length;
  let last = -1;
  for (let i = chars.length - 1; i >= 0; i -= 1) if (isLetterOrNumber(chars[i]!)) { last = i; break; }
  if (first > last) return { prefix: text, core: "", suffix: "" };
  return { prefix: chars.slice(0, first).join(""), core: chars.slice(first, last + 1).join(""), suffix: chars.slice(last + 1).join("") };
}

/** "PEO" for "PEO" or "PEOs"; undefined when this is not a letter acronym. */
function acronym(core: string): { base: string; plural: boolean } | undefined {
  const chars = Array.from(core);
  const plural = chars.length > 2 && core.endsWith("s");
  const base = plural ? chars.slice(0, -1).join("") : core;
  const letters = Array.from(base);
  if (letters.length < MIN_ACRONYM || letters.length > MAX_ACRONYM || !letters.every((c) => isLetter(c) && isUpper(c))) return undefined;
  return { base, plural };
}

/** Lowercased plain word; undefined for acronyms, numbers and contractions. */
function plainWord(core: string): string | undefined {
  if (acronym(core) !== undefined || core === "" || !Array.from(core).every(isLetter)) return undefined;
  return core.toLowerCase();
}

function hasSilentE(letters: readonly string[]): boolean {
  const n = letters.length;
  if (n <= 3 || letters[n - 1] !== "e") return false;
  const vowels = "aeiouy";
  if (vowels.includes(letters[n - 2]!)) return false;
  if (letters[n - 2] === "l" && !vowels.includes(letters[n - 3]!)) return false;
  return true;
}

/** Vowel groups, less a silent final "e". */
export function syllables(word: string): number {
  const letters = Array.from(word.toLowerCase()).filter(isLetter);
  if (hasSilentE(letters)) letters.pop();
  let count = 0;
  let inVowel = false;
  for (const c of letters) {
    const vowel = "aeiouy".includes(c);
    if (vowel && !inVowel) count += 1;
    inVowel = vowel;
  }
  return count;
}

/** Swift `MeetingVocabulary.soundKey`: consonant codes in order, the first vowel sound by its letter, `V` for later ones. */
export function soundKey(word: string): string {
  const letters = Array.from(word.toLowerCase()).filter(isLetter);
  if (hasSilentE(letters)) letters.pop();
  const isVowel = (c: string | undefined): boolean => c !== undefined && "aeiouy".includes(c);
  const frontVowel = (c: string | undefined): boolean => c !== undefined && "eiy".includes(c);
  const at = (i: number): string | undefined => letters[i];
  const codes: string[] = [];
  const emit = (code: string): void => {
    if (codes.at(-1) !== code) codes.push(code);
  };
  let inVowel = false;
  let sawVowel = false;
  let i = 0;
  while (i < letters.length) {
    const c = letters[i]!;
    const next = at(i + 1);
    const vowel = "aeiou".includes(c) || (c === "y" && i > 0);
    if (vowel) {
      if (!inVowel) codes.push(sawVowel ? "V" : c.toUpperCase());
      sawVowel = true;
      inVowel = true;
      i += 1;
      continue;
    }
    switch (c) {
      case "p": if (next === "h") { emit("F"); i += 1; } else emit("P"); break;
      case "c": if (next === "h") { emit("X"); i += 1; } else if (frontVowel(next)) emit("S"); else emit("K"); break;
      case "t": if (next === "h") { emit("0"); i += 1; } else if (next === "i" && isVowel(at(i + 2))) emit("X"); else emit("T"); break;
      case "g": if (next === "h") i += 1; else if (frontVowel(next)) emit("J"); else emit("G"); break;
      case "k": case "q": emit("K"); break;
      case "s":
        if (next === "h") { emit("X"); i += 1; }
        else if (next !== undefined && "iu".includes(next) && isVowel(at(i + 2))) emit("J");
        else emit("S");
        break;
      case "x": emit("K"); emit("S"); break;
      case "h": case "w": break;
      default: emit(c.toUpperCase());
    }
    inVowel = false;
    i += 1;
  }
  if (codes.length >= 2 && codes.at(-2) === "N" && codes.at(-1) === "T") codes.pop();
  return codes.join("");
}

function editDistance(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  if (x.length === 0) return y.length;
  if (y.length === 0) return x.length;
  const row = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i += 1) {
    let previous = row[0]!;
    row[0] = i;
    for (let j = 1; j <= y.length; j += 1) {
      const current = row[j]!;
      row[j] = x[i - 1] === y[j - 1] ? previous : Math.min(previous, row[j]!, row[j - 1]!) + 1;
      previous = current;
    }
  }
  return row[y.length]!;
}

/** Confident terms in this meeting (and the firm's): how often each was heard and its usual spelling. */
class Lexicon {
  private readonly acronyms = new Map<string, number>();
  private readonly words = new Map<string, number>();
  private readonly spellings = new Map<string, Map<string, number>>();

  constructor(confident: readonly TranscribedWord[], firm: readonly VocabularyEntry[]) {
    for (const item of confident) this.add(token(item.text).core, 1);
    for (const entry of firm) {
      const term = entry.term.trim();
      if (term === "" || /\s/u.test(term)) continue;
      this.add(term, Number.POSITIVE_INFINITY, true);
    }
  }

  private add(core: string, count: number, firm = false): void {
    const letters = acronym(core);
    if (letters !== undefined) {
      this.acronyms.set(letters.base, (this.acronyms.get(letters.base) ?? 0) + count);
      return;
    }
    const plain = plainWord(core);
    if (plain === undefined) return;
    this.words.set(plain, (this.words.get(plain) ?? 0) + count);
    const spelled = this.spellings.get(plain) ?? new Map<string, number>();
    spelled.set(core, (spelled.get(core) ?? 0) + (firm ? Number.MAX_SAFE_INTEGER : 1));
    this.spellings.set(plain, spelled);
  }

  replacement(core: string): string | undefined {
    const letters = acronym(core);
    if (letters !== undefined) {
      const own = this.acronyms.get(letters.base) ?? 0;
      const matches = [...this.acronyms].filter(([term, count]) => Array.from(term).length >= MIN_ACRONYM_TERM && count > own && editDistance(term, letters.base) === 1);
      if (matches.length !== 1) return undefined;
      return matches[0]![0] + (letters.plural ? "s" : "");
    }
    const plain = plainWord(core);
    if (plain === undefined || Array.from(plain).length < MIN_WORD_LETTERS) return undefined;
    const count = syllables(plain);
    if (count < MIN_SYLLABLES) return undefined;
    const key = soundKey(plain);
    const own = this.words.get(plain) ?? 0;
    const matches = [...this.words].filter(([term, seen]) => term !== plain && seen > own && Array.from(term).length >= MIN_WORD_LETTERS
      && syllables(term) === count && soundKey(term) === key);
    if (matches.length !== 1) return undefined;
    const term = matches[0]![0];
    const spelled = [...(this.spellings.get(term) ?? new Map<string, number>())]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return spelled[0]?.[0] ?? term;
  }
}

const folded = (text: string): string => token(text).core.toLowerCase();

/** The firm's listed spellings as word runs (lowercased cores), longest first. */
function heardAs(firm: readonly VocabularyEntry[]): Array<{ words: string[]; term: string }> {
  const out: Array<{ words: string[]; term: string }> = [];
  for (const entry of firm) {
    const term = entry.term.trim();
    if (term === "") continue;
    for (const spelling of entry.alsoHeardAs ?? []) {
      const words = spelling.split(/\s+/u).map(folded).filter((item) => item !== "");
      if (words.length > 0 && words.length <= MAX_PHRASE_WORDS) out.push({ words, term });
    }
  }
  return out.sort((a, b) => b.words.length - a.words.length);
}

export interface CorrectOptions {
  readonly thresholds?: VocabularyThresholds;
  readonly firm?: readonly VocabularyEntry[];
}

export function correctVocabulary(words: readonly TranscribedWord[], options: CorrectOptions = {}): TranscribedWord[] {
  const thresholds = options.thresholds ?? DEFAULT_VOCABULARY_THRESHOLDS;
  const firm = options.firm ?? [];
  const lexicon = new Lexicon(words.filter((item) => item.confidence !== undefined && item.confidence >= thresholds.confident), firm);
  const sounded = words.map((item, index) => {
    if (item.confidence === undefined || item.confidence >= thresholds.uncertain || item.recognizedText !== undefined) return item;
    const parts = token(item.text);
    let core = lexicon.replacement(parts.core);
    if (core === undefined) return item;
    const sentenceStart = index === 0 || /[.?!]$/u.test(words[index - 1]!.text);
    if (sentenceStart && core[0] !== undefined && core[0] === core[0].toLowerCase() && core[0] !== core[0].toUpperCase()) core = core[0].toUpperCase() + core.slice(1);
    return { ...item, text: parts.prefix + core + parts.suffix, recognizedText: item.text };
  });
  const runs = heardAs(firm);
  if (runs.length === 0) return sounded;
  const out: TranscribedWord[] = [];
  let index = 0;
  while (index < sounded.length) {
    const run = runs.find((candidate) => candidate.words.every((part, offset) => {
      const item = sounded[index + offset];
      return item !== undefined && folded(item.recognizedText ?? item.text) === part;
    }));
    if (run === undefined) {
      out.push(sounded[index]!);
      index += 1;
      continue;
    }
    const covered = sounded.slice(index, index + run.words.length);
    const first = token(covered[0]!.text);
    const last = token(covered.at(-1)!.text);
    out.push({
      text: first.prefix + run.term + last.suffix,
      start: covered[0]!.start,
      end: covered.at(-1)!.end,
      confidence: covered.reduce<number | undefined>((low, item) => (item.confidence === undefined ? low : Math.min(low ?? 1, item.confidence)), undefined),
      recognizedText: covered.map((item) => item.recognizedText ?? item.text).join(" "),
    });
    index += run.words.length;
  }
  return out.map((item) => (item.recognizedText !== undefined && item.recognizedText === item.text ? { ...item, recognizedText: undefined } : item))
    .map((item) => {
      if (item.recognizedText !== undefined) return item;
      const { recognizedText: _drop, ...rest } = item;
      return rest;
    });
}

/** What `sherpa-onnx` returns for an offline transducer decode. */
export interface RecognizerResult {
  readonly tokens?: readonly string[];
  readonly timestamps?: readonly number[];
  readonly ys_log_probs?: readonly number[];
}

/**
 * Sub-word tokens joined into words (Swift `RecognizedWords`): a token starting with a space
 * (or the BPE word marker) begins a word. A word's confidence is the lowest of its token
 * probabilities; its end is the next word's start (or `end` for the last one).
 */
export function recognizedWords(result: RecognizerResult, offset: number, end: number): TranscribedWord[] {
  const tokens = result.tokens ?? [];
  const times = result.timestamps ?? [];
  const probs = result.ys_log_probs ?? [];
  const words: Array<{ text: string; start: number; confidence: number | undefined }> = [];
  tokens.forEach((piece, index) => {
    if (piece === "" || piece === "<blank>" || piece === "<pad>") return;
    const boundary = piece.startsWith(" ") || piece.startsWith("▁");
    const probability = probs[index] === undefined ? undefined : Math.exp(probs[index]!);
    const current = words.at(-1);
    if (boundary || current === undefined) {
      words.push({ text: piece.replace(/^[ ▁]+/u, ""), start: offset + (times[index] ?? 0), confidence: probability });
    } else {
      current.text += piece;
      if (probability !== undefined) current.confidence = Math.min(current.confidence ?? 1, probability);
    }
  });
  return words.filter((item) => item.text.trim() !== "").map((item, index, all) => ({
    text: item.text.trim(),
    start: item.start,
    end: index + 1 < all.length ? all[index + 1]!.start : Math.max(end, item.start),
    confidence: item.confidence,
  }));
}
