import { concatBytes } from "../bytes/concat.js";
import { utf8 } from "../bytes/utf8.js";
import type { AttestationMethod } from "./messages.js";

/** Bytes the phone signs: domain tag, session, nonce, connection binding, method. */
export function attestationSignedBytes(sessionID: string, nonce: Uint8Array, channelBinding: Uint8Array, method: AttestationMethod): Uint8Array {
  const zero = Uint8Array.of(0);
  return concatBytes(utf8("lana.attest/v1"), zero, utf8(sessionID), zero, nonce, channelBinding, utf8(method));
}
