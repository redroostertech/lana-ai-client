/**
 * The calendar Foundation's `Calendar(identifier: .gregorian)` really is: Gregorian from
 * 1582-10-15, Julian before it (the ICU hybrid). `LanaDate` formats and parses through
 * it, so dates before the cutover must use Julian rules here too to stay byte identical.
 * Day numbers count days since 1970-01-01.
 */
export interface CivilDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/** 1582-10-15, the first Gregorian day. */
export const GREGORIAN_CUTOVER_DAY = -141_427;
const CUTOVER_YEAR = 1582;

function floorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}

/** Proleptic Gregorian day number (H. Hinnant's days_from_civil). */
export function gregorianDays(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = floorDiv(y, 400);
  const yearOfEra = y - era * 400;
  const dayOfYear = floorDiv(153 * (month + (month > 2 ? -3 : 9)) + 2, 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + floorDiv(yearOfEra, 4) - floorDiv(yearOfEra, 100) + dayOfYear;
  return era * 146_097 + dayOfEra - 719_468;
}

/** Proleptic Julian day number, same epoch. */
export function julianDays(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = floorDiv(y, 4);
  const yearOfEra = y - era * 4;
  const dayOfYear = floorDiv(153 * (month + (month > 2 ? -3 : 9)) + 2, 5) + day - 1;
  return era * 1_461 + yearOfEra * 365 + dayOfYear - 719_470;
}

function civilFromDayOfEra(dayOfEra: number, yearOfEra: number, eraYears: number, era: number): CivilDate {
  const dayOfYear = dayOfEra;
  const shifted = floorDiv(5 * dayOfYear + 2, 153);
  const day = dayOfYear - floorDiv(153 * shifted + 2, 5) + 1;
  const month = shifted < 10 ? shifted + 3 : shifted - 9;
  const year = era * eraYears + yearOfEra;
  return { year: month <= 2 ? year + 1 : year, month, day };
}

export function gregorianCivil(days: number): CivilDate {
  const z = days + 719_468;
  const era = floorDiv(z, 146_097);
  const dayOfEra = z - era * 146_097;
  const yearOfEra = floorDiv(dayOfEra - floorDiv(dayOfEra, 1_460) + floorDiv(dayOfEra, 36_524) - floorDiv(dayOfEra, 146_096), 365);
  const dayOfYear = dayOfEra - (365 * yearOfEra + floorDiv(yearOfEra, 4) - floorDiv(yearOfEra, 100));
  return civilFromDayOfEra(dayOfYear, yearOfEra, 400, era);
}

export function julianCivil(days: number): CivilDate {
  const z = days + 719_470;
  const era = floorDiv(z, 1_461);
  const dayOfEra = z - era * 1_461;
  const yearOfEra = Math.min(floorDiv(dayOfEra, 365), 3);
  const dayOfYear = dayOfEra - 365 * yearOfEra;
  return civilFromDayOfEra(dayOfYear, yearOfEra, 4, era);
}

/** The civil date of a day number in the hybrid calendar. */
export function hybridCivil(days: number): CivilDate {
  return days >= GREGORIAN_CUTOVER_DAY ? gregorianCivil(days) : julianCivil(days);
}

/**
 * Day number for a possibly out-of-range year, month and day, resolved the way ICU's
 * lenient `GregorianCalendar` does: months roll into years, days roll forward, the
 * calendar is chosen by year and swapped when the result lands on the other side of
 * the cutover.
 */
export function hybridDays(year: number, month: number, day: number): number {
  const normalizedYear = year + floorDiv(month - 1, 12);
  const normalizedMonth = month - 1 - floorDiv(month - 1, 12) * 12 + 1;
  const compute = (gregorian: boolean): number =>
    (gregorian ? gregorianDays : julianDays)(normalizedYear, normalizedMonth, 1) + day - 1;
  const gregorian = normalizedYear >= CUTOVER_YEAR;
  const days = compute(gregorian);
  return gregorian === days >= GREGORIAN_CUTOVER_DAY ? days : compute(!gregorian);
}
