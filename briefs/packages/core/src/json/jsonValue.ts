/** A JSON value as the canonical encoder accepts it. `undefined` object members are omitted, matching Swift's `encodeIfPresent` for nil optionals. */
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | JsonObject;

export interface JsonObject {
  readonly [key: string]: JsonValue | undefined;
}

export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
