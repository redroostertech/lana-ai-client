import { readFileSync } from "node:fs";
import { fold } from "../ask/tokenizer.js";
import { graphemeToPhoneme } from "./graphemeToPhoneme.js";
import { normalizeForSpeech } from "./speechNormalizer.js";
import { digitWords } from "./numberWords.js";

/** How a word was turned into sounds. */
export type PhonemeSource = "lexicon" | "rules" | "spelled";

export interface PhonemizedWord {
  readonly word: string;
  readonly phonemes: string;
  readonly source: PhonemeSource;
}

export interface PhonemizedSentence {
  /** Phonemes as Kokoro takes them: words separated by spaces, sentence punctuation kept. */
  readonly phonemes: string;
  readonly words: readonly PhonemizedWord[];
}

const VOICELESS_END = /[ptkfθ]$/u;
const SIBILANT_END = /[szʃʒʧʤ]$/u;
const TOKEN = /[\p{L}][\p{L}'-]*|[.,;:!?]|\d+/gu;

/**
 * Turns speech text into Kokoro phonemes so nothing is skipped: the Kokoro lexicon for
 * known words (its own pronunciations), letter names for acronyms and stray letters, and
 * the rule-based converter for every other word. Fed to sherpa-onnx as
 * `phonemeCodepoints`, which replaces its lexicon-only text path that drops unknown words.
 */
export class Phonemizer {
  private constructor(private readonly lexicon: ReadonlyMap<string, string>) {}

  /** Lexicon lines are `word p h o n e m e s` (one token per phoneme). */
  static fromLexiconText(text: string): Phonemizer {
    const lexicon = new Map<string, string>();
    for (const line of text.split("\n")) {
      const space = line.indexOf(" ");
      if (space <= 0) continue;
      const word = line.slice(0, space);
      if (!lexicon.has(word)) lexicon.set(word, line.slice(space + 1).split(" ").join(""));
    }
    return new Phonemizer(lexicon);
  }

  static fromLexiconFile(path: string): Phonemizer {
    return Phonemizer.fromLexiconText(readFileSync(path, "utf8"));
  }

  has(word: string): boolean {
    return this.lexicon.has(word.toLowerCase());
  }

  /** Normalizes, then phonemizes one sentence of answer text. */
  sentence(text: string): PhonemizedSentence {
    const words: PhonemizedWord[] = [];
    let phonemes = "";
    for (const token of normalizeForSpeech(text).match(TOKEN) ?? []) {
      if (/^[.,;:!?]$/.test(token)) {
        phonemes = phonemes.trimEnd() + token + " ";
        continue;
      }
      // Digits never survive normalization; read any that do, digit by digit.
      const parts = /^\d+$/.test(token) ? digitWords(token).split(" ") : [token];
      for (const part of parts) {
        for (const word of this.words(part)) {
          words.push(word);
          phonemes += `${word.phonemes} `;
        }
      }
    }
    return { phonemes: phonemes.trim(), words };
  }

  /** One token as one or more phonemized words (hyphenated words may split). */
  words(token: string): PhonemizedWord[] {
    const clean = token.replace(/^['-]+|['-]+$/g, "");
    if (clean.length === 0) return [];
    const known = this.lookup(clean);
    if (known !== undefined) return [{ word: clean, phonemes: known, source: "lexicon" }];
    if (clean.includes("-")) return clean.split("-").filter((part) => part.length > 0).flatMap((part) => this.words(part));
    const possessive = /^(.+)'s$/i.exec(clean);
    if (possessive !== null) {
      const base = this.words(possessive[1]!);
      const last = base[base.length - 1];
      if (last !== undefined) {
        const ending = SIBILANT_END.test(last.phonemes) ? "ɪz" : VOICELESS_END.test(last.phonemes) ? "s" : "z";
        return [...base.slice(0, -1), { ...last, word: clean, phonemes: last.phonemes + ending }];
      }
    }
    const inflected = this.inflected(clean);
    if (inflected !== undefined) return [{ word: clean, phonemes: inflected, source: "lexicon" }];
    const letters = fold(clean).replace(/[^a-z]/g, "");
    // Acronyms ("LLC", "FBI") and single letters are spelled.
    if (letters.length > 0 && (letters.length === 1 || (clean === clean.toUpperCase() && letters.length <= 5))) {
      return [{ word: clean, phonemes: this.spell(letters), source: "spelled" }];
    }
    const sounds = graphemeToPhoneme(clean);
    if (sounds.length > 0) return [{ word: clean, phonemes: sounds, source: "rules" }];
    return letters.length === 0 ? [] : [{ word: clean, phonemes: this.spell(letters), source: "spelled" }];
  }

  /** A plural, past or -ing form of a lexicon word ("deliveries", "rescheduled"). */
  private inflected(word: string): string | undefined {
    const lower = word.toLowerCase();
    const plural = (stem: string): string => (SIBILANT_END.test(stem) ? `${stem}ɪz` : VOICELESS_END.test(stem) ? `${stem}s` : `${stem}z`);
    const past = (stem: string): string => (/[td]$/u.test(stem) ? `${stem}ɪd` : VOICELESS_END.test(stem) || /[sʃʧ]$/u.test(stem) ? `${stem}t` : `${stem}d`);
    const candidates: [string, (stem: string) => string][] = [];
    if (lower.endsWith("ies")) candidates.push([`${lower.slice(0, -3)}y`, plural]);
    if (lower.endsWith("es")) candidates.push([lower.slice(0, -2), plural]);
    if (lower.endsWith("s")) candidates.push([lower.slice(0, -1), plural]);
    if (lower.endsWith("ied")) candidates.push([`${lower.slice(0, -3)}y`, past]);
    if (lower.endsWith("ed")) candidates.push([lower.slice(0, -2), past], [lower.slice(0, -1), past]);
    if (lower.endsWith("ing")) candidates.push([lower.slice(0, -3), (stem) => `${stem}ɪŋ`], [`${lower.slice(0, -3)}e`, (stem) => `${stem}ɪŋ`]);
    for (const [stem, inflect] of candidates) {
      const known = stem.length > 1 ? this.lexicon.get(stem) : undefined;
      if (known !== undefined) return inflect(known);
    }
    return undefined;
  }

  private lookup(word: string): string | undefined {
    const lower = word.toLowerCase();
    // The article "a" reads as a schwa; the letter name is for spelling.
    if (word === "a") return "ɐ";
    if (word.length === 1 && word !== "I" && word !== word.toUpperCase()) return undefined;
    return this.lexicon.get(lower) ?? this.lexicon.get(fold(lower));
  }

  private spell(letters: string): string {
    return [...letters].map((letter) => this.lexicon.get(letter) ?? graphemeToPhoneme(letter)).join(" ");
  }
}
