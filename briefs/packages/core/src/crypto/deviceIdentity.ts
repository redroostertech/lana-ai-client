import { makeLanaId, type LanaId } from "../ids/lanaId.js";
import type { DevicePublicKeys } from "./devicePublicKeys.js";
import { openHpke, type HpkeEnvelope } from "./hpke.js";
import { generateP256PrivateKey, p256SharedSecret, p256Sign, type P256PrivateKey } from "./p256.js";

/** A device's private keys behind one interface, so hardware-backed keys can replace software ones later. */
export interface DeviceIdentity {
  readonly publicKeys: DevicePublicKeys;
  /** Raw (r||s) P-256 ECDSA signature over SHA-256 of `message`. */
  sign(message: Uint8Array): Uint8Array;
  /** ECDH with a peer's X9.63 agreement key. */
  sharedSecret(peerAgreementKey: Uint8Array): Uint8Array;
  /** Opens an HPKE envelope addressed to this device's agreement key. */
  openHpke(envelope: HpkeEnvelope, info: Uint8Array, aad?: Uint8Array): Promise<Uint8Array>;
}

/** Software P-256 keys (Swift `SoftwareIdentity`). The app seals the raw keys with the OS keystore. */
export class SoftwareIdentity implements DeviceIdentity {
  readonly publicKeys: DevicePublicKeys;

  constructor(
    deviceID: LanaId,
    displayName: string,
    private readonly signing: P256PrivateKey = generateP256PrivateKey(),
    private readonly agreement: P256PrivateKey = generateP256PrivateKey(),
  ) {
    this.publicKeys = { deviceID, signingKey: signing.x963, agreementKey: agreement.x963, displayName };
  }

  static generate(displayName: string): SoftwareIdentity {
    return new SoftwareIdentity(makeLanaId("device"), displayName);
  }

  /** Raw private scalars, for sealing into the OS keystore. Never log these. */
  exportPrivateKeys(): { readonly signing: Uint8Array; readonly agreement: Uint8Array } {
    return { signing: this.signing.raw.slice(), agreement: this.agreement.raw.slice() };
  }

  sign(message: Uint8Array): Uint8Array {
    return p256Sign(this.signing, message);
  }

  sharedSecret(peerAgreementKey: Uint8Array): Uint8Array {
    return p256SharedSecret(this.agreement, peerAgreementKey);
  }

  openHpke(envelope: HpkeEnvelope, info: Uint8Array, aad?: Uint8Array): Promise<Uint8Array> {
    return openHpke(envelope, this.agreement, info, aad);
  }
}
