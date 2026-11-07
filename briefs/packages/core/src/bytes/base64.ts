const STRICT_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const BASE64_URL = /^[A-Za-z0-9_-]*$/;

/** Standard padded base64, the form Swift's `JSONEncoder` uses for `Data`. */
export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
}

/** Strict padded base64, as `Data(base64Encoded:)` accepts it. Returns null otherwise. */
export function fromBase64(text: string): Uint8Array | null {
  if (!STRICT_BASE64.test(text)) return null;
  return new Uint8Array(Buffer.from(text, "base64"));
}

/** Base64url without padding (`Data.base64URLEncodedString` in LanaCrypto). */
export function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function fromBase64Url(text: string): Uint8Array | null {
  if (!BASE64_URL.test(text) || text.length % 4 === 1) return null;
  let base64 = text.replaceAll("-", "+").replaceAll("_", "/");
  while (base64.length % 4 !== 0) base64 += "=";
  return fromBase64(base64);
}
