import { FORM_ALLOWED, percentEncode } from "../url.js";

/** `application/x-www-form-urlencoded` with only RFC 3986 unreserved characters left raw (Swift `FormEncoding`). */
export function formEncode(pairs: readonly (readonly [string, string])[]): string {
  return pairs.map(([name, value]) => `${percentEncode(name, FORM_ALLOWED)}=${percentEncode(value, FORM_ALLOWED)}`).join("&");
}
