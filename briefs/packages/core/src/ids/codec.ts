import { asString, JsonShapeError } from "../json/read.js";
import type { JsonValue } from "../json/jsonValue.js";
import { parseLanaId, type LanaId } from "./lanaId.js";

export function asLanaId(value: JsonValue | undefined, path: string): LanaId {
  const id = parseLanaId(asString(value, path));
  if (id === null) throw new JsonShapeError(path, "expected a LANA identifier");
  return id;
}
