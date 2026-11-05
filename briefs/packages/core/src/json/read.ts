import { fromBase64 } from "../bytes/base64.js";
import { LanaDate } from "./lanaDate.js";
import { isJsonObject, type JsonObject, type JsonValue } from "./jsonValue.js";

/**
 * Thrown when JSON does not have the expected shape. Messages carry the field path
 * only, never values, so they are safe to log.
 */
export class JsonShapeError extends Error {
  override readonly name = "JsonShapeError";
  constructor(readonly path: string, reason: string) {
    super(`${path}: ${reason}`);
  }
}

export function asObject(value: JsonValue | undefined, path: string): JsonObject {
  if (!isJsonObject(value)) throw new JsonShapeError(path, "expected an object");
  return value;
}

export function asArray(value: JsonValue | undefined, path: string): readonly JsonValue[] {
  if (!Array.isArray(value)) throw new JsonShapeError(path, "expected an array");
  return value as readonly JsonValue[];
}

export function asString(value: JsonValue | undefined, path: string): string {
  if (typeof value !== "string") throw new JsonShapeError(path, "expected a string");
  return value;
}

export function asNumber(value: JsonValue | undefined, path: string): number {
  if (typeof value !== "number") throw new JsonShapeError(path, "expected a number");
  return value;
}

/** Swift `Int`. Limited to safe integers so the value re-encodes identically. */
export function asInt(value: JsonValue | undefined, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new JsonShapeError(path, "expected an integer");
  return value;
}

export function asBool(value: JsonValue | undefined, path: string): boolean {
  if (typeof value !== "boolean") throw new JsonShapeError(path, "expected a boolean");
  return value;
}

/** `Data`, encoded by Swift as padded base64. */
export function asBytes(value: JsonValue | undefined, path: string): Uint8Array {
  const bytes = fromBase64(asString(value, path));
  if (bytes === null) throw new JsonShapeError(path, "expected base64 data");
  return bytes;
}

export function asDate(value: JsonValue | undefined, path: string): Date {
  const date = LanaDate.parse(asString(value, path));
  if (date === null) throw new JsonShapeError(path, "expected a LANA timestamp");
  return date;
}

export function asEnum<T extends string>(value: JsonValue | undefined, allowed: readonly T[], path: string): T {
  const text = asString(value, path);
  if (!(allowed as readonly string[]).includes(text)) throw new JsonShapeError(path, "unexpected value");
  return text as T;
}

/** A required member. Swift treats a JSON null as missing for non-optional fields. */
export function required(object: JsonObject, key: string, path: string): JsonValue {
  const value = Object.hasOwn(object, key) ? object[key] : undefined;
  if (value === undefined || value === null) throw new JsonShapeError(`${path}.${key}`, "missing");
  return value;
}

/** An optional member: absent or null both mean nil, as `decodeIfPresent` reads them. */
export function optional<T>(object: JsonObject, key: string, path: string, read: (value: JsonValue, path: string) => T): T | undefined {
  const value = Object.hasOwn(object, key) ? object[key] : undefined;
  return value === undefined || value === null ? undefined : read(value, `${path}.${key}`);
}

export function field<T>(object: JsonObject, key: string, path: string, read: (value: JsonValue, path: string) => T): T {
  return read(required(object, key, path), `${path}.${key}`);
}

export function arrayOf<T>(read: (value: JsonValue, path: string) => T): (value: JsonValue, path: string) => T[] {
  return (value, path) => asArray(value, path).map((item, index) => read(item, `${path}[${index}]`));
}
