import { fromUtf8 } from "../bytes/utf8.js";
import type { JsonValue } from "./jsonValue.js";

export class JsonParseError extends Error {
  override readonly name = "JsonParseError";
}

/** Parses UTF-8 JSON bytes. Invalid UTF-8 is rejected, as Swift's `JSONDecoder` does. */
export function parseJson(bytes: Uint8Array | string): JsonValue {
  try {
    const text = typeof bytes === "string" ? bytes : fromUtf8(bytes);
    return JSON.parse(text) as JsonValue;
  } catch {
    throw new JsonParseError("Malformed JSON");
  }
}
