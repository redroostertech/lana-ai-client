import { LanaDate } from "../../json/lanaDate.js";
import type { JsonObject, JsonValue } from "../../json/jsonValue.js";
import { asBool, asDate, asEnum, asObject, asString, field, optional } from "../../json/read.js";
import { EXECUTOR_KINDS, type ExecutorKind } from "./actionPlan.js";

/** Reverses one executed action inside its window (Swift `UndoToken`). */
export interface UndoToken {
  readonly executor: ExecutorKind;
  readonly externalID: string;
  /** The DELETE target. */
  readonly url: string;
  readonly expiresAt: Date;
}

/** 24 hours, in seconds. */
export const UNDO_WINDOW = 24 * 60 * 60;

export interface ExecutionResult {
  readonly externalID: string;
  readonly webURL?: string | undefined;
  readonly undo: UndoToken;
  /** True when an earlier attempt had already created the record and it was reused. */
  readonly deduplicated: boolean;
}

export function encodeUndoToken(token: UndoToken): JsonObject {
  return { executor: token.executor, external_id: token.externalID, url: token.url, expires_at: LanaDate.format(token.expiresAt) };
}

export function decodeUndoToken(value: JsonValue, path = "undo"): UndoToken {
  const object = asObject(value, path);
  return {
    executor: field(object, "executor", path, (v, p) => asEnum(v, EXECUTOR_KINDS, p)),
    externalID: field(object, "external_id", path, asString),
    url: field(object, "url", path, asString),
    expiresAt: field(object, "expires_at", path, asDate),
  };
}

/** Same keys as the Swift `CodingKeys`, so a ledger row written by either app reads in the other. */
export function encodeExecutionResult(result: ExecutionResult): JsonObject {
  return { external_id: result.externalID, web_url: result.webURL, undo: encodeUndoToken(result.undo), deduplicated: result.deduplicated };
}

export function decodeExecutionResult(value: JsonValue, path = "result"): ExecutionResult {
  const object = asObject(value, path);
  return {
    externalID: field(object, "external_id", path, asString),
    webURL: optional(object, "web_url", path, asString),
    undo: field(object, "undo", path, decodeUndoToken),
    deduplicated: field(object, "deduplicated", path, asBool),
  };
}
