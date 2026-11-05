import { decodeEntityHint, encodeEntityHint } from "@lana/core/intent";
import { arrayOf, asBool, asDate, asObject, asString, canonicalEncode, field, LanaDate, optional, parseJson, type JsonObject, type JsonValue } from "@lana/core/json";
import type { ExecutionResult, ExecutorKind, ResolvedEntity, ResolvedRecipient, ResolvedTarget } from "./actionRecords.js";

/**
 * What the gateway keeps in `intent.resolution` (Swift `StoredResolution`): the confirmed
 * target, the hash of the plan that was shown, and once executed the result with its
 * undo token. Canonical JSON with the Swift keys, so a store moved between the apps reads.
 */
export interface StoredResolution {
  readonly target: ResolvedTarget;
  readonly planHash?: string | undefined;
  readonly result?: ExecutionResult | undefined;
}

const ENTITY_KINDS = ["matter", "contact", "user"] as const;
const EXECUTORS: readonly ExecutorKind[] = ["clio.note", "clio.task", "graph.draft", "lana.task", "lana.note"];

export function encodeStoredResolution(value: StoredResolution): Uint8Array {
  return canonicalEncode({
    target: encodeTarget(value.target),
    plan_hash: value.planHash,
    result: value.result === undefined ? undefined : encodeResult(value.result),
  });
}

/** Null when absent or unreadable (Swift `StoredResolution.decode` with `try?`). */
export function decodeStoredResolution(data: Uint8Array | null): StoredResolution | null {
  if (data === null) return null;
  try {
    const object = asObject(parseJson(data), "resolution");
    return {
      target: field(object, "target", "resolution", decodeTarget),
      planHash: optional(object, "plan_hash", "resolution", asString),
      result: optional(object, "result", "resolution", decodeResult),
    };
  } catch {
    return null;
  }
}

function encodeEntity(entity: ResolvedEntity): JsonObject {
  return { kind: entity.kind, id: entity.id, displayName: entity.displayName };
}

function decodeEntity(value: JsonValue, path: string): ResolvedEntity {
  const object = asObject(value, path);
  const kind = field(object, "kind", path, asString);
  return {
    kind: (ENTITY_KINDS as readonly string[]).includes(kind) ? (kind as ResolvedEntity["kind"]) : "contact",
    id: field(object, "id", path, asString),
    displayName: field(object, "displayName", path, asString),
  };
}

function encodeTarget(target: ResolvedTarget): JsonObject {
  return {
    regarding: target.regarding === undefined ? undefined : encodeEntity(target.regarding),
    assignee: target.assignee === undefined ? undefined : encodeEntity(target.assignee),
    recipients: target.recipients.map((recipient) => ({
      hint: encodeEntityHint(recipient.hint),
      address: recipient.address ?? undefined,
      displayName: recipient.displayName,
    })),
  };
}

function decodeTarget(value: JsonValue, path: string): ResolvedTarget {
  const object = asObject(value, path);
  return {
    regarding: optional(object, "regarding", path, decodeEntity),
    assignee: optional(object, "assignee", path, decodeEntity),
    recipients: field(object, "recipients", path, arrayOf((item, itemPath): ResolvedRecipient => {
      const recipient = asObject(item, itemPath);
      return {
        hint: field(recipient, "hint", itemPath, decodeEntityHint),
        address: optional(recipient, "address", itemPath, asString) ?? null,
        displayName: field(recipient, "displayName", itemPath, asString),
      };
    })),
  };
}

function encodeResult(result: ExecutionResult): JsonObject {
  return {
    external_id: result.externalID,
    web_url: result.webURL ?? undefined,
    deduplicated: result.deduplicated,
    undo: {
      executor: result.undo.executor,
      external_id: result.undo.externalID,
      url: result.undo.url,
      expires_at: LanaDate.format(result.undo.expiresAt),
    },
  };
}

function decodeResult(value: JsonValue, path: string): ExecutionResult {
  const object = asObject(value, path);
  const undo = field(object, "undo", path, asObject);
  const executor = field(undo, "executor", `${path}.undo`, asString);
  if (!(EXECUTORS as readonly string[]).includes(executor)) throw new Error("unknown executor");
  return {
    externalID: field(object, "external_id", path, asString),
    webURL: optional(object, "web_url", path, asString) ?? null,
    deduplicated: field(object, "deduplicated", path, asBool),
    undo: {
      executor: executor as ExecutorKind,
      externalID: field(undo, "external_id", `${path}.undo`, asString),
      url: field(undo, "url", `${path}.undo`, asString),
      expiresAt: field(undo, "expires_at", `${path}.undo`, asDate),
    },
  };
}
