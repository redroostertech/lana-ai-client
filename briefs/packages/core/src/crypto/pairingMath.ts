import { bytesEqualConstantTime, concatBytes } from "../bytes/concat.js";
import { utf8 } from "../bytes/utf8.js";
import type { LanaId } from "../ids/lanaId.js";
import type { DeviceIdentity } from "./deviceIdentity.js";
import type { DevicePublicKeys } from "./devicePublicKeys.js";
import { hkdfSha256, hmacSha256 } from "./digest.js";
import type { PairingInvitation } from "./pairingInvitation.js";

/** Six-digit short authentication string both screens show. */
export function shortCode(invitation: PairingInvitation, phone: DevicePublicKeys): string {
  const transcript = concatBytes(
    utf8("lana.sas/v1"),
    invitation.mac.signingKey,
    invitation.mac.agreementKey,
    phone.signingKey,
    phone.agreementKey,
  );
  const mac = hmacSha256(invitation.oneTimeSecret, transcript);
  const value = new DataView(mac.buffer, mac.byteOffset, 4).getUint32(0, false);
  return String(value % 1_000_000).padStart(6, "0");
}

function proofMessage(phone: DevicePublicKeys): Uint8Array {
  return concatBytes(utf8("lana.pair.proof/v1"), phone.signingKey, phone.agreementKey, utf8(phone.deviceID));
}

/** Proof that the phone saw the QR code: HMAC of its public keys under the secret. */
export function phoneProof(invitation: PairingInvitation, phone: DevicePublicKeys): Uint8Array {
  return hmacSha256(invitation.oneTimeSecret, proofMessage(phone));
}

export function verifyPhoneProof(proof: Uint8Array, invitation: PairingInvitation, phone: DevicePublicKeys): boolean {
  return bytesEqualConstantTime(proof, phoneProof(invitation, phone));
}

/** Long-term transport PSK: HKDF over the ECDH of the pinned agreement keys, salted with both device ids. */
export function transportPsk(identity: DeviceIdentity, peer: DevicePublicKeys, macID: LanaId, phoneID: LanaId): Uint8Array {
  const secret = identity.sharedSecret(peer.agreementKey);
  return hkdfSha256(secret, utf8(`${macID}|${phoneID}`), utf8("lana.transport.psk/v1"), 32);
}
