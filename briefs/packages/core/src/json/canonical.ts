import { utf8 } from "../bytes/utf8.js";
import { compareKeys } from "./compareKeys.js";
import { escapeString } from "./escapeString.js";
import { formatNumber } from "./formatNumber.js";
import type { JsonValue } from "./jsonValue.js";

/** Canonical JSON text, byte for byte what `LanaJSON.encode` produces for the same value. */
export function canonicalString(value: JsonValue): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      return formatNumber(value);
    case "string":
      return escapeString(value);
    default:
      break;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalString).join(",")}]`;
  const object = value as Readonly<Record<string, JsonValue | undefined>>;
  const members: string[] = [];
  for (const key of Object.keys(object).sort(compareKeys)) {
    const member = object[key];
    if (member !== undefined) members.push(`${escapeString(key)}:${canonicalString(member)}`);
  }
  return `{${members.join(",")}}`;
}

/** Canonical JSON bytes: what gets hashed and signed. */
export function canonicalEncode(value: JsonValue): Uint8Array {
  return utf8(canonicalString(value));
}
