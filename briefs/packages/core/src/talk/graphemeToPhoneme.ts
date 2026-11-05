/**
 * A small rule-based English letter-to-sound converter for words the Kokoro lexicon does
 * not know (client names, invented words). Written for Lana (no third-party rules, no GPL
 * code). It produces Kokoro's misaki phoneme set (A = eI, I = aI, O = oU, W = aU, Y = oI)
 * with primary stress on the first vowel. Not as good as a dictionary, but it never drops a
 * word: every letter run becomes sounds.
 */
const VOWELS = "aeiouy";
const SHORT: Record<string, string> = { a: "æ", e: "ɛ", i: "ɪ", o: "ɑ", u: "ʌ", y: "ɪ" };
const LONG: Record<string, string> = { a: "A", e: "i", i: "I", o: "O", u: "u", y: "I" };
const FINAL: Record<string, string> = { a: "ə", i: "i", o: "O", u: "u", y: "i" };
const SIMPLE: Record<string, string> = {
  b: "b", d: "d", f: "f", h: "h", k: "k", l: "l", m: "m", n: "n", p: "p", t: "t", v: "v", w: "w", z: "z", j: "ʤ", q: "k", r: "ɹ",
};

const isVowel = (word: string, index: number): boolean => {
  const letter = word[index];
  if (letter === undefined || !VOWELS.includes(letter)) return false;
  // A y before a vowel is a consonant ("yes", "Priya").
  return !(letter === "y" && isVowelLetter(word[index + 1]));
};
const isVowelLetter = (letter: string | undefined): boolean => letter !== undefined && "aeiou".includes(letter);

export function graphemeToPhoneme(input: string): string {
  const word = input.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z]/g, "");
  if (word.length === 0) return "";
  let out = "";
  let stressed = false;
  let index = 0;
  const vowel = (sound: string): void => {
    if (!stressed) {
      out += "ˈ";
      stressed = true;
    }
    out += sound;
  };
  const at = (text: string, offset = 0): boolean => word.startsWith(text, index + offset);
  const end = word.length;
  // A final silent e after a consonant (not in a two-letter word, and not the only vowel).
  const silentFinalE = end > 2 && word.endsWith("e") && !isVowel(word, end - 2) && [...word.slice(0, -1)].some((_, i) => isVowel(word, i));

  while (index < end) {
    const letter = word[index]!;
    const next = word[index + 1];
    const atStart = index === 0;
    if (isVowel(word, index)) {
      if (index === end - 1 && letter === "e" && silentFinalE) break;
      // Vowel pairs.
      const pairs: [string, string][] = [["eau", "O"], ["ee", "i"], ["ea", "i"], ["oo", "u"], ["ou", "W"], ["oi", "Y"], ["oy", "Y"], ["ai", "A"], ["ay", "A"],
        ["au", "ɔ"], ["aw", "ɔ"], ["ei", "A"], ["oa", "O"], ["ue", "u"], ["ui", "u"], ["eu", "u"], ["ew", "u"], ["ie", "i"]];
      const pair = pairs.find(([letters]) => at(letters));
      if (pair !== undefined) {
        const [letters, sound] = pair;
        const final = index + letters.length === end;
        vowel(letters === "ow" ? (final ? "O" : "W") : letters === "ey" && final ? "i" : sound);
        index += letters.length;
        continue;
      }
      if (at("ow")) {
        vowel(index + 2 === end ? "O" : "W");
        index += 2;
        continue;
      }
      if (at("ey")) {
        vowel(index + 2 === end ? "i" : "A");
        index += 2;
        continue;
      }
      // r-coloured vowels: a vowel then r not followed by a vowel.
      if (next === "r" && !isVowel(word, index + 2)) {
        const sound = letter === "a" ? "ɑɹ" : letter === "o" ? "ɔɹ" : stressed ? "əɹ" : "ɜɹ";
        vowel(sound);
        index += 2;
        continue;
      }
      const final = index === end - 1;
      if (final && FINAL[letter] !== undefined && (letter !== "y" || stressed)) {
        vowel(letter === "y" ? "i" : FINAL[letter]!);
        index += 1;
        continue;
      }
      // Magic e ("bake") and an open syllable ("Ngozi", "Okon"): vowel, one consonant, vowel.
      const consonant = word[index + 1];
      const afterConsonant = index + 2;
      const oneConsonant = consonant !== undefined && !isVowel(word, index + 1) && consonant !== "r" && consonant !== "x" && isVowel(word, afterConsonant)
        && !(word[afterConsonant] === "e" && afterConsonant === end - 1 && !silentFinalE);
      if (oneConsonant && (!stressed || (afterConsonant === end - 1 && word[afterConsonant] === "e"))) {
        vowel(LONG[letter]!);
        index += 1;
        continue;
      }
      // Unstressed short vowels reduce to a schwa, except i.
      vowel(stressed && letter !== "i" && letter !== "y" ? "ə" : SHORT[letter]!);
      index += 1;
      continue;
    }
    // Consonants, longest spelling first.
    if (at("tch")) { out += "ʧ"; index += 3; continue; }
    if (at("sch")) { out += "sk"; index += 3; continue; }
    if (at("ch")) { out += "ʧ"; index += 2; continue; }
    if (at("sh")) { out += "ʃ"; index += 2; continue; }
    if (at("th")) { out += "θ"; index += 2; continue; }
    if (at("ph")) { out += "f"; index += 2; continue; }
    if (at("gh")) { out += atStart ? "ɡ" : ""; index += 2; continue; }
    if (at("ck")) { out += "k"; index += 2; continue; }
    if (at("dg")) { out += "ʤ"; index += 2; continue; }
    if (at("qu")) { out += "kw"; index += 2; continue; }
    if (at("wh")) { out += "w"; index += 2; continue; }
    if (atStart && at("wr")) { out += "ɹ"; index += 2; continue; }
    if (atStart && at("kn")) { out += "n"; index += 2; continue; }
    if (at("ng")) {
      // A leading "ng" (Ngozi) is a syllabic n before the g, never a velar nasal.
      out += atStart ? "ˌɪnɡ" : index + 2 === end ? "ŋ" : "ŋɡ";
      index += 2;
      continue;
    }
    if (letter === next && letter !== "c" && letter !== "g") {
      index += 1;
      continue;
    }
    switch (letter) {
      case "x":
        out += atStart ? "z" : "ks";
        break;
      case "c":
        out += next === "e" || next === "i" || next === "y" ? "s" : "k";
        if (next === "c") index += 1;
        break;
      case "g":
        out += (next === "e" || next === "i" || next === "y") && index + 2 < end ? "ʤ" : "ɡ";
        if (next === "g") index += 1;
        break;
      case "s":
        out += index > 0 && isVowel(word, index - 1) && isVowel(word, index + 1) ? "z" : "s";
        break;
      case "y":
        out += "j";
        break;
      default:
        out += SIMPLE[letter] ?? "";
    }
    index += 1;
  }
  return out;
}
