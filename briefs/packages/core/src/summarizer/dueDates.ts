/**
 * Spoken due dates ("tonight", "by Friday") resolved against the meeting start, in the
 * computer's local time zone. Only words with one clear meaning resolve; anything else
 * ("soon", "next month") stays as the spoken words with no date. Shared rules with the phone:
 * - today, tonight, this morning, this afternoon, this evening, end of day, EOD: the meeting day;
 * - tomorrow: the next day;
 * - a weekday name ("Friday", "by Friday", "this Friday"): the next such day after the meeting
 *   day (the same weekday means a week later); "next <weekday>" is one week after the meeting
 *   week's own: the next such day at least 7 days out;
 * - this week, end of the week, end of week, EOW: the Friday of the meeting week (the meeting day
 *   when it is already Friday or later).
 */
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const SAME_DAY = /^(today|tonight|this (morning|afternoon|evening)|(the )?end of (the )?day|eod|close of business|cob)$/u;
const END_OF_WEEK = /^(this week|(the )?end of (the |this )?week|eow)$/u;

function stamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function plusDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** `YYYY-MM-DD` for `spoken`, or undefined when the words have no single meaning. */
export function resolveDueText(spoken: string, meetingStart: Date): string | undefined {
  if (Number.isNaN(meetingStart.getTime())) return undefined;
  const text = spoken.toLowerCase().replace(/[.,!]/gu, " ").replace(/\s+/gu, " ").trim()
    .replace(/^(by|before|on|until|no later than) /u, "").replace(/ (at the latest|latest)$/u, "");
  const day = new Date(meetingStart.getFullYear(), meetingStart.getMonth(), meetingStart.getDate());
  if (SAME_DAY.test(text)) return stamp(day);
  if (text === "tomorrow" || text === "tomorrow morning" || text === "tomorrow night") return stamp(plusDays(day, 1));
  if (END_OF_WEEK.test(text)) return stamp(plusDays(day, Math.max(0, 5 - day.getDay())));
  const match = /^(this |next |coming |the )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)( morning| afternoon| evening| night)?$/u.exec(text);
  if (match === null) return undefined;
  const target = WEEKDAYS.indexOf(match[2]!);
  let ahead = (target - day.getDay() + 7) % 7;
  if (ahead === 0) ahead = 7;
  if (match[1] === "next " && ahead < 7) ahead += 7;
  return stamp(plusDays(day, ahead));
}
