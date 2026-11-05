import type { LanaId } from "../../ids/lanaId.js";
import { asLanaId } from "../../ids/codec.js";
import type { JsonObject, JsonValue } from "../../json/jsonValue.js";
import { arrayOf, asEnum, asObject, asString, field, optional } from "../../json/read.js";
import { decodePlannedRequest, encodePlannedRequest, plannedRequestHash, type PlannedRequest } from "./plannedRequest.js";

export const EXECUTOR_KINDS = ["clio.note", "clio.task", "graph.draft"] as const;
export type ExecutorKind = (typeof EXECUTOR_KINDS)[number];

export interface PreviewField {
  readonly label: string;
  readonly value: string;
}

/** Human-readable summary for the confirmation card. */
export interface ActionPreview {
  readonly title: string;
  readonly fields: readonly PreviewField[];
}

export interface FieldChange {
  readonly field: string;
  readonly old?: string | undefined;
  readonly new?: string | undefined;
}

/**
 * Everything the action card shows and everything execute will send (Swift `ActionPlan`).
 * Execute refuses a plan whose request no longer hashes to `planHash`.
 */
export interface ActionPlan {
  readonly executor: ExecutorKind;
  readonly intentID: LanaId;
  readonly idempotencyKey: string;
  /** Text embedded in (or attached to) the created record so a retry can find it. */
  readonly marker: string;
  readonly request: PlannedRequest;
  readonly preview: ActionPreview;
  /** Field changes against an existing record. Empty for creates, which is every executor today. */
  readonly diff: readonly FieldChange[];
  readonly planHash: string;
}

export function makeActionPlan(input: Omit<ActionPlan, "planHash" | "diff"> & { readonly diff?: readonly FieldChange[] }): ActionPlan {
  return { ...input, diff: input.diff ?? [], planHash: plannedRequestHash(input.request) };
}

export function encodeActionPlan(plan: ActionPlan): JsonObject {
  return {
    executor: plan.executor,
    intent_id: plan.intentID,
    idempotency_key: plan.idempotencyKey,
    marker: plan.marker,
    request: encodePlannedRequest(plan.request),
    preview: { title: plan.preview.title, fields: plan.preview.fields.map((f) => ({ label: f.label, value: f.value })) },
    diff: plan.diff.map((change) => ({ field: change.field, old: change.old, new: change.new })),
    plan_hash: plan.planHash,
  };
}

function decodePreviewField(value: JsonValue, path: string): PreviewField {
  const object = asObject(value, path);
  return { label: field(object, "label", path, asString), value: field(object, "value", path, asString) };
}

function decodeFieldChange(value: JsonValue, path: string): FieldChange {
  const object = asObject(value, path);
  return { field: field(object, "field", path, asString), old: optional(object, "old", path, asString), new: optional(object, "new", path, asString) };
}

export function decodeActionPlan(value: JsonValue, path = "plan"): ActionPlan {
  const object = asObject(value, path);
  const preview = field(object, "preview", path, asObject);
  return {
    executor: field(object, "executor", path, (v, p) => asEnum(v, EXECUTOR_KINDS, p)),
    intentID: field(object, "intent_id", path, asLanaId),
    idempotencyKey: field(object, "idempotency_key", path, asString),
    marker: field(object, "marker", path, asString),
    request: field(object, "request", path, decodePlannedRequest),
    preview: {
      title: field(preview, "title", `${path}.preview`, asString),
      fields: field(preview, "fields", `${path}.preview`, arrayOf(decodePreviewField)),
    },
    diff: field(object, "diff", path, arrayOf(decodeFieldChange)),
    planHash: field(object, "plan_hash", path, asString),
  };
}
