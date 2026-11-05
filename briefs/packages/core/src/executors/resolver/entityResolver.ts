import type { EntityHint, EntityKind } from "../../intent/entityHint.js";
import { compareKeys } from "../../json/compareKeys.js";
import { graphemeCount } from "../../text/graphemes.js";
import type { Candidate, CandidateKind, CandidateSource } from "./candidate.js";
import { NameNormalizer } from "./nameNormalizer.js";
import type { MatchReason, Resolution, ScoredCandidate } from "./resolution.js";
import { StringSimilarity } from "./stringSimilarity.js";

export interface ResolverThresholds {
  readonly high: number;
  readonly low: number;
  readonly margin: number;
}

export const DEFAULT_THRESHOLDS: ResolverThresholds = { high: 0.9, low: 0.6, margin: 0.1 };

const GENERIC_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com",
  "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com", "gmx.com",
]);
const NUMBER = /\p{N}/u;
const LETTER_OR_NUMBER = /^[\p{Alphabetic}\p{N}]$/u;

interface NameScore {
  readonly score: number;
  readonly tokens: readonly string[];
  readonly equal: boolean;
  readonly initial: boolean;
}

interface Scored {
  readonly candidate: Candidate;
  readonly score: number;
  readonly reasons: readonly MatchReason[];
  readonly tokens: ReadonlySet<string>;
  readonly nameScore: number;
  readonly nameEqual: boolean;
  readonly usedInitial: boolean;
  readonly hardIdentifier: boolean;
}

function toPublic(scored: Scored): ScoredCandidate {
  return { candidate: scored.candidate, score: Math.round(scored.score * 1000) / 1000, reasons: scored.reasons };
}

