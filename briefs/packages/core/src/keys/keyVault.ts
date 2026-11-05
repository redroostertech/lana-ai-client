import { toBase64 } from "../bytes/base64.js";
import { SoftwareIdentity } from "../crypto/deviceIdentity.js";
import { p256PrivateKeyFromRaw } from "../crypto/p256.js";
import { randomBytes } from "../crypto/random.js";
import { asLanaId } from "../ids/codec.js";
import { canonicalEncode } from "../json/canonical.js";
import { parseJson } from "../json/parse.js";
import { asBytes, asObject, asString, field } from "../json/read.js";
import type { DataKeyProvider } from "./dataKeyProvider.js";
import { KeyVaultError } from "./keyVaultError.js";
import { InMemorySecretBackend, SealedFileSecretBackend, type SecretBackend, type SecretSealer } from "./secretBackend.js";

/** Item names, one per Keychain item the Mac app keeps. */
export const VAULT_ITEMS = {
  macIdentity: "identity.mac",
  dataKey: "datakey.gateway",
} as const;

/**
 * Everything the gateway keeps in the OS keystore: this computer's identity keys
 * (`MacIdentityStore`) and the store data key (`KeychainDataKeyProvider`). Sign-in tokens
 * are the LANA client's; Briefs keeps none.
 */
export interface KeyVault extends DataKeyProvider {
  /** Loads the Mac's identity, creating it once. */
  macIdentity(displayName: string): Promise<SoftwareIdentity>;
  /** The store data key, created on first use. */
  dataKey(): Promise<Uint8Array>;
}

/** The vault over any secret backend. */
export class SecretKeyVault implements KeyVault {
  private pendingDataKey: Promise<Uint8Array> | null = null;
  private pendingIdentity: Promise<SoftwareIdentity> | null = null;

  constructor(private readonly backend: SecretBackend) {}

  macIdentity(displayName: string): Promise<SoftwareIdentity> {
    this.pendingIdentity ??= this.loadOrCreateIdentity(displayName).catch((error: unknown) => {
      this.pendingIdentity = null;
      throw error;
    });
    return this.pendingIdentity;
  }

  async dataKey(): Promise<Uint8Array> {
    this.pendingDataKey ??= this.loadOrCreateDataKey().catch((error: unknown) => {
      this.pendingDataKey = null;
      throw error;
    });
    return (await this.pendingDataKey).slice();
  }

  private async loadOrCreateDataKey(): Promise<Uint8Array> {
    const stored = await this.backend.read(VAULT_ITEMS.dataKey);
    if (stored !== null) {
      if (stored.length !== 32) throw new KeyVaultError("corrupt", VAULT_ITEMS.dataKey);
      return stored;
    }
    const key = randomBytes(32);
    await this.backend.write(VAULT_ITEMS.dataKey, key);
    return key;
  }

  private async loadOrCreateIdentity(displayName: string): Promise<SoftwareIdentity> {
    const stored = await this.backend.read(VAULT_ITEMS.macIdentity);
    if (stored !== null) return decodeIdentity(stored);
    const identity = SoftwareIdentity.generate(displayName);
    await this.backend.write(VAULT_ITEMS.macIdentity, encodeIdentity(identity));
    return identity;
  }
}

export function createInMemoryKeyVault(): SecretKeyVault {
  return new SecretKeyVault(new InMemorySecretBackend());
}

/**
 * The Electron vault: secrets sealed by `sealer` (use `safeStorageSealer(safeStorage)`)
 * in files under `directory` (for example `<userData>/keys`).
 */
export function createSealedFileKeyVault(options: { readonly directory: string; readonly sealer: SecretSealer }): SecretKeyVault {
  return new SecretKeyVault(new SealedFileSecretBackend(options.directory, options.sealer));
}

/**
 * Same shape as Swift `SecureEnclaveIdentity.Serialized` (camelCase keys, base64 data),
 * holding raw P-256 scalars instead of enclave blobs.
 */
function encodeIdentity(identity: SoftwareIdentity): Uint8Array {
  const keys = identity.exportPrivateKeys();
  return canonicalEncode({
    deviceID: identity.publicKeys.deviceID,
    displayName: identity.publicKeys.displayName,
    signing: toBase64(keys.signing),
    agreement: toBase64(keys.agreement),
  });
}

function decodeIdentity(data: Uint8Array): SoftwareIdentity {
  try {
    const object = asObject(parseJson(data), "identity");
    return new SoftwareIdentity(
      field(object, "deviceID", "identity", asLanaId),
      field(object, "displayName", "identity", asString),
      p256PrivateKeyFromRaw(field(object, "signing", "identity", asBytes)),
      p256PrivateKeyFromRaw(field(object, "agreement", "identity", asBytes)),
    );
  } catch {
    throw new KeyVaultError("corrupt", VAULT_ITEMS.macIdentity);
  }
}
