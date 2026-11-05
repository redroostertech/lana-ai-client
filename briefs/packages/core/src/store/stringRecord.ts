import { isJsonObject } from "../json/jsonValue.js";
import { parseJson } from "../json/parse.js";

/** Swift `try? LanaJSON.decode([String: String].self, ...) ?? [:]`: any non-string value gives an empty record. */
export function parseStringRecord(raw: string | null): Record<string, string> {
  if (raw === null) return {};
  try {
    const value = parseJson(raw);
    if (!isJsonObject(value)) return {};
    const record: Record<string, string> = {};
    for (const [key, member] of Object.entries(value)) {
      if (typeof member !== "string") return {};
      record[key] = member;
    }
    return record;
  } catch {
    return {};
  }
}