function sameArray(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function isSubset(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && isSubset(a, b);
}

function isCompatible(hint: EntityKind, candidate: CandidateKind): boolean {
  return hint === "matter" ? candidate === "matter" : candidate !== "matter";
}

function nested(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return !setsEqual(a, b) && (isSubset(a, b) || isSubset(b, a));
}

/** Contact and company names: soft token-set Dice blended with Jaro-Winkler. */
function contactNameScore(hint: readonly string[], candidate: readonly string[]): NameScore {
  if (hint.length === 0 || candidate.length === 0) return { score: 0, tokens: candidate, equal: false, initial: false };
  const hintSorted = StringSimilarity.sorted(hint);
  const candidateSorted = StringSimilarity.sorted(candidate);
  if (sameArray(hintSorted, candidateSorted)) return { score: 1, tokens: candidate, equal: true, initial: false };
  const pairing = StringSimilarity.pair(hint, candidate);
  const dice = (2 * pairing.sum) / (hint.length + candidate.length);
  const jw = StringSimilarity.jaroWinkler(hintSorted.join(" "), candidateSorted.join(" "));
  return { score: 0.7 * dice + 0.3 * jw, tokens: candidate, equal: false, initial: pairing.usedInitial };
}

/**
 * Matters: how much of what was said is covered by the client name plus description,
 * blended with Dice so a broader matter does not tie a narrower one.
 */
function matterNameScore(hintTokens: readonly string[], candidate: Candidate): NameScore {
  const description = NameNormalizer.coreTokens(candidate.name);
  const client = candidate.clientName === undefined ? [] : NameNormalizer.coreTokens(candidate.clientName);
  const combined = [...client, ...description.filter((token) => !client.includes(token))];
  if (hintTokens.length === 0 || combined.length === 0) return { score: 0, tokens: combined, equal: false, initial: false };
  const hintSorted = StringSimilarity.sorted(hintTokens);
  if (sameArray(hintSorted, StringSimilarity.sorted(combined)) || sameArray(hintSorted, StringSimilarity.sorted(description))) {
    return { score: 1, tokens: combined, equal: true, initial: false };
  }
  const pairing = StringSimilarity.pair(hintTokens, combined);
  const coverage = pairing.sum / hintTokens.length;
  const dice = (2 * pairing.sum) / (hintTokens.length + combined.length);
  return { score: 0.6 * coverage + 0.4 * dice, tokens: combined, equal: false, initial: pairing.usedInitial };
}

/** True when the spoken text contains the matter's display number as a whole term. */
function mentions(text: string, displayNumber: string): boolean {
  const number = NameNormalizer.trimSpaces(NameNormalizer.fold(displayNumber));
  if (graphemeCount(number) < 3 || !NUMBER.test(number)) return false;
  const haystack = NameNormalizer.fold(text);
  let from = 0;
  for (;;) {
    const found = haystack.indexOf(number, from);
    if (found < 0) return false;
    const end = found + number.length;
    const before = found === 0 ? undefined : Array.from(haystack.slice(0, found)).at(-1);
    const after = end >= haystack.length ? undefined : Array.from(haystack.slice(end))[0];
    const beforeOK = before === undefined || !LETTER_OR_NUMBER.test(before);
    const afterOK = after === undefined || !LETTER_OR_NUMBER.test(after);
    if (beforeOK && afterOK) return true;
    from = end;
  }
}

/**
 * Turns a spoken reference into a firm record, conservatively (Swift `EntityResolver`).
 *
 * A `match` requires the top score to clear `high`, beat the runner-up by `margin`, not
 * rely on an initial, and not sit beside a runner-up whose name is a subset or superset of
 * its own (for matters: a broader matter). A unique exact email or matter display number
 * also matches, unless another candidate carries the same name. Everything else is
 * `ambiguous` for the attorney to settle. Never auto-merge.
 */
export class EntityResolver {
  constructor(private readonly sources: readonly CandidateSource[], private readonly thresholds: ResolverThresholds = DEFAULT_THRESHOLDS) {}

  async resolve(hint: EntityHint): Promise<Resolution> {
    const all: Candidate[] = [];
    for (const source of this.sources) all.push(...(await source.search(hint)));
    return this.rank(hint, all);
  }

  /** Pure scoring and decision over an already gathered candidate list. */
  rank(hint: EntityHint, candidates: readonly Candidate[]): Resolution {
    const { high, low, margin } = this.thresholds;
    const hintTokens = NameNormalizer.coreTokens(hint.name);
    const suggestCreate = hint.kind !== "matter";
    const seen = new Set<string>();
    const unique = candidates.filter((candidate) => {
      const key = `${candidate.kind}:${candidate.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const scored = unique
      .filter((candidate) => isCompatible(hint.kind, candidate.kind))
      .map((candidate) => this.score(hint, hintTokens, candidate))
      .sort((a, b) => (a.score !== b.score ? b.score - a.score : compareKeys(a.candidate.id, b.candidate.id)));

    const top = scored[0];
    if (top === undefined || top.score < low) return { outcome: "no_match", suggestCreate };
    const plausible = scored.filter((entry) => entry.score >= low);
    const ambiguous: Resolution = { outcome: "ambiguous", options: plausible.slice(0, 3).map(toPublic) };

    const hard = scored.filter((entry) => entry.hardIdentifier);
    if (hard.length > 1) return { outcome: "ambiguous", options: hard.slice(0, 3).map(toPublic) };
    const only = hard[0];
    if (only !== undefined) {
      // An email that points at someone whose name does not fit, or a second record
      // carrying the spoken name exactly, means the identifier alone is not enough.
      const nameTwin = scored.some((entry) => entry.candidate.id !== only.candidate.id && entry.nameEqual);
      const nameFits = only.candidate.kind === "matter" || only.nameScore >= low;
      return nameTwin || !nameFits ? ambiguous : { outcome: "match", candidate: only.candidate, score: only.score, reasons: only.reasons };
    }

    if (top.score < high || top.usedInitial) return ambiguous;
    const runner = scored[1];
    if (runner !== undefined && runner.score >= low) {
      if (top.score - runner.score < margin) return ambiguous;
      if (top.candidate.kind === "matter") {
        // A broader matter the speaker may have abbreviated.
        if (!setsEqual(top.tokens, runner.tokens) && isSubset(top.tokens, runner.tokens)) return ambiguous;
      } else if (nested(top.tokens, runner.tokens)) {
        return ambiguous;
      }
    }
    return { outcome: "match", candidate: top.candidate, score: top.score, reasons: top.reasons };
  }

  private score(hint: EntityHint, hintTokens: readonly string[], candidate: Candidate): Scored {
    const reasons: MatchReason[] = [];
    let hardIdentifier = false;
    let name: NameScore;
    if (candidate.kind === "matter") {
      name = matterNameScore(hintTokens, candidate);
      if (candidate.displayNumber !== undefined && mentions(hint.name, candidate.displayNumber)) {
        hardIdentifier = true;
        reasons.push("display_number");
      }
    } else {
      name = contactNameScore(hintTokens, NameNormalizer.coreTokens(candidate.name));
    }

    if (name.equal) {
      const exact = NameNormalizer.trimSpaces(NameNormalizer.fold(hint.name)) === NameNormalizer.trimSpaces(NameNormalizer.fold(candidate.name));
      reasons.push(exact ? "exact_name" : "normalized_name");
    } else if (name.score > 0) {
      reasons.push("fuzzy_name");
    }
    if (name.initial) reasons.push("initials");

    let total = name.score;
    const hintEmail = hint.email?.toLowerCase();
    const candidateEmail = candidate.email?.toLowerCase();
    if (hintEmail !== undefined && hintEmail.length > 0 && candidateEmail !== undefined && candidateEmail.length > 0) {
      const domain = NameNormalizer.emailDomain(hintEmail);
      if (hintEmail === candidateEmail) {
        hardIdentifier = true;
        total = Math.max(total, 0.97);
        reasons.push("email_exact");
      } else if (domain !== undefined && domain === NameNormalizer.emailDomain(candidateEmail) && !GENERIC_EMAIL_DOMAINS.has(domain)) {
        total = Math.min(1, total + 0.05);
        reasons.push("email_domain");
      } else {
        total -= 0.15;
        reasons.push("email_conflict");
      }
    }
    if (hint.kind === "company" && candidate.kind === "person") {
      total -= 0.1;
      reasons.push("kind_mismatch");
    }
    if (hardIdentifier && candidate.kind === "matter") total = Math.max(total, 0.97);

    return {
      candidate,
      score: Math.max(0, total),
      reasons,
      tokens: new Set(name.tokens),
      nameScore: name.score,
      nameEqual: name.equal,
      usedInitial: name.initial && !hardIdentifier,
      hardIdentifier,
    };
  }
}
