import { utf8 } from "../bytes/utf8.js";

const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
/** What URLComponents leaves raw in a query item name or value (`&`, `=`, `#`, `%` and the rest are escaped). */
const QUERY_ALLOWED = new Set(`${ALNUM}!$'()*+,-./:;?@_~`);
/** `CharacterSet.urlPathAllowed` without `/`. */
export const PATH_SEGMENT_ALLOWED = new Set(`${ALNUM}-._~!$&'()*+,;=:@`);
/** RFC 3986 unreserved: what `FormEncoding` leaves raw. */
export const FORM_ALLOWED = new Set(`${ALNUM}-._~`);

/** Percent-encodes every UTF-8 byte outside `allowed` with uppercase hex, as `addingPercentEncoding`. */
export function percentEncode(text: string, allowed: ReadonlySet<string>): string {
  let out = "";
  for (const character of text) {
    if (character.length === 1 && allowed.has(character)) {
      out += character;
      continue;
    }
    for (const byte of utf8(character)) out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

/** `URLComponents.queryItems` in the given order, appended to `base` (which may already carry a query). */
export function withQuery(base: string, items: readonly (readonly [string, string])[]): string {
  if (items.length === 0) return base;
  const encoded = items.map(([name, value]) => `${percentEncode(name, QUERY_ALLOWED)}=${percentEncode(value, QUERY_ALLOWED)}`).join("&");
  return `${base}${base.includes("?") ? "&" : "?"}${encoded}`;
}

/** `URL.appending(path:)` for the plain relative paths the executors use. */
export function appendingPath(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

/**
 * Query items of a URL as `URLComponents.queryItems` reads them: percent decoded, `+`
 * left as is, a missing `=` gives no value. Null when the URL cannot be parsed.
 */
export function queryItems(url: string): { readonly name: string; readonly value: string | undefined }[] | null {
  const hash = url.indexOf("#");
  const withoutFragment = hash < 0 ? url : url.slice(0, hash);
  const start = withoutFragment.indexOf("?");
  if (start < 0) return [];
  const query = withoutFragment.slice(start + 1);
  if (query.length === 0) return [];
  try {
    return query.split("&").map((part) => {
      const equals = part.indexOf("=");
      if (equals < 0) return { name: decodeURIComponent(part), value: undefined };
      return { name: decodeURIComponent(part.slice(0, equals)), value: decodeURIComponent(part.slice(equals + 1)) };
    });
  } catch {
    return null;
  }
}

/** Scheme and lowercased host of an absolute URL, or null. */
export function schemeAndHost(url: string): { readonly scheme: string; readonly host: string } | null {
  const match = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/(?:[^@/?#]*@)?(\[[^\]]*\]|[^:/?#]*)/.exec(url);
  if (match === null) return null;
  return { scheme: (match[1] ?? "").toLowerCase(), host: (match[2] ?? "").toLowerCase() };
}

/** `URL(string:)`: the string kept verbatim when it parses, otherwise undefined. */
export function parseURL(raw: string | null | undefined): string | undefined {
  if (raw === null || raw === undefined || raw.length === 0) return undefined;
  return URL.canParse(raw) || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw) ? raw : undefined;
}
