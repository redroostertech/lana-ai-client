import { asLanaId } from "../ids/codec.js";
import { makeLanaId, type LanaId } from "../ids/lanaId.js";
import { LanaDate } from "../json/lanaDate.js";
import type { JsonObject, JsonValue } from "../json/jsonValue.js";
import { arrayOf, asDate, asEnum, asNumber, asObject, asString, field, JsonShapeError } from "../json/read.js";
import { makeIdempotencyKey } from "./idempotencyKey.js";
import { canTransition, INTENT_STATUSES, InvalidTransitionError, type IntentStatus } from "./intentStatus.js";
import { decodeParams, encodeParams, intentType, type IntentParams } from "./params.js";

export const INTENT_SCHEMA = "lana.intent/v1";

/** One quoted span of the meeting that justifies an intent. */
export interface Evidence {
  readonly speaker: string;
  readonly tStart: number;
  readonly tEnd: number;
  readonly quote: string;
}

/** `lana.intent/v1`: a typed proposal from the phone. The gateway resolves and executes it. */
export interface Intent {
  readonly schema: typeof INTENT_SCHEMA;
  readonly id: LanaId;
  readonly meetingID: LanaId;
  /** Wire type string; equals `intentType(params)`. */
  readonly type: string;
  readonly status: IntentStatus;
  readonly confidence: number;
  readonly params: IntentParams;
  readonly evidence: readonly Evidence[];
  readonly createdAt: Date;
  readonly idempotencyKey: string;
}

export interface NewIntent {
  readonly id?: LanaId;
  readonly meetingID: LanaId;
  readonly params: IntentParams;
  readonly confidence: number;
  readonly evidence: readonly Evidence[];
  readonly createdAt: Date;
  readonly status?: IntentStatus;
}

/** Mirrors the Swift initializer: derives `type` and the idempotency key from the params. */
export function makeIntent(input: NewIntent): Intent {
  return {
    schema: INTENT_SCHEMA,
    id: input.id ?? makeLanaId("intent"),
    meetingID: input.meetingID,
    type: intentType(input.params),
    status: input.status ?? "proposed",
    confidence: input.confidence,
    params: input.params,
    evidence: input.evidence,
    createdAt: new Date(LanaDate.milliseconds(input.createdAt)),
    idempotencyKey: makeIdempotencyKey(input.meetingID, input.params),
  };
}

export function transitioned(intent: Intent, next: IntentStatus): Intent {
  if (!canTransition(intent.status, next)) throw new InvalidTransitionError(intent.status, next);
  return { ...intent, status: next };
}

export function encodeEvidence(evidence: Evidence): JsonObject {
  return { speaker: evidence.speaker, t_start: evidence.tStart, t_end: evidence.tEnd, quote: evidence.quote };
}

export function decodeEvidence(value: JsonValue, path: string): Evidence {
  const object = asObject(value, path);
  return {
    speaker: field(object, "speaker", path, asString),
    tStart: field(object, "t_start", path, asNumber),
    tEnd: field(object, "t_end", path, asNumber),
    quote: field(object, "quote", path, asString),
  };
}

export function encodeIntent(intent: Intent): JsonObject {
  return {
    schema: intent.schema,
    id: intent.id,
    meeting_id: intent.meetingID,
    type: intent.type,
    status: intent.status,
    confidence: intent.confidence,
    params: encodeParams(intent.params),
    evidence: intent.evidence.map(encodeEvidence),
    created_at: LanaDate.format(intent.createdAt),
    idempotency_key: intent.idempotencyKey,
  };
}

export function decodeIntent(value: JsonValue, path = "intent"): Intent {
  const object = asObject(value, path);
  const schema = field(object, "schema", path, asString);
  if (schema !== INTENT_SCHEMA) throw new JsonShapeError(`${path}.schema`, "unsupported schema");
  const type = field(object, "type", path, asString);
  const rawParams = Object.hasOwn(object, "params") ? (object["params"] ?? null) : null;
  if (type !== "note.log" && type !== "task.create" && type !== "email.draft") {
    // Unknown types keep their params verbatim (Swift `JSONValue`), null included.
  } else if (rawParams === null) {
    throw new JsonShapeError(`${path}.params`, "missing");
  }
  return {
    schema: INTENT_SCHEMA,
    id: field(object, "id", path, asLanaId),
    meetingID: field(object, "meeting_id", path, asLanaId),
    type,
    status: field(object, "status", path, (v, p) => asEnum(v, INTENT_STATUSES, p)),
    confidence: field(object, "confidence", path, asNumber),
    params: decodeParams(type, rawParams, `${path}.params`),
    evidence: field(object, "evidence", path, arrayOf(decodeEvidence)),
    createdAt: field(object, "created_at", path, asDate),
    idempotencyKey: field(object, "idempotency_key", path, asString),
  };
}
