import type { EntityHint } from "../../intent/entityHint.js";
import type { JsonObject, JsonValue } from "../../json/jsonValue.js";
import { asEnum, asObject, asString, field, optional } from "../../json/read.js";

export const CANDIDATE_KINDS = ["matter", "person", "company"] as const;
export type CandidateKind = (typeof CANDIDATE_KINDS)[number];

/** A record in a firm system that a hint might refer to (Swift `Candidate`). */
export interface Candidate {
  readonly id: string;
  readonly kind: CandidateKind;
  /** Contact name, or matter description for matters. */
  readonly name: string;
  readonly email?: string | undefined;
  readonly displayNumber?: string | undefined;
  /** Matter client name, when the candidate is a matter. */
  readonly clientName?: string | undefined;
  readonly source: string;
}

/**
 * Anything that can propose candidates for a hint: live Clio search today, the gateway's
 * local mirror later (Swift `CandidateSource`).
 */
export interface CandidateSource {
  readonly name: string;
  search(hint: EntityHint): Promise<Candidate[]>;
}

export function encodeCandidate(candidate: Candidate): JsonObject {
  return {
    id: candidate.id,
    kind: candidate.kind,
    name: candidate.name,
    email: candidate.email,
    display_number: candidate.displayNumber,
    client_name: candidate.clientName,
    source: candidate.source,
  };
}

export function decodeCandidate(value: JsonValue, path = "candidate"): Candidate {
  const object = asObject(value, path);
  return {
    id: field(object, "id", path, asString),
    kind: field(object, "kind", path, (v, p) => asEnum(v, CANDIDATE_KINDS, p)),
    name: field(object, "name", path, asString),
    email: optional(object, "email", path, asString),
    displayNumber: optional(object, "display_number", path, asString),
    clientName: optional(object, "client_name", path, asString),
    source: field(object, "source", path, asString),
  };
}
