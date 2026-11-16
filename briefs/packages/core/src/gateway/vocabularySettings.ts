import type { JsonValue } from "../json/jsonValue.js";
import { canonicalString } from "../json/canonical.js";
import { parseJson } from "../json/parse.js";
import { utf8 } from "../bytes/utf8.js";
import type { VocabularyEntry } from "../recording/meetingVocabulary.js";
import type { SettingsWriter, SettingsReader } from "./handoffSettings.js";

/** Store setting keys for the firm's word list (Settings, shared with the phone through account info). */
export const VOCABULARY_SETTING_KEYS = { list: "vocabulary.terms", seeded: "vocabulary.seeded" } as const;

export const VOCABULARY_LIMITS = { terms: 200, termLength: 60, spellings: 10 } as const;

function clean(text: unknown): string {
  return typeof text === "string" ? text.replace(/\s+/gu, " ").trim().slice(0, VOCABULARY_LIMITS.termLength).trim() : "";
}

/** Trimmed, without blanks or repeats (case-insensitive, first kept), within the limits, in order. */
export function normalizeVocabulary(entries: readonly VocabularyEntry[]): VocabularyEntry[] {
  const out: VocabularyEntry[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const term = clean(entry?.term);
    const key = term.toLowerCase();
    if (term === "" || seen.has(key) || out.length >= VOCABULARY_LIMITS.terms) continue;
    seen.add(key);
    const spellings: string[] = [];
    const heard = new Set<string>([key]);
    for (const raw of Array.isArray(entry.alsoHeardAs) ? entry.alsoHeardAs : []) {
      const spelling = clean(raw);
      if (spelling === "" || heard.has(spelling.toLowerCase()) || spellings.length >= VOCABULARY_LIMITS.spellings) continue;
      heard.add(spelling.toLowerCase());
      spellings.push(spelling);
    }
    out.push(spellings.length === 0 ? { term } : { term, alsoHeardAs: spellings });
  }
  return out;
}

/** Wire shape: `{ "term", "also_heard_as" (omitted when empty) }`. */
export function encodeVocabulary(entries: readonly VocabularyEntry[]): JsonValue[] {
  return entries.map((entry) => ({ term: entry.term, also_heard_as: entry.alsoHeardAs === undefined || entry.alsoHeardAs.length === 0 ? undefined : [...entry.alsoHeardAs] }));
}

/** Reads the wire shape leniently: anything unreadable is skipped. */
export function decodeVocabulary(value: JsonValue | undefined): VocabularyEntry[] {
  if (!Array.isArray(value)) return [];
  return normalizeVocabulary(value.flatMap((item) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return [];
    const object = item as Record<string, JsonValue>;
    const heard = Array.isArray(object["also_heard_as"]) ? (object["also_heard_as"] as JsonValue[]).filter((spelling): spelling is string => typeof spelling === "string") : [];
    return typeof object["term"] === "string" ? [{ term: object["term"], alsoHeardAs: heard }] : [];
  }));
}

export function loadVocabulary(store: SettingsReader): VocabularyEntry[] {
  const raw = store.get(VOCABULARY_SETTING_KEYS.list);
  if (raw === null) return [];
  try {
    return decodeVocabulary(parseJson(utf8(raw)));
  } catch {
    return [];
  }
}

export function saveVocabulary(store: SettingsWriter, entries: readonly VocabularyEntry[]): VocabularyEntry[] {
  const list = normalizeVocabulary(entries);
  store.set(VOCABULARY_SETTING_KEYS.list, canonicalString(encodeVocabulary(list)));
  return list;
}

/**
 * Adds the firm's connector names to the list once (the first time names are known); later
 * calls change nothing, so a name the person removed does not come back. True when it seeded.
 */
export function seedVocabulary(store: SettingsWriter, names: readonly string[]): boolean {
  if (store.get(VOCABULARY_SETTING_KEYS.seeded) === "1") return false;
  saveVocabulary(store, [...loadVocabulary(store), ...names.map((term) => ({ term }))]);
  store.set(VOCABULARY_SETTING_KEYS.seeded, "1");
  return true;
}
