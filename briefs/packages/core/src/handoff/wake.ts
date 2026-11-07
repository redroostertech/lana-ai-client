import { toHex } from "../bytes/hex.js";
import { utf8 } from "../bytes/utf8.js";
import { hmacSha256 } from "../crypto/digest.js";
import type { LanaId } from "../ids/lanaId.js";

const TAG_BYTES = 8;

/**
 * One phone's wake flag for the gateway's Bonjour TXT record (Swift `HandoffWake.value`):
 * `<nonce hex>.<tag hex>`, the tag being HMAC-SHA256(transport PSK,
 * "lana.wake/v1|<Mac id>|<nonce hex>") cut to 8 bytes. Only the paired phone recognises it.
 */
export function wakeValue(psk: Uint8Array, macID: LanaId, nonce: Uint8Array): string {
  const nonceHex = toHex(nonce);
  return `${nonceHex}.${toHex(hmacSha256(psk, utf8(`lana.wake/v1|${macID}|${nonceHex}`)).slice(0, TAG_BYTES))}`;
}
