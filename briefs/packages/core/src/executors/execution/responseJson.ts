import { fromUtf8 } from "../../bytes/utf8.js";
import { ResponseDecodingError } from "./executorError.js";

/** Minimal typed readers for API responses, shaped like Swift's `JSONDecoder` rules. Never echo values in errors. */
export type Json = unknown;

export function parseResponse(body: Uint8Array): Json {
  try {
    return JSON.parse(fromUtf8(body)) as Json;
  } catch {
    throw new ResponseDecodingError("$");
  }
}

export function obj(value: Json, path: string): Record<string, Json> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ResponseDecodingError(path);
  return value as Record<string, Json>;
}

export function arr(value: Json, path: string): Json[] {
  if (!Array.isArray(value)) throw new ResponseDecodingError(path);
  return value as Json[];
}

/** A required integer id (Swift `Int64`), returned as its decimal string. */
export function intId(object: Record<string, Json>, key: string, path: string): string {
  const value = object[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new ResponseDecodingError(`${path}.${key}`);
  return String(value);
}

export function str(object: Record<string, Json>, key: string, path: string): string {
  const value = object[key];
  if (typeof value !== "string") throw new ResponseDecodingError(`${path}.${key}`);
  return value;
}

/** An optional string: absent or null is undefined, anything else but a string fails. */
export function optStr(object: Record<string, Json>, key: string, path: string): string | undefined {
  const value = object[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new ResponseDecodingError(`${path}.${key}`);
  return value;
}

export function optObj(object: Record<string, Json>, key: string, path: string): Record<string, Json> | undefined {
  const value = object[key];
  if (value === undefined || value === null) return undefined;
  return obj(value, `${path}.${key}`);
}
