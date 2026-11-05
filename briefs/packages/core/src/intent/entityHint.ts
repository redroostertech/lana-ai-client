import type { JsonObject, JsonValue } from "../json/jsonValue.js";
import { asEnum, asObject, asString, field, optional } from "../json/read.js";

export const ENTITY_KINDS = ["matter", "contact", "company"] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

/** A fuzzy reference to something that may exist in the firm's systems. The gateway resolver decides what it is. */
export interface EntityHint {
  readonly kind: EntityKind;
  readonly name: string;
  readonly email?: string | undefined;
}

export function encodeEntityHint(hint: EntityHint): JsonObject {
  return { kind: hint.kind, name: hint.name, email: hint.email };
}

export function decodeEntityHint(value: JsonValue, path: string): EntityHint {
  const object = asObject(value, path);
  return {
    kind: field(object, "kind", path, (v, p) => asEnum(v, ENTITY_KINDS, p)),
    name: field(object, "name", path, asString),
    email: optional(object, "email", path, asString),
  };
}
