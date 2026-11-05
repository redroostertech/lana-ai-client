import { HTTPError } from "./httpError.js";
import type { HTTPExchange } from "./httpTransport.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** `EEE, dd MMM yyyy HH:mm:ss zzz` as Foundation reads it (the weekday is not checked). */
const HTTP_DATE = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), (\d{2}) ([A-Z][a-z]{2}) (\d{4}) (\d{2}):(\d{2}):(\d{2}) (GMT|UTC)$/;
const DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
/** Foundation `.whitespaces`: Zs, tab and U+200B. */
const EDGE_SPACES = /^[\p{Zs}\t\u{200B}]+|[\p{Zs}\t\u{200B}]+$/gu;

/**
 * A completed exchange (Swift `HTTPResponse`). Non-2xx statuses are returned, not thrown,
 * so callers such as the OAuth client can read structured error bodies.
 */
export class HTTPResponse {
  constructor(readonly exchange: HTTPExchange) {}

  get status(): number {
    return this.exchange.status;
  }

  get body(): Uint8Array {
    return this.exchange.body;
  }

  get isSuccess(): boolean {
    return this.status >= 200 && this.status <= 299;
  }

  /** Case-insensitive header lookup. */
  header(name: string): string | undefined {
    const wanted = name.toLowerCase();
    for (const [key, value] of Object.entries(this.exchange.headers)) if (key.toLowerCase() === wanted) return value;
    return undefined;
  }

  /** Retry-After as seconds, accepting both delta-seconds and an HTTP date. */
  retryAfter(now: Date): number | undefined {
    const header = this.header("Retry-After");
    if (header === undefined) return undefined;
    return parseRetryAfter(header, now);
  }

  requireSuccess(now: Date = new Date()): this {
    if (!this.isSuccess) throw HTTPError.status(this.status, this.retryAfter(now));
    return this;
  }
}

export function parseRetryAfter(header: string, now: Date): number | undefined {
  const raw = header.replace(EDGE_SPACES, "");
  if (DECIMAL.test(raw)) return Math.max(0, Number(raw));
  const match = HTTP_DATE.exec(raw);
  if (match === null) return undefined;
  const [, day, monthName, year, hour, minute, second] = match;
  const month = MONTHS.indexOf(monthName ?? "");
  if (month < 0) return undefined;
  const at = Date.UTC(Number(year), month, Number(day), Number(hour), Number(minute), Number(second));
  return Math.max(0, (at - now.getTime()) / 1000);
}
