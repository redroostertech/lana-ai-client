import { utf8 } from "../bytes/utf8.js";
import { aesKeyUnwrap, aesKeyWrap } from "./aesKeyWrap.js";
import { ChunkCipher } from "./chunkCipher.js";
import { randomBytes } from "./random.js";

/**
 * At-rest encryption for one recording (Swift `RecordingKey` in AtRestCipher.swift): a
 * random 256-bit key, wrapped by the device master key with AES key wrap; content is
 * sealed with AES-GCM using the context string as AAD.
 */
export class RecordingKey {
  constructor(readonly key: Uint8Array = randomBytes(32)) {
    if (key.length !== 32) throw new RangeError("Recording key must be 32 bytes");
  }

  wrapped(master: Uint8Array): Uint8Array {
    return aesKeyWrap(master, this.key);
  }

  static unwrap(wrapped: Uint8Array, master: Uint8Array): RecordingKey {
    return new RecordingKey(aesKeyUnwrap(master, wrapped));
  }

  seal(plaintext: Uint8Array, context: string): Uint8Array {
    return ChunkCipher.seal(plaintext, this.key, utf8(context));
  }

  open(sealed: Uint8Array, context: string): Uint8Array {
    return ChunkCipher.open(sealed, this.key, utf8(context));
  }
}
