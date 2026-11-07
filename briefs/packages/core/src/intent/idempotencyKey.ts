import type { LanaId } from "../ids/lanaId.js";
import { slug } from "../text/slug.js";
import { intentType, regardingOf, titleOf, type IntentParams } from "./params.js";

/** Deterministic `<meeting>:<type>:<slug>`, identical to Swift `IdempotencyKey.make`. */
export function makeIdempotencyKey(meetingID: LanaId, params: IntentParams): string {
  const target = regardingOf(params)?.name ?? "";
  const basis = target.length === 0 ? titleOf(params) : `${target} ${titleOf(params)}`;
  return `${meetingID}:${intentType(params)}:${slug(basis)}`;
}
