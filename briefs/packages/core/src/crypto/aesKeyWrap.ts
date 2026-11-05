import { createCipheriv, createDecipheriv } from "node:crypto";
import { bytesEqualConstantTime } from "../bytes/concat.js";

/**
 * RFC 3394 AES key wrap (CryptoKit `AES.KeyWrap`), built on single-block AES-256-ECB.
 * Node's `id-aes256-wrap` cipher is not available under Electron's BoringSSL, so the
 * six-round wrap is done here.
 */
const DEFAULT_IV = Uint8Array.of(0xa6, 0xa6, 0xa6, 0xa6, 0xa6, 0xa6, 0xa6, 0xa6);

export class KeyWrapError extends Error {
  override readonly name = "KeyWrapError";
}

function block(kek: Uint8Array, input: Uint8Array, encrypt: boolean): Uint8Array {
  const cipher = encrypt ? createCipheriv("aes-256-ecb", kek, null) : createDecipheriv("aes-256-ecb", kek, null);
  cipher.setAutoPadding(false);
  return new Uint8Array(cipher.update(input));
}

function xorCounter(a: Uint8Array, t: number): void {
  for (let index = 7; index >= 0 && t > 0; index -= 1) {
    a[index] = (a[index] ?? 0) ^ (t & 0xff);
    t = Math.floor(t / 256);
  }
}

export function aesKeyWrap(kek: Uint8Array, key: Uint8Array): Uint8Array {
  if (kek.length !== 32 || key.length < 16 || key.length % 8 !== 0) throw new KeyWrapError("Bad key wrap sizes");
  const n = key.length / 8;
  const a = DEFAULT_IV.slice();
  const r = Array.from({ length: n }, (_, i) => key.slice(i * 8, i * 8 + 8));
  const buffer = new Uint8Array(16);
  for (let j = 0; j < 6; j += 1) {
    for (let i = 0; i < n; i += 1) {
      buffer.set(a, 0);
      buffer.set(r[i] as Uint8Array, 8);
      const b = block(kek, buffer, true);
      a.set(b.subarray(0, 8));
      xorCounter(a, n * j + i + 1);
      r[i] = b.slice(8);
    }
  }
  const out = new Uint8Array(8 + key.length);
  out.set(a, 0);
  r.forEach((part, i) => out.set(part, 8 + i * 8));
  return out;
}

export function aesKeyUnwrap(kek: Uint8Array, wrapped: Uint8Array): Uint8Array {
  if (kek.length !== 32 || wrapped.length < 24 || wrapped.length % 8 !== 0) throw new KeyWrapError("Bad key wrap sizes");
  const n = wrapped.length / 8 - 1;
  const a = wrapped.slice(0, 8);
  const r = Array.from({ length: n }, (_, i) => wrapped.slice(8 + i * 8, 16 + i * 8));
  const buffer = new Uint8Array(16);
  for (let j = 5; j >= 0; j -= 1) {
    for (let i = n - 1; i >= 0; i -= 1) {
      xorCounter(a, n * j + i + 1);
      buffer.set(a, 0);
      buffer.set(r[i] as Uint8Array, 8);
      const b = block(kek, buffer, false);
      a.set(b.subarray(0, 8));
      r[i] = b.slice(8);
    }
  }
  if (!bytesEqualConstantTime(a, DEFAULT_IV)) throw new KeyWrapError("Key unwrap failed integrity check");
  const out = new Uint8Array(n * 8);
  r.forEach((part, i) => out.set(part, i * 8));
  return out;
}
