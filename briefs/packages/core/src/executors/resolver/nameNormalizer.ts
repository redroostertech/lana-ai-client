import { SLUG_TABLE_PACKED } from "../../text/slugTable.js";

const LEGAL_SUFFIXES = new Set([
  "llc", "llp", "lllp", "lp", "inc", "incorporated", "corp", "corporation", "co", "company",
  "ltd", "limited", "pc", "pllc", "plc", "pa", "pty", "sa", "sarl", "srl", "gmbh", "ag", "bv", "nv",
]);
const ALPHANUMERIC = /^[\p{L}\p{M}\p{N}]$/u;
const COMBINING = /\p{Mn}/gu;
const EDGE_WHITESPACE = /^[\p{Zs}\t\u{200B}]+|[\p{Zs}\t\u{200B}]+$/gu;

let asciiFolds: Map<number, string> | undefined;

/**
 * Scalars Foundation folds to ASCII (or removes), from the table exported from Swift for
 * `IdempotencyKey.slug`. Entries holding a `-` were word breaks in the slug, not the
 * folded text, so they fall through to the generic rule.
 */
function foldTable(): Map<number, string> {
  if (asciiFolds === undefined) {
    asciiFolds = new Map();
    for (const entry of SLUG_TABLE_PACKED.split(",")) {
      const separator = entry.indexOf(":");
      const value = entry.slice(separator + 1);
      if (!value.includes("-")) asciiFolds.set(Number.parseInt(entry.slice(0, separator), 36), value);
    }
  }
  return asciiFolds;
}

function foldScalar(scalar: string): string {
  const code = scalar.codePointAt(0) ?? 0;
  if (code < 0x80) return scalar.toLowerCase();
  const mapped = foldTable().get(code);
  if (mapped !== undefined) return mapped;
  // Width folding for the halfwidth and fullwidth forms, then diacritics and case.
  const widened = code >= 0xff00 && code <= 0xffef ? scalar.normalize("NFKC") : scalar;
  return widened.normalize("NFD").replace(COMBINING, "").toLowerCase();
}

/**
 * Folds names into comparable tokens (Swift `NameNormalizer`): case and diacritics folded,
 * punctuation removed, "&" read as "and", a leading "the" and trailing legal suffixes
 * dropped. "Group", "Holdings", "Jr" and "Sr" are kept on purpose: they often name a
 * different entity.
 */
export const NameNormalizer = {
  legalSuffixes: LEGAL_SUFFIXES as ReadonlySet<string>,

  /** Foundation diacritic, case and width folding (en_US_POSIX), then lowercased. */
  fold(text: string): string {
    let out = "";
    for (const scalar of text) out += foldScalar(scalar);
    return out;
  },

  /** Tokens before suffix stripping. */
  tokens(text: string): string[] {
    let cleaned = "";
    for (const scalar of NameNormalizer.fold(text)) {
      if (scalar === "." || scalar === "'" || scalar === "’") continue;
      if (scalar === "&") cleaned += " and ";
      else cleaned += ALPHANUMERIC.test(scalar) ? scalar : " ";
    }
    return cleaned.split(" ").filter((token) => token.length > 0);
  },

  /** Tokens with a leading "the" and trailing legal suffixes removed (never down to zero). */
  coreTokens(text: string): string[] {
    const result = NameNormalizer.tokens(text);
    while (result.length > 1 && result[0] === "the") result.shift();
    while (result.length > 1 && LEGAL_SUFFIXES.has(result.at(-1) ?? "")) result.pop();
    return result;
  },

  normalized(text: string): string {
    return NameNormalizer.coreTokens(text).join(" ");
  },

  /** Query text for a remote search: the core name without suffixes or punctuation. */
  searchQuery(text: string): string {
    const core = NameNormalizer.normalized(text);
    return core.length === 0 ? text : core;
  },

  emailDomain(email: string | undefined): string | undefined {
    if (email === undefined) return undefined;
    const at = email.lastIndexOf("@");
    if (at < 0) return undefined;
    const domain = email.slice(at + 1).toLowerCase();
    return domain.length === 0 ? undefined : domain;
  },

  /** `trimmingCharacters(in: .whitespaces)`. */
  trimSpaces(text: string): string {
    return text.replace(EDGE_WHITESPACE, "");
  },
};
