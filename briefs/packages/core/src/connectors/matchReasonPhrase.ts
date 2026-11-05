import type { MatchReason } from "../executors/resolver/resolution.js";

const PHRASES: Readonly<Record<MatchReason, string>> = {
  exact_name: "Exact name",
  normalized_name: "Same name",
  fuzzy_name: "Similar name",
  initials: "Initial only",
  email_exact: "Same email",
  email_domain: "Same email domain",
  email_conflict: "Different email",
  display_number: "Matter number said",
  kind_mismatch: "Person, not company",
};

/** Plain words for the reason chips on an action card (Swift `MatchReason.phrase`). */
export function matchReasonPhrase(reason: MatchReason): string {
  return PHRASES[reason];
}
