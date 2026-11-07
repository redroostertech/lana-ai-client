import { randomFillSync } from "node:crypto";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const VALID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

/** A 26-character Crockford base32 ULID: 48 bits of milliseconds, then 80 random bits. */
export function makeUlid(milliseconds: number, random: Uint8Array = randomFillSync(new Uint8Array(10))): string {
  if (random.length !== 10) throw new RangeError("ULID randomness must be 10 bytes");
  const millis = BigInt(Math.max(0, Math.trunc(milliseconds)));
  let value = millis & 0xffff_ffff_ffffn;
  for (const byte of random) value = (value << 8n) | BigInt(byte);
  let out = "";
  for (let index = 0; index < 26; index += 1) {
    out = ALPHABET[Number(value & 31n)] + out;
    value >>= 5n;
  }
  return out;
}

/** Uppercase only, and the first character carries 3 bits, so it is at most `7`. */
export function isValidUlid(value: string): boolean {
  return VALID.test(value);
}
