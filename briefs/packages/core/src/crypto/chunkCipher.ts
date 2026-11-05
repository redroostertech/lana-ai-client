import { createCipheriv, createDecipheriv } from "node:crypto";
import { concatBytes } from "../bytes/concat.js";
import { randomBytes } from "./random.js";

const NONCE = 12;
const TAG = 16;

export class ChunkCipherError extends Error {
  override readonly name = "ChunkCipherError";
}

/**
 * AES-256-GCM in CryptoKit's `combined` layout: `nonce (12) | ciphertext | tag (16)`.
 * The AAD binds a chunk to its bundle, position and count (or a recording context).
 */
export const ChunkCipher = {
  seal(plaintext: Uint8Array, key: Uint8Array, aad: Uint8Array, nonce: Uint8Array = randomBytes(NONCE)): Uint8Array {
    if (key.length !== 32 || nonce.length !== NONCE) throw new ChunkCipherError("Bad key or nonce size");
    const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: TAG });
    cipher.setAAD(aad);
    const body = concatBytes(cipher.update(plaintext), cipher.final());
    return concatBytes(nonce, body, cipher.getAuthTag());
  },

  open(sealed: Uint8Array, key: Uint8Array, aad: Uint8Array): Uint8Array {
    if (key.length !== 32 || sealed.length < NONCE + TAG) throw new ChunkCipherError("Sealed chunk is malformed");
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, sealed.subarray(0, NONCE), { authTagLength: TAG });
      decipher.setAAD(aad);
      decipher.setAuthTag(sealed.subarray(sealed.length - TAG));
      return concatBytes(decipher.update(sealed.subarray(NONCE, sealed.length - TAG)), decipher.final());
    } catch {
      throw new ChunkCipherError("Chunk failed authentication");
    }
  },
} as const;
