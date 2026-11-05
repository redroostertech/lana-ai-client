import { createHash, createHmac, hkdfSync } from "node:crypto";
import { toHex } from "../bytes/hex.js";

export function sha256(data: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(data).digest());
}

/** Lowercase hex SHA-256, as `Digest.sha256Hex`. */
export function sha256Hex(data: Uint8Array): string {
  return toHex(sha256(data));
}

export function hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array {
  return new Uint8Array(createHmac("sha256", key).update(message).digest());
}

/** RFC 5869 HKDF-SHA256. An empty salt means a zero-filled salt, as in CryptoKit. */
export function hkdfSha256(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Uint8Array {
  return new Uint8Array(hkdfSync("sha256", ikm, salt, info, length));
}
