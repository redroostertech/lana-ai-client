import { cardinal, decimalWords, digitWords, ordinal, yearWords } from "./numberWords.js";

/**
 * Rewrites answer text so every part of it can be spoken as words: dates, times, money,
 * percentages, ordinals, matter numbers and other codes, and plain numbers become words,
 * and common abbreviations are expanded. Kokoro in sherpa-onnx 2.x reads only words it can
 * phonemize and silently drops digits and symbols; with this pass nothing is left for it to
 * drop. The output keeps sentence punctuation (, . ; : ! ?).
 */
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTH_ABBREVIATIONS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
for (const [index, name] of MONTHS.entries()) MONTH_ABBREVIATIONS[name.toLowerCase()] = index + 1;

const ABBREVIATIONS: readonly [RegExp, string][] = [
  [/\bDr\.(?=\s)/g, "Doctor"],
  [/\bMr\.(?=\s)/g, "Mister"],
  [/\bMrs\.(?=\s)/g, "Missus"],
  [/\bMs\.(?=\s)/g, "Miz"],
  [/\bJr\./g, "Junior"],
  [/\bSr\./g, "Senior"],
  [/\bAtty\./g, "Attorney"],
  [/\bProf\.(?=\s)/g, "Professor"],
  [/\s(?:v|vs)\.?\s(?=[A-Z])/g, " versus "],
  [/\bInc\./g, "Incorporated"],
  [/\bLtd\./g, "Limited"],
  [/\be\.g\.,?/gi, "for example"],
  [/\bi\.e\.,?/gi, "that is"],
  [/\betc\./gi, "et cetera"],
  [/\bNo\.\s?(?=\d)/g, "number "],
  [/#\s?(?=\d)/g, "number "],
];

function dateWords(month: number, day: number, year?: number): string | undefined {
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  return `${MONTHS[month - 1]} ${ordinal(day)}${year === undefined ? "" : `, ${yearWords(year)}`}`;
}

/** One group of digits inside a code such as a matter number. */
function codeDigits(digits: string): string {
  if (digits.length <= 2 && !(digits.length === 2 && digits.startsWith("0"))) return cardinal(Number(digits));
  if (digits.length === 4 && !digits.startsWith("0")) return yearWords(Number(digits));
  return digitWords(digits);
}

/** Letters inside a code: short runs are spelled ("cv" to "C V"), words stay words. */
function codeLetters(letters: string): string {
  return letters.length <= 3 ? [...letters.toUpperCase()].join(" ") : letters;
}

/** "2026-0147" to "twenty twenty six zero one four seven", "W-9" to "W nine", "12-cv-345" to "twelve C V three four five". */
export function codeWords(code: string): string {
  const parts = code.split(/[-/.]/).flatMap((part) => part.match(/\d+|[A-Za-z]+/g) ?? []);
  return parts.map((part) => (/^\d/.test(part) ? codeDigits(part) : codeLetters(part))).join(" ");
}

function plainNumber(text: string): string {
  const digits = text.replace(/,/g, "");
  if (digits.length > 15) return digitWords(digits);
  const value = Number(digits);
  if (!text.includes(",") && digits.length === 4 && value >= 1100 && value <= 2099) return yearWords(value);
  return cardinal(BigInt(digits));
}

export function normalizeForSpeech(input: string): string {
  let text = input.replace(/[\u2018\u2019]/g, "'").replace(/[\u2013\u2014]/g, ", ");
  for (const [pattern, replacement] of ABBREVIATIONS) text = text.replace(pattern, replacement);

  // ISO and US dates.
  text = text.replace(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g, (all, y: string, m: string, d: string) => dateWords(Number(m), Number(d), Number(y)) ?? all);
  text = text.replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})\b/g, (all, m: string, d: string, y: string) =>
    dateWords(Number(m), Number(d), y.length === 2 ? 2000 + Number(y) : Number(y)) ?? all);
  // "December 2", "Dec. 2nd, 2026".
  text = text.replace(/\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4})\b)?/g,
    (all, month: string, day: string, year: string | undefined) => dateWords(MONTH_ABBREVIATIONS[month.toLowerCase()]!, Number(day), year === undefined ? undefined : Number(year)) ?? all);
  // Clock times: "9:30", "10:05 a.m.", "3:00 PM".
  text = text.replace(/\b(\d{1,2}):(\d{2})(?:\s*([AaPp])\.?\s?[Mm]\b\.?)?/g, (_all, h: string, m: string, half: string | undefined) => {
    const minutes = Number(m);
    const spokenMinutes = minutes === 0 ? (half === undefined ? " o'clock" : "") : minutes < 10 ? ` oh ${cardinal(minutes)}` : ` ${cardinal(minutes)}`;
    return `${cardinal(Number(h))}${spokenMinutes}${half === undefined ? "" : ` ${half.toUpperCase()} M`}`;
  });
  // Money: "$1,200.50", "$3 million".
  text = text.replace(/\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?:\s*(thousand|million|billion|trillion)\b)?/gi, (_all, whole: string, cents: string | undefined, scale: string | undefined) => {
    if (scale !== undefined) return `${decimalWords(`${whole.replace(/,/g, "")}${cents === undefined ? "" : `.${cents}`}`)} ${scale.toLowerCase()} dollars`;
    const dollars = BigInt(whole.replace(/,/g, ""));
    const centValue = cents === undefined ? 0 : Number(cents.padEnd(2, "0"));
    const dollarWords = `${cardinal(dollars)} ${dollars === 1n ? "dollar" : "dollars"}`;
    return centValue === 0 ? dollarWords : `${dollarWords} and ${cardinal(centValue)} ${centValue === 1 ? "cent" : "cents"}`;
  });
  text = text.replace(/(\d+(?:\.\d+)?)\s?%/g, (_all, value: string) => `${decimalWords(value)} percent`);
  text = text.replace(/\b(\d+)(?:st|nd|rd|th)\b/g, (_all, value: string) => ordinal(BigInt(value)));
  // Decimals before codes, so "3.5" is a number, not a code.
  text = text.replace(/\b\d+\.\d+\b(?![-/.]\w)/g, (value) => decimalWords(value));
  // Matter numbers and other codes with separators, then letter and digit mixes ("W9", "P1").
  text = text.replace(/\b(?=[A-Za-z0-9./-]*\d)[A-Za-z0-9]+(?:[-/.][A-Za-z0-9]+)+\b/g, (code) => codeWords(code));
  text = text.replace(/\b(?=[A-Za-z]*\d)(?=\d*[A-Za-z])[A-Za-z0-9]+\b/g, (code) => codeWords(code));
  text = text.replace(/\b\d{1,3}(?:,\d{3})+\b|\b\d+\b/g, (value) => plainNumber(value));
  // Symbols.
  text = text.replace(/\s*&\s*/g, " and ").replace(/\s*@\s*/g, " at ").replace(/\s*\+\s*/g, " plus ").replace(/\s*=\s*/g, " equals ").replace(/%/g, " percent");
  text = text.replace(/(?<=\p{L})\/(?=\p{L})/gu, " ");
  return text.replace(/\s+/g, " ").replace(/ ([.,;:!?])/g, "$1").trim();
}
