import { LanaDate } from "../json/lanaDate.js";

/** Foundation's `Date.distantPast` (0001-01-01T00:00:00Z in the hybrid calendar). */
export const DISTANT_PAST = new Date(-62_135_769_600_000);

/** Swift `LanaDate.parse(raw) ?? .distantPast`, the store's reading of a date column. */
export function parseStoredDate(raw: string | null): Date {
  if (raw === null) return DISTANT_PAST;
  return LanaDate.parse(raw) ?? DISTANT_PAST;
}

/** Swift `LanaDate.normalized`: whole milliseconds. */
export function normalizedDate(date: Date): Date {
  return new Date(LanaDate.milliseconds(date));
}
