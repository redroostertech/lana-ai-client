import { createECDH, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, sign, verify, type JsonWebKey, type KeyObject } from "node:crypto";
import { fromBase64Url, toBase64Url } from "../bytes/base64.js";
import { concatBytes } from "../bytes/concat.js";

/**
 * P-256 keys in the representations CryptoKit uses: 32-byte private scalars
 * (`rawRepresentation`) and 65-byte uncompressed public points (`x963Representation`).
 * Keys are imported through JWK because Electron's BoringSSL rejects PKCS#8 EC keys
 * that omit the public point.
 */
export interface P256PrivateKey {
  readonly raw: Uint8Array;
  readonly x963: Uint8Array;
  readonly keyObject: KeyObject;
  readonly jwk: JsonWebKey;
}

export class P256KeyError extends Error {
  override readonly name = "P256KeyError";
}

const X963_LENGTH = 65;
const SIGNATURE_LENGTH = 64;

export function p256PrivateKeyFromRaw(raw: Uint8Array): P256PrivateKey {
  if (raw.length !== 32) throw new P256KeyError("P-256 private key must be 32 bytes");
  const ecdh = createECDH("prime256v1");
  let x963: Uint8Array;
  try {
    ecdh.setPrivateKey(raw);
    x963 = new Uint8Array(ecdh.getPublicKey());
  } catch {
    throw new P256KeyError("Invalid P-256 private key");
  }
  const jwk: JsonWebKey = { kty: "EC", crv: "P-256", d: toBase64Url(raw), x: toBase64Url(x963.subarray(1, 33)), y: toBase64Url(x963.subarray(33)) };
  return { raw: new Uint8Array(raw), x963, keyObject: createPrivateKey({ key: jwk, format: "jwk" }), jwk };
}

export function generateP256PrivateKey(): P256PrivateKey {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const d = privateKey.export({ format: "jwk" }).d;
  const raw = d === undefined ? null : fromBase64Url(d);
  if (raw === null) throw new P256KeyError("Could not export generated key");
  return p256PrivateKeyFromRaw(raw);
}

export function p256PublicKeyFromX963(x963: Uint8Array): KeyObject {
  if (x963.length !== X963_LENGTH || x963[0] !== 0x04) throw new P256KeyError("Expected an uncompressed P-256 point");
  try {
    return createPublicKey({ key: { kty: "EC", crv: "P-256", x: toBase64Url(x963.subarray(1, 33)), y: toBase64Url(x963.subarray(33)) }, format: "jwk" });
  } catch {
    throw new P256KeyError("Point is not on P-256");
  }
}

export function x963FromPublicKey(key: KeyObject): Uint8Array {
  const jwk = key.export({ format: "jwk" });
  const x = jwk.x === undefined ? null : fromBase64Url(jwk.x);
  const y = jwk.y === undefined ? null : fromBase64Url(jwk.y);
  if (x === null || y === null) throw new P256KeyError("Not an EC public key");
  return concatBytes(Uint8Array.of(0x04), x, y);
}

/** ECDSA P-256 over SHA-256, raw `r || s` (64 bytes), as CryptoKit's `rawRepresentation`. */
export function p256Sign(key: P256PrivateKey, message: Uint8Array): Uint8Array {
  return new Uint8Array(sign("sha256", message, { key: key.keyObject, dsaEncoding: "ieee-p1363" }));
}

export function p256Verify(publicX963: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
  if (signature.length !== SIGNATURE_LENGTH) return false;
  try {
    return verify("sha256", message, { key: p256PublicKeyFromX963(publicX963), dsaEncoding: "ieee-p1363" }, signature);
  } catch {
    return false;
  }
}

/** ECDH shared secret: the 32-byte x coordinate, as CryptoKit's `SharedSecret`. */
export function p256SharedSecret(key: P256PrivateKey, peerX963: Uint8Array): Uint8Array {
  return new Uint8Array(diffieHellman({ privateKey: key.keyObject, publicKey: p256PublicKeyFromX963(peerX963) }));
}
