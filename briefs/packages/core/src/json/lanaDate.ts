import { GREGORIAN_CUTOVER_DAY, hybridCivil, hybridDays } from "./calendar.js";

const MS_PER_DAY = 86_400_000;

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

/**
 * Canonical UTC timestamps, `YYYY-MM-DDTHH:MM:SS.mmmZ`, identical to Swift `LanaDate`.
 * Works in integer milliseconds, in the same hybrid Julian and Gregorian calendar.
 */
export const LanaDate = {
  /** Whole milliseconds since 1970, rounded half away from zero like Swift's `rounded()`. */
  milliseconds(date: Date | number): number {
    const ms = typeof date === "number" ? date : date.getTime();
    if (!Number.isFinite(ms)) throw new RangeError("Invalid date");
    return Math.sign(ms) * Math.round(Math.abs(ms));
  },

  format(date: Date | number): string {
    const millis = LanaDate.milliseconds(date);
    const days = Math.floor(millis / MS_PER_DAY);
    const civil = hybridCivil(days);
    if (civil.year < 1) throw new RangeError("Dates before year 1 are not supported");
    const inDay = millis - days * MS_PER_DAY;
    const hour = Math.floor(inDay / 3_600_000);
    const minute = Math.floor((inDay % 3_600_000) / 60_000);
    const second = Math.floor((inDay % 60_000) / 1_000);
    const fraction = inDay % 1_000;
    return `${pad(civil.year, 4)}-${pad(civil.month, 2)}-${pad(civil.day, 2)}T${pad(hour, 2)}:${pad(minute, 2)}:${pad(second, 2)}.${pad(fraction, 3)}Z`;
  },

  /** Milliseconds since 1970, or null when Swift's `LanaDate.parse` would return nil. */
  parseMilliseconds(raw: string): number | null {
    const bytes = Buffer.from(raw, "utf8");
    const at = (index: number): number => bytes[index] ?? -1;
    const number = (from: number, to: number): number | null => {
      if (to > bytes.length) return null;
      let value = 0;
      for (let index = from; index < to; index += 1) {
        const digit = at(index) - 48;
        if (digit < 0 || digit > 9) return null;
        value = value * 10 + digit;
      }
      return value;
    };
    if (bytes.length < 20 || at(4) !== 45 || at(7) !== 45 || at(10) !== 84 || at(13) !== 58 || at(16) !== 58) return null;
    const year = number(0, 4);
    const month = number(5, 7);
    const day = number(8, 10);
    const hour = number(11, 13);
    const minute = number(14, 16);
    const second = number(17, 19);
    if (year === null || month === null || day === null || hour === null || minute === null || second === null) return null;
    let index = 19;
    let millis = 0;
    if (at(index) === 46) {
      let digits = 0;
      index += 1;
      for (let digit = number(index, index + 1); index < bytes.length && digit !== null; digit = number(index, index + 1)) {
        if (digits < 3) millis = millis * 10 + digit;
        digits += 1;
        index += 1;
      }
      if (digits === 0) return null;
      for (let padding = digits; padding < 3; padding += 1) millis *= 10;
    }
    if (index !== bytes.length - 1 || at(index) !== 90) return null;
    const base = hybridDays(year, month, day) * MS_PER_DAY + hour * 3_600_000 + minute * 60_000 + second * 1_000;
    if (hybridCivil(Math.floor(base / MS_PER_DAY)).day !== day) return null;
    return base + millis;
  },

  parse(raw: string): Date | null {
    const ms = LanaDate.parseMilliseconds(raw);
    return ms === null ? null : new Date(ms);
  },
} as const;

export { GREGORIAN_CUTOVER_DAY };
