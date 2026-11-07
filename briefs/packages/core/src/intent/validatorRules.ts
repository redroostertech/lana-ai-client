import { hybridCivil, hybridDays } from "../json/calendar.js";
import { graphemeCount, graphemes } from "../text/graphemes.js";
import { containsWhitespace } from "../text/whitespace.js";

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_EMAIL = 254;

/** `IntentValidator.isValidEmail`, compared by Swift `Character`s (grapheme clusters). */
export function isValidEmail(value: string): boolean {
  const parts: string[][] = [[]];
  for (const character of graphemes(value)) {
    if (character === "@") parts.push([]);
    else parts[parts.length - 1]?.push(character);
  }
  const [local, domain] = parts;
  if (parts.length !== 2 || local === undefined || domain === undefined || local.length === 0) return false;
  if (!domain.includes(".") || domain[0] === "." || domain[domain.length - 1] === ".") return false;
  return graphemeCount(value) <= MAX_EMAIL && !containsWhitespace(value);
}

/**
 * `IntentValidator.isCalendarDate`: a real date written exactly `YYYY-MM-DD`, in
 * Foundation's hybrid calendar (Julian before 1582-10-15, so 1500-02-29 exists and
 * 1582-10-10 does not).
 */
export function isCalendarDate(value: string): boolean {
  const match = CALENDAR_DATE.exec(value);
  if (match === null) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const civil = hybridCivil(hybridDays(year, month, day));
  return civil.year === year && civil.month === month && civil.day === day;
}
