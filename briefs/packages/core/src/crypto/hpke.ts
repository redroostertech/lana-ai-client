import { Aes256Gcm, CipherSuite, DhkemP256HkdfSha256, HkdfSha256 } from "@hpke/core";
import type { JsonObject, JsonValue } from "../json/jsonValue.js";
import { asBytes, asObject, field } from "../json/read.js";
import { toBase64 } from "../bytes/base64.js";
import type { P256PrivateKey } from "./p256.js";

/** One HPKE (RFC 9180) base-mode message: DHKEM(P-256, HKDF-SHA256), HKDF-SHA256, AES-256-GCM. */
export interface HpkeEnvelope {
  readonly encapsulatedKey: Uint8Array;
  readonly ciphertext: Uint8Array;
}

export class HpkeOpenError extends Error {
  override readonly name = "HpkeOpenError";
}

let suite: CipherSuite | undefined;

function cipherSuite(): CipherSuite {
  suite ??= new CipherSuite({ kem: new DhkemP256HkdfSha256(), kdf: new HkdfSha256(), aead: new Aes256Gcm() });
  return suite;
}

function buffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

/** Opens an envelope addressed to `recipient`. The private key goes in through JWK (see p256.ts). */
export async function openHpke(envelope: HpkeEnvelope, recipient: P256PrivateKey, info: Uint8Array, aad: Uint8Array = new Uint8Array()): Promise<Uint8Array> {
  const hpke = cipherSuite();
  try {
    const recipientKey = await hpke.kem.importKey("jwk", { ...recipient.jwk }, false);
    const plaintext = await hpke.open({ recipientKey, enc: buffer(envelope.encapsulatedKey), info: buffer(info) }, buffer(envelope.ciphertext), buffer(aad));
    return new Uint8Array(plaintext);
  } catch {
    throw new HpkeOpenError("HPKE envelope did not open");
  }
}

/** Seals to a recipient's X9.63 agreement key. The desktop only needs this for tests and tools. */
export async function sealHpke(plaintext: Uint8Array, recipientX963: Uint8Array, info: Uint8Array, aad: Uint8Array = new Uint8Array()): Promise<HpkeEnvelope> {
  const hpke = cipherSuite();
  const recipientPublicKey = await hpke.kem.importKey("raw", buffer(recipientX963), true);
  const sealed = await hpke.seal({ recipientPublicKey, info: buffer(info) }, buffer(plaintext), buffer(aad));
  return { encapsulatedKey: new Uint8Array(sealed.enc), ciphertext: new Uint8Array(sealed.ct) };
}

export function encodeHpkeEnvelope(envelope: HpkeEnvelope): JsonObject {
  return { enc: toBase64(envelope.encapsulatedKey), ct: toBase64(envelope.ciphertext) };
}

export function decodeHpkeEnvelope(value: JsonValue, path: string): HpkeEnvelope {
  const object = asObject(value, path);
  return { encapsulatedKey: field(object, "enc", path, asBytes), ciphertext: field(object, "ct", path, asBytes) };
}
