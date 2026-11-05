import type { JsonObject } from "../../json/jsonValue.js";
import { encodeCandidate, type Candidate } from "./candidate.js";

export const MATCH_REASONS = [
  "exact_name",
  /** Equal after folding case, diacritics, punctuation and legal suffixes. */
  "normalized_name",
  "fuzzy_name",
  /** An initial stood in for a word. Never enough on its own for a match. */
  "initials",
  "email_exact",
  "email_domain",
  "email_conflict",
  "display_number",
  "kind_mismatch",
] as const;
export type MatchReason = (typeof MATCH_REASONS)[number];

export interface ScoredCandidate {
  readonly candidate: Candidate;
  readonly score: number;
  readonly reasons: readonly MatchReason[];
}

/** Swift `Resolution`. */
export type Resolution =
  /** One clear winner: above the high threshold and well ahead of the runner-up. */
  | { readonly outcome: "match"; readonly candidate: Candidate; readonly score: number; readonly reasons: readonly MatchReason[] }
  /** Up to three plausible candidates. The attorney picks. */
  | { readonly outcome: "ambiguous"; readonly options: readonly ScoredCandidate[] }
  /** Nothing plausible. `suggestCreate` is true for contacts and companies. */
  | { readonly outcome: "no_match"; readonly suggestCreate: boolean };

/** Swift `ScoredCandidate` Codable shape. */
export function encodeScoredCandidate(scored: ScoredCandidate): JsonObject {
  return { candidate: encodeCandidate(scored.candidate), score: scored.score, reasons: [...scored.reasons] };
}
