import { toBase64Url } from "../../bytes/base64.js";
import { utf8 } from "../../bytes/utf8.js";
import { sha256 } from "../../crypto/digest.js";
import { randomBytes } from "../../crypto/random.js";

/** RFC 7636 proof key, S256 method only (Swift `PKCE`). */
export class PKCE {
  static readonly method = "S256";

  readonly challenge: string;

  /** Derives the challenge from a known verifier (used for test vectors and restore). */
  constructor(readonly verifier: string) {
    this.challenge = toBase64Url(sha256(utf8(verifier)));
  }

  /** Builds a verifier from raw entropy: base64url of the bytes, no padding. */
  static fromRandomBytes(bytes: Uint8Array): PKCE {
    return new PKCE(toBase64Url(bytes));
  }

  /** 32 random bytes, which yields the 43-character verifier RFC 7636 recommends. */
  static generate(): PKCE {
    return PKCE.fromRandomBytes(randomBytes(32));
  }
}
