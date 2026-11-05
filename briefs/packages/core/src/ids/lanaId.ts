import { isValidUlid, makeUlid } from "./ulid.js";

export const LANA_ID_KINDS = { intent: "int", meeting: "mtg", bundle: "bdl", device: "dev", audit: "aud", segment: "seg" } as const;
export type LanaIdKind = keyof typeof LANA_ID_KINDS;
export type LanaIdPrefix = (typeof LANA_ID_KINDS)[LanaIdKind];

/** A validated, prefixed, time-sortable identifier such as `int_01JCQ8...`. */
export type LanaId = string & { readonly __lanaId: unique symbol };

const PREFIX_TO_KIND = new Map<string, LanaIdKind>(
  (Object.entries(LANA_ID_KINDS) as [LanaIdKind, LanaIdPrefix][]).map(([kind, prefix]) => [prefix, kind]),
);

export function makeLanaId(kind: LanaIdKind, date: Date = new Date()): LanaId {
  return `${LANA_ID_KINDS[kind]}_${makeUlid(date.getTime())}` as LanaId;
}

/** Parses like `LanaID(validating:kind:)`; null for anything malformed or of another kind. */
export function parseLanaId(raw: string, kind?: LanaIdKind): LanaId | null {
  const separator = raw.indexOf("_");
  if (separator < 0) return null;
  const parsed = PREFIX_TO_KIND.get(raw.slice(0, separator));
  if (parsed === undefined || (kind !== undefined && kind !== parsed)) return null;
  return isValidUlid(raw.slice(separator + 1)) ? (raw as LanaId) : null;
}

/** The kind of an identifier, from its prefix. */
export function lanaIdKind(id: LanaId): LanaIdKind | undefined {
  const separator = id.indexOf("_");
  return PREFIX_TO_KIND.get(separator < 0 ? id : id.slice(0, separator));
}
