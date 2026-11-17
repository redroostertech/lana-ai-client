/**
 * Years LANA writes (Find more Amendment 8, notes and Find more, both platforms): a year the
 * cited lines never said is not trusted. After a month and day ("December 9, 2024") it becomes
 * the year that date falls in nearest the meeting (within six months either way); anywhere else
 * the item is dropped. A calendar due date is put in the same year when its year was not said.
 */
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH = "(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\\.?";
const YEAR = /\b(19|20)\d{2}\b/gu;
const MONTH_DAY_YEAR = new RegExp(`\\b${MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+((?:19|20)\\d{2})\\b`, "giu");
const DAY_MONTH_YEAR = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH},?\\s+((?:19|20)\\d{2})\\b`, "giu");

function monthIndex(name: string): number {
  const lower = name.toLowerCase().replace(/\.$/u, "");
  return MONTHS.findIndex((month) => month.startsWith(lower.slice(0, 3)));
}

/** The year month/day falls in nearest the meeting day (within six months either way). */
export function nearestYear(month: number, day: number, meetingStart: Date): number {
  const base = meetingStart.getFullYear();
  const meeting = new Date(base, meetingStart.getMonth(), meetingStart.getDate()).getTime();
  const candidates = [base - 1, base, base + 1].map((year) => ({ year, gap: Math.abs(new Date(year, month, day).getTime() - meeting) }));
  return candidates.sort((a, b) => a.gap - b.gap)[0]!.year;
}

/** The text with untrusted years fixed, or undefined when an untrusted year is not part of a date. */
export function checkYears(text: string, cited: string, meetingStart: Date): string | undefined {
  const said = new Set([...cited.matchAll(YEAR)].map((match) => match[0]));
  let out = text;
  const fix = (whole: string, monthName: string, dayText: string, year: string): string => {
    if (said.has(year)) return whole;
    const month = monthIndex(monthName);
    if (month < 0) return whole;
    return whole.replace(year, String(nearestYear(month, Number(dayText), meetingStart)));
  };
  out = out.replace(MONTH_DAY_YEAR, (whole, monthName: string, day: string, year: string) => fix(whole, monthName, day, year));
  out = out.replace(DAY_MONTH_YEAR, (whole, day: string, monthName: string, year: string) => fix(whole, monthName, day, year));
  // Any year left that the lines never said, and that is not one just fixed in a date, makes the item untrusted.
  const fixedDates = new Set([...out.matchAll(MONTH_DAY_YEAR), ...out.matchAll(DAY_MONTH_YEAR)].map((match) => match[0]));
  const dateYears = [...fixedDates].flatMap((date) => [...date.matchAll(YEAR)].map((match) => match[0]));
  const stray = [...out.matchAll(YEAR)].map((match) => match[0]).filter((year) => !said.has(year) && !dateYears.includes(year));
  return stray.length > 0 ? undefined : out;
}

/** A YYYY-MM-DD due date in the year nearest the meeting when its year was not said in the cited lines. */
export function checkDueYear(dueDate: string, cited: string, meetingStart: Date): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(dueDate);
  if (match === null || [...cited.matchAll(YEAR)].some((year) => year[0] === match[1])) return dueDate;
  const year = nearestYear(Number(match[2]) - 1, Number(match[3]), meetingStart);
  return `${year}-${match[2]}-${match[3]}`;
}
