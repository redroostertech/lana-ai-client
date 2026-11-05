import { utf8 } from "../bytes/utf8.js";
import { ChunkCipher } from "../crypto/chunkCipher.js";
import { canonicalEncode } from "../json/canonical.js";
import type { JsonValue } from "../json/jsonValue.js";
import { parseJson } from "../json/parse.js";
import { StoreError } from "./errors.js";

export const STORE_AAD_PREFIX = "lana.gateway|";

/**
 * Field encryption at rest, identical to `GatewayStore.seal/open`: AES-256-GCM
 * (`ChunkCipher`, nonce | ciphertext | tag) under the store data key, with AAD
 * `lana.gateway|<context>` so a sealed value cannot be moved to another row or column.
 */
export class FieldSealer {
  constructor(private readonly key: Uint8Array) {
    if (key.length !== 32) throw StoreError.corrupt("data key");
  }

  seal(data: Uint8Array, context: string): Uint8Array {
    return ChunkCipher.seal(data, this.key, utf8(STORE_AAD_PREFIX + context));
  }

  open(data: Uint8Array, context: string): Uint8Array {
    try {
      return ChunkCipher.open(data, this.key, utf8(STORE_AAD_PREFIX + context));
    } catch {
      throw StoreError.corrupt(context);
    }
  }

  sealJson(value: JsonValue, context: string): Uint8Array {
    return this.seal(canonicalEncode(value), context);
  }

  openJson(data: Uint8Array, context: string): JsonValue {
    const plaintext = this.open(data, context);
    try {
      return parseJson(plaintext);
    } catch {
      throw StoreError.corrupt(context);
    }
  }
}
