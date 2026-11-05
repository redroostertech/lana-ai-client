import { decodeEntityHint, encodeEntityHint, type EntityHint } from "../../intent/entityHint.js";
import type { JsonObject, JsonValue } from "../../json/jsonValue.js";
import { arrayOf, asEnum, asObject, asString, field, optional } from "../../json/read.js";

export const RESOLVED_ENTITY_KINDS = ["matter", "contact", "user"] as const;
export type ResolvedEntityKind = (typeof RESOLVED_ENTITY_KINDS)[number];

export interface ResolvedEntity {
  readonly kind: ResolvedEntityKind;
  /** External id in the target system (Clio ids are numeric strings). */
  readonly id: string;
  readonly displayName: string;
}

export interface ResolvedRecipient {
  readonly hint: EntityHint;
  /** Undefined when the resolver could not settle on an address. Any missing address blocks the plan. */
  readonly address?: string | undefined;
  readonly displayName: string;
}

/** What the attorney confirmed on the card: concrete records in the firm's systems (Swift `ResolvedTarget`). */
export interface ResolvedTarget {
  readonly regarding?: ResolvedEntity | undefined;
  readonly assignee?: ResolvedEntity | undefined;
  /** One entry per `EmailParams.to` hint, in order. */
  readonly recipients?: readonly ResolvedRecipient[] | undefined;
}

// Swift synthesizes these without CodingKeys, so `displayName` stays camelCase on the wire.
function encodeEntity(entity: ResolvedEntity): JsonObject {
  return { kind: entity.kind, id: entity.id, displayName: entity.displayName };
}

function decodeEntity(value: JsonValue, path: string): ResolvedEntity {
  const object = asObject(value, path);
  return {
    kind: field(object, "kind", path, (v, p) => asEnum(v, RESOLVED_ENTITY_KINDS, p)),
    id: field(object, "id", path, asString),
    displayName: field(object, "displayName", path, asString),
  };
}

function decodeRecipient(value: JsonValue, path: string): ResolvedRecipient {
  const object = asObject(value, path);
  return {
    hint: field(object, "hint", path, decodeEntityHint),
    address: optional(object, "address", path, asString),
    displayName: field(object, "displayName", path, asString),
  };
}

export function encodeResolvedTarget(target: ResolvedTarget): JsonObject {
  return {
    regarding: target.regarding === undefined ? undefined : encodeEntity(target.regarding),
    assignee: target.assignee === undefined ? undefined : encodeEntity(target.assignee),
    recipients: (target.recipients ?? []).map((r) => ({ hint: encodeEntityHint(r.hint), address: r.address, displayName: r.displayName })),
  };
}

export function decodeResolvedTarget(value: JsonValue, path = "target"): ResolvedTarget {
  const object = asObject(value, path);
  return {
    regarding: optional(object, "regarding", path, decodeEntity),
    assignee: optional(object, "assignee", path, decodeEntity),
    recipients: field(object, "recipients", path, arrayOf(decodeRecipient)),
  };
}
